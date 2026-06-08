const fs = require("fs");
const net = require("net");
const path = require("path");
const { resolveAutomaticProviderSelection } = require("./ai-runner-lib");

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

function assignRunner(key, relativePath) {
  if (!process.env[key]) process.env[key] = scriptPath(relativePath);
}

function applyRuntimeSelection(selection) {
  process.env.LEGAL_WORKBENCH_RUNTIME_PROFILE = selection.profile;
  process.env.LEGAL_WORKBENCH_RUNTIME_MODE = selection.mode;
  process.env.LEGAL_WORKBENCH_RUNTIME_REASON = selection.reason;
  process.env.LEGAL_WORKBENCH_EFFECTIVE_PROVIDER = selection.provider;
}

function resolveAutomaticAiProfile() {
  return resolveAutomaticProviderSelection();
}

function configureRunnerProfile(profile = "ai") {
  const normalized = String(profile || "ai").toLowerCase();

  if (normalized === "basic" || normalized === "server") {
    applyRuntimeSelection({ profile: normalized, mode: "basic", provider: "none", reason: "Basic server profile selected." });
    return normalized;
  }

  if (normalized === "skill") {
    assignRunner("LEGAL_SKILL_RUNNER_SCRIPT", "scripts/legal-skill-runner.js");
    applyRuntimeSelection({ profile: normalized, mode: "local-skill", provider: "local-skill", reason: "Local skill profile selected." });
    return normalized;
  }

  if (normalized === "codex") {
    process.env.LEGAL_AI_PROVIDER = "codex-cli";
    assignRunner("LEGAL_SKILL_RUNNER_SCRIPT", "scripts/codex-skill-runner.js");
    assignRunner("SUGGESTION_ACTION_RUNNER_SCRIPT", "scripts/codex-suggestion-runner.js");
    assignRunner("CONTRACT_INTAKE_RUNNER_SCRIPT", "scripts/codex-intake-runner.js");
    assignRunner("VISUAL_QA_RUNNER_SCRIPT", "scripts/ai-visual-qa-runner.js");
    applyRuntimeSelection({ profile: normalized, mode: "codex-cli", provider: "codex-cli", reason: "Codex profile selected explicitly." });
    return normalized;
  }

  if (normalized === "kimi") {
    process.env.LEGAL_AI_PROVIDER = "kimi";
    assignRunner("LEGAL_SKILL_RUNNER_SCRIPT", "scripts/ai-skill-runner.js");
    assignRunner("SUGGESTION_ACTION_RUNNER_SCRIPT", "scripts/ai-suggestion-runner.js");
    assignRunner("CONTRACT_INTAKE_RUNNER_SCRIPT", "scripts/ai-intake-runner.js");
    assignRunner("VISUAL_QA_RUNNER_SCRIPT", "scripts/ai-visual-qa-runner.js");
    applyRuntimeSelection({ profile: normalized, mode: "openai-compatible", provider: "kimi", reason: "Kimi profile selected explicitly." });
    return normalized;
  }

  const selection = resolveAutomaticAiProfile();
  applyRuntimeSelection(selection);

  if (selection.mode === "codex-cli") {
    process.env.LEGAL_AI_PROVIDER = selection.provider;
    assignRunner("LEGAL_SKILL_RUNNER_SCRIPT", "scripts/codex-skill-runner.js");
    assignRunner("SUGGESTION_ACTION_RUNNER_SCRIPT", "scripts/codex-suggestion-runner.js");
    assignRunner("CONTRACT_INTAKE_RUNNER_SCRIPT", "scripts/codex-intake-runner.js");
    assignRunner("VISUAL_QA_RUNNER_SCRIPT", "scripts/ai-visual-qa-runner.js");
    return "codex";
  }

  if (selection.mode === "openai-compatible") {
    process.env.LEGAL_AI_PROVIDER = selection.provider;
    assignRunner("LEGAL_SKILL_RUNNER_SCRIPT", "scripts/ai-skill-runner.js");
    assignRunner("SUGGESTION_ACTION_RUNNER_SCRIPT", "scripts/ai-suggestion-runner.js");
    assignRunner("CONTRACT_INTAKE_RUNNER_SCRIPT", "scripts/ai-intake-runner.js");
    assignRunner("VISUAL_QA_RUNNER_SCRIPT", "scripts/ai-visual-qa-runner.js");
    return selection.profile === "kimi" ? "kimi" : "ai";
  }

  if (!process.env.LEGAL_SKILL_ALLOW_FALLBACK) process.env.LEGAL_SKILL_ALLOW_FALLBACK = "1";
  if (!process.env.SUGGESTION_ACTION_ALLOW_FALLBACK) process.env.SUGGESTION_ACTION_ALLOW_FALLBACK = "1";
  if (!process.env.CONTRACT_INTAKE_ALLOW_FALLBACK) process.env.CONTRACT_INTAKE_ALLOW_FALLBACK = "1";
  if (!process.env.VISUAL_QA_ALLOW_FALLBACK) process.env.VISUAL_QA_ALLOW_FALLBACK = "1";
  assignRunner("VISUAL_QA_RUNNER_SCRIPT", "scripts/ai-visual-qa-runner.js");
  return "fallback";
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
  resolveAutomaticAiProfile,
  parseProfileArg,
};
