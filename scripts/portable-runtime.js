const fs = require("fs");
const net = require("net");
const path = require("path");

const DEFAULT_PORT = 8787;
const PORT_SCAN_LIMIT = 20;

function appRoot() {
  return path.resolve(__dirname, "..");
}

function defaultPortableDataDir() {
  return path.join(appRoot(), ".local-workbench");
}

function ensurePortableDataDir() {
  if (!process.env.LEGAL_WORKBENCH_DATA_DIR) {
    process.env.LEGAL_WORKBENCH_DATA_DIR = defaultPortableDataDir();
  }
  ensureWritableDirectory(process.env.LEGAL_WORKBENCH_DATA_DIR);
  return process.env.LEGAL_WORKBENCH_DATA_DIR;
}

function ensureWritableDirectory(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const probe = path.join(dir, `.write-probe-${process.pid}-${Date.now()}`);
  fs.writeFileSync(probe, "ok");
  fs.unlinkSync(probe);
}

function canListen(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

async function findAvailablePort(startPort = DEFAULT_PORT, limit = PORT_SCAN_LIMIT) {
  const base = Number(startPort || DEFAULT_PORT);
  for (let offset = 0; offset < limit; offset += 1) {
    const port = base + offset;
    if (await canListen(port)) return port;
  }
  throw new Error(`No available port found from ${base} to ${base + limit - 1}`);
}

async function ensurePortablePort() {
  if (process.env.LEGAL_WORKBENCH_PORT) {
    const port = Number(process.env.LEGAL_WORKBENCH_PORT);
    if (!Number.isInteger(port) || port <= 0) {
      throw new Error(`Invalid LEGAL_WORKBENCH_PORT: ${process.env.LEGAL_WORKBENCH_PORT}`);
    }
    return port;
  }
  const port = await findAvailablePort(DEFAULT_PORT);
  process.env.LEGAL_WORKBENCH_PORT = String(port);
  return port;
}

function scriptPath(relativePath) {
  return path.join(appRoot(), relativePath);
}

function configureRunnerProfile(profile = "ai") {
  const normalized = String(profile || "ai").toLowerCase();
  const assign = (key, relativePath) => {
    if (!process.env[key]) process.env[key] = scriptPath(relativePath);
  };

  if (normalized === "basic" || normalized === "server") return normalized;

  if (normalized === "skill") {
    assign("LEGAL_SKILL_RUNNER_SCRIPT", "scripts/legal-skill-runner.js");
    return normalized;
  }

  if (normalized === "codex") {
    assign("LEGAL_SKILL_RUNNER_SCRIPT", "scripts/codex-skill-runner.js");
    assign("SUGGESTION_ACTION_RUNNER_SCRIPT", "scripts/codex-suggestion-runner.js");
    assign("CONTRACT_INTAKE_RUNNER_SCRIPT", "scripts/codex-intake-runner.js");
    assign("VISUAL_QA_RUNNER_SCRIPT", "scripts/ai-visual-qa-runner.js");
    return normalized;
  }

  if (normalized === "kimi") {
    if (!process.env.LEGAL_AI_PROVIDER) process.env.LEGAL_AI_PROVIDER = "kimi";
  }

  assign("LEGAL_SKILL_RUNNER_SCRIPT", "scripts/ai-skill-runner.js");
  assign("SUGGESTION_ACTION_RUNNER_SCRIPT", "scripts/ai-suggestion-runner.js");
  assign("CONTRACT_INTAKE_RUNNER_SCRIPT", "scripts/ai-intake-runner.js");
  assign("VISUAL_QA_RUNNER_SCRIPT", "scripts/ai-visual-qa-runner.js");
  return normalized === "kimi" ? "kimi" : "ai";
}

function parseProfileArg(argv = process.argv.slice(2)) {
  const profileArg = argv.find((item) => item.startsWith("--profile="));
  if (profileArg) return profileArg.split("=").slice(1).join("=") || "ai";
  const index = argv.indexOf("--profile");
  if (index >= 0 && argv[index + 1]) return argv[index + 1];
  return "ai";
}

module.exports = {
  DEFAULT_PORT,
  PORT_SCAN_LIMIT,
  appRoot,
  canListen,
  configureRunnerProfile,
  defaultPortableDataDir,
  ensurePortableDataDir,
  ensurePortablePort,
  ensureWritableDirectory,
  findAvailablePort,
  parseProfileArg,
};
