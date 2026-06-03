const { sendJson, readJson, isAuthorizedApiRequest } = require("../http-utils");
const { readDb, replaceDb, saveFile, DB_PATH, FILE_DIR, WORKBENCH_ROOT, saveContractFile, getContractFiles, getFileById, deleteFile, getContractFolder, listAllContractsWithPaths, runAutoBackup, search, searchContracts, searchClauses, searchGlobal } = require("../store");
const { analyzeLegalReview, getRunnerStatus } = require("../legal-skill-adapter");
const { runSuggestionAction } = require("../suggestion-action-adapter");
const { runContractIntake } = require("../contract-intake-adapter");
const { runVisualQa } = require("../visual-qa-adapter");
const { extractDocxPackage } = require("../../scripts/docx-extract");
const { createAnalysisJob, cancelJob, summarizeJob, getJob } = require("../jobs");

async function handleApi(req, res, url) {
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {}, req);
    return true;
  }

  if (url.pathname.startsWith("/api/") && !isAuthorizedApiRequest(req)) {
    sendJson(res, 401, { ok: false, error: "Unauthorized" }, req);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      service: "legal-contract-workbench-local-skill-bridge",
      port: Number(process.env.LEGAL_WORKBENCH_PORT || 8787),
      database: DB_PATH,
      fileStorage: FILE_DIR,
      archiveRoot: WORKBENCH_ROOT,
    }, req);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/contracts") {
    sendJson(res, 200, { ok: true, contracts: listAllContractsWithPaths() }, req);
    return true;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/contracts/") && url.pathname.endsWith("/files")) {
    try {
      const parts = url.pathname.split("/");
      const contractId = decodeURIComponent(parts[3]);
      const fileType = url.searchParams.get("type") || null;
      sendJson(res, 200, { ok: true, files: getContractFiles(contractId, fileType) }, req);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message || String(error) }, req);
    }
    return true;
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/contracts/") && url.pathname.endsWith("/files")) {
    try {
      const parts = url.pathname.split("/");
      const contractId = decodeURIComponent(parts[3]);
      const payload = await readJson(req);
      const buffer = Buffer.from(payload.contentBase64 || "", "base64");
      const result = saveContractFile(
        contractId,
        payload.versionId || null,
        buffer,
        payload.originalName || payload.name || "unnamed",
        payload.mimeType || "application/octet-stream",
        payload.fileType || "attachment"
      );
      sendJson(res, 200, { ok: true, file: result }, req);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message || String(error) }, req);
    }
    return true;
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/contracts/") && url.pathname.endsWith("/exports")) {
    try {
      const parts = url.pathname.split("/");
      const contractId = decodeURIComponent(parts[3]);
      const payload = await readJson(req);
      const buffer = Buffer.from(payload.contentBase64 || "", "base64");
      const result = saveContractFile(
        contractId,
        payload.versionId || null,
        buffer,
        payload.originalName || payload.name || "export.docx",
        payload.mimeType || "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "export"
      );
      sendJson(res, 200, { ok: true, file: result }, req);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message || String(error) }, req);
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
      if (!require("fs").existsSync(file.path)) {
        sendJson(res, 404, { ok: false, error: "File missing on disk" }, req);
        return true;
      }
      const content = require("fs").readFileSync(file.path);
      res.writeHead(200, {
        "Content-Type": file.mimeType || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(file.name)}"`,
        "Content-Length": content.length,
        ...require("../http-utils").getCorsHeaders(req),
      });
      res.end(content);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message || String(error) }, req);
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
      sendJson(res, 500, { ok: false, error: error.message || String(error) }, req);
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/backup") {
    try {
      const backupPath = await runAutoBackup();
      sendJson(res, 200, { ok: true, backupPath }, req);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message || String(error) }, req);
    }
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/legal-review/runner-status") {
    sendJson(res, 200, { ok: true, runner: getRunnerStatus() }, req);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/db") {
    sendJson(res, 200, readDb(), req);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/db/sync") {
    try {
      const snapshot = await readJson(req);
      const dbResult = replaceDb(snapshot);
      sendJson(res, 200, { ok: true, db: dbResult }, req);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message || String(error) }, req);
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/files") {
    try {
      const payload = await readJson(req);
      sendJson(res, 200, { ok: true, file: saveFile(payload.name, payload.content) }, req);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message || String(error) }, req);
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/docx/parse") {
    try {
      const payload = await readJson(req);
      const buffer = Buffer.from(payload.contentBase64 || "", "base64");
      const parsed = extractDocxPackage(buffer);
      sendJson(res, 200, { ok: true, fileName: payload.name || "", text: parsed.acceptedText, ...parsed }, req);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message || String(error) }, req);
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/legal-review") {
    try {
      const request = await readJson(req);
      const result = await analyzeLegalReview(request);
      sendJson(res, 200, result, req);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message || String(error) }, req);
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/legal-review/jobs") {
    try {
      const request = await readJson(req);
      const job = createAnalysisJob(request);
      sendJson(res, 202, { ok: true, job: summarizeJob(job) }, req);
    } catch (error) {
      sendJson(res, error.statusCode || 500, { ok: false, error: error.message || String(error) }, req);
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/ai-suggestion/action") {
    try {
      const request = await readJson(req);
      sendJson(res, 200, await runSuggestionAction(request), req);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message || String(error) }, req);
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/contract-intake") {
    try {
      const request = await readJson(req);
      sendJson(res, 200, await runContractIntake(request), req);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message || String(error) }, req);
    }
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/search") {
    try {
      const query = url.searchParams.get("q") || "";
      const types = (url.searchParams.get("types") || "").split(",").filter(Boolean);
      const contractId = url.searchParams.get("contractId") || null;
      const limit = Math.min(Number(url.searchParams.get("limit") || 50), 200);
      const results = search(query, { types, limit, contractId });
      sendJson(res, 200, { ok: true, query, results }, req);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message || String(error) }, req);
    }
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/search/contracts") {
    try {
      const query = url.searchParams.get("q") || "";
      const limit = Math.min(Number(url.searchParams.get("limit") || 20), 100);
      const results = searchContracts(query, limit);
      sendJson(res, 200, { ok: true, query, results }, req);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message || String(error) }, req);
    }
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/search/clauses") {
    try {
      const query = url.searchParams.get("q") || "";
      const contractId = url.searchParams.get("contractId") || null;
      const limit = Math.min(Number(url.searchParams.get("limit") || 20), 100);
      const results = searchClauses(query, contractId, limit);
      sendJson(res, 200, { ok: true, query, contractId, results }, req);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message || String(error) }, req);
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/visual-qa") {
    try {
      const request = await readJson(req);
      sendJson(res, 200, await runVisualQa(request), req);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message || String(error) }, req);
    }
    return true;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/legal-review/jobs/")) {
    const id = decodeURIComponent(url.pathname.split("/").pop());
    const job = getJob(id);
    if (!job) {
      sendJson(res, 404, { ok: false, error: "Job not found" }, req);
      return true;
    }
    sendJson(res, 200, { ok: true, job: summarizeJob(job, true) }, req);
    return true;
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/legal-review/jobs/") && url.pathname.endsWith("/cancel")) {
    const parts = url.pathname.split("/");
    const id = decodeURIComponent(parts[parts.length - 2] || "");
    const job = getJob(id);
    if (!job) {
      sendJson(res, 404, { ok: false, error: "Job not found" }, req);
      return true;
    }
    cancelJob(id);
    sendJson(res, 200, { ok: true, job: summarizeJob(job, true) }, req);
    return true;
  }

  return false;
}

module.exports = { handleApi };
