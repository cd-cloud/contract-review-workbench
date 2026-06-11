const { sendJson, readJson, serverErrorPayload } = require("../../http-utils");
const { upsertContractWithAudit, upsertContractVersionWithAudit, replaceClauseActions, appendInsertedClause, appendAuditLog, deleteContractCascade, deleteContractVersionCascade, listAllContractsWithPaths } = require("../../store");

async function handleContracts(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/contracts") {
    sendJson(res, 200, { ok: true, contracts: listAllContractsWithPaths() }, req);
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

  return false;
}

module.exports = { handleContracts };
