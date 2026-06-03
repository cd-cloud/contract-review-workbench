/**
 * Tests for js/review-checks.js pure functions
 */

const { loadScript, test, summary, assert } = require("./test-helper");

global.state = { reviewChecks: {} };

loadScript("js/review-checks.js");

console.log("\n=== test-review-checks-pure.js ===\n");

// --- findDuplicates ---
test("findDuplicates returns empty for empty array", () => {
  assert.deepStrictEqual(findDuplicates([]), []);
});

test("findDuplicates returns empty when no duplicates", () => {
  assert.deepStrictEqual(findDuplicates([1, 2, 3]), []);
});

test("findDuplicates finds one duplicate", () => {
  assert.deepStrictEqual(findDuplicates([1, 2, 2, 3]), [2]);
});

test("findDuplicates finds multiple duplicates", () => {
  const result = findDuplicates([1, 1, 2, 2, 3, 4]);
  assert.strictEqual(result.length, 2);
  assert.ok(result.includes(1));
  assert.ok(result.includes(2));
});

test("findDuplicates handles all same values", () => {
  assert.deepStrictEqual(findDuplicates([5, 5, 5]), [5]);
});

// --- dedupeChecks ---
test("dedupeChecks returns empty for empty array", () => {
  assert.deepStrictEqual(dedupeChecks([]), []);
});

test("dedupeChecks preserves all unique checks", () => {
  const checks = [
    { type: "numbering", clauseId: "c1", title: "重复编号" },
    { type: "reference", clauseId: "c2", title: "无效引用" },
  ];
  assert.strictEqual(dedupeChecks(checks).length, 2);
});

test("dedupeChecks removes checks with same type:clauseId:title", () => {
  const checks = [
    { type: "numbering", clauseId: "c1", title: "重复编号" },
    { type: "numbering", clauseId: "c1", title: "重复编号" },
  ];
  assert.strictEqual(dedupeChecks(checks).length, 1);
});

test("dedupeChecks preserves different checks", () => {
  const checks = [
    { type: "numbering", clauseId: "c1", title: "重复编号" },
    { type: "numbering", clauseId: "c2", title: "重复编号" },
    { type: "core-clause", clauseId: null, title: "缺少保密条款" },
  ];
  const result = dedupeChecks(checks);
  assert.strictEqual(result.length, 3);
});

// --- summarizeAutomaticReviewChecks ---
test("summarizeAutomaticReviewChecks returns fallback for empty checks", () => {
  const result = summarizeAutomaticReviewChecks([]);
  assert.strictEqual(result, "自动核查未发现明显编号、引用或核心条款问题。");
});

test("summarizeAutomaticReviewChecks counts severities correctly", () => {
  const checks = [
    { severity: "high", title: "高风险1" },
    { severity: "high", title: "高风险2" },
    { severity: "medium", title: "中风险1" },
  ];
  const result = summarizeAutomaticReviewChecks(checks);
  assert.ok(result.includes("高风险 2 项"));
  assert.ok(result.includes("中风险 1 项"));
  assert.ok(result.includes("重点：高风险1；高风险2；中风险1"));
});

test("summarizeAutomaticReviewChecks lists top 4 issues", () => {
  const checks = [
    { severity: "medium", title: "问题1" },
    { severity: "medium", title: "问题2" },
    { severity: "medium", title: "问题3" },
    { severity: "medium", title: "问题4" },
    { severity: "medium", title: "问题5" },
  ];
  const result = summarizeAutomaticReviewChecks(checks);
  assert.ok(result.includes("问题1"));
  assert.ok(result.includes("问题2"));
  assert.ok(result.includes("问题3"));
  assert.ok(result.includes("问题4"));
  assert.ok(!result.includes("问题5"));
});

summary();
