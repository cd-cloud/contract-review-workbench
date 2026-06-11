const { sendJson, readJson, serverErrorPayload } = require("../../http-utils");
const {
  readDb, replaceDb, runWalCheckpoint, runAutoBackup, appendAuditLog,
  upsertContract, upsertContractVersion, replaceContractClauses, replaceContractFindings, replaceClauseActions,
  DB_PATH, WAL_PATH, FILE_DIR, WORKBENCH_ROOT,
} = require("../../store");

let isSyncing = false;
const { getRunnerStatus } = require("../../legal-skill-adapter");
const { getRunnerStatus: getSuggestionRunnerStatus } = require("../../suggestion-action-adapter");
const { getRunnerStatus: getIntakeRunnerStatus } = require("../../contract-intake-adapter");
const { getRunnerStatus: getVisualQaRunnerStatus } = require("../../visual-qa-adapter");
const config = require("../../config");

async function handleSystem(req, res, url, state = {}) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      service: "legal-contract-workbench-local-skill-bridge",
      port: config.port,
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

  if (req.method === "GET" && url.pathname === "/api/db") {
    sendJson(res, 200, readDb(), req);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/db/sync") {
    if (isSyncing) {
      sendJson(res, 429, { ok: false, error: "Sync already in progress, please retry later" }, req);
      return true;
    }
    isSyncing = true;
    try {
      const snapshot = await readJson(req);
      let dbResult;
      if (snapshot?.syncMode === "aux-patch") {
        const { patchAuxState } = require("../../store");
        const auxState = patchAuxState(snapshot.state || {});
        dbResult = { ok: true, auxState };
      } else if (snapshot?.syncMode === "incremental") {
        dbResult = await incrementalSync(snapshot);
      } else {
        dbResult = replaceDb(snapshot);
      }
      sendJson(res, 200, { ok: true, db: dbResult }, req);
    } catch (error) {
      sendJson(res, error.statusCode || 500, serverErrorPayload(error, "Failed to sync workbench state"), req);
    } finally {
      isSyncing = false;
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

  if (req.method === "POST" && url.pathname === "/api/backup") {
    if (state.isBackingUp) {
      sendJson(res, 409, { ok: false, error: "Backup already in progress" }, req);
      return true;
    }
    state.isBackingUp = true;
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
      state.isBackingUp = false;
    }
    return true;
  }

  return false;
}

async function incrementalSync(snapshot) {
  const savedAt = new Date().toISOString();
  const contracts = snapshot.contracts || [];
  const versions = snapshot.updates || snapshot.contractVersions || [];
  const clauses = snapshot.clauses || [];
  const findings = snapshot.findings || snapshot.reviewRecords || [];
  const clauseActions = snapshot.clauseActions || {};

  for (const contract of contracts) {
    upsertContract(contract);
  }
  for (const version of versions) {
    upsertContractVersion(version);
  }
  // Group clauses/findings/actions by contract for targeted replacement
  const clausesByContract = new Map();
  for (const clause of clauses) {
    const list = clausesByContract.get(clause.contractId) || [];
    list.push(clause);
    clausesByContract.set(clause.contractId, list);
  }
  const findingsByContract = new Map();
  for (const finding of findings) {
    const list = findingsByContract.get(finding.contractId) || [];
    list.push(finding);
    findingsByContract.set(finding.contractId, list);
  }
  for (const [contractId, contractClauses] of clausesByContract) {
    replaceContractClauses(contractId, null, contractClauses);
  }
  for (const [contractId, contractFindings] of findingsByContract) {
    replaceContractFindings(contractId, contractFindings);
  }
  for (const [sourceKey, actions] of Object.entries(clauseActions)) {
    replaceClauseActions(sourceKey, actions);
  }

  return { ok: true, savedAt, mode: "incremental", contracts: contracts.length, versions: versions.length, clauses: clauses.length, findings: findings.length };
}

module.exports = { handleSystem };
