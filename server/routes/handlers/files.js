const fs = require("fs");
const { sendJson, readJson, serverErrorPayload, isPathInsideRoot, getCorsHeaders } = require("../../http-utils");
const { saveContractFile, getContractFiles, getFileById, deleteFile, WORKBENCH_ROOT, appendAuditLog, saveFile } = require("../../store");
const { validateUploadedPayload } = require("../upload-utils");

async function handleFiles(req, res, url) {
  if (req.method === "GET" && url.pathname.startsWith("/api/contracts/") && url.pathname.endsWith("/files")) {
    try {
      const parts = url.pathname.split("/");
      const contractId = decodeURIComponent(parts[3]);
      const fileType = url.searchParams.get("type") || null;
      sendJson(res, 200, { ok: true, files: getContractFiles(contractId, fileType) }, req);
    } catch (error) {
      sendJson(res, error.statusCode || 500, serverErrorPayload(error, "Failed to list archived files"), req);
    }
    return true;
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/contracts/") && url.pathname.endsWith("/files")) {
    try {
      const parts = url.pathname.split("/");
      const contractId = decodeURIComponent(parts[3]);
      const payload = await readJson(req);
      const validated = validateUploadedPayload(payload, ["attachment", "version"]);
      const result = saveContractFile(
        contractId,
        payload.versionId || null,
        validated.buffer,
        validated.originalName,
        validated.mimeType,
        validated.fileType
      );
      appendAuditLog({
        action: "archive-contract-file",
        contractId,
        details: { originalName: validated.originalName, fileType: validated.fileType, mimeType: validated.mimeType },
      });
      sendJson(res, 200, { ok: true, file: result }, req);
    } catch (error) {
      sendJson(res, error.statusCode || 500, serverErrorPayload(error, "Failed to archive uploaded file"), req);
    }
    return true;
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/contracts/") && url.pathname.endsWith("/exports")) {
    try {
      const parts = url.pathname.split("/");
      const contractId = decodeURIComponent(parts[3]);
      const payload = await readJson(req);
      const validated = validateUploadedPayload({ ...payload, fileType: "export" }, ["export"]);
      const result = saveContractFile(
        contractId,
        payload.versionId || null,
        validated.buffer,
        validated.originalName || "export.docx",
        validated.mimeType || "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "export"
      );
      appendAuditLog({
        action: "archive-contract-export",
        contractId,
        details: { originalName: validated.originalName || "export.docx", mimeType: validated.mimeType || "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
      });
      sendJson(res, 200, { ok: true, file: result }, req);
    } catch (error) {
      sendJson(res, error.statusCode || 500, serverErrorPayload(error, "Failed to archive export file"), req);
    }
    return true;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/files/") && url.pathname.endsWith("/download")) {
    try {
      const parts = url.pathname.split("/");
      const fileId = decodeURIComponent(parts[3]);
      const file = getFileById(fileId);
      if (!file) {
        sendJson(res, 404, { ok: false, error: "File not found" }, req);
        return true;
      }
      if (!fs.existsSync(file.path)) {
        sendJson(res, 404, { ok: false, error: "File missing on disk" }, req);
        return true;
      }
      if (!isPathInsideRoot(WORKBENCH_ROOT, file.path)) {
        sendJson(res, 403, { ok: false, error: "File path escaped workbench root" }, req);
        return true;
      }
      const stat = fs.statSync(file.path);
      res.writeHead(200, {
        "Content-Type": file.mimeType || "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        "Content-Length": stat.size,
        ...getCorsHeaders(req),
      });
      const stream = fs.createReadStream(file.path);
      if (typeof res.setTimeout === "function") {
        res.setTimeout(30000, () => {
          stream.destroy();
          if (res.destroyed) return;
          if (!res.headersSent) {
            sendJson(res, 504, { ok: false, error: "Download timed out" }, req);
          } else {
            res.destroy();
          }
        });
      }
      stream.on("error", (err) => {
        try {
          if (res.destroyed) return;
          if (!res.headersSent) {
            sendJson(res, 500, { ok: false, error: "Failed to stream archived file" }, req);
          } else {
            res.destroy(err);
          }
        } catch (error) {}
      });
      if (typeof req.on === "function") {
        req.on("close", () => { stream.destroy(); });
      }
      stream.pipe(res, { end: true });
    } catch (error) {
      sendJson(res, error.statusCode || 500, serverErrorPayload(error, "Failed to download archived file"), req);
    }
    return true;
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/files/")) {
    try {
      const parts = url.pathname.split("/");
      const fileId = decodeURIComponent(parts[3]);
      const file = deleteFile(fileId);
      sendJson(res, 200, { ok: true, file }, req);
    } catch (error) {
      sendJson(res, error.statusCode || 500, serverErrorPayload(error, "Failed to delete archived file"), req);
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/files") {
    try {
      const payload = await readJson(req);
      sendJson(res, 200, { ok: true, file: saveFile(payload.name, payload.content) }, req);
    } catch (error) {
      sendJson(res, error.statusCode || 500, serverErrorPayload(error, "Failed to save local file"), req);
    }
    return true;
  }

  return false;
}

module.exports = { handleFiles };
