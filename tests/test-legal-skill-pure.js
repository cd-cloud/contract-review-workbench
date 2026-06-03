/**
 * Layer 3-A: Pure function tests for server/legal-skill-adapter.js
 *
 * Most target functions are module-internal; they are exercised indirectly
 * through the exported `getRunnerStatus` and `analyzeLegalReview` APIs by
 * spawning fresh Node.js processes (so env-dependent module-level logic is
 * re-evaluated with the desired environment).
 */

const assert = require("assert");
const { execSync } = require("child_process");
const { test, testAsync, summary } = require("./test-helper");

function runInFreshEnv(code, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  return execSync(`node -e ${JSON.stringify(code)}`, {
    env,
    encoding: "utf8",
    cwd: require("path").resolve(__dirname, ".."),
  }).trim();
}

console.log("\n=== test-legal-skill-pure.js ===\n");

const asyncTests = [];

// ---------------------------------------------------------------------------
// Exported getRunnerStatus
// ---------------------------------------------------------------------------

test("getRunnerStatus returns object with all expected keys", () => {
  const { getRunnerStatus } = require("../server/legal-skill-adapter");
  const s = getRunnerStatus();
  assert.strictEqual(typeof s, "object");
  assert("configured" in s);
  assert("command" in s);
  assert("args" in s);
  assert("skillPath" in s);
  assert("skillExists" in s);
  assert("provider" in s);
  assert("model" in s);
  assert("baseUrlConfigured" in s);
  assert("apiKeyConfigured" in s);
  assert("mode" in s);
});

test("getRunnerStatus.configured is boolean", () => {
  const { getRunnerStatus } = require("../server/legal-skill-adapter");
  assert.strictEqual(typeof getRunnerStatus().configured, "boolean");
});

test("getRunnerStatus.args is an array", () => {
  const { getRunnerStatus } = require("../server/legal-skill-adapter");
  assert(Array.isArray(getRunnerStatus().args));
});

test("getRunnerStatus.skillPath ends with SKILL.md", () => {
  const { getRunnerStatus } = require("../server/legal-skill-adapter");
  assert(getRunnerStatus().skillPath.endsWith("SKILL.md"));
});

test("getRunnerStatus.mode is fallback when runner is not configured", () => {
  const { getRunnerStatus } = require("../server/legal-skill-adapter");
  const s = getRunnerStatus();
  if (!s.configured) {
    assert.strictEqual(s.mode, "fallback");
  }
});

// ---------------------------------------------------------------------------
// Exported analyzeLegalReview – synchronous throw path
// ---------------------------------------------------------------------------

asyncTests.push(
  testAsync("analyzeLegalReview throws when runner unconfigured and fallback disallowed", async () => {
    const { analyzeLegalReview, getRunnerStatus } = require("../server/legal-skill-adapter");
    if (getRunnerStatus().configured) {
      // Cannot test throw path when a real runner is wired in.
      return;
    }
    try {
      await analyzeLegalReview({ contract_text: "test" });
      assert.fail("Expected analyzeLegalReview to throw");
    } catch (err) {
      assert(err.message.includes("未配置"));
    }
  })
);

// ---------------------------------------------------------------------------
// parseRunnerArgs (indirect via getRunnerStatus in fresh process)
// ---------------------------------------------------------------------------

test("parseRunnerArgs parses JSON array env", () => {
  const out = runInFreshEnv(
    `delete require.cache[require.resolve("./server/legal-skill-adapter")];` +
    `const { getRunnerStatus } = require("./server/legal-skill-adapter");` +
    `console.log(JSON.stringify(getRunnerStatus().args));`,
    { LEGAL_SKILL_ARGS_JSON: '["--foo","--bar"]' }
  );
  assert.deepStrictEqual(JSON.parse(out), ["--foo", "--bar"]);
});

test("parseRunnerArgs returns empty array for invalid JSON", () => {
  const out = runInFreshEnv(
    `delete require.cache[require.resolve("./server/legal-skill-adapter")];` +
    `const { getRunnerStatus } = require("./server/legal-skill-adapter");` +
    `console.log(JSON.stringify(getRunnerStatus().args));`,
    { LEGAL_SKILL_ARGS_JSON: "not-json" }
  );
  assert.deepStrictEqual(JSON.parse(out), []);
});

