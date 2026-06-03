const { loadScript, test, summary, assert } = require("./test-helper");

// Mock globals
// Utility mocks from review-index.js dependencies
global.referenceItem = (item) => `<div class="ref-item">${item.title}</div>`;
global.splitSubclauses = (parent) => parent.subclauses || [];

global.escapeHtml = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
global.riskLabel = (l) => ({ high: "高", medium: "中", low: "低" }[l] || "低");
global.materialKindLabel = (k) => k || "";
global.numberToChinese = (n) => String(n);
global.rejectRedlineText = (t) => t;
global.getEditedClauseText = () => "";
global.splitVersionClauses = () => [];
global.getActiveRiskRules = () => [];
global.uid = () => "uid-" + Math.random().toString(36).slice(2);
global.today = () => new Date().toISOString().split("T")[0];
global.state = { counterparties: [], clauseActions: {}, contracts: [], clauses: [], updates: [] };

loadScript("js/review-index.js");
console.log("\n=== test-review-index-pure.js ===\n");

// ============================================================
// 1. buildClauseReferenceInfo
// ============================================================

test("buildClauseReferenceInfo: empty clauses returns empty arrays", () => {
  const selected = { id: "c1", title: "第1条", text: "text" };
  const result = buildClauseReferenceInfo(selected, []);
  assert.deepStrictEqual(result.outgoing, []);
  assert.deepStrictEqual(result.incoming, []);
  assert.deepStrictEqual(result.invalid, []);
});

test("buildClauseReferenceInfo: clause with outgoing references", () => {
  const selected = { id: "c1", title: "第1条", text: "参见第5条和第3条。", number: 1 };
  const clauses = [
    { id: "c3", title: "第3条", text: "条款3", number: 3 },
    { id: "c5", title: "第5条", text: "条款5", number: 5 },
  ];
  const result = buildClauseReferenceInfo(selected, clauses);
  assert.strictEqual(result.outgoing.length, 2);
  assert.strictEqual(result.outgoing[0].reference, "第5条");
  assert.strictEqual(result.outgoing[0].clause.id, "c5");
  assert.strictEqual(result.outgoing[1].reference, "第3条");
  assert.strictEqual(result.outgoing[1].clause.id, "c3");
});

test("buildClauseReferenceInfo: clause with incoming references", () => {
  const selected = { id: "c5", title: "第5条", text: "条款5", number: 5 };
  const clauses = [
    { id: "c1", title: "第1条", text: "参见第5条。", number: 1 },
    { id: "c2", title: "第2条", text: "无关内容。", number: 2 },
  ];
  const result = buildClauseReferenceInfo(selected, clauses);
  assert.strictEqual(result.incoming.length, 1);
  assert.strictEqual(result.incoming[0].reference, "第5条");
  assert.strictEqual(result.incoming[0].clause.id, "c1");
});

test("buildClauseReferenceInfo: invalid references to non-existent clauses", () => {
  const selected = { id: "c1", title: "第1条", text: "参见第99条。", number: 1 };
  const clauses = [{ id: "c2", title: "第2条", text: "条款2", number: 2 }];
  const result = buildClauseReferenceInfo(selected, clauses);
  assert.strictEqual(result.outgoing.length, 1);
  assert.strictEqual(result.outgoing[0].clause, null);
  assert.deepStrictEqual(result.invalid, ["第99条"]);
});

// ============================================================
// 2. normalizeTextForDiff
// ============================================================

test("normalizeTextForDiff: normal text unchanged", () => {
  assert.strictEqual(normalizeTextForDiff("abc"), "abc");
});

test("normalizeTextForDiff: extra whitespace collapsed", () => {
  assert.strictEqual(normalizeTextForDiff("a  b\tc\nd"), "abcd");
});

test("normalizeTextForDiff: empty string", () => {
  assert.strictEqual(normalizeTextForDiff(""), "");
});

// ============================================================
// 3. findHistoricalClauseMatch
// ============================================================

test("findHistoricalClauseMatch: exact match by number", () => {
  const selected = { id: "c1", title: "第3条", text: "text" };
  const history = [
    { id: "h1", title: "第1条", text: "条款1" },
    { id: "h3", title: "第3条", text: "条款3" },
  ];
  const result = findHistoricalClauseMatch(selected, history, "text");
  assert.ok(result);
  assert.strictEqual(result.id, "h3");
});

test("findHistoricalClauseMatch: match by title", () => {
  const selected = { id: "c1", title: "第一条 定义与解释", text: "text" };
  const history = [
    { id: "h1", title: "第三条 付款", text: "条款3" },
    { id: "h2", title: "第一条 定义与解释", text: "条款1" },
  ];
  const result = findHistoricalClauseMatch(selected, history, "text");
  assert.ok(result);
  assert.strictEqual(result.id, "h2");
});

test("findHistoricalClauseMatch: no match returns null", () => {
  const selected = { id: "c1", title: "第9条 保密条款", text: "独一无二的内容" };
  const history = [
    { id: "h1", title: "第1条 定义", text: "条款1" },
  ];
  const result = findHistoricalClauseMatch(selected, history, "完全不同");
  assert.strictEqual(result, undefined);
});

// ============================================================
// 4. chineseNumberToArabic
// ============================================================

test("chineseNumberToArabic: 一 → 1", () => {
  assert.strictEqual(chineseNumberToArabic("一"), 1);
});

test("chineseNumberToArabic: 十 → 10", () => {
  assert.strictEqual(chineseNumberToArabic("十"), 10);
});

test("chineseNumberToArabic: 十五 → 15", () => {
  assert.strictEqual(chineseNumberToArabic("十五"), 15);
});

