/**
 * Electron main process for Legal Contract Workbench.
 * Handles backend lifecycle, window management, tray, and auto-backup.
 */

const { app, BrowserWindow, Tray, Menu, dialog, ipcMain, nativeImage, shell } = require("electron");
const { spawn, execFile } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const net = require("net");
const crypto = require("crypto");
const { configureRunnerProfile } = require("../scripts/portable-runtime");

const isDev = !app.isPackaged;
const isTest = process.env.NODE_ENV === "test" || process.env.ELECTRON_SMOKE_TEST === "1";
const WORKBENCH_ROOT = path.join(os.homedir(), "LegalWorkbench");

function smokeLog(message) {
  if (!isTest || !process.env.ELECTRON_SMOKE_LOG) return;
  try {
    fs.appendFileSync(process.env.ELECTRON_SMOKE_LOG, `[electron-main] ${new Date().toISOString()} ${message}\n`);
  } catch (error) {}
}

/* ─────────────── Data directory writable check ─────────────── */
function isDirectoryWritable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const testFile = path.join(dir, `.write-test-${Date.now()}`);
    fs.writeFileSync(testFile, "test");
    fs.unlinkSync(testFile);
    return true;
  } catch (error) {
    return false;
  }
}

function ensureWorkbenchRoot() {
  if (isDirectoryWritable(WORKBENCH_ROOT)) return true;

  const fallbackRoot = path.join(app.getPath("userData"), "LegalWorkbench");
  if (isDirectoryWritable(fallbackRoot)) {
    WORKBENCH_ROOT = fallbackRoot;
    process.env.LEGAL_WORKBENCH_DATA_DIR = WORKBENCH_ROOT;
    console.log(`[Electron] Using fallback data directory: ${WORKBENCH_ROOT}`);
    return true;
  }

  dialog.showErrorBox(
    "数据目录不可写",
    `合同审阅工作台无法写入数据目录：\n${WORKBENCH_ROOT}\n\n已尝试回退到 ${fallbackRoot} 也失败。\n\n请检查磁盘空间或更换数据目录（设置 LEGAL_WORKBENCH_DATA_DIR 环境变量）。`
  );
  app.quit();
  return false;
}

if (!ensureWorkbenchRoot()) return;
smokeLog("workbench root ready");

/* ─────────────── Port selection ─────────────── */
let BACKEND_PORT = 8787;
const BACKEND_URL = () => `http://127.0.0.1:${BACKEND_PORT}`;

function findAvailablePort(startPort, limit = 20) {
  return new Promise((resolve, reject) => {
    if (limit <= 0) {
      reject(new Error(`No available port found from ${startPort}`));
      return;
    }
    const server = net.createServer();
    server.listen(startPort, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        findAvailablePort(startPort + 1, limit - 1).then(resolve).catch(reject);
      } else {
        reject(err);
      }
    });
  });
}

async function resolveBackendPort() {
  try {
    const port = await findAvailablePort(BACKEND_PORT);
    if (port !== BACKEND_PORT) {
      console.log(`[Electron] Port ${BACKEND_PORT} is in use, switching to ${port}`);
    }
    BACKEND_PORT = port;
  } catch (error) {
    dialog.showErrorBox(
      "端口占用",
      `合同审阅工作台无法找到可用端口（起始端口 ${BACKEND_PORT}）。\n\n错误：${error.message}\n\n请关闭占用端口的其他程序后重试。`
    );
    app.quit();
  }
}

let mainWindow = null;
let tray = null;
let backendProcess = null;
let backendReady = false;
let backendRestartCount = 0;
let isQuitting = false;
const MAX_BACKEND_RESTARTS = 5;
const BACKEND_API_TOKEN = process.env.LEGAL_WORKBENCH_TOKEN || crypto.randomBytes(32).toString("hex");

