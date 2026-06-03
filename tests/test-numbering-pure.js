/**
 * Layer 4-A: Pure numbering function tests
 * Tests js/review-numbering.js pure functions:
 *   parseClauseNumber, parseClauseTitleNumber, parseClauseTitleNumberText,
 *   rewriteClauseTitleNumber, rewriteClauseReferences, escapeRegex
 */

const { loadScript, test, summary, assert } = require("./test-helper");

// Load dependencies first
// state must be defined globally because review-numbering.js references it
// (e.g., getClauseNumberingMap reads state.clauseNumberMaps)
global.state = { clauseNumberMaps: {} };
loadScript("js/utils.js");
loadScript("js/review-numbering.js");

console.log("\n=== test-numbering-pure.js ===\n");

// --- parseClauseNumber ---
test("parseClauseNumber handles Arabic digits", () => {
  assert.strictEqual(parseClauseNumber("1"), 1);
  assert.strictEqual(parseClauseNumber("10"), 10);
  assert.strictEqual(parseClauseNumber("99"), 99);
});

test("parseClauseNumber handles Chinese digits 1-10", () => {
  assert.strictEqual(parseClauseNumber("一"), 1);
  assert.strictEqual(parseClauseNumber("五"), 5);
  assert.strictEqual(parseClauseNumber("十"), 10);
});

test("parseClauseNumber handles Chinese teens (11-19)", () => {
  assert.strictEqual(parseClauseNumber("十一"), 11);
  assert.strictEqual(parseClauseNumber("十五"), 15);
  assert.strictEqual(parseClauseNumber("十九"), 19);
});

test("parseClauseNumber handles Chinese tens (20-99)", () => {
  assert.strictEqual(parseClauseNumber("二十"), 20);
  assert.strictEqual(parseClauseNumber("二十一"), 21);
  assert.strictEqual(parseClauseNumber("三十五"), 35);
  assert.strictEqual(parseClauseNumber("九十九"), 99);
});

test("parseClauseNumber handles hundreds", () => {
  assert.strictEqual(parseClauseNumber("一百"), 100);
  assert.strictEqual(parseClauseNumber("一百二十三"), 123);
  assert.strictEqual(parseClauseNumber("二百"), 200);
  // Note: "一百零一" contains "零一" which is not fully supported; falls through to 0
  assert.strictEqual(parseClauseNumber("一百零一"), 100);
});

test("parseClauseNumber handles special cases", () => {
  assert.strictEqual(parseClauseNumber("两"), 2);
  assert.strictEqual(parseClauseNumber("〇"), 0);
  assert.strictEqual(parseClauseNumber("零"), 0);
  assert.strictEqual(parseClauseNumber("unknown"), 0);
  assert.strictEqual(parseClauseNumber(""), 0);
});

// --- parseClauseTitleNumber ---
test("parseClauseTitleNumber extracts Chinese clause numbers", () => {
  assert.strictEqual(parseClauseTitleNumber("第一条 定义"), 1);
  assert.strictEqual(parseClauseTitleNumber("第十条 服务范围"), 10);
  assert.strictEqual(parseClauseTitleNumber("第十五条 付款"), 15);
});

test("parseClauseTitleNumber extracts Arabic clause numbers", () => {
  assert.strictEqual(parseClauseTitleNumber("1. 服务范围"), 1);
  assert.strictEqual(parseClauseTitleNumber("5. 保密义务"), 5);
  assert.strictEqual(parseClauseTitleNumber("10. 争议解决"), 10);
});

test("parseClauseTitleNumber returns 0 for unnumbered titles", () => {
  assert.strictEqual(parseClauseTitleNumber("服务范围"), 0);
  assert.strictEqual(parseClauseTitleNumber(""), 0);
});

// --- parseClauseTitleNumberText ---
test("parseClauseTitleNumberText extracts number prefix", () => {
  assert.strictEqual(parseClauseTitleNumberText("第一条 定义"), "第一条");
  assert.strictEqual(parseClauseTitleNumberText("1. 服务范围"), "1.");
  assert.strictEqual(parseClauseTitleNumberText("服务范围"), "");
});

// --- rewriteClauseTitleNumber ---
test("rewriteClauseTitleNumber rewrites Chinese clause numbers", () => {
  assert.strictEqual(rewriteClauseTitleNumber("第一条 定义", 3), "第三条 定义");
  assert.strictEqual(rewriteClauseTitleNumber("第十条 付款", 12), "第十二条 付款");
});

test("rewriteClauseTitleNumber rewrites Arabic clause numbers", () => {
  assert.strictEqual(rewriteClauseTitleNumber("1. 服务范围", 5), "5. 服务范围");
  assert.strictEqual(rewriteClauseTitleNumber("10. 争议解决", 11), "11. 争议解决");
});

test("rewriteClauseTitleNumber leaves unnumbered text unchanged", () => {
  assert.strictEqual(rewriteClauseTitleNumber("服务范围", 3), "服务范围");
  assert.strictEqual(rewriteClauseTitleNumber("", 1), "");
});

// --- rewriteClauseReferences ---
test("rewriteClauseReferences updates cross-references", () => {
  const map = new Map([[1, 3], [2, 4]]);
  assert.strictEqual(rewriteClauseReferences("参见第一条、第二条", map), "参见第三条、第四条");
});

test("rewriteClauseReferences leaves unchanged references alone", () => {
  const map = new Map([[1, 1]]);
  assert.strictEqual(rewriteClauseReferences("参见第一条", map), "参见第一条");
});

test("rewriteClauseReferences handles mixed references", () => {
  const map = new Map([[1, 2], [3, 5]]);
  assert.strictEqual(rewriteClauseReferences("第一条和第三条", map), "第二条和第五条");
});

// --- escapeRegex ---
test("escapeRegex escapes special regex characters", () => {
  assert.strictEqual(escapeRegex("1.1"), "1\\.1");
  assert.strictEqual(escapeRegex("a*b"), "a\\*b");
  assert.strictEqual(escapeRegex("[test]"), "\\[test\\]");
});

summary();
