const { sendJson, readJson, serverErrorPayload } = require("../../http-utils");
const { runSuggestionAction } = require("../../suggestion-action-adapter");
const { runContractIntake } = require("../../contract-intake-adapter");
const { runVisualQa } = require("../../visual-qa-adapter");

async function handleAdapters(req, res, url) {
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

  if (req.method === "POST" && url.pathname === "/api/visual-qa") {
    try {
      const request = await readJson(req);
      sendJson(res, 200, await runVisualQa(request), req);
    } catch (error) {
      sendJson(res, error.statusCode || 500, serverErrorPayload(error, "Visual QA failed"), req);
    }
    return true;
  }

  return false;
}

module.exports = { handleAdapters };