test("parseRunnerArgs returns empty array when env is empty", () => {
  const out = runInFreshEnv(
    `delete require.cache[require.resolve("./server/legal-skill-adapter")];` +
    `const { getRunnerStatus } = require("./server/legal-skill-adapter");` +
    `console.log(JSON.stringify(getRunnerStatus().args));`,
    { LEGAL_SKILL_ARGS_JSON: "" }
  );
  assert.deepStrictEqual(JSON.parse(out), []);
});

// ---------------------------------------------------------------------------
// inferContractType (indirect via analyzeLegalReview fallback)
// ---------------------------------------------------------------------------

test("inferContractType recognizes SaaS / tech from text", () => {
  const out = runInFreshEnv(
    `const { analyzeLegalReview } = require("./server/legal-skill-adapter");` +
    `analyzeLegalReview({ contract_text: "SaaS平台服务", clauses: [] })` +
    `.then(r => console.log(JSON.stringify({t: r.response.contractSummary.contractType})))` +
    `.catch(e => console.error(e.message));`,
    { LEGAL_SKILL_ALLOW_FALLBACK: "1" }
  );
  assert.strictEqual(JSON.parse(out).t, "SaaS / 技术服务合同");
});

test("inferContractType recognizes NDA from text", () => {
  const out = runInFreshEnv(
    `const { analyzeLegalReview } = require("./server/legal-skill-adapter");` +
    `analyzeLegalReview({ contract_text: "保密协议 NDA", clauses: [] })` +
    `.then(r => console.log(JSON.stringify({t: r.response.contractSummary.contractType})))` +
    `.catch(e => console.error(e.message));`,
    { LEGAL_SKILL_ALLOW_FALLBACK: "1" }
  );
  assert.strictEqual(JSON.parse(out).t, "保密协议");
});

test("inferContractType recognizes 数据 from text", () => {
  const out = runInFreshEnv(
    `const { analyzeLegalReview } = require("./server/legal-skill-adapter");` +
    `analyzeLegalReview({ contract_text: "数据集采购", clauses: [] })` +
    `.then(r => console.log(JSON.stringify({t: r.response.contractSummary.contractType})))` +
    `.catch(e => console.error(e.message));`,
    { LEGAL_SKILL_ALLOW_FALLBACK: "1" }
  );
  assert.strictEqual(JSON.parse(out).t, "数据采购或数据服务合同");
});

test("inferContractType respects explicit contract_type fallback", () => {
  const out = runInFreshEnv(
    `const { analyzeLegalReview } = require("./server/legal-skill-adapter");` +
    `analyzeLegalReview({ contract_text: "SaaS", contract_type: "保密协议", clauses: [] })` +
    `.then(r => console.log(JSON.stringify({t: r.response.contractSummary.contractType})))` +
    `.catch(e => console.error(e.message));`,
    { LEGAL_SKILL_ALLOW_FALLBACK: "1" }
  );
  assert.strictEqual(JSON.parse(out).t, "保密协议");
});

// ---------------------------------------------------------------------------
// inferPurpose (indirect via analyzeLegalReview fallback)
// ---------------------------------------------------------------------------

test("inferPurpose extracts SaaS purpose keywords", () => {
  const out = runInFreshEnv(
    `const { analyzeLegalReview } = require("./server/legal-skill-adapter");` +
    `analyzeLegalReview({ contract_text: "API技术服务", clauses: [] })` +
    `.then(r => console.log(JSON.stringify({p: r.response.contractSummary.purpose})))` +
    `.catch(e => console.error(e.message));`,
    { LEGAL_SKILL_ALLOW_FALLBACK: "1" }
  );
  assert.strictEqual(JSON.parse(out).p, "采购或提供 AI / SaaS / API 技术服务");
});

