const { loadScript, test, summary, assert } = require("./test-helper");

// Mock globals

global.escapeHtml = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
global.riskLabel = (l) => ({ high: "高", medium: "中", low: "低" }[l] || "低");
global.getClauseRiskSummary = () => [];
global.renderInlineClauseCard = () => "";
global.renderSubclauseCard = () => "";
global.isTreeNodeExpanded = () => true;

loadScript("js/review-tree.js");

console.log("\n=== test-review-tree-pure.js ===\n");

// ─── buildClauseTree ───

test("buildClauseTree: empty clauses returns empty", () => {
  const result = buildClauseTree([], "src");
  assert.deepStrictEqual(result, []);
});

test("buildClauseTree: clauses with chapter titles are grouped", () => {
  const clauses = [
    { id: "c1", chapterTitle: "第一章", title: "条款一" },
    { id: "c2", chapterTitle: "第一章", title: "条款二" },
    { id: "c3", chapterTitle: "第二章", title: "条款三" },
  ];
  const result = buildClauseTree(clauses, "src");
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result[0].kind, "chapter");
  assert.strictEqual(result[0].title, "第一章");
  assert.strictEqual(result[0].clauses.length, 2);
  assert.strictEqual(result[1].kind, "chapter");
  assert.strictEqual(result[1].title, "第二章");
  assert.strictEqual(result[1].clauses.length, 1);
});

test("buildClauseTree: clauses without chapterTitle become flat", () => {
  const clauses = [
    { id: "c1", title: "条款一" },
    { id: "c2", title: "条款二" },
  ];
  const result = buildClauseTree(clauses, "src");
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result[0].kind, "clause");
  assert.strictEqual(result[0].clause.id, "c1");
  assert.strictEqual(result[1].kind, "clause");
  assert.strictEqual(result[1].clause.id, "c2");
});

test("buildClauseTree: mixed clauses with and without chapterTitle", () => {
  const clauses = [
    { id: "c1", chapterTitle: "第一章", title: "条款一" },
    { id: "c2", title: "条款二" },
    { id: "c3", chapterTitle: "第一章", title: "条款三" },
  ];
  const result = buildClauseTree(clauses, "src");
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result[0].kind, "chapter");
  assert.strictEqual(result[0].clauses.length, 2);
  assert.strictEqual(result[1].kind, "clause");
  assert.strictEqual(result[1].clause.id, "c2");
});

// ─── shouldFlattenDuplicateChapter ───

test("shouldFlattenDuplicateChapter: single clause chapter matching title → true", () => {
  const node = {
    kind: "chapter",
    title: "保密义务",
    clauses: [{ title: "保密义务", text: "保密义务内容" }],
  };
  assert.strictEqual(shouldFlattenDuplicateChapter(node), true);
});

test("shouldFlattenDuplicateChapter: multiple clauses → false", () => {
  const node = {
    kind: "chapter",
    title: "保密义务",
    clauses: [
      { title: "保密义务", text: "内容一" },
      { title: "另一条款", text: "内容二" },
    ],
  };
  assert.strictEqual(shouldFlattenDuplicateChapter(node), false);
});

test("shouldFlattenDuplicateChapter: non-matching title → false", () => {
  const node = {
    kind: "chapter",
    title: "第一章",
    clauses: [{ title: "保密义务", text: "内容" }],
  };
  assert.strictEqual(shouldFlattenDuplicateChapter(node), false);
});

test("shouldFlattenDuplicateChapter: non-chapter node → false", () => {
  const node = { kind: "clause", clause: { title: "条款" } };
  assert.strictEqual(shouldFlattenDuplicateChapter(node), false);
});

// ─── normalizeTreeTitle ───

test("normalizeTreeTitle: strips Chinese numbering", () => {
  assert.strictEqual(normalizeTreeTitle("第一章 总则"), "总则");
  assert.strictEqual(normalizeTreeTitle("第一节 范围"), "范围");
});

test("normalizeTreeTitle: strips digit numbering", () => {
  assert.strictEqual(normalizeTreeTitle("1. 总则"), "总则");
  assert.strictEqual(normalizeTreeTitle("一、定义"), "定义");
});

test("normalizeTreeTitle: strips punctuation", () => {
  assert.strictEqual(normalizeTreeTitle("总则："), "总则");
  assert.strictEqual(normalizeTreeTitle("定义；"), "定义");
  assert.strictEqual(normalizeTreeTitle("范围，"), "范围");
});

test("normalizeTreeTitle: empty returns empty", () => {
  assert.strictEqual(normalizeTreeTitle(""), "");
  assert.strictEqual(normalizeTreeTitle(null), "");
  assert.strictEqual(normalizeTreeTitle(undefined), "");
});

// ─── buildSubclauseTree ───

test("buildSubclauseTree: empty returns empty", () => {
  const result = buildSubclauseTree([]);
  assert.deepStrictEqual(result, []);
});

test("buildSubclauseTree: single level flat", () => {
  const subclauses = [
    { id: "s1", text: "1.1 内容一", outlineLevel: 2 },
    { id: "s2", text: "1.2 内容二", outlineLevel: 2 },
  ];
  const result = buildSubclauseTree(subclauses);
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result[0].children.length, 0);
  assert.strictEqual(result[1].children.length, 0);
});

test("buildSubclauseTree: nested hierarchy built correctly", () => {
  const subclauses = [
    { id: "s1", text: "1. 一级", outlineLevel: 1 },
    { id: "s2", text: "1.1 二级", outlineLevel: 2 },
    { id: "s3", text: "1.1.1 三级", outlineLevel: 3 },
    { id: "s4", text: "1.2 二级", outlineLevel: 2 },
  ];
  const result = buildSubclauseTree(subclauses);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].children.length, 2);
  assert.strictEqual(result[0].children[0].children.length, 1);
  assert.strictEqual(result[0].children[1].children.length, 0);
});

// ─── getSubclauseLevel ───

test("getSubclauseLevel: has level → returns level", () => {
  assert.strictEqual(getSubclauseLevel({ outlineLevel: 3 }), 3);
  assert.strictEqual(getSubclauseLevel({ outlineLevel: 1 }), 1);
});

test("getSubclauseLevel: no level → defaults to 2", () => {
  assert.strictEqual(getSubclauseLevel({ text: "普通文本" }), 2);
  assert.strictEqual(getSubclauseLevel({}), 2);
});

test("getSubclauseLevel: inferred from outline number depth", () => {
  assert.strictEqual(getSubclauseLevel({ text: "1.1 内容" }), 2);
  assert.strictEqual(getSubclauseLevel({ text: "1.1.1 内容" }), 3);
  assert.strictEqual(getSubclauseLevel({ text: "1.1.1.1 内容" }), 4);
});

summary();
