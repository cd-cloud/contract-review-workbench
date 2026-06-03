const path = require("path");
const { sendStaticFile, getApiToken } = require("../http-utils");

const ROOT_DIR = path.resolve(__dirname, "../..");

function sendRuntimeConfig(res) {
  const body = `window.LEGAL_WORKBENCH_API_TOKEN = ${JSON.stringify(getApiToken())};\n`;
  res.writeHead(200, {
    "Content-Type": "text/javascript; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function handleStatic(req, res, url) {
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    sendStaticFile(res, path.join(ROOT_DIR, "index.html"));
    return true;
  }

  if (req.method === "GET" && url.pathname === "/favicon.ico") {
    res.writeHead(204, { "Cache-Control": "no-store" });
    res.end();
    return true;
  }

  if (req.method === "GET" && url.pathname === "/js/runtime-config.js") {
    sendRuntimeConfig(res);
    return true;
  }

  if (req.method === "GET" && (url.pathname === "/app.js" || url.pathname === "/styles.css" || url.pathname.startsWith("/js/") || url.pathname.startsWith("/lib/"))) {
    sendStaticFile(res, path.join(ROOT_DIR, decodeURIComponent(url.pathname)));
    return true;
  }

  return false;
}

module.exports = { handleStatic };
