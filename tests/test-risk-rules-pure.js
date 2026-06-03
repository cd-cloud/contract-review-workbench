/**
 * Tests for js/risk-rules.js pure functions
 */

const { loadScript, test, summary, assert } = require("./test-helper");

global.state = { riskRules: [] };
global.seedData = { riskRules: [] };

loadScript("js/risk-rules.js");

console.log("\n=== test-risk-rules-pure.js ===\n");

// --- safeRuleRegex ---
test("safeRuleRegex returns RegExp for valid pattern", () => {
  const re = safeRuleRegex("test");
  assert.ok(re instanceof RegExp);
  assert.strictEqual(re.test("test"), true);
});

test("safeRuleRegex returns null for invalid pattern", () => {
  const re = safeRuleRegex("[invalid");
  assert.strictEqual(re, null);
});

test("safeRuleRegex returns null for empty string", () => {
  const re = safeRuleRegex("");
  assert.strictEqual(re, null);
});

test("safeRuleRegex returns null for null/undefined", () => {
  assert.strictEqual(safeRuleRegex(null), null);
  assert.strictEqual(safeRuleRegex(undefined), null);
});

// --- riskRuleMatches ---
test("riskRuleMatches returns true when pattern matches clause text", () => {
  const rule = { pattern: "违约金" };
  const clause = { title: "违约责任", text: "违约金为合同金额的10%" };
  const contract = { type: "采购合同", businessBackground: "" };
  assert.strictEqual(riskRuleMatches(rule, clause, contract), true);
});

test("riskRuleMatches returns false when pattern does not match", () => {
  const rule = { pattern: "知识产权" };
  const clause = { title: "违约责任", text: "违约金为合同金额的10%" };
  const contract = { type: "采购合同", businessBackground: "" };
  assert.strictEqual(riskRuleMatches(rule, clause, contract), false);
});

test("riskRuleMatches returns true when no pattern is set", () => {
  const rule = {};
  const clause = { title: "任何条款", text: "任何内容" };
  const contract = { type: "合同", businessBackground: "" };
  assert.strictEqual(riskRuleMatches(rule, clause, contract), true);
});

test("riskRuleMatches is case-insensitive", () => {
  const rule = { pattern: "CONFIDENTIAL" };
  const clause = { title: "保密", text: "This is confidential information" };
  const contract = { type: "合同", businessBackground: "" };
  assert.strictEqual(riskRuleMatches(rule, clause, contract), true);
});

test("riskRuleMatches respects missingPattern exclusion", () => {
  const rule = { pattern: "保密", missingPattern: "公开" };
  const clause = { title: "保密", text: "本条款已公开" };
  const contract = { type: "合同", businessBackground: "" };
  assert.strictEqual(riskRuleMatches(rule, clause, contract), false);
});

// --- dedupeRuleFindings ---
test("dedupeRuleFindings returns empty for empty array", () => {
  assert.deepStrictEqual(dedupeRuleFindings([]), []);
});

test("dedupeRuleFindings returns single finding unchanged", () => {
  const findings = [{ clauseId: "c1", title: "风险1", fix: "修改1" }];
  assert.deepStrictEqual(dedupeRuleFindings(findings), findings);
});

test("dedupeRuleFindings removes identical findings", () => {
  const findings = [
    { clauseId: "c1", title: "风险1", fix: "修改1" },
    { clauseId: "c1", title: "风险1", fix: "修改1" },
  ];
  assert.strictEqual(dedupeRuleFindings(findings).length, 1);
});

test("dedupeRuleFindings preserves different findings", () => {
  const findings = [
    { clauseId: "c1", title: "风险1", fix: "修改1" },
    { clauseId: "c2", title: "风险2", fix: "修改2" },
  ];
  assert.strictEqual(dedupeRuleFindings(findings).length, 2);
});

test("dedupeRuleFindings handles mixed duplicates and unique items", () => {
  const findings = [
    { clauseId: "c1", title: "风险1", fix: "修改1" },
    { clauseId: "c1", title: "风险1", fix: "修改1" },
    { clauseId: "c2", title: "风险2", fix: "修改2" },
    { clauseId: "c3", title: "风险3", fix: "修改3" },
    { clauseId: "c2", title: "风险2", fix: "修改2" },
  ];
  const result = dedupeRuleFindings(findings);
  assert.strictEqual(result.length, 3);
  assert.strictEqual(result[0].clauseId, "c1");
  assert.strictEqual(result[1].clauseId, "c2");
  assert.strictEqual(result[2].clauseId, "c3");
});

summary();
