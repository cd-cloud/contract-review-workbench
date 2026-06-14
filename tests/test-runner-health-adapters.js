const assert = require("assert");
const { testAsync, summary } = require("./test-helper");

function clearModuleCaches(modulePath) {
  [modulePath, "../scripts/ai-runner-lib", "../server/runner-health"].forEach((target) => {
    try {
      delete require.cache[require.resolve(target)];
    } catch (error) {}
  });
}

async function withModule(modulePath, overrides, fn, setup) {
  const previous = {};
  Object.keys(overrides).forEach((key) => {
    previous[key] = process.env[key];
    if (overrides[key] === undefined) delete process.env[key];
    else process.env[key] = overrides[key];
  });
  clearModuleCaches(modulePath);
  let teardown = null;
  try {
    teardown = typeof setup === "function" ? setup() : null;
    const mod = require(modulePath);
    if (typeof mod._resetRunnerStatusForTesting === "function") mod._resetRunnerStatusForTesting();
    return await fn(mod);
  } finally {
    try {
      if (typeof teardown === "function") teardown();
    } catch (error) {}
    Object.keys(overrides).forEach((key) => {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    });
    clearModuleCaches(modulePath);
  }
}

console.log("\n=== test-runner-health-adapters.js ===\n");

const asyncTests = [];

asyncTests.push(testAsync("contract intake status records fallback after a real degraded call", async () => {
  await withModule("../server/contract-intake-adapter", {
    CONTRACT_INTAKE_ALLOW_FALLBACK: "1",
    CONTRACT_INTAKE_RUNNER_SCRIPT: "scripts/does-not-exist.js",
    LEGAL_AI_PROVIDER: "kimi",
    KIMI_API_KEY: "test-key",
  }, async ({ runContractIntake, getRunnerStatus }) => {
    assert.strictEqual(getRunnerStatus().lastRunState, "never-run");
    const result = await runContractIntake({ contractText: "淇濆瘑鍗忚\n鐢叉柟锛氱敳鍏徃\n涔欐柟锛氫箼鍏徃" });
    assert.strictEqual(result.source, "backend-fallback");
    const status = getRunnerStatus();
    assert.strictEqual(status.lastRunState, "fallback");
    assert.strictEqual(status.degraded, true);
    assert.strictEqual(status.healthy, false);
    assert.ok(status.lastFallbackReason);
    assert.ok(status.lastFailureAt);
    assert.strictEqual(status.promptVersion, "agent-intake-v1");
    assert.strictEqual(status.downstreamSkill, "legal-contract-orchestrator");
  });
}));

asyncTests.push(testAsync("suggestion action status records successful runner execution", async () => {
  await withModule("../server/suggestion-action-adapter", {
    SUGGESTION_ACTION_ALLOW_FALLBACK: "0",
    SUGGESTION_ACTION_RUNNER_SCRIPT: "tests/fixture-success-runner.js",
    LEGAL_AI_PROVIDER: "kimi",
    KIMI_API_KEY: "test-key",
  }, async ({ runSuggestionAction, getRunnerStatus }) => {
    const result = await runSuggestionAction({ suggestion: {}, targetClause: { id: "c1", text: "x" } });
    assert.strictEqual(result.ok, true);
    const status = getRunnerStatus();
    assert.strictEqual(status.lastRunState, "succeeded");
    assert.strictEqual(status.healthy, true);
    assert.strictEqual(status.degraded, false);
    assert.ok(status.lastSuccessAt);
    assert.strictEqual(status.promptVersion, "agent-suggestion-v1");
    assert.strictEqual(status.downstreamSkill, "legal-contract-orchestrator");
  }, () => {
    const childProcess = require("child_process");
    const original = childProcess.execFile;
    childProcess.execFile = (command, args, options, callback) => {
      if (typeof options === "function") {
        callback = options;
        options = {};
      }
      setImmediate(() => callback(null, JSON.stringify({ action: { status: "adopted", actionType: "none" } }), ""));
      return { stdin: { write() {}, end() {} } };
    };
    return () => {
      childProcess.execFile = original;
    };
  });
}));

asyncTests.push(testAsync("visual QA status records fallback after model runner failure", async () => {
  await withModule("../server/visual-qa-adapter", {
    VISUAL_QA_RUNNER_SCRIPT: "scripts/does-not-exist.js",
    VISUAL_QA_ALLOW_FALLBACK: "1",
    LEGAL_AI_PROVIDER: "kimi",
    KIMI_API_KEY: "test-key",
  }, async ({ runVisualQa, getRunnerStatus }) => {
    const result = await runVisualQa({ localChecks: [{ severity: "medium", type: "numbering", title: "n" }] });
    assert.strictEqual(result.source, "visual-qa-fallback");
    const status = getRunnerStatus();
    assert.strictEqual(status.lastRunState, "fallback");
    assert.strictEqual(status.lastUsedFallback, true);
    assert.ok(status.lastFailureAt);
    assert.strictEqual(status.promptVersion, "agent-b-visual-v1");
    assert.strictEqual(status.downstreamSkill, "legal-contract-orchestrator");
  }, () => {
    const childProcess = require("child_process");
    const original = childProcess.execFile;
    childProcess.execFile = (command, args, options, callback) => {
      if (typeof options === "function") {
        callback = options;
        options = {};
      }
      setImmediate(() => callback(new Error("simulated visual qa failure"), "", "simulated visual qa failure"));
      return { stdin: { write() {}, end() {} } };
    };
    return () => {
      childProcess.execFile = original;
    };
  });
}));

asyncTests.push(testAsync("visual QA falls back by default when model runner fails", async () => {
  await withModule("../server/visual-qa-adapter", {
    VISUAL_QA_RUNNER_SCRIPT: "scripts/does-not-exist.js",
    VISUAL_QA_ALLOW_FALLBACK: undefined,
    LEGAL_AI_PROVIDER: "kimi",
    KIMI_API_KEY: "test-key",
  }, async ({ runVisualQa, getRunnerStatus }) => {
    const result = await runVisualQa({ localChecks: [{ severity: "high", type: "numbering", title: "n" }] });
    assert.strictEqual(result.source, "visual-qa-fallback");
    assert.strictEqual(result.visualQa.status, "blocked");
    const status = getRunnerStatus();
    assert.strictEqual(status.allowFallback, true);
    assert.strictEqual(status.lastRunState, "fallback");
  }, () => {
    const childProcess = require("child_process");
    const original = childProcess.execFile;
    childProcess.execFile = (command, args, options, callback) => {
      if (typeof options === "function") {
        callback = options;
        options = {};
      }
      setImmediate(() => callback(new Error("simulated visual qa failure"), "", "simulated visual qa failure"));
      return { stdin: { write() {}, end() {} } };
    };
    return () => {
      childProcess.execFile = original;
    };
  });
}));

Promise.all(asyncTests).then(() => summary());
