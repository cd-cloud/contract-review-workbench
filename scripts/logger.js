const fs = require("fs");
const path = require("path");
const os = require("os");

const LOG_DIR = process.env.LEGAL_WORKBENCH_LOG_DIR
  || path.join(os.homedir(), "LegalWorkbench", "logs");

fs.mkdirSync(LOG_DIR, { recursive: true });

function getLogFile() {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(LOG_DIR, `app-${date}.log`);
}

function write(level, message) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level}] ${message}\n`;
  try {
    fs.appendFileSync(getLogFile(), line);
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