function applySelectedRuntimeProfile(env, backendRuntime, options = {}) {
  const tmpEnv = { ...process.env, ...env };
  if (options.deterministicSmoke) {
    if (!tmpEnv.LEGAL_AI_PROVIDER) tmpEnv.LEGAL_AI_PROVIDER = "codex-cli";
    if (!tmpEnv.CODEX_CLI_COMMAND) tmpEnv.CODEX_CLI_COMMAND = backendRuntime;
  }
  const selectedProfile = configureRunnerProfile("ai", tmpEnv);
  env.LEGAL_AI_PROVIDER = tmpEnv.LEGAL_AI_PROVIDER;
  env.LEGAL_SKILL_RUNNER_SCRIPT = tmpEnv.LEGAL_SKILL_RUNNER_SCRIPT;
  env.SUGGESTION_ACTION_RUNNER_SCRIPT = tmpEnv.SUGGESTION_ACTION_RUNNER_SCRIPT;
  env.CONTRACT_INTAKE_RUNNER_SCRIPT = tmpEnv.CONTRACT_INTAKE_RUNNER_SCRIPT;
  env.VISUAL_QA_RUNNER_SCRIPT = tmpEnv.VISUAL_QA_RUNNER_SCRIPT;
  env.LEGAL_SKILL_ALLOW_FALLBACK = tmpEnv.LEGAL_SKILL_ALLOW_FALLBACK;
  env.SUGGESTION_ACTION_ALLOW_FALLBACK = tmpEnv.SUGGESTION_ACTION_ALLOW_FALLBACK;
  env.CONTRACT_INTAKE_ALLOW_FALLBACK = tmpEnv.CONTRACT_INTAKE_ALLOW_FALLBACK;
  env.VISUAL_QA_ALLOW_FALLBACK = tmpEnv.VISUAL_QA_ALLOW_FALLBACK;
  env.LEGAL_WORKBENCH_RUNTIME_PROFILE = tmpEnv.LEGAL_WORKBENCH_RUNTIME_PROFILE;
  env.LEGAL_WORKBENCH_RUNTIME_MODE = tmpEnv.LEGAL_WORKBENCH_RUNTIME_MODE;
  env.LEGAL_WORKBENCH_RUNTIME_REASON = tmpEnv.LEGAL_WORKBENCH_RUNTIME_REASON;
  env.LEGAL_WORKBENCH_EFFECTIVE_PROVIDER = tmpEnv.LEGAL_WORKBENCH_EFFECTIVE_PROVIDER;
  env.CODEX_CLI_COMMAND = tmpEnv.CODEX_CLI_COMMAND;
  return selectedProfile;
}

