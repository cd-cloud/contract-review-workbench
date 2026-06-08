const path = require("path");
const { sendStaticFile, getSessionCookieHeader } = require("../http-utils");

const ROOT_DIR = path.resolve(__dirname, "../..");

function resolveBackendOrigin(req) {
  const port = Number(process.env.LEGAL_WORKBENCH_PORT || 8787);
  const host = req?.headers?.host || `127.0.0.1:${port}`;
  return `http://${host}`;
}

function sendRuntimeConfig(req, res) {
  const config = {
    backendOrigin: resolveBackendOrigin(req),
    authMode: "cookie-session",
  };
  const body = [
    `window.LEGAL_WORKBENCH_CONFIG = ${JSON.stringify(config)};`,
    `window.LEGAL_WORKBENCH_BACKEND_ORIGIN = ${JSON.stringify(config.backendOrigin)};`,
    "",
  ].join("\n");
  res.writeHead(200, {
    "Content-Type": "text/javascript; charset=utf-8",
    "Cache-Control": "no-store",
    "Set-Cookie": getSessionCookieHeader(),
  });
  res.end(body);
}

function handleStatic(req, res, url) {
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    sendStaticFile(res, path.join(ROOT_DIR, "index.html"), {
      "Set-Cookie": getSessionCookieHeader(),
    });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/favicon.ico") {
    res.writeHead(204, { "Cache-Control": "no-store" });
    res.end();
    return true;
  }

  if (req.method === "GET" && url.pathname === "/js/runtime-config.js") {
    sendRuntimeConfig(req, res);
    return true;
  }

  if (req.method === "GET" && (url.pathname === "/app.js" || url.pathname === "/styles.css" || url.pathname.startsWith("/js/") || url.pathname.startsWith("/lib/"))) {
    sendStaticFile(res, path.join(ROOT_DIR, decodeURIComponent(url.pathname)));
    return true;
  }

  return false;
}

module.exports = { handleStatic };
