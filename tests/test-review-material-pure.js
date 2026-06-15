/**
 * Pure helper function tests for js/review-material.js
 */

const { loadScript, test, summary, assert } = require("./test-helper");

// Mock globals
// state is referenced by some functions in review-material.js
// contract-parser.js must be loaded first because extractSubclauseTitle calls parseOutlineMarker
// which is defined there.
global.state = {};
global.materialKindLabel = () => "version";

// Load dependencies before review-material.js
loadScript("js/contract-parser.js");
loadScript("js/review-material.js");

console.log("\n=== test-review-material-pure.js ===\n");

// --- isSubclauseHeading ---
test("isSubclauseHeading recognizes Chinese paren markers like （一）", () => {
  assert.strictEqual(isSubclauseHeading("（一）定义条款"), true);
  assert.strictEqual(isSubclauseHeading("（二）服务范围"), true);
  assert.strictEqual(isSubclauseHeading("（10）测试项"), true);
});

test("isSubclauseHeading recognizes Arabic decimal markers like 1. and 1.1", () => {
  assert.strictEqual(isSubclauseHeading("1. 服务范围"), true);
  assert.strictEqual(isSubclauseHeading("1.1 子条款"), true);
  assert.strictEqual(isSubclauseHeading("1.1.1 细分项"), true);
});

test("isSubclauseHeading recognizes ASCII paren markers like (1)", () => {
  assert.strictEqual(isSubclauseHeading("(1) 说明"), true);
  assert.strictEqual(isSubclauseHeading("(10) 测试"), true);
});

test("isSubclauseHeading recognizes Chinese comma markers like 1、", () => {
  assert.strictEqual(isSubclauseHeading("1、条款"), true);
});

test("isSubclauseHeading returns false for circled numbers like ①", () => {
  assert.strictEqual(isSubclauseHeading("① 测试"), false);
});

test("isSubclauseHeading returns false for regular text", () => {
  assert.strictEqual(isSubclauseHeading("普通文本"), false);
  assert.strictEqual(isSubclauseHeading("这是一段普通的内容"), false);
});

test("isSubclauseHeading returns false for empty string", () => {
  assert.strictEqual(isSubclauseHeading(""), false);
});

// --- extractSubclauseTitle ---
test("extractSubclauseTitle extracts title from Chinese paren marker", () => {
  // parseOutlineMarker (from contract-parser.js) produces marker.title "一、定义条款"
  const result = extractSubclauseTitle("（一）定义条款");
  assert.strictEqual(result, "一、定义条款");
});

test("extractSubclauseTitle extracts title from Arabic marker", () => {
  // parseOutlineMarker produces marker.title "1、服务范围"
  const result = extractSubclauseTitle("1. 服务范围");
  assert.strictEqual(result, "1、服务范围");
});

test("extractSubclauseTitle returns empty for line without marker", () => {
  assert.strictEqual(extractSubclauseTitle("普通文本"), "");
  assert.strictEqual(extractSubclauseTitle(""), "");
});

test("extractSubclauseTitle rejects very long text (>24 chars)", () => {
  const longTitle = "1. 这是一个非常非常非常非常非常非常非常非常长的条款标题";
  assert.strictEqual(extractSubclauseTitle(longTitle), "");
});

// --- isExplicitSubclauseTitle ---
test("isExplicitSubclauseTitle returns true for short title-like text", () => {
  assert.strictEqual(isExplicitSubclauseTitle("定义条款"), true);
  assert.strictEqual(isExplicitSubclauseTitle("服务范围"), true);
  assert.strictEqual(isExplicitSubclauseTitle("付款方式"), true);
});

test("isExplicitSubclauseTitle returns false for long body text with stop words", () => {
  assert.strictEqual(isExplicitSubclauseTitle("甲方应当向乙方支付相应的服务费用"), false);
  assert.strictEqual(isExplicitSubclauseTitle("乙方不得将保密信息泄露给任何第三方"), false);
});

test("isExplicitSubclauseTitle returns false for empty string", () => {
  assert.strictEqual(isExplicitSubclauseTitle(""), false);
});

test("isExplicitSubclauseTitle returns false for text starting with quotes or brackets", () => {
  assert.strictEqual(isExplicitSubclauseTitle("\"定义条款\""), false);
  assert.strictEqual(isExplicitSubclauseTitle("《服务范围》"), false);
  assert.strictEqual(isExplicitSubclauseTitle("（说明）"), false);
});

test("isExplicitSubclauseTitle returns false for text ending with punctuation", () => {
  assert.strictEqual(isExplicitSubclauseTitle("定义条款。"), false);
  assert.strictEqual(isExplicitSubclauseTitle("服务范围；"), false);
  assert.strictEqual(isExplicitSubclauseTitle("付款方式，"), false);
});

test("isExplicitSubclauseTitle returns false for text longer than 24 chars", () => {
  assert.strictEqual(isExplicitSubclauseTitle("这是一个非常非常非常非常非常非常非常非常非常长的标题"), false);
});