/* ─────────────── Backend lifecycle ─────────────── */
function startBackend() {
  if (backendProcess) return;

  // Ensure backend reads the same token we pass via env
  const tokenPath = path.join(WORKBENCH_ROOT, ".api_token");
  try {
    fs.mkdirSync(WORKBENCH_ROOT, { recursive: true });
    fs.writeFileSync(tokenPath, BACKEND_API_TOKEN, "utf8");
  } catch (error) {
    console.error("[Electron] Failed to persist API token:", error.message);
  }

  const serverScript = isDev
    ? path.join(__dirname, "..", "server", "server.js")
    : path.join(process.resourcesPath, "app", "server", "server.js");
  const backendRuntime = isDev
    ? (process.env.LEGAL_WORKBENCH_NODE_COMMAND || process.env.npm_node_execpath || "node")
    : process.execPath;

  const env = {
    ...process.env,
    LEGAL_WORKBENCH_PORT: String(BACKEND_PORT),
    LEGAL_WORKBENCH_DATA_DIR: WORKBENCH_ROOT,
    LEGAL_WORKBENCH_TOKEN: BACKEND_API_TOKEN,
    NODE_ENV: isDev ? "development" : "production",
    ELECTRON_RUN_AS_NODE: "1",
  };

  const selectedProfile = applySelectedRuntimeProfile(env, backendRuntime, {
    deterministicSmoke: process.env.ELECTRON_SMOKE_TEST === "1",
  });
  if (process.env.ELECTRON_SMOKE_TEST === "1") {
    console.log(`[Electron] Smoke mode runtime profile: ${selectedProfile} | ${env.LEGAL_WORKBENCH_RUNTIME_MODE || "unknown"} | ${env.LEGAL_WORKBENCH_EFFECTIVE_PROVIDER || "unknown"}`);
  } else {
    console.log(`[Electron] Selected AI runtime profile: ${selectedProfile} | ${env.LEGAL_WORKBENCH_RUNTIME_MODE || "unknown"} | ${env.LEGAL_WORKBENCH_EFFECTIVE_PROVIDER || "unknown"}`);
  }

  console.log("[Electron] Starting backend...", serverScript, "with", backendRuntime, "on port", BACKEND_PORT);
  backendProcess = spawn(backendRuntime, [serverScript], {
    env,
    stdio: ["pipe", "pipe", "pipe"],
    detached: false,
  });

  backendProcess.stdout.on("data", (data) => {
    const text = data.toString().trim();
    if (text) console.log("[Backend]", text);
    if (text) smokeLog(`[Backend] ${text}`);
    if (text.includes(`listening on http://127.0.0.1:${BACKEND_PORT}`)) {
      backendReady = true;
      backendRestartCount = 0;
      if (mainWindow) loadWorkbench();
    }
  });

  backendProcess.stderr.on("data", (data) => {
    const text = data.toString().trim();
    if (text) console.error("[Backend Error]", text);
    if (text) smokeLog(`[Backend Error] ${text}`);
  });

  backendProcess.on("error", (err) => {
    console.error("[Backend] Failed to start:", err);
    smokeLog(`[Backend] failed to start ${err.message}`);
    tryRestartBackend();
  });

  backendProcess.on("close", (code) => {
    console.log(`[Backend] Exited with code ${code}`);
    smokeLog(`[Backend] exited with code ${code}`);
    backendProcess = null;
    backendReady = false;
    if (code !== 0 && code !== null) {
      tryRestartBackend();
    }
  });
}

function tryRestartBackend() {
  backendRestartCount++;
  if (backendRestartCount > MAX_BACKEND_RESTARTS) {
    dialog.showErrorBox(
      "后端服务异常",
      `合同审阅工作台的后端服务连续崩溃 ${MAX_BACKEND_RESTARTS} 次，已停止自动重启。\n\n请检查日志或重新启动应用。`
    );
    return;
  }
  console.log(`[Electron] Restarting backend (attempt ${backendRestartCount}/${MAX_BACKEND_RESTARTS})...`);
  setTimeout(startBackend, 2000);
}

function stopBackend() {
  return new Promise((resolve) => {
    if (!backendProcess) { resolve(); return; }
    console.log("[Electron] Stopping backend...");
    backendProcess.removeAllListeners("close");

    const pid = backendProcess.pid;
    try {
      backendProcess.kill("SIGTERM");
    } catch (e) {}

    const killTimeout = setTimeout(() => {
      if (backendProcess && !backendProcess.killed) {
        try {
          backendProcess.kill("SIGKILL");
        } catch (e) {}
      }
    }, 5000);

    if (process.platform === "win32" && pid) {
      setTimeout(() => {
        try {
          execFile("taskkill", ["/F", "/T", "/PID", String(pid)], { windowsHide: true }, (err) => {
            if (err) console.error("[Electron] taskkill fallback error:", err.message);
          });
        } catch (e) {
          console.error("[Electron] taskkill fallback error:", e.message);
        }
      }, 6000);
    }

    const checkInterval = setInterval(() => {
      try { process.kill(pid, 0); } catch (e) {
        clearInterval(checkInterval);
        clearTimeout(killTimeout);
        backendProcess = null;
        backendReady = false;
        resolve();
      }
    }, 200);

    setTimeout(() => {
      clearInterval(checkInterval);
      clearTimeout(killTimeout);
      backendProcess = null;
      backendReady = false;
      resolve();
    }, 8000);
  });
}