test("inferPurpose extracts 数据 purpose keywords", () => {
  const out = runInFreshEnv(
    `const { analyzeLegalReview } = require("./server/legal-skill-adapter");` +
    `analyzeLegalReview({ contract_text: "数据采购", clauses: [] })` +
    `.then(r => console.log(JSON.stringify({p: r.response.contractSummary.purpose})))` +
    `.catch(e => console.error(e.message));`,
    { LEGAL_SKILL_ALLOW_FALLBACK: "1" }
  );
  assert.strictEqual(JSON.parse(out).p, "采购、交付或使用数据资源");
});

// ---------------------------------------------------------------------------
// inferLinkedClauseIds (indirect via analyzeLegalReview fallback)
// ---------------------------------------------------------------------------

test("inferLinkedClauseIds finds related clause IDs", () => {
  const out = runInFreshEnv(
    `const { analyzeLegalReview } = require("./server/legal-skill-adapter");` +
    `analyzeLegalReview({ contract_text: "", clauses: [` +
    `{id:"c1", title:"数据", text:"数据", type:"数据使用"},` +
    `{id:"c2", title:"保密", text:"保密", type:"保密"}` +
    `]}).then(r => {` +
    `const linked = r.response.clauseAnalyses[0]?.linkedClauseIds || [];` +
    `console.log(JSON.stringify({linked}));` +
    `}).catch(e => console.error(e.message));`,
    { LEGAL_SKILL_ALLOW_FALLBACK: "1" }
  );
  assert.deepStrictEqual(JSON.parse(out).linked, ["c2"]);
});

// ---------------------------------------------------------------------------
// inferNegotiationBottomLine (indirect via clause analysis)
// ---------------------------------------------------------------------------

test("inferNegotiationBottomLine returns bottom line text", () => {
  const out = runInFreshEnv(
    `const { analyzeLegalReview } = require("./server/legal-skill-adapter");` +
    `analyzeLegalReview({ contract_text: "数据使用", clauses: [` +
    `{id:"c1", title:"数据", text:"数据", type:"数据使用"}` +
    `]}).then(r => {` +
    `const bl = r.response.clauseAnalyses[0]?.negotiationBottomLine || "";` +
    `console.log(JSON.stringify({hasText: bl.length > 0, text: bl}));` +
    `}).catch(e => console.error(e.message));`,
    { LEGAL_SKILL_ALLOW_FALLBACK: "1" }
  );
  const result = JSON.parse(out);
  assert.strictEqual(result.hasText, true);
  assert(typeof result.text === "string");
});

// ---------------------------------------------------------------------------
// scoreSuggestionQuality (indirect via clause / risk qualityScore)
// ---------------------------------------------------------------------------

test("scoreSuggestionQuality returns a score between 0 and 100", () => {
  const out = runInFreshEnv(
    `const { analyzeLegalReview } = require("./server/legal-skill-adapter");` +
    `analyzeLegalReview({ contract_text: "训练模型", clauses: [` +
    `{id:"c1", title:"数据", text:"训练模型", type:"数据使用"}` +
    `]}).then(r => {` +
    `const score = r.response.clauseAnalyses[0]?.qualityScore;` +
    `console.log(JSON.stringify({score, inRange: score >= 0 && score <= 100}));` +
    `}).catch(e => console.error(e.message));`,
    { LEGAL_SKILL_ALLOW_FALLBACK: "1" }
  );
  const result = JSON.parse(out);
  assert.strictEqual(result.inRange, true);
});

// ---------------------------------------------------------------------------
// buildFallbackSuggestedClauseText (indirect via contractLevelRisks)
// ---------------------------------------------------------------------------

test("buildFallbackSuggestedClauseText returns template text for known types", () => {
  const out = runInFreshEnv(
    `const { analyzeLegalReview } = require("./server/legal-skill-adapter");` +
    `analyzeLegalReview({ contract_text: "", clauses: [] })` +
    `.then(r => {` +
    `const risk = r.response.contractLevelRisks.find(x => x.title.includes("保密"));` +
    `console.log(JSON.stringify({hasText: !!(risk && risk.proposedClauseText)}));` +
    `}).catch(e => console.error(e.message));`,
    { LEGAL_SKILL_ALLOW_FALLBACK: "1" }
  );
  assert.strictEqual(JSON.parse(out).hasText, true);
});

