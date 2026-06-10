const path = require("path");
const fs = require("fs");
const { sendJson, readJson, isAuthorizedApiRequest, serverErrorPayload, isPathInsideRoot } = require("../http-utils");
const { readDb, replaceDb, upsertContract, upsertContractWithAudit, upsertContractVersion, upsertContractVersionWithAudit, replaceClauseActions, appendInsertedClause, patchAuxState, appendAuditLog, deleteContractCascade, deleteContractVersionCascade, saveFile, DB_PATH, WAL_PATH, FILE_DIR, WORKBENCH_ROOT, saveContractFile, getContractFiles, getFileById, deleteFile, getContractFolder, listAllContractsWithPaths, runAutoBackup, runWalCheckpoint, search, searchContracts, searchClauses, searchGlobal } = require("../store");
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
]);
const ALLOWED_UPLOAD_EXTENSIONS = new Set([".txt", ".md", ".text", ".eml", ".pdf", ".docx"]);
const MACH_O_SIGNATURES = new Set([0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe]);

function hasExecutableMagic(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return false;
  if (buffer[0] === 0x4d && buffer[1] === 0x5a) return true;
  if (buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46) return true;
  return MACH_O_SIGNATURES.has(buffer.readUInt32BE(0));
}

function looksLikeZip(buffer) {
  return Buffer.isBuffer(buffer)
    && buffer.length >= 4
    && buffer[0] === 0x50
    && buffer[1] === 0x4b
    && [0x03, 0x05, 0x07].includes(buffer[2])
    && [0x04, 0x06, 0x08].includes(buffer[3]);
}

function looksLikePdf(buffer) {
  return Buffer.isBuffer(buffer)
    && buffer.length >= 5
    && buffer.subarray(0, 5).toString("ascii") === "%PDF-";
}

function looksLikeText(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return false;
  if (buffer.includes(0x00)) return false;
  let suspiciousBytes = 0;
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  for (const byte of sample) {
    const printable = byte === 0x09 || byte === 0x0a || byte === 0x0d || (byte >= 0x20 && byte <= 0x7e) || byte >= 0x80;
    if (!printable) suspiciousBytes += 1;
  }
  return suspiciousBytes <= Math.max(4, Math.floor(sample.length * 0.02));
}

function validateUploadSignature(buffer, extension) {
  if (hasExecutableMagic(buffer)) {
    const error = new Error("Uploaded file signature does not match an allowed document type");
    error.statusCode = 400;
    throw error;
  }
  if (extension === ".docx" && !looksLikeZip(buffer)) {
    const error = new Error("DOCX upload failed signature validation");
    error.statusCode = 400;
    throw error;
  }
  if (extension === ".pdf" && !looksLikePdf(buffer)) {
    const error = new Error("PDF upload failed signature validation");
    error.statusCode = 400;
    throw error;
  }
  if ([".txt", ".md", ".text", ".eml"].includes(extension) && !looksLikeText(buffer)) {
    const error = new Error("Text upload failed signature validation");
    error.statusCode = 400;
    throw error;
  }
}

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
  validateUploadSignature(buffer, extension);
  return { buffer, mimeType, originalName, fileType };
}

