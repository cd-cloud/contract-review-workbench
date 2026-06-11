const { sendJson, readJson, serverErrorPayload } = require("../../http-utils");
const { extractDocxPackage } = require("../../../scripts/docx-extract");

async function handleDocx(req, res, url) {
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

  return false;
}

module.exports = { handleDocx };
