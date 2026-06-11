const { sendJson, readJson, serverErrorPayload } = require("../../http-utils");
const { readDb, replaceDb, runWalCheckpoint, runAutoBackup, appendAuditLog, DB_PATH, WAL_PATH, FILE_DIR, WORKBENCH_ROOT } = require("../../store");
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
    try {
      const snapshot = await readJson(req);
      let dbResult;
      if (snapshot?.syncMode === "aux-patch") {
        const { patchAuxState } = require("../../store");
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

module.exports = { handleSystem };
