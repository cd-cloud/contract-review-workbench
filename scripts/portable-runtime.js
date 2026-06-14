const fs = require("fs");
const net = require("net");
const path = require("path");
const { resolveAutomaticProviderSelection, resolveKimiCommandStatus } = require("./ai-runner-lib");

const DEFAULT_PORT = 8787;
const PORT_SCAN_LIMIT = 20;
const RUNTIME_PROFILE_FILE = "runtime-profile.json";
const RUNTIME_PROFILE_LABELS = {
  ai: "自动选择",
  kimi: "Kimi CLI",
  codex: "Codex CLI",
  basic: "仅后端",
  server: "仅后端",
  skill: "本地 Skill",
};

function appRoot() {
  return path.resolve(__dirname, "..");
}

function defaultPortableDataDir() {
  return path.join(appRoot(), ".local-workbench");
}

function normalizeRuntimeProfile(profile = "ai") {
  const normalized = String(profile || "ai").trim().toLowerCase();
  if (["auto", "default", "automatic"].includes(normalized)) return "ai";
  if (Object.prototype.hasOwnProperty.call(RUNTIME_PROFILE_LABELS, normalized)) return normalized;
  return "ai";
}

function runtimeProfilePath(dataDir = process.env.LEGAL_WORKBENCH_DATA_DIR || defaultPortableDataDir()) {
  return path.join(dataDir, RUNTIME_PROFILE_FILE);
}

function readRuntimePreference(dataDir = process.env.LEGAL_WORKBENCH_DATA_DIR || defaultPortableDataDir()) {
  const filePath = runtimeProfilePath(dataDir);
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const profile = normalizeRuntimeProfile(raw.profile || raw.preferredProfile || "ai");
    return {
      profile,
      label: RUNTIME_PROFILE_LABELS[profile] || profile,
      path: filePath,
      updatedAt: raw.updatedAt || "",
    };
  } catch (error) {
    return {
      profile: "ai",
      label: RUNTIME_PROFILE_LABELS.ai,
      path: filePath,
      updatedAt: "",
    };
  }
}

