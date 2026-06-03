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

const isDev = !app.isPackaged;
const WORKBENCH_ROOT = path.join(os.homedir(), "LegalWorkbench");

/* ─────────────── Data directory writable check ─────────────── */
function ensureWorkbenchRoot() {
  try {
    fs.mkdirSync(WORKBENCH_ROOT, { recursive: true });
  } catch (error) {
    if (error.code === "EACCES" || error.code === "EPERM") {
      dialog.showErrorBox(
        "数据目录不可写",
        `合同审阅工作台无法创建数据目录：\n${WORKBENCH_ROOT}\n\n错误：${error.message}\n\n请检查该路径的写入权限，或以管理员身份重新启动应用。`
      );
      app.quit();
      return false;
    }
    throw error;
  }
  // Verify writable by creating a temp file
  const testFile = path.join(WORKBENCH_ROOT, `.write-test-${Date.now()}`);
  try {
    fs.writeFileSync(testFile, "test");
    fs.unlinkSync(testFile);
  } catch (error) {
    dialog.showErrorBox(
      "数据目录不可写",
      `合同审阅工作台无法写入数据目录：\n${WORKBENCH_ROOT}\n\n错误：${error.message}\n\n请检查该路径的写入权限，或以管理员身份重新启动应用。`
    );
    app.quit();
    return false;
  }
  return true;
}

if (!ensureWorkbenchRoot()) return;

/* ─────────────── Port selection ─────────────── */
let BACKEND_PORT = 8787;
const BACKEND_URL = () => `http://127.0.0.1:${BACKEND_PORT}`;

function findAvailablePort(startPort) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(startPort, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        findAvailablePort(startPort + 1).then(resolve).catch(reject);
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
const MAX_BACKEND_RESTARTS = 5;

/* ─────────────── Backend lifecycle ─────────────── */
function startBackend() {
  if (backendProcess) return;

  const serverScript = isDev
    ? path.join(__dirname, "..", "server", "server.js")
    : path.join(process.resourcesPath, "app", "server", "server.js");

  const env = {
    ...process.env,
    LEGAL_WORKBENCH_PORT: String(BACKEND_PORT),
    LEGAL_WORKBENCH_DATA_DIR: WORKBENCH_ROOT,
    NODE_ENV: isDev ? "development" : "production",
    ELECTRON_RUN_AS_NODE: "1",
  };

  // Desktop production: wire built-in AI runners so review works out-of-the-box
  if (!isDev) {
    const appRoot = path.join(process.resourcesPath, "app");
    const runnerMap = {
      LEGAL_SKILL_RUNNER_SCRIPT: "scripts/ai-skill-runner.js",
      SUGGESTION_ACTION_RUNNER_SCRIPT: "scripts/ai-suggestion-runner.js",
      CONTRACT_INTAKE_RUNNER_SCRIPT: "scripts/ai-intake-runner.js",
      VISUAL_QA_RUNNER_SCRIPT: "scripts/ai-visual-qa-runner.js",
    };
    for (const [key, relPath] of Object.entries(runnerMap)) {
      if (!env[key]) env[key] = path.join(appRoot, relPath);
    }
  }

  console.log("[Electron] Starting backend...", serverScript, "on port", BACKEND_PORT);
  backendProcess = spawn(process.execPath, [serverScript], {
    env,
    stdio: ["pipe", "pipe", "pipe"],
    detached: false,
  });

  backendProcess.stdout.on("data", (data) => {
    const text = data.toString().trim();
    if (text) console.log("[Backend]", text);
    if (text.includes(`listening on http://127.0.0.1:${BACKEND_PORT}`)) {
      backendReady = true;
      if (mainWindow) loadWorkbench();
    }
  });

  backendProcess.stderr.on("data", (data) => {
    const text = data.toString().trim();
    if (text) console.error("[Backend Error]", text);
  });

  backendProcess.on("error", (err) => {
    console.error("[Backend] Failed to start:", err);
    tryRestartBackend();
  });

  backendProcess.on("close", (code) => {
    console.log(`[Backend] Exited with code ${code}`);
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
  if (!backendProcess) return;
  console.log("[Electron] Stopping backend...");
  backendProcess.removeAllListeners("close");

  // Windows reliable termination: try SIGTERM then SIGKILL, and fallback to taskkill
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

  // Windows fallback: taskkill /F /T to ensure no orphan Node processes
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

  setTimeout(() => {
    clearTimeout(killTimeout);
    backendProcess = null;
    backendReady = false;
  }, 7000);
}

/* ─────────────── Window lifecycle ─────────────── */
function createWindow() {
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

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    if (isDev) mainWindow.webContents.openDevTools();
  });

  mainWindow.on("close", (event) => {
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
  let trayIcon;
  if (fs.existsSync(iconPath)) {
    trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  } else {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip("AI 合同审阅工作台");
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
  try {
    const res = await fetch(`${BACKEND_URL()}/js/runtime-config.js`);
    const text = await res.text();
    const match = text.match(/window\.LEGAL_WORKBENCH_API_TOKEN\s*=\s*(.+?);/);
    if (match) {
      const token = JSON.parse(match[1]);
      return token;
    }
  } catch (e) {
    console.error("[Electron] Failed to get API token:", e);
  }
  return "";
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
  const resolved = path.resolve(folderPath);
  const root = path.resolve(WORKBENCH_ROOT);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    dialog.showErrorBox("安全限制", "只能打开工作台根目录内的文件夹。");
    return;
  }
  shell.openPath(resolved);
}

ipcMain.handle("app:open-folder", async (_, folderPath) => {
  const resolved = path.resolve(folderPath);
  const root = path.resolve(WORKBENCH_ROOT);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
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
    const token = await getApiToken();
    const res = await fetch(`${BACKEND_URL()}/api/backup`, {
      method: "POST",
      headers: { "X-Legal-Workbench-Token": token, "Content-Type": "application/json" },
    });
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
  if (tray) {
    tray.destroy();
    tray = null;
  }
  await autoBackupOnQuit();
  stopBackend();
  app.quit();
}

app.whenReady().then(async () => {
  await resolveBackendPort();
  startBackend();
  createWindow();
  createTray();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow) {
      mainWindow.show();
    }
  });
});

app.on("window-all-closed", () => {
  // Keep backend running in tray on Windows/Linux
  if (process.platform === "darwin") {
    autoBackupOnQuit().finally(() => {
      stopBackend();
      app.quit();
    });
  }
});

app.on("before-quit", () => {
  stopBackend();
});

// macOS: close window doesn't quit app
app.on("will-quit", () => {
  stopBackend();
});

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}
