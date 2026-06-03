/**
 * Tests for js/analysis-fallback.js pure functions
 */

const { loadScript, test, summary, assert } = require("./test-helper");

global.evaluateRiskRules = () => [];
global.splitClauses = () => [];
global.classifyContract = () => "其他";
global.uid = () => "uid";
global.today = () => "2026-01-01";
global.state = { counterparties: [] };

loadScript("js/analysis-fallback.js");

console.log("\n=== test-analysis-fallback-pure.js ===\n");

// --- riskRank ---

test("riskRank: high returns 3", () => {
  assert.strictEqual(riskRank("high"), 3);
});

test("riskRank: medium returns 2", () => {
  assert.strictEqual(riskRank("medium"), 2);
});

test("riskRank: low returns 1", () => {
  assert.strictEqual(riskRank("low"), 1);
});

test("riskRank: unknown string returns 1 (fallback to low)", () => {
  assert.strictEqual(riskRank("unknown"), 1);
});

test("riskRank: undefined returns 1 (fallback to low)", () => {
  assert.strictEqual(riskRank(undefined), 1);
});

test("riskRank: null returns 1 (fallback to low)", () => {
  assert.strictEqual(riskRank(null), 1);
});

summary();