function writeRuntimePreference(profile, dataDir = process.env.LEGAL_WORKBENCH_DATA_DIR || defaultPortableDataDir()) {
  const normalized = normalizeRuntimeProfile(profile);
  ensureWritableDirectory(dataDir);
  const filePath = runtimeProfilePath(dataDir);
  const payload = {
    profile: normalized,
    label: RUNTIME_PROFILE_LABELS[normalized] || normalized,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
  return { ...payload, path: filePath };
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

function assignRunner(key, relativePath, targetEnv = process.env) {
  if (!targetEnv[key]) targetEnv[key] = scriptPath(relativePath);
}

function applyRuntimeSelection(selection, targetEnv = process.env) {
  targetEnv.LEGAL_WORKBENCH_RUNTIME_PROFILE = selection.profile;
  targetEnv.LEGAL_WORKBENCH_RUNTIME_MODE = selection.mode;
  targetEnv.LEGAL_WORKBENCH_RUNTIME_REASON = selection.reason;
  targetEnv.LEGAL_WORKBENCH_EFFECTIVE_PROVIDER = selection.provider;
}

function resolveAutomaticAiProfile() {
  return resolveAutomaticProviderSelection();
}

function configureRunnerProfile(profile = "ai", targetEnv = process.env) {
  const normalized = normalizeRuntimeProfile(profile);

  if (normalized === "basic" || normalized === "server") {
    applyRuntimeSelection({ profile: normalized, mode: "basic", provider: "none", reason: "Basic server profile selected." }, targetEnv);
    return normalized;
  }

  if (normalized === "skill") {
    assignRunner("LEGAL_SKILL_RUNNER_SCRIPT", "scripts/legal-skill-runner.js", targetEnv);
    applyRuntimeSelection({ profile: normalized, mode: "local-skill", provider: "local-skill", reason: "Local skill profile selected." }, targetEnv);
    return normalized;
  }

  if (normalized === "codex") {
    targetEnv.LEGAL_AI_PROVIDER = "codex-cli";
    assignRunner("LEGAL_SKILL_RUNNER_SCRIPT", "scripts/codex-skill-runner.js", targetEnv);
    assignRunner("SUGGESTION_ACTION_RUNNER_SCRIPT", "scripts/codex-suggestion-runner.js", targetEnv);
    assignRunner("CONTRACT_INTAKE_RUNNER_SCRIPT", "scripts/codex-intake-runner.js", targetEnv);
    assignRunner("VISUAL_QA_RUNNER_SCRIPT", "scripts/ai-visual-qa-runner.js", targetEnv);
    applyRuntimeSelection({ profile: normalized, mode: "codex-cli", provider: "codex-cli", reason: "Codex profile selected explicitly." }, targetEnv);
    return normalized;
  }

  if (normalized === "kimi") {
    const kimiStatus = resolveKimiCommandStatus();
    if (kimiStatus.runnable) {
      targetEnv.LEGAL_AI_PROVIDER = "kimi-cli";
      assignRunner("LEGAL_SKILL_RUNNER_SCRIPT", "scripts/kimi-code-skill-runner.js", targetEnv);
      assignRunner("SUGGESTION_ACTION_RUNNER_SCRIPT", "scripts/ai-suggestion-runner.js", targetEnv);
      assignRunner("CONTRACT_INTAKE_RUNNER_SCRIPT", "scripts/ai-intake-runner.js", targetEnv);
      assignRunner("VISUAL_QA_RUNNER_SCRIPT", "scripts/ai-visual-qa-runner.js", targetEnv);
      applyRuntimeSelection({ profile: normalized, mode: "kimi-cli", provider: "kimi-cli", reason: "Kimi Code CLI is runnable; using true skill execution." }, targetEnv);
      return normalized;
    }
    targetEnv.LEGAL_AI_PROVIDER = "kimi";
    assignRunner("LEGAL_SKILL_RUNNER_SCRIPT", "scripts/ai-skill-runner.js", targetEnv);
    assignRunner("SUGGESTION_ACTION_RUNNER_SCRIPT", "scripts/ai-suggestion-runner.js", targetEnv);
    assignRunner("CONTRACT_INTAKE_RUNNER_SCRIPT", "scripts/ai-intake-runner.js", targetEnv);
    assignRunner("VISUAL_QA_RUNNER_SCRIPT", "scripts/ai-visual-qa-runner.js", targetEnv);
    applyRuntimeSelection({ profile: normalized, mode: "openai-compatible", provider: "kimi", reason: "Kimi profile selected explicitly. Kimi Code CLI is not available; falling back to API." }, targetEnv);
    return normalized;
  }

  const selection = resolveAutomaticAiProfile();
  applyRuntimeSelection(selection, targetEnv);

  if (selection.mode === "kimi-cli") {
    targetEnv.LEGAL_AI_PROVIDER = selection.provider;
    assignRunner("LEGAL_SKILL_RUNNER_SCRIPT", "scripts/kimi-code-skill-runner.js", targetEnv);
    assignRunner("SUGGESTION_ACTION_RUNNER_SCRIPT", "scripts/ai-suggestion-runner.js", targetEnv);
    assignRunner("CONTRACT_INTAKE_RUNNER_SCRIPT", "scripts/ai-intake-runner.js", targetEnv);
    assignRunner("VISUAL_QA_RUNNER_SCRIPT", "scripts/ai-visual-qa-runner.js", targetEnv);
    return "kimi";
  }

  if (selection.mode === "codex-cli") {
    targetEnv.LEGAL_AI_PROVIDER = selection.provider;
    assignRunner("LEGAL_SKILL_RUNNER_SCRIPT", "scripts/codex-skill-runner.js", targetEnv);
    assignRunner("SUGGESTION_ACTION_RUNNER_SCRIPT", "scripts/codex-suggestion-runner.js", targetEnv);
    assignRunner("CONTRACT_INTAKE_RUNNER_SCRIPT", "scripts/codex-intake-runner.js", targetEnv);
    assignRunner("VISUAL_QA_RUNNER_SCRIPT", "scripts/ai-visual-qa-runner.js", targetEnv);
    return "codex";
  }

  if (selection.mode === "openai-compatible") {
    targetEnv.LEGAL_AI_PROVIDER = selection.provider;
    assignRunner("LEGAL_SKILL_RUNNER_SCRIPT", "scripts/ai-skill-runner.js", targetEnv);
    assignRunner("SUGGESTION_ACTION_RUNNER_SCRIPT", "scripts/ai-suggestion-runner.js", targetEnv);
    assignRunner("CONTRACT_INTAKE_RUNNER_SCRIPT", "scripts/ai-intake-runner.js", targetEnv);
    assignRunner("VISUAL_QA_RUNNER_SCRIPT", "scripts/ai-visual-qa-runner.js", targetEnv);
    return selection.profile === "kimi" ? "kimi" : "ai";
  }

  if (!targetEnv.LEGAL_SKILL_ALLOW_FALLBACK) targetEnv.LEGAL_SKILL_ALLOW_FALLBACK = "1";
  if (!targetEnv.SUGGESTION_ACTION_ALLOW_FALLBACK) targetEnv.SUGGESTION_ACTION_ALLOW_FALLBACK = "1";
  if (!targetEnv.CONTRACT_INTAKE_ALLOW_FALLBACK) targetEnv.CONTRACT_INTAKE_ALLOW_FALLBACK = "1";
  if (!targetEnv.VISUAL_QA_ALLOW_FALLBACK) targetEnv.VISUAL_QA_ALLOW_FALLBACK = "1";
  assignRunner("VISUAL_QA_RUNNER_SCRIPT", "scripts/ai-visual-qa-runner.js", targetEnv);
  return "fallback";
}

function parseProfileArg(argv = process.argv.slice(2), fallback = "ai") {
  const profileArg = argv.find((item) => item.startsWith("--profile="));
  if (profileArg) return profileArg.split("=").slice(1).join("=") || "ai";
  const index = argv.indexOf("--profile");
  if (index >= 0 && argv[index + 1]) return argv[index + 1];
  return fallback;
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
  normalizeRuntimeProfile,
  readRuntimePreference,
  resolveAutomaticAiProfile,
  parseProfileArg,
  runtimeProfilePath,
  writeRuntimePreference,
};
