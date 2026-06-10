const http = require("http");
const { handleStatic } = require("./routes/static");
const { handleApi } = require("./routes/api");
const { sendJson, getCorsHeaders, serverErrorPayload } = require("./http-utils");
const { cancelAllJobs } = require("./jobs");
const { closeDb } = require("./store-sqlite");
const logger = require("../scripts/logger");

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
    sendJson(res, 500, serverErrorPayload(error, "Server error"), req);
  }
});

server.on("error", (err) => {
  logger.error(`[server] ${err.message}`);
  if (err.code === "EADDRINUSE") {
    console.error("[server] Port already in use, exiting to allow Electron restart");
    process.exit(1);
  }
  if (err.code === "EMFILE" || err.code === "ENFILE") {
    logger.error("[server] Too many open files, reducing maxConnections");
    server.maxConnections = Math.max(1, (server.maxConnections || Infinity) - 5);
    return;
  }
  console.error("[server] Non-fatal server error, continuing:", err.code || err.message);
});

server.listen(PORT, "127.0.0.1", () => {
  logger.info(`Legal workbench local skill bridge listening on http://127.0.0.1:${PORT}`);
});

function gracefulShutdown(signal) {
  logger.info(`[server] Received ${signal}, shutting down gracefully...`);
  cancelAllJobs();
  server.close(() => {
    closeDb();
    process.exit(0);
  });
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
