const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT_DIR = path.resolve(__dirname, "..");
const PORT = Number(process.env.LEGAL_WORKBENCH_PORT || 8787);
const API_TOKEN = process.env.LEGAL_WORKBENCH_TOKEN || crypto.randomBytes(32).toString("hex");
const SESSION_COOKIE_NAME = "legal_workbench_session";
const BROWSER_SESSION_ID = crypto.randomBytes(24).toString("hex");

const ALLOWED_ORIGINS = new Set([
  `http://127.0.0.1:${PORT}`,
  `http://localhost:${PORT}`,
]);

const STATIC_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ico": "image/x-icon",
};

function getCorsHeaders(req) {
  const origin = req?.headers?.origin || "";
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Legal-Workbench-Token",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function parseCookies(cookieHeader = "") {
  return String(cookieHeader || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, pair) => {
      const index = pair.indexOf("=");
      if (index < 0) return acc;
      acc[pair.slice(0, index).trim()] = pair.slice(index + 1).trim();
      return acc;
    }, {});
}

function getSessionCookieHeader() {
  return `${SESSION_COOKIE_NAME}=${BROWSER_SESSION_ID}; Path=/; HttpOnly; SameSite=Strict`;
}

function isAuthorizedApiRequest(req) {
  const headers = req?.headers || {};
  if (headers["x-legal-workbench-token"] === API_TOKEN) return true;
  const cookies = parseCookies(headers.cookie || "");
  return cookies[SESSION_COOKIE_NAME] === BROWSER_SESSION_ID;
}

function getApiToken() {
  return API_TOKEN;
}

function safeJsonStringify(value) {
  const seen = new WeakSet();
  return JSON.stringify(value, (key, val) => {
    if (typeof val === "object" && val !== null) {
      if (seen.has(val)) return "[Circular]";
      seen.add(val);
    }
    return val;
  });
}

function sendJson(res, status, payload, req = null) {
  const body = safeJsonStringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...getCorsHeaders(req),
  });
  res.end(body);
}

function sendStaticFile(res, filePath, extraHeaders = {}) {
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(ROOT_DIR)) {
    sendJson(res, 403, { ok: false, error: "Forbidden" });
    return;
  }
  fs.readFile(resolved, (error, content) => {
    if (error) {
      sendJson(res, error.code === "ENOENT" ? 404 : 500, { ok: false, error: error.message || String(error) });
      return;
    }
    res.writeHead(200, {
      "Content-Type": STATIC_TYPES[path.extname(resolved).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store",
      ...extraHeaders,
    });
    res.end(content);
  });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body, "utf8") > 20 * 1024 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

module.exports = {
  safeJsonStringify,
  sendJson,
  sendStaticFile,
  readJson,
  getCorsHeaders,
  isAuthorizedApiRequest,
  getApiToken,
  getSessionCookieHeader,
};
