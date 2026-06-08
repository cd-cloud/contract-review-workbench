const assert = require("assert");
const { testAsync, summary } = require("./test-helper");

async function withEnv(overrides, fn) {
  const previous = {};
  Object.keys(overrides).forEach((key) => {
    previous[key] = process.env[key];
    if (overrides[key] === undefined) delete process.env[key];
    else process.env[key] = overrides[key];
  });
  delete require.cache[require.resolve("../server/contract-intake-adapter")];
  delete require.cache[require.resolve("../scripts/ai-runner-lib")];
  try {
    return await fn(require("../server/contract-intake-adapter"));
  } finally {
    Object.keys(overrides).forEach((key) => {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    });
    delete require.cache[require.resolve("../server/contract-intake-adapter")];
    delete require.cache[require.resolve("../scripts/ai-runner-lib")];
  }
}

console.log("\n=== test-contract-intake-adapter.js ===\n");

const asyncTests = [];

asyncTests.push(
  testAsync("runContractIntake returns backend fallback when runner is unavailable", async () => {
    await withEnv({
      CONTRACT_INTAKE_ALLOW_FALLBACK: "1",
      CONTRACT_INTAKE_RUNNER_SCRIPT: "scripts/does-not-exist.js",
      LEGAL_AI_PROVIDER: "codex-cli",
      CODEX_CLI_COMMAND: "C:/definitely-missing/codex.exe",
    }, async ({ runContractIntake }) => {
      const result = await runContractIntake({
        contractText: "保密协议\n甲方：甲公司\n乙方：乙公司\n双方应对合作中获知的信息保密。",
      });
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.source, "backend-fallback");
      assert.strictEqual(result.intake.contractType, "保密协议");
      assert.strictEqual(result.intake.counterparty, "乙公司");
    });
  })
);

Promise.all(asyncTests).then(() => summary());
