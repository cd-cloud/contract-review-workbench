/**
 * Electron desktop smoke test.
 *
 * Verifies that the packaged-style desktop shell can recover when the
 * default backend port is occupied, load the renderer, and call the API
 * through runtime-config rather than hard-coded localhost:8787 URLs.
 */

const fs = require("fs");
const http = require("http");
const path = require("path");
const { _electron: electron } = require("playwright");
const electronPath = require("electron");

const ROOT = path.resolve(__dirname, "..");
const MAIN = path.join(ROOT, "electron", "main.js");
const LOG_PATH = path.join(ROOT, ".electron-smoke.log");
const DEFAULT_PORT = 8787;
const STEP_TIMEOUT_MS = 45000;

function logStep(message) {
  const line = `[electron-smoke] ${new Date().toISOString()} ${message}`;
  console.log(line);
  fs.appendFileSync(LOG_PATH, `${line}\n`);
}

function withTimeout(promise, label, timeoutMs = STEP_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function occupyPort(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      res.writeHead(204);
      res.end();
    });
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE") resolve({ server: null, occupiedAlready: true });
      else reject(error);
    });
    server.listen(port, "127.0.0.1", () => resolve({ server, occupiedAlready: false }));
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    if (!server) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}

async function main() {
  fs.writeFileSync(LOG_PATH, "");
  logStep(`occupying ${DEFAULT_PORT}`);
  const blocker = await occupyPort(DEFAULT_PORT);
  let app = null;
  try {
    logStep(`launching ${electronPath}`);
    app = await withTimeout(electron.launch({
      executablePath: electronPath,
      args: [MAIN],
      cwd: ROOT,
      env: {
        ...process.env,
        NODE_ENV: "test",
        ELECTRON_SMOKE_TEST: "1",
        ELECTRON_SMOKE_LOG: LOG_PATH,
        ELECTRON_RUN_AS_NODE: undefined,
      },
    }), "electron.launch");

    logStep("waiting for first window");
    const window = await withTimeout(app.firstWindow({ timeout: 30000 }), "firstWindow");
    logStep("waiting for domcontentloaded");
    await window.waitForLoadState("domcontentloaded", { timeout: 30000 });
    logStep("waiting for local URL");
    await window.waitForFunction(() => location.href.startsWith("http://127.0.0.1:"), null, { timeout: 30000 });
    logStep("waiting for dashboard");
    await window.waitForSelector("#dashboard-view", { timeout: 30000 });

    logStep("checking renderer API");
    const result = await window.evaluate(async () => {
      const backendOrigin = window.LEGAL_WORKBENCH_BACKEND_ORIGIN || "";
      const health = await window.legalWorkbenchFetch("/api/health").then((res) => res.json());
      const runnerStatus = await window.legalWorkbenchFetch("/api/legal-review/runner-status").then((res) => res.json());
      return {
        href: location.href,
        backendOrigin,
        tokenExposed: typeof window.LEGAL_WORKBENCH_API_TOKEN !== "undefined",
        health,
        runnerStatus,
        title: document.title,
        dashboardVisible: Boolean(document.querySelector("#dashboard-view")),
      };
    });

    if (!result.dashboardVisible) throw new Error("Dashboard view did not render.");
    if (!result.backendOrigin) throw new Error("Runtime backend origin was not exposed.");
    if (result.backendOrigin.endsWith(`:${DEFAULT_PORT}`)) {
      throw new Error(`Electron did not move away from occupied port ${DEFAULT_PORT}.`);
    }
    if (result.health.port !== Number(new URL(result.backendOrigin).port)) {
      throw new Error(`Health port ${result.health.port} did not match runtime origin ${result.backendOrigin}.`);
    }
    if (!result.health.ok) throw new Error("Health API did not return ok=true.");
    if (result.tokenExposed) throw new Error("Runtime API token should not be exposed in renderer.");
    if (!result.runnerStatus?.ok) throw new Error("Runner status API did not return ok=true.");
    if (!result.runnerStatus?.runner?.launcherProfile) throw new Error("Smoke did not exercise configureRunnerProfile('ai').");
    if (!result.runnerStatus?.runner?.launcherMode) throw new Error("Smoke runner status did not include a runtime mode.");

    console.log(JSON.stringify({
      ok: true,
      occupiedAlready: blocker.occupiedAlready,
      ...result,
    }, null, 2));
  } finally {
    if (app) {
      try {
        logStep("quitting app");
        await app.evaluate(async ({ app }) => {
          app.quit();
        });
        await withTimeout(app.close(), "app.close", 15000);
      } catch (error) {
        // Playwright may have already observed app shutdown; ignore cleanup noise.
        logStep(`cleanup ignored: ${error.message}`);
      }
    }
    logStep("releasing occupied port");
    await closeServer(blocker.server);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
