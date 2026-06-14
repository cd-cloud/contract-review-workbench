const assert = require("assert");
const { test, summary } = require("./test-helper");

function withEnv(overrides, fn, prepare) {
  const previous = {};
  Object.keys(overrides).forEach((key) => {
    previous[key] = process.env[key];
    if (overrides[key] === undefined) delete process.env[key];
    else process.env[key] = overrides[key];
  });
  delete require.cache[require.resolve("../scripts/portable-runtime")];
  delete require.cache[require.resolve("../scripts/ai-runner-lib")];
  try {
    if (typeof prepare === "function") prepare(require("../scripts/ai-runner-lib"));
    delete require.cache[require.resolve("../scripts/portable-runtime")];
    return fn(require("../scripts/portable-runtime"));
  } finally {
    Object.keys(overrides).forEach((key) => {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    });
    delete require.cache[require.resolve("../scripts/portable-runtime")];
    delete require.cache[require.resolve("../scripts/ai-runner-lib")];
  }
}

console.log("\n=== test-portable-runtime-pure.js ===\n");

test("resolveAutomaticAiProfile prefers ready API provider", () => {
  withEnv({
    CODEX_CLI_COMMAND: "C:/definitely-missing/codex.exe",
    LEGAL_WORKBENCH_DISABLE_KIMI_CLI: "1",
    LEGAL_WORKBENCH_DISABLE_CODEX_CLI: "1",
    KIMI_API_KEY: "test-key",
    LEGAL_AI_PROVIDER: undefined,
    AI_PROVIDER: undefined,
    LEGAL_AI_API_KEY: undefined,
    OPENAI_COMPATIBLE_API_KEY: undefined,
  }, ({ resolveAutomaticAiProfile }) => {
    const result = resolveAutomaticAiProfile();
    assert.strictEqual(result.mode, "openai-compatible");
    assert.strictEqual(result.profile, "kimi");
  });
});

test("resolveAutomaticAiProfile falls back to codex when API config is incomplete but codex is runnable", () => {
  withEnv({
    LEGAL_AI_PROVIDER: "openai-compatible",
    LEGAL_AI_API_KEY: undefined,
    OPENAI_COMPATIBLE_API_KEY: undefined,
    KIMI_API_KEY: undefined,
    MOONSHOT_API_KEY: undefined,
  }, ({ resolveAutomaticAiProfile }) => {
    const result = resolveAutomaticAiProfile();
    assert.strictEqual(result.mode, "codex-cli");
    assert.strictEqual(result.profile, "codex");
  }, (aiRunnerLib) => {
    aiRunnerLib.resolveAutomaticProviderSelection = () => ({
      profile: "codex",
      provider: "codex-cli",
      mode: "codex-cli",
      reason: "Configured API provider is incomplete; falling back to local Codex CLI.",
    });
  });
});

test("resolveAutomaticAiProfile returns fallback when neither codex nor API is healthy", () => {
  withEnv({
    CODEX_CLI_COMMAND: "C:/definitely-missing/codex.exe",
    LEGAL_AI_PROVIDER: undefined,
    AI_PROVIDER: undefined,
    LEGAL_AI_API_KEY: undefined,
    OPENAI_COMPATIBLE_API_KEY: undefined,
    KIMI_API_KEY: undefined,
    MOONSHOT_API_KEY: undefined,
  }, ({ resolveAutomaticAiProfile }) => {
    const result = resolveAutomaticAiProfile();
    assert.strictEqual(result.mode, "fallback");
    assert.strictEqual(result.profile, "fallback");
  }, (aiRunnerLib) => {
    aiRunnerLib.resolveAutomaticProviderSelection = () => ({
      profile: "fallback",
      provider: "codex-cli",
      mode: "fallback",
      reason: "No healthy AI provider detected.",
    });
  });
});

test("runtime profile preference persists normalized profile", () => {
  const fs = require("fs");
  const path = require("path");
  const dir = path.join(__dirname, ".tmp-runtime-profile");
  fs.rmSync(dir, { recursive: true, force: true });
  try {
    withEnv({ LEGAL_WORKBENCH_DATA_DIR: dir }, ({
      normalizeRuntimeProfile,
      readRuntimePreference,
      writeRuntimePreference,
    }) => {
      assert.strictEqual(normalizeRuntimeProfile("auto"), "ai");
      assert.strictEqual(readRuntimePreference(dir).profile, "ai");

      const saved = writeRuntimePreference("codex", dir);
      assert.strictEqual(saved.profile, "codex");
      assert.strictEqual(saved.label, "Codex CLI");

      const loaded = readRuntimePreference(dir);
      assert.strictEqual(loaded.profile, "codex");
      assert.strictEqual(loaded.label, "Codex CLI");

      const fallback = writeRuntimePreference("not-a-profile", dir);
      assert.strictEqual(fallback.profile, "ai");
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

summary();
