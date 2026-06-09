const path = require("path");
const { sendJson, readJson, isAuthorizedApiRequest, serverErrorPayload } = require("../http-utils");
const { readDb, replaceDb, saveFile, DB_PATH, FILE_DIR, WORKBENCH_ROOT, saveContractFile, getContractFiles, getFileById, deleteFile, getContractFolder, listAllContractsWithPaths, runAutoBackup, search, searchContracts, searchClauses, searchGlobal } = require("../store");
const { analyzeLegalReview, getRunnerStatus } = require("../legal-skill-adapter");
const { runSuggestionAction, getRunnerStatus: getSuggestionRunnerStatus } = require("../suggestion-action-adapter");
const { runContractIntake, getRunnerStatus: getIntakeRunnerStatus } = require("../contract-intake-adapter");
const { runVisualQa, getRunnerStatus: getVisualQaRunnerStatus } = require("../visual-qa-adapter");
const { extractDocxPackage } = require("../../scripts/docx-extract");
const { createAnalysisJob, cancelJob, summarizeJob, getJob } = require("../jobs");

const MAX_ARCHIVE_FILE_BYTES = Number(process.env.LEGAL_WORKBENCH_MAX_FILE_BYTES || 50 * 1024 * 1024);
const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "message/rfc822",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/octet-stream",
]);
const ALLOWED_UPLOAD_EXTENSIONS = new Set([".txt", ".md", ".text", ".eml", ".pdf", ".docx"]);

function validateUploadedPayload(payload = {}, allowedFileTypes = ["attachment"]) {
  const fileType = payload.fileType || "attachment";
  if (!allowedFileTypes.includes(fileType)) {
    const error = new Error(`Unsupported file type: ${fileType}`);
    error.statusCode = 400;
    throw error;
  }
  const originalName = String(payload.originalName || payload.name || "unnamed");
  const extension = path.extname(originalName).toLowerCase();
  if (!ALLOWED_UPLOAD_EXTENSIONS.has(extension)) {
    const error = new Error(`Unsupported file extension: ${extension || "(none)"}`);
    error.statusCode = 400;
    throw error;
  }
  const mimeType = String(payload.mimeType || "application/octet-stream").toLowerCase();
  if (!ALLOWED_UPLOAD_MIME_TYPES.has(mimeType)) {
    const error = new Error(`Unsupported mime type: ${mimeType}`);
    error.statusCode = 400;
    throw error;
  }
  const buffer = Buffer.from(payload.contentBase64 || "", "base64");
  if (!buffer.length) {
    const error = new Error("Uploaded file was empty");
    error.statusCode = 400;
    throw error;
  }
  if (buffer.length > MAX_ARCHIVE_FILE_BYTES) {
    const error = new Error(`Uploaded file exceeds ${MAX_ARCHIVE_FILE_BYTES} bytes`);
    error.statusCode = 413;
    throw error;
  }
  return { buffer, mimeType, originalName, fileType };
}

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

  if (req.method === "POST" && url.pathname === "/api/backup") {
    try {
      const backupPath = await runAutoBackup();
      sendJson(res, 200, { ok: true, backupPath }, req);
    } catch (error) {
      sendJson(res, error.statusCode || 500, serverErrorPayload(error, "Failed to create backup"), req);
    }
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/legal-review/runner-status") {
    const legal = getRunnerStatus();
    const intake = getIntakeRunnerStatus();
    const suggestion = getSuggestionRunnerStatus();
    const visualQa = getVisualQaRunnerStatus();
    sendJson(res, 200, {
      ok: true,
      runner: legal,
      runners: {
        legal,
        intake,
        suggestion,
        visualQa,
      },
    }, req);
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
      sendJson(res, error.statusCode || 500, serverErrorPayload(error, "Failed to sync workbench state"), req);
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

  if (req.method === "POST" && url.pathname === "/api/docx/parse") {
    try {
      const payload = await readJson(req);
      const buffer = Buffer.from(payload.contentBase64 || "", "base64");
      const parsed = extractDocxPackage(buffer);
      sendJson(res, 200, { ok: true, fileName: payload.name || "", text: parsed.acceptedText, ...parsed }, req);
    } catch (error) {
      sendJson(res, error.statusCode || 500, serverErrorPayload(error, "Failed to parse docx"), req);
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/legal-review") {
    try {
      const request = await readJson(req);
      const result = await analyzeLegalReview(request);
      sendJson(res, 200, result, req);
    } catch (error) {
      sendJson(res, error.statusCode || 500, serverErrorPayload(error, "Legal review failed"), req);
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
      sendJson(res, error.statusCode || 500, serverErrorPayload(error, "Suggestion action failed"), req);
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/contract-intake") {
    try {
      const request = await readJson(req);
      sendJson(res, 200, await runContractIntake(request), req);
    } catch (error) {
      sendJson(res, error.statusCode || 500, serverErrorPayload(error, "Contract intake failed"), req);
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
      sendJson(res, error.statusCode || 500, serverErrorPayload(error, "Search failed"), req);
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
      sendJson(res, error.statusCode || 500, serverErrorPayload(error, "Contract search failed"), req);
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
      sendJson(res, error.statusCode || 500, serverErrorPayload(error, "Clause search failed"), req);
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/visual-qa") {
    try {
      const request = await readJson(req);
      sendJson(res, 200, await runVisualQa(request), req);
    } catch (error) {
      sendJson(res, error.statusCode || 500, serverErrorPayload(error, "Visual QA failed"), req);
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