/* ─────────────── Window lifecycle ─────────────── */
function createWindow() {
  smokeLog("createWindow begin");
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    return;
  }
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: "AI 合同审阅工作台",
    icon: getAppIcon(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
    show: false,
    backgroundColor: "#f8f9fa",
  });

  // Wait for backend before loading
  if (backendReady) {
    loadWorkbench();
  }

  if (isTest) {
    mainWindow.webContents.on("dom-ready", () => smokeLog("renderer dom-ready"));
    mainWindow.webContents.on("did-finish-load", () => smokeLog("renderer did-finish-load"));
    mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      smokeLog(`renderer did-fail-load code=${errorCode} main=${isMainFrame} url=${validatedURL} error=${errorDescription}`);
    });
    mainWindow.webContents.on("unresponsive", () => smokeLog("renderer unresponsive"));
    mainWindow.webContents.on("responsive", () => smokeLog("renderer responsive"));
  }

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    smokeLog(`renderer render-process-gone reason=${details?.reason || "unknown"} exitCode=${details?.exitCode ?? "n/a"}`);
    if (isTest) return;
    if (renderProcessReloadCount < MAX_RENDER_PROCESS_RELOADS) {
      renderProcessReloadCount += 1;
      console.log(`[Electron] Render process crashed, attempting reload ${renderProcessReloadCount}/${MAX_RENDER_PROCESS_RELOADS}`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.reload();
        return;
      }
    }
    dialog.showErrorBox("页面崩溃", `合同审阅工作台页面渲染进程异常终止（原因: ${details?.reason || "unknown"}），已尝试恢复 ${MAX_RENDER_PROCESS_RELOADS} 次均未成功。请重启应用。`);
  });

  mainWindow.once("ready-to-show", () => {
    smokeLog("window ready-to-show");
    mainWindow.show();
    if (isDev && !isTest) mainWindow.webContents.openDevTools();
  });

  mainWindow.on("close", (event) => {
    if (isQuitting) return;
    if (process.platform === "darwin") return; // macOS standard behavior
    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function loadWorkbench() {
  if (!mainWindow) return;
  smokeLog(`loading ${BACKEND_URL()}`);
  mainWindow.loadURL(BACKEND_URL());
}

function getAppIcon() {
  // Use a default blank icon or look for bundled icon
  const possiblePaths = [
    path.join(__dirname, "assets", "icon.png"),
    path.join(__dirname, "assets", "icon.ico"),
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return nativeImage.createFromPath(p);
  }
  return undefined;
}

/* ─────────────── Tray ─────────────── */
function createTray() {
  const iconPath = path.join(__dirname, "assets", "tray-icon.png");
  const fallbackPath = path.join(__dirname, "assets", "icon.png");
  let trayIcon;
  if (fs.existsSync(iconPath)) {
    trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  } else if (fs.existsSync(fallbackPath)) {
    trayIcon = nativeImage.createFromPath(fallbackPath).resize({ width: 16, height: 16 });
  } else {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip("AI 合同审阅工作台");

  function updateTrayTooltip(status) {
    if (!tray) return;
    const base = "AI 合同审阅工作台";
    tray.setToolTip(status ? `${base} - ${status}` : base);
  }

  // Update tooltip when backend status changes
  // Simple polling approach
  let lastTrayStatus = "";
  const trayInterval = setInterval(() => {
    const status = backendReady ? (isQuitting ? "正在关闭..." : "后端运行中") : (isQuitting ? "已关闭" : "后端启动中");
    if (status !== lastTrayStatus) {
      lastTrayStatus = status;
      updateTrayTooltip(status);
    }
  }, 5000);
  app.once("before-quit", () => clearInterval(trayInterval));
  updateTrayMenu();

  tray.on("click", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });
}

function updateTrayMenu() {
  const menu = Menu.buildFromTemplate([
    {
      label: "打开工作台",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow();
        }
      },
    },
    {
      label: "打开合同归档文件夹",
      click: () => {
        openWorkbenchFolder(WORKBENCH_ROOT);
      },
    },
    { type: "separator" },
    {
      label: "立即备份",
      click: async () => {
        try {
          const res = await fetch(`${BACKEND_URL()}/api/backup`, {
            method: "POST",
            headers: { "X-Legal-Workbench-Token": await getApiToken(), "Content-Type": "application/json" },
          });
          const data = await res.json();
          if (data.ok) {
            dialog.showMessageBox(mainWindow || undefined, {
              type: "info",
              title: "备份完成",
              message: `数据库已备份到:\n${data.backupPath}`,
            });
          } else {
            dialog.showErrorBox("备份失败", data.error || "未知错误");
          }
        } catch (e) {
          dialog.showErrorBox("备份失败", e.message);
        }
      },
    },
    { type: "separator" },
    {
      label: "退出",
      click: quitApp,
    },
  ]);
  tray.setContextMenu(menu);
}

