const { sendJson, isAuthorizedApiRequest } = require("../http-utils");
const { validateUploadedPayload } = require("./upload-utils");
const { handleSystem } = require("./handlers/system");
const { handleContracts } = require("./handlers/contracts");
const { handleFiles } = require("./handlers/files");
const { handleDocx } = require("./handlers/docx");
const { handleLegalReview } = require("./handlers/legal-review");
const { handleSearch } = require("./handlers/search");
const { handleAdapters } = require("./handlers/adapters");

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

  const systemState = { get isBackingUp() { return isBackingUp; }, set isBackingUp(v) { isBackingUp = v; } };
  if (await handleSystem(req, res, url, systemState)) return true;
  if (await handleContracts(req, res, url)) return true;
  if (await handleFiles(req, res, url)) return true;
  if (await handleDocx(req, res, url)) return true;
  if (await handleLegalReview(req, res, url)) return true;
  if (await handleSearch(req, res, url)) return true;
  if (await handleAdapters(req, res, url)) return true;

  return false;
}

module.exports = { handleApi, validateUploadedPayload };