// --- normalizeWordTextArtifacts ---
test("normalizeWordTextArtifacts fixes corrupted full-width parens", () => {
  // Replaces （digit�+ with （digit）
  assert.strictEqual(normalizeWordTextArtifacts("（一�"), "（一）");
  assert.strictEqual(normalizeWordTextArtifacts("（二��"), "（二）");
});

test("normalizeWordTextArtifacts fixes corrupted ASCII parens", () => {
  // Replaces (alnum�+ with (alnum)
  assert.strictEqual(normalizeWordTextArtifacts("(a�"), "(a)");
  assert.strictEqual(normalizeWordTextArtifacts("(1��"), "(1)");
});

test("normalizeWordTextArtifacts fixes corrupted trailing full-width parens", () => {
  // Replaces digit��� with digit）
  assert.strictEqual(normalizeWordTextArtifacts("一���"), "一）");
  assert.strictEqual(normalizeWordTextArtifacts("1���"), "1）");
});

test("normalizeWordTextArtifacts leaves normal text unchanged", () => {
  assert.strictEqual(normalizeWordTextArtifacts("正常文本"), "正常文本");
  assert.strictEqual(normalizeWordTextArtifacts("（一）定义条款"), "（一）定义条款");
  assert.strictEqual(normalizeWordTextArtifacts("(1) 说明"), "(1) 说明");
});

test("normalizeWordTextArtifacts handles empty string", () => {
  assert.strictEqual(normalizeWordTextArtifacts(""), "");
});

test("getWorkbenchMaterial falls back from empty active update to latest text update", () => {
  global.state = {
    reviewMode: "clean",
    activeUpdateId: "u-empty",
    updates: [
      { id: "u-text", contractId: "c1", type: "draft", versionText: "usable version body", acceptedText: "", createdAt: "2026-06-13" },
      { id: "u-empty", contractId: "c1", type: "draft", versionText: "", acceptedText: "", createdAt: "2026-06-14" },
    ],
  };
  const material = getWorkbenchMaterial({ id: "c1", name: "Test", text: "", cleanText: "" });
  assert.strictEqual(material.text, "usable version body");
  assert.strictEqual(material.sourceKey, "c1:u-text");
  assert.strictEqual(material.materialId, "u-text");
});

// --- applyEditedTitleToClauseText ---
test("applyEditedTitleToClauseText reflects title change in text", () => {
  const text = "原标题\n第一行内容\n第二行内容";
  const result = applyEditedTitleToClauseText(text, "原标题", "新标题");
  assert.strictEqual(result, "新标题\n第一行内容\n第二行内容");
});

test("applyEditedTitleToClauseText returns original when editedTitle is empty", () => {
  const text = "标题\n内容";
  assert.strictEqual(applyEditedTitleToClauseText(text, "标题", ""), "标题\n内容");
});

test("applyEditedTitleToClauseText returns original when first line already matches editedTitle", () => {
  const text = "标题\n内容";
  assert.strictEqual(applyEditedTitleToClauseText(text, "其他标题", "标题"), "标题\n内容");
});

test("applyEditedTitleToClauseText prepends title when no match and no empty editedTitle", () => {
  const text = "内容第一行\n内容第二行";
  const result = applyEditedTitleToClauseText(text, "", "新标题");
  assert.strictEqual(result, "新标题\n内容第一行\n内容第二行");
});

// --- composeEditableClauseText ---
test("composeEditableClauseText combines title and body correctly", () => {
  assert.strictEqual(composeEditableClauseText("标题", "正文内容"), "标题\n正文内容");
});

test("composeEditableClauseText handles empty title", () => {
  assert.strictEqual(composeEditableClauseText("", "正文内容"), "正文内容");
});

test("composeEditableClauseText handles empty body", () => {
  assert.strictEqual(composeEditableClauseText("标题", ""), "标题");
});

test("composeEditableClauseText handles empty parts", () => {
  assert.strictEqual(composeEditableClauseText("", ""), "");
});

// --- normalizeEditableClauseTitleLine ---
test("normalizeEditableClauseTitleLine strips whitespace", () => {
  assert.strictEqual(normalizeEditableClauseTitleLine("  标 题  "), "标题");
  assert.strictEqual(normalizeEditableClauseTitleLine("标\t题"), "标题");
});

test("normalizeEditableClauseTitleLine strips trailing punctuation", () => {
  assert.strictEqual(normalizeEditableClauseTitleLine("标题："), "标题");
  assert.strictEqual(normalizeEditableClauseTitleLine("标题:"), "标题");
  assert.strictEqual(normalizeEditableClauseTitleLine("标题。"), "标题");
  assert.strictEqual(normalizeEditableClauseTitleLine("标题；"), "标题");
  assert.strictEqual(normalizeEditableClauseTitleLine("标题，"), "标题");
  assert.strictEqual(normalizeEditableClauseTitleLine("标题、"), "标题");
});

test("normalizeEditableClauseTitleLine returns empty for empty string", () => {
  assert.strictEqual(normalizeEditableClauseTitleLine(""), "");
});

summary();