async function getApiToken() {
  return BACKEND_API_TOKEN;
}

/* ─────────────── IPC ─────────────── */
ipcMain.handle("app:get-version", () => app.getVersion());
ipcMain.handle("app:get-paths", () => ({
  workbenchRoot: WORKBENCH_ROOT,
  dataDir: path.join(WORKBENCH_ROOT, "data"),
  contractsDir: path.join(WORKBENCH_ROOT, "contracts"),
  backupsDir: path.join(WORKBENCH_ROOT, "backups"),
}));
function openWorkbenchFolder(folderPath) {
  const resolved = path.resolve(path.normalize(folderPath));
  const root = path.resolve(path.normalize(WORKBENCH_ROOT));
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    dialog.showErrorBox("安全限制", "只能打开工作台根目录内的文件夹。");
    return;
  }
  shell.openPath(resolved);
}

ipcMain.handle("app:open-folder", async (_, folderPath) => {
  const resolved = path.resolve(path.normalize(folderPath));
  const root = path.resolve(path.normalize(WORKBENCH_ROOT));
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return { ok: false, error: "Access denied: path outside workbench root" };
  }
  const error = await shell.openPath(resolved);
  return { ok: !error, error: error || null };
});
ipcMain.handle("app:show-save-dialog", async (_, options) => {
  if (!mainWindow) return { canceled: true };
  const result = await dialog.showSaveDialog(mainWindow, options);
  return result;
});
ipcMain.handle("app:show-open-dialog", async (_, options) => {
  if (!mainWindow) return { canceled: true };
  const result = await dialog.showOpenDialog(mainWindow, options);
  return result;
});

/* ─────────────── App lifecycle ─────────────── */
async function autoBackupOnQuit() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const token = await getApiToken();
    const res = await fetch(`${BACKEND_URL()}/api/backup`, {
      method: "POST",
      headers: { "X-Legal-Workbench-Token": token, "Content-Type": "application/json" },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await res.json();
    if (data.ok) {
      console.log("[Electron] Auto-backup completed:", data.backupPath);
    } else {
      console.error("[Electron] Auto-backup failed:", data.error);
    }
  } catch (e) {
    console.error("[Electron] Auto-backup error:", e.message);
  }
}

async function quitApp() {
  isQuitting = true;
  if (tray) {
    tray.destroy();
    tray = null;
  }
  await autoBackupOnQuit();
  await stopBackend();
  app.quit();
}

app.whenReady().then(async () => {
  smokeLog("app.whenReady");
  await resolveBackendPort();
  smokeLog(`resolved backend port ${BACKEND_PORT}`);
  startBackend();
  smokeLog("backend start requested");
  createWindow();
  smokeLog("window create requested");
  createTray();
  smokeLog("tray create requested");

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow) {
      mainWindow.show();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform === "darwin") {
    quitApp();
  }
});

app.on("before-quit", (event) => {
  if (!isQuitting) {
    event.preventDefault();
    quitApp();
  }
});

// macOS: close window doesn't quit app
app.on("will-quit", () => {
  isQuitting = true;
});

// Prevent multiple instances
const gotTheLock = isTest ? true : app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else if (!isTest) {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}
