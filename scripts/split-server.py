#!/usr/bin/env python3
"""Split server/server.js into modular route files."""
import os

def main():
    os.makedirs('server/routes', exist_ok=True)

    # Write server/http-utils.js
    http_utils = '''const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");
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

function sendJson(res, status, payload) {
  const body = safeJsonStringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(body);
}

function sendStaticFile(res, filePath) {
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

module.exports = { safeJsonStringify, sendJson, sendStaticFile, readJson };
'''

    with open('server/http-utils.js', 'w', encoding='utf-8') as f:
        f.write(http_utils)

    # Write server/jobs.js
    jobs = '''const { sendJson } = require("./http-utils");

const analysisJobs = new Map();

function createAnalysisJob(request) {
  const id = `job-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const job = {
    id,
    status: "queued",
    phase: "已进入 Codex 分析队列",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    result: null,
    error: null,
  };
  analysisJobs.set(id, job);
  setImmediate(async () => {
    const current = analysisJobs.get(id);
    if (!current) return;
    Object.assign(current, {
      status: "running",
      phase: "Codex Skill 正在审阅合同",
      updatedAt: new Date().toISOString(),
    });
    try {
      const { analyzeLegalReview } = require("./legal-skill-adapter");
      const result = await analyzeLegalReview(request);
      Object.assign(current, {
        status: "completed",
        phase: "分析完成",
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        result,
      });
    } catch (error) {
      Object.assign(current, {
        status: "failed",
        phase: "分析失败",
        updatedAt: new Date().toISOString(),
        error: error.message || String(error),
      });
    }
  });
  return job;
}

function summarizeJob(job, includeResult = false) {
  return {
    id: job.id,
    status: job.status,
    phase: job.phase,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt || null,
    error: job.error,
    result: includeResult ? job.result : undefined,
  };
}

function getJob(id) {
  return analysisJobs.get(id);
}

module.exports = { createAnalysisJob, summarizeJob, getJob };
'''

    with open('server/jobs.js', 'w', encoding='utf-8') as f:
        f.write(jobs)

    # Write server/routes/static.js
    static_routes = '''const path = require("path");
const { sendStaticFile } = require("../http-utils");

const ROOT_DIR = path.resolve(__dirname, "../..");

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

  if (req.method === "GET" && (url.pathname === "/app.js" || url.pathname === "/styles.css" || url.pathname.startsWith("/js/"))) {
    sendStaticFile(res, path.join(ROOT_DIR, decodeURIComponent(url.pathname)));
    return true;
  }

  return false;
}

module.exports = { handleStatic };
'''

    with open('server/routes/static.js', 'w', encoding='utf-8') as f:
        f.write(static_routes)

    # Write server/routes/api.js
    api_routes = '''const { sendJson, readJson } = require("../http-utils");
/*
 * Legacy diagnostic split of server routes kept only for historical reference.
 * Do not treat this file as the active backend entrypoint or current API contract.
 */

const { readDb, replaceDb, saveFile, DB_PATH, FILE_DIR } = require("../store");
const { analyzeLegalReview, getRunnerStatus } = require("../legal-skill-adapter");
const { runSuggestionAction } = require("../suggestion-action-adapter");
const { runContractIntake } = require("../contract-intake-adapter");
const { runVisualQa } = require("../visual-qa-adapter");
const { extractDocxPackage } = require("../../scripts/docx-extract");
const { createAnalysisJob, summarizeJob, getJob } = require("../jobs");

async function handleApi(req, res, url) {
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      service: "legal-contract-workbench-local-skill-bridge",
      database: DB_PATH,
      fileStorage: FILE_DIR,
    });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/legal-review/runner-status") {
    sendJson(res, 200, { ok: true, runner: getRunnerStatus() });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/db") {
    sendJson(res, 200, readDb());
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/db/sync") {
    try {
      const snapshot = await readJson(req);
      sendJson(res, 200, { ok: true, db: replaceDb(snapshot) });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message || String(error) });
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/files") {
    try {
      const payload = await readJson(req);
      sendJson(res, 200, { ok: true, file: saveFile(payload.name, payload.content) });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message || String(error) });
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/docx/parse") {
    try {
      const payload = await readJson(req);
      const buffer = Buffer.from(payload.contentBase64 || "", "base64");
      const parsed = extractDocxPackage(buffer);
      sendJson(res, 200, { ok: true, fileName: payload.name || "", text: parsed.acceptedText, ...parsed });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message || String(error) });
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/legal-review") {
    try {
      const request = await readJson(req);
      const result = await analyzeLegalReview(request);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message || String(error) });
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/legal-review/jobs") {
    try {
      const request = await readJson(req);
      const job = createAnalysisJob(request);
      sendJson(res, 202, { ok: true, job: summarizeJob(job) });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message || String(error) });
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/ai-suggestion/action") {
    try {
      const request = await readJson(req);
      sendJson(res, 200, await runSuggestionAction(request));
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message || String(error) });
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/contract-intake") {
    try {
      const request = await readJson(req);
      sendJson(res, 200, await runContractIntake(request));
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message || String(error) });
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/visual-qa") {
    try {
      const request = await readJson(req);
      sendJson(res, 200, await runVisualQa(request));
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message || String(error) });
    }
    return true;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/legal-review/jobs/")) {
    const id = decodeURIComponent(url.pathname.split("/").pop());
    const job = getJob(id);
    if (!job) {
      sendJson(res, 404, { ok: false, error: "Job not found" });
      return true;
    }
    sendJson(res, 200, { ok: true, job: summarizeJob(job, true) });
    return true;
  }

  return false;
}

module.exports = { handleApi };
'''

    with open('server/routes/api.js', 'w', encoding='utf-8') as f:
        f.write(api_routes)

    # Write new server/server.js
    new_server = '''const http = require("http");
const { handleStatic } = require("./routes/static");
const { handleApi } = require("./routes/api");
const { sendJson } = require("./http-utils");

const PORT = Number(process.env.LEGAL_WORKBENCH_PORT || 8787);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (await handleApi(req, res, url)) return;
  if (handleStatic(req, res, url)) return;

  sendJson(res, 404, { ok: false, error: "Not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Legal workbench local skill bridge listening on http://127.0.0.1:${PORT}`);
});
'''

    with open('server/server.js', 'w', encoding='utf-8') as f:
        f.write(new_server)

    print("Server split complete!")
    print("  - server/http-utils.js")
    print("  - server/jobs.js")
    print("  - server/routes/static.js")
    print("  - server/routes/api.js")
    print("  - server/server.js (rewritten)")

if __name__ == '__main__':
    main()