// ---------------------------------------------------------------------------
// completionScore (indirect via contractSummary)
// ---------------------------------------------------------------------------

test("completionScore is 0 when no core clauses are present", () => {
  const out = runInFreshEnv(
    `const { analyzeLegalReview } = require("./server/legal-skill-adapter");` +
    `analyzeLegalReview({ contract_text: "", clauses: [] })` +
    `.then(r => console.log(JSON.stringify({score: r.response.contractSummary.completionScore})))` +
    `.catch(e => console.error(e.message));`,
    { LEGAL_SKILL_ALLOW_FALLBACK: "1" }
  );
  assert.strictEqual(JSON.parse(out).score, 0);
});

test("completionScore increases when core clause types are present", () => {
  const out = runInFreshEnv(
    `const { analyzeLegalReview } = require("./server/legal-skill-adapter");` +
    `analyzeLegalReview({ contract_text: "", clauses: [` +
    `{id:"c1", title:"服务", text:"服务范围", type:"服务范围"},` +
    `{id:"c2", title:"付款", text:"付款", type:"付款"},` +
    `{id:"c3", title:"保密", text:"保密", type:"保密"}` +
    `]}).then(r => console.log(JSON.stringify({score: r.response.contractSummary.completionScore})))` +
    `.catch(e => console.error(e.message));`,
    { LEGAL_SKILL_ALLOW_FALLBACK: "1" }
  );
  assert(JSON.parse(out).score > 0);
});

// ---------------------------------------------------------------------------
// inferMissingFacts (indirect via response.missingFacts)
// ---------------------------------------------------------------------------

test("inferMissingFacts lists missing fields when request is sparse", () => {
  const out = runInFreshEnv(
    `const { analyzeLegalReview } = require("./server/legal-skill-adapter");` +
    `analyzeLegalReview({ contract_text: "SaaS", clauses: [] })` +
    `.then(r => console.log(JSON.stringify({missing: r.response.missingFacts})))` +
    `.catch(e => console.error(e.message));`,
    { LEGAL_SKILL_ALLOW_FALLBACK: "1" }
  );
  const result = JSON.parse(out);
  assert(Array.isArray(result.missing));
  assert(result.missing.includes("我方角色"));
  assert(result.missing.includes("相对方身份"));
  assert(result.missing.includes("交易背景和商业目的"));
});

test("inferMissingFacts returns empty array when all facts provided", () => {
  const out = runInFreshEnv(
    `const { analyzeLegalReview } = require("./server/legal-skill-adapter");` +
    `analyzeLegalReview({ contract_text: "SaaS", represented_party: "甲方", counterparty: "乙方", business_background: "采购", clauses: [] })` +
    `.then(r => console.log(JSON.stringify({missing: r.response.missingFacts})))` +
    `.catch(e => console.error(e.message));`,
    { LEGAL_SKILL_ALLOW_FALLBACK: "1" }
  );
  assert.deepStrictEqual(JSON.parse(out).missing, []);
});

// ---------------------------------------------------------------------------
// buildBusinessSummary (indirect via response.businessSummary)
// ---------------------------------------------------------------------------

test("buildBusinessSummary summarizes contract type and risk level", () => {
  const out = runInFreshEnv(
    `const { analyzeLegalReview } = require("./server/legal-skill-adapter");` +
    `analyzeLegalReview({ contract_text: "SaaS", clauses: [] })` +
    `.then(r => console.log(JSON.stringify({summary: r.response.businessSummary})))` +
    `.catch(e => console.error(e.message));`,
    { LEGAL_SKILL_ALLOW_FALLBACK: "1" }
  );
  const result = JSON.parse(out);
  assert(typeof result.summary === "string");
  assert(result.summary.includes("SaaS"));
  assert(result.summary.includes("风险"));
});

// Wait for async tests before printing summary
Promise.all(asyncTests).then(() => summary());
