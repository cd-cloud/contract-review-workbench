const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function exists(filePath) {
  return Boolean(filePath && fs.existsSync(filePath));
}

function findCodexCommand() {
  const configured = process.env.CODEX_CLI_COMMAND || process.env.CODEX_COMMAND;
  if (configured) return { command: configured, exists: exists(configured) || configured === "codex" };
  const localAppData = process.env.LOCALAPPDATA || "";
  const desktopCodex = localAppData ? path.join(localAppData, "OpenAI", "Codex", "bin", "codex.exe") : "";
  if (exists(desktopCodex)) return { command: desktopCodex, exists: true };
  const lookupCommand = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(lookupCommand, ["codex"], { encoding: "utf8" });
  if (result.status === 0) return { command: result.stdout.split(/\r?\n/).filter(Boolean)[0], exists: true };
  return { command: "codex", exists: false };
}

function checkFile(label, filePath) {
  return { label, path: filePath, ok: exists(filePath) };
}

function main() {
  const provider = (process.env.LEGAL_AI_PROVIDER || process.env.AI_PROVIDER || (process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY ? "kimi" : "codex-cli")).toLowerCase();
  const codex = findCodexCommand();
  const skillPath =
    process.env.LEGAL_WORK_ORCHESTRATOR_SKILL ||
    path.join(process.env.USERPROFILE || process.env.HOME || "", ".codex", "skills", "legal-work-orchestrator", "SKILL.md");
  const checks = [
    checkFile("legal-work-orchestrator skill", skillPath),
    checkFile("AI skill runner", path.resolve("scripts/ai-skill-runner.js")),
    checkFile("AI suggestion runner", path.resolve("scripts/ai-suggestion-runner.js")),
    checkFile("AI intake runner", path.resolve("scripts/ai-intake-runner.js")),
    checkFile("AI visual QA runner", path.resolve("scripts/ai-visual-qa-runner.js")),
    checkFile("legal skill schema", path.resolve("schemas/legal-skill-response.schema.json")),
    checkFile("suggestion action schema", path.resolve("schemas/suggestion-action-response.schema.json")),
    checkFile("contract intake schema", path.resolve("schemas/contract-intake-response.schema.json")),
    checkFile("visual QA schema", path.resolve("schemas/visual-qa-response.schema.json")),
  ];
  const openAiCompatibleReady = Boolean(
    (process.env.LEGAL_AI_BASE_URL || process.env.OPENAI_COMPATIBLE_BASE_URL || process.env.KIMI_BASE_URL) &&
      (process.env.LEGAL_AI_API_KEY || process.env.OPENAI_COMPATIBLE_API_KEY || process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY) &&
      (process.env.LEGAL_AI_MODEL || process.env.KIMI_MODEL || process.env.MOONSHOT_MODEL)
  );
  const kimiImplicitReady = Boolean(
    (provider === "kimi" || provider === "moonshot") &&
      (process.env.LEGAL_AI_API_KEY || process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY)
  );
  const result = {
    ok:
      checks.every((item) => item.ok) &&
      (provider === "codex-cli" || provider === "codex" ? codex.exists : openAiCompatibleReady || kimiImplicitReady),
    provider,
    codex,
    openAiCompatible: {
      baseUrlConfigured: Boolean(process.env.LEGAL_AI_BASE_URL || process.env.OPENAI_COMPATIBLE_BASE_URL || process.env.KIMI_BASE_URL || process.env.MOONSHOT_BASE_URL || provider === "kimi" || provider === "moonshot"),
      apiKeyConfigured: Boolean(process.env.LEGAL_AI_API_KEY || process.env.OPENAI_COMPATIBLE_API_KEY || process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY),
      modelConfigured: Boolean(process.env.LEGAL_AI_MODEL || process.env.KIMI_MODEL || process.env.MOONSHOT_MODEL || provider === "kimi" || provider === "moonshot"),
      ready: openAiCompatibleReady || kimiImplicitReady,
    },
    checks,
    recommendedCommands: {
      codex: "npm run server:ai",
      kimi:
        "set LEGAL_AI_PROVIDER=kimi&& set KIMI_API_KEY=<key>&& npm run server:kimi",
    },
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

main();
