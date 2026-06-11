const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const TIMEOUT_MS = Number(process.env.PORTABLE_SMOKE_TIMEOUT_MS || 15000);

function requestText(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        if (res.statusCode >= 400) {
          reject(new Error(`${url} returned ${res.statusCode}: ${body}`));
          return;
        }
        resolve(body);
      });
    });
    req.on("error", reject);
    req.setTimeout(5000, () => req.destroy(new Error(`${url} timed out`)));
  });
}

function parseRuntimeConfig(source) {
  return source.match(/LEGAL_WORKBENCH_BACKEND_ORIGIN\s*=\s*"([^"]+)"/)?.[1] ||
    source.match(/"backendOrigin"\s*:\s*"([^"]+)"/)?.[1] ||
    "";
}

function parseCookie(headers = {}) {
  const setCookie = headers["set-cookie"];
  if (!setCookie) return "";
  const values = Array.isArray(setCookie) ? setCookie : [setCookie];
  return values.map((entry) => String(entry).split(";")[0]).join("; ");
}

async function waitForHealth(port) {
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + TIMEOUT_MS;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const runtimeResponse = await new Promise((resolve, reject) => {
        const req = http.get(`${base}/js/runtime-config.js`, (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => { body += chunk; });
          res.on("end", () => resolve({ body, headers: res.headers }));
        });
        req.on("error", reject);
        req.setTimeout(5000, () => req.destroy(new Error(`${base}/js/runtime-config.js timed out`)));
      });
      const origin = parseRuntimeConfig(runtimeResponse.body) || base;
      const cookie = parseCookie(runtimeResponse.headers);
      const healthText = await requestText(`${origin}/api/health`, cookie ? { Cookie: cookie } : {});
      const health = JSON.parse(healthText);
      if (!health.ok) throw new Error(`health check returned ok=false on ${base}`);
      return health;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw lastError || new Error(`health check timed out on ${base}`);
}

async function main() {
  let selectedPort = null;
  let stdout = "";
  let stderr = "";
  const env = { ...process.env };
  delete env.LEGAL_WORKBENCH_PORT;

  const child = spawn(process.execPath, ["scripts/start-ai-server.js", "--profile", "basic"], {
    cwd: ROOT,
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const cleanup = (exitCode) => {
    clearTimeout(timeout);
    if (!child.killed && child.exitCode === null) child.kill();
    if (typeof exitCode === "number") process.exit(exitCode);
  };

  const timeout = setTimeout(() => {
    console.error(`portable smoke timed out after ${TIMEOUT_MS}ms`);
    console.error(stdout);
    console.error(stderr);
    cleanup(1);
  }, TIMEOUT_MS);
  if (typeof timeout.unref === "function") timeout.unref();

  let healthCheckPromise = null;

  child.stdout.on("data", async (chunk) => {
    stdout += chunk.toString();
    const text = chunk.toString();
    const match = text.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/) ||
      text.match(/url=http:\/\/127\.0\.0\.1:(\d+)\//);
    if (!match || selectedPort) return;
    selectedPort = Number(match[1]);
    healthCheckPromise = waitForHealth(selectedPort).then((health) => {
      console.log(`portable smoke ok: ${selectedPort}`);
      console.log(`database: ${health.database}`);
      cleanup();
      return { ok: true };
    }).catch((error) => {
      cleanup();
      console.error(error.message || String(error));
      process.exit(1);
    });
  });

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  child.on("exit", async (code) => {
    if (selectedPort && code === null) return;
    if (selectedPort && code === 0) return;
    clearTimeout(timeout);
    if (!selectedPort) {
      console.error(`portable server exited before reporting a port: ${code}`);
      console.error(stdout);
      console.error(stderr);
      process.exit(1);
    }
    try {
      if (healthCheckPromise) await healthCheckPromise;
    } catch (error) {
      console.error(error.message || String(error));
      process.exit(1);
    }
  });
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