let isBackingUp = false;

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
      walPath: WAL_PATH,
      fileStorage: FILE_DIR,
      archiveRoot: WORKBENCH_ROOT,
    }, req);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/db/checkpoint") {
    try {
      const payload = await readJson(req);
      const checkpoint = runWalCheckpoint(payload.mode || "TRUNCATE");
      sendJson(res, 200, { ok: true, checkpoint }, req);
    } catch (error) {
      sendJson(res, error.statusCode || 500, serverErrorPayload(error, "Failed to checkpoint sqlite WAL"), req);
    }
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
      if (!require("fs").existsSync(file.path)) {
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
        ...require("../http-utils").getCorsHeaders(req),
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

  if (req.method === "POST" && url.pathname === "/api/backup") {
    if (isBackingUp) {
      sendJson(res, 409, { ok: false, error: "Backup already in progress" }, req);
      return true;
    }
    isBackingUp = true;
    try {
      const backupPath = await runAutoBackup();
      appendAuditLog({
        action: "create-backup",
        details: { backupPath },
      });
      sendJson(res, 200, { ok: true, backupPath }, req);
    } catch (error) {
      sendJson(res, error.statusCode || 500, serverErrorPayload(error, "Failed to create backup"), req);
    } finally {
      isBackingUp = false;
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
      let dbResult;
      if (snapshot?.syncMode === "aux-patch") {
        const auxState = patchAuxState(snapshot.state || {});
        dbResult = { ok: true, auxState };
      } else {
        dbResult = replaceDb(snapshot);
      }
      sendJson(res, 200, { ok: true, db: dbResult }, req);
    } catch (error) {
      sendJson(res, error.statusCode || 500, serverErrorPayload(error, "Failed to sync workbench state"), req);
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/contracts") {
    try {
      const payload = await readJson(req);
      const contract = upsertContractWithAudit(payload.contract || payload, {
        action: "create-contract-review",
        details: {},
      });
      sendJson(res, 200, { ok: true, contract }, req);
    } catch (error) {
      sendJson(res, error.statusCode || 500, serverErrorPayload(error, "Failed to create contract"), req);
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/contract-versions") {
    try {
      const payload = await readJson(req);
      const version = upsertContractVersionWithAudit(payload.version || payload, {
        action: "append-progress-update",
        details: {},
      });
      sendJson(res, 200, { ok: true, version }, req);
    } catch (error) {
      sendJson(res, error.statusCode || 500, serverErrorPayload(error, "Failed to create contract version"), req);
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/inserted-clauses") {
    try {
      const payload = await readJson(req);
      const sourceKey = String(payload.sourceKey || "");
      if (!sourceKey) {
        const error = new Error("sourceKey is required");
        error.statusCode = 400;
        throw error;
      }
      const insertedClause = appendInsertedClause(sourceKey, payload.insertedClause || payload);
      appendAuditLog({
        action: "insert-clause",
        contractId: payload.contractId || null,
        contractName: payload.contractName || "",
        details: { clauseTitle: insertedClause.title || "", sourceKey },
      });
      sendJson(res, 200, { ok: true, insertedClause }, req);
    } catch (error) {
      sendJson(res, error.statusCode || 500, serverErrorPayload(error, "Failed to append inserted clause"), req);
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/clause-actions") {
    try {
      const payload = await readJson(req);
      const sourceKey = String(payload.sourceKey || "");
      if (!sourceKey) {
        const error = new Error("sourceKey is required");
        error.statusCode = 400;
        throw error;
      }
      const clauseActions = replaceClauseActions(sourceKey, payload.clauseActions || {});
      sendJson(res, 200, { ok: true, clauseActions }, req);
    } catch (error) {
      sendJson(res, error.statusCode || 500, serverErrorPayload(error, "Failed to replace clause actions"), req);
    }
    return true;
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/contracts/") && !url.pathname.endsWith("/files") && !url.pathname.endsWith("/exports")) {
    try {
      const parts = url.pathname.split("/");
      const contractId = decodeURIComponent(parts[3]);
      const contract = deleteContractCascade(contractId);
      if (!contract) {
        sendJson(res, 404, { ok: false, error: "Contract not found" }, req);
        return true;
      }
      appendAuditLog({
        action: "delete-contract",
        contractId,
        contractName: contract.name,
        details: { contractName: contract.name },
      });
      sendJson(res, 200, { ok: true, contract }, req);
    } catch (error) {
      sendJson(res, error.statusCode || 500, serverErrorPayload(error, "Failed to delete contract"), req);
    }
    return true;
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/contract-versions/")) {
    try {
      const parts = url.pathname.split("/");
      const versionId = decodeURIComponent(parts[3]);
      const version = deleteContractVersionCascade(versionId);
      if (!version) {
        sendJson(res, 404, { ok: false, error: "Contract version not found" }, req);
        return true;
      }
      appendAuditLog({
        action: "delete-contract-version",
        contractId: version.contractId,
        details: { note: `${version.type || ""} ${version.createdAt || ""}`.trim() },
      });
      sendJson(res, 200, { ok: true, version }, req);
    } catch (error) {
      sendJson(res, error.statusCode || 500, serverErrorPayload(error, "Failed to delete contract version"), req);
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/audit") {
    try {
      const payload = await readJson(req);
      const audit = appendAuditLog(payload);
      sendJson(res, 200, { ok: true, audit }, req);
    } catch (error) {
      sendJson(res, error.statusCode || 500, serverErrorPayload(error, "Failed to append audit log"), req);
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
      const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") || 50), 200));
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
      const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") || 20), 100));
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
      const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") || 20), 100));
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
