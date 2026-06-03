const http = require("http");
const { handleStatic } = require("./routes/static");
const { handleApi } = require("./routes/api");
const { sendJson, getCorsHeaders } = require("./http-utils");

const PORT = Number(process.env.LEGAL_WORKBENCH_PORT || 8787);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

    if (req.method === "OPTIONS") {
      const corsHeaders = getCorsHeaders(req);
      if (!Object.keys(corsHeaders).length) {
        sendJson(res, 403, { ok: false, error: "Forbidden origin" }, req);
        return;
      }
      res.writeHead(204, corsHeaders);
      res.end();
      return;
    }

    if (await handleApi(req, res, url)) return;
    if (handleStatic(req, res, url)) return;

    sendJson(res, 404, { ok: false, error: "Not found" }, req);
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message || String(error) }, req);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Legal workbench local skill bridge listening on http://127.0.0.1:${PORT}`);
});