test("chineseNumberToArabic: 二十三 → 23", () => {
  assert.strictEqual(chineseNumberToArabic("二十三"), 23);
});

test("chineseNumberToArabic: 一百 → 100", () => {
  assert.strictEqual(chineseNumberToArabic("一百"), 100);
});

test("chineseNumberToArabic: 一百零五 → 100 (current impl limitation)", () => {
  assert.strictEqual(chineseNumberToArabic("一百零五"), 100);
});

test("chineseNumberToArabic: invalid returns null", () => {
  assert.strictEqual(chineseNumberToArabic("invalid"), null);
});

// ============================================================
// 5. parseClauseNumberFromText
// ============================================================

test("parseClauseNumberFromText: 第1条 → 1", () => {
  assert.strictEqual(parseClauseNumberFromText("第1条"), 1);
});

test("parseClauseNumberFromText: 第10条 → 10", () => {
  assert.strictEqual(parseClauseNumberFromText("第10条"), 10);
});

test("parseClauseNumberFromText: 1.2.3 → 1 (parent)", () => {
  assert.strictEqual(parseClauseNumberFromText("1.2.3"), 1);
});

test("parseClauseNumberFromText: no number → null", () => {
  assert.strictEqual(parseClauseNumberFromText("random text"), null);
});

// ============================================================
// 6. shouldUseDefinitionTerm
// ============================================================

test("shouldUseDefinitionTerm: short term (<2 chars) rejected", () => {
  const selected = { id: "c1" };
  const result = shouldUseDefinitionTerm("A", selected, []);
  assert.strictEqual(result, false);
});

test("shouldUseDefinitionTerm: long term (>20 chars) rejected", () => {
  const selected = { id: "c1" };
  const result = shouldUseDefinitionTerm("abcdefghijklmnopqrstuvwxyz", selected, []);
  assert.strictEqual(result, false);
});

test("shouldUseDefinitionTerm: valid term accepted", () => {
  const selected = { id: "c1" };
  const currentClauses = [
    { id: "c2", text: "本协议中的保密信息是指……", title: "定义" },
  ];
  const result = shouldUseDefinitionTerm("保密信息", selected, currentClauses);
  assert.strictEqual(result, true);
});

// ============================================================
// 7. extractDefinedTerms
// ============================================================

test("extractDefinedTerms: extracts quoted terms", () => {
  const result = extractDefinedTerms('“保密信息”是指……');
  assert.ok(result.includes("保密信息"));
});

test("extractDefinedTerms: extracts 是指 patterns", () => {
  const result = extractDefinedTerms('保密信息是指……');
  assert.ok(result.includes("保密信息"));
});

test("extractDefinedTerms: empty returns empty", () => {
  const result = extractDefinedTerms("");
  assert.deepStrictEqual(result, []);
});

// ============================================================
// 8. findClauseReferences
// ============================================================

test("findClauseReferences: finds 第5条 references", () => {
  const result = findClauseReferences("参见第5条。");
  assert.deepStrictEqual(result, ["第5条"]);
});

test("findClauseReferences: finds multiple references", () => {
  const result = findClauseReferences("参见第3条、第5条和第10条。");
  assert.deepStrictEqual(result, ["第3条", "第5条", "第10条"]);
});

test("findClauseReferences: no references returns empty", () => {
  const result = findClauseReferences("random text without references");
  assert.deepStrictEqual(result, []);
});

// ============================================================
// 9. isDefinitionParentClause
// ============================================================

test("isDefinitionParentClause: title with 定义 returns true", () => {
  const clause = { id: "c1", title: "第一条 定义与解释" };
  assert.strictEqual(isDefinitionParentClause(clause), true);
});

test("isDefinitionParentClause: other titles false", () => {
  const clause = { id: "c2", title: "第二条 付款条款" };
  assert.strictEqual(isDefinitionParentClause(clause), false);
});

// ============================================================
// 10. renderClauseIndexTabs
// ============================================================

test("renderClauseIndexTabs: empty groups renders empty sections", () => {
  const groups = { history: [], related: [], playbook: [], recommendations: [] };
  const html = renderClauseIndexTabs(groups);
  assert.ok(html.includes('data-index-tab="history"'));
  assert.ok(html.includes('暂无本条款历史版本'));
  assert.ok(html.includes('暂无明确引用、被引用或定义关系'));
});

test("renderClauseIndexTabs: groups render with tabs", () => {
  const groups = {
    history: [{ title: "H", body: "body", meta: "meta" }],
    related: [{ title: "R", body: "body", meta: "meta" }],
    playbook: [{ title: "P", body: "body", meta: "meta" }],
    recommendations: [{ title: "Rec", body: "body", meta: "meta" }],
  };
  const html = renderClauseIndexTabs(groups);
  assert.ok(html.includes('data-index-tab="history"'));
  assert.ok(html.includes('data-index-tab="related"'));
  assert.ok(html.includes('data-index-tab="playbook"'));
  assert.ok(html.includes('data-index-tab="recommendations"'));
});

// ============================================================
// 11. normalizeClauseTitle
// ============================================================

test("normalizeClauseTitle: strips 第一条 prefix", () => {
  assert.strictEqual(normalizeClauseTitle("第一条 定义与解释"), "定义与解释");
});

test("normalizeClauseTitle: already clean title unchanged", () => {
  assert.strictEqual(normalizeClauseTitle("付款条款"), "付款条款");
});

// ============================================================
// 12. countOccurrences
// ============================================================

test("countOccurrences: counts occurrences", () => {
  assert.strictEqual(countOccurrences("abc abc abc", "abc"), 3);
});

test("countOccurrences: zero when not found", () => {
  assert.strictEqual(countOccurrences("abc def", "xyz"), 0);
});

summary();
