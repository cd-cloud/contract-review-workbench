const fs = require("fs");
const path = require("path");
const os = require("os");

const LOG_DIR = process.env.LEGAL_WORKBENCH_LOG_DIR
  || path.join(os.homedir(), "LegalWorkbench", "logs");
const MAX_LOG_SIZE_BYTES = Number(process.env.LEGAL_WORKBENCH_MAX_LOG_SIZE || 10 * 1024 * 1024);
const MAX_LOG_ROTATIONS = Number(process.env.LEGAL_WORKBENCH_MAX_LOG_ROTATIONS || 5);
const MAX_LOG_AGE_DAYS = Number(process.env.LEGAL_WORKBENCH_MAX_LOG_AGE_DAYS || 30);

fs.mkdirSync(LOG_DIR, { recursive: true });

function getLogFile() {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(LOG_DIR, `app-${date}.log`);
}

function rotateLogFile(logFile) {
  try {
    if (!fs.existsSync(logFile)) return;
    const stat = fs.statSync(logFile);
    if (stat.size < MAX_LOG_SIZE_BYTES) return;

    const dir = path.dirname(logFile);
    const base = path.basename(logFile, ".log");
    let target = path.join(dir, `${base}-1.log`);
    let index = 1;
    while (fs.existsSync(target) && index < MAX_LOG_ROTATIONS) {
      index += 1;
      target = path.join(dir, `${base}-${index}.log`);
    }
    fs.renameSync(logFile, target);

    // Prune old rotations beyond MAX_LOG_ROTATIONS
    for (let i = MAX_LOG_ROTATIONS + 1; ; i += 1) {
      const old = path.join(dir, `${base}-${i}.log`);
      if (!fs.existsSync(old)) break;
      try { fs.unlinkSync(old); } catch (e) {}
    }
  } catch (error) {
    // Silently fail if rotation fails
  }
}

function pruneOldLogs() {
  try {
    const cutoff = Date.now() - MAX_LOG_AGE_DAYS * 24 * 60 * 60 * 1000;
    const entries = fs.readdirSync(LOG_DIR);
    for (const name of entries) {
      if (!name.endsWith(".log")) continue;
      const filePath = path.join(LOG_DIR, name);
      try {
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(filePath);
        }
      } catch (e) {}
    }
  } catch (error) {
    // Silently fail if pruning fails
  }
}

pruneOldLogs();
const logPruneInterval = setInterval(pruneOldLogs, 6 * 60 * 60 * 1000);
if (typeof logPruneInterval.unref === "function") logPruneInterval.unref();

function write(level, message) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level}] ${message}\n`;
  try {
    const logFile = getLogFile();
    rotateLogFile(logFile);
    fs.appendFileSync(logFile, line);
  } catch (error) {
    // Silently fail if log file is not writable
  }
}

function log(message) {
  write("LOG", message);
  console.log(message);
}

function info(message) {
  write("INFO", message);
  console.info(message);
}

function warn(message) {
  write("WARN", message);
  console.warn(message);
}

function error(message) {
  write("ERROR", message);
  console.error(message);
}

module.exports = { log, info, warn, error };
