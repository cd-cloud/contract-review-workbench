const { loadScript, test, summary, assert } = require("./test-helper");

// Mock globals used by playbook.js
global.escapeHtml = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
global.riskLabel = (l) => ({ high: "高", medium: "中", low: "低" }[l] || "低");
global.statCard = (t, v, d) => `<div>${t}:${v}</div>`;
global.normalizeText = (t) => t;
global.today = () => "2026-05-29";
global.uid = (prefix) => `${prefix}_${Math.random().toString(36).slice(2)}`;
global.state = { aiSuggestionFeedback: [], playbooks: [], clauses: [], contracts: [] };

loadScript("js/playbook.js");

console.log("\n=== test-playbook-pure.js ===\n");

// ─── playbookStatusLabel ───
test("playbookStatusLabel maps known statuses", () => {
  assert.strictEqual(playbookStatusLabel("standard"), "标准版本");
  assert.strictEqual(playbookStatusLabel("fallback"), "备选版本");
  assert.strictEqual(playbookStatusLabel("forbidden"), "禁用版本");
});

test("playbookStatusLabel returns default for unknown status", () => {
  assert.strictEqual(playbookStatusLabel("unknown"), "标准版本");
  assert.strictEqual(playbookStatusLabel(""), "标准版本");
  assert.strictEqual(playbookStatusLabel(undefined), "标准版本");
});

// ─── playbookReviewStatusLabel ───
test("playbookReviewStatusLabel maps known statuses", () => {
  assert.strictEqual(playbookReviewStatusLabel("active"), "已生效");
  assert.strictEqual(playbookReviewStatusLabel("pending_review"), "待复核");
  assert.strictEqual(playbookReviewStatusLabel("disabled"), "已禁用");
});

test("playbookReviewStatusLabel returns default for unknown status", () => {
  assert.strictEqual(playbookReviewStatusLabel("unknown"), "已生效");
  assert.strictEqual(playbookReviewStatusLabel(""), "已生效");
  assert.strictEqual(playbookReviewStatusLabel(null), "已生效");
});

// ─── inferKnowledgeKeywords ───
test("inferKnowledgeKeywords extracts keywords from text", () => {
  const item = {
    type: "保密条款",
    standard: "双方应对数据、模型训练及个人信息严格保密",
    fallback: "保密义务不得免除",
    negotiation: "知识产权归原权利人所有",
  };
  const keywords = inferKnowledgeKeywords(item);
  assert(keywords.includes("数据"));
  assert(keywords.includes("保密"));
  assert(keywords.includes("模型训练"));
  assert(keywords.includes("个人信息"));
  assert(keywords.includes("知识产权"));
});

test("inferKnowledgeKeywords returns empty array for empty input", () => {
  assert.deepStrictEqual(inferKnowledgeKeywords({}), []);
  assert.deepStrictEqual(inferKnowledgeKeywords(), []);
  assert.deepStrictEqual(inferKnowledgeKeywords({ type: "", standard: "" }), []);
});

test("inferKnowledgeKeywords caps at 8 keywords", () => {
  const item = {
    standard: "数据、模型训练、个人信息、保密、知识产权、责任上限、违约、争议解决、股权、创始人",
  };
  const keywords = inferKnowledgeKeywords(item);
  assert.strictEqual(keywords.length, 8);
});

// ─── inferPlaybookConfidence ───
test("inferPlaybookConfidence calculates score based on occurrences and signals", () => {
  const item = {
    sourceOccurrences: [{ id: "a" }, { id: "b" }],
    knowledgeSignals: [{ id: "s1" }],
    reviewStatus: "active",
    standard: "foo",
  };
  const score = inferPlaybookConfidence(item);
  // 2 * 18 + 1 * 6 + 25 = 67
  assert.strictEqual(score, 67);
});

test("inferPlaybookConfidence is capped at 100", () => {
  const item = {
    sourceOccurrences: Array(10).fill({ id: "x" }),
    knowledgeSignals: Array(10).fill({ id: "s" }),
    reviewStatus: "active",
    standard: "foo",
  };
  assert.strictEqual(inferPlaybookConfidence(item), 100);
});

test("inferPlaybookConfidence floor is 20 when standard exists", () => {
  const item = {
    sourceOccurrences: [],
    knowledgeSignals: [],
    reviewStatus: "disabled",
    standard: "bar",
  };
  assert.strictEqual(inferPlaybookConfidence(item), 20);
});

test("inferPlaybookConfidence floor is 0 when no standard", () => {
  const item = {
    sourceOccurrences: [],
    knowledgeSignals: [],
    reviewStatus: "disabled",
  };
  assert.strictEqual(inferPlaybookConfidence(item), 0);
});

// ─── upsertKnowledgeOccurrence ───
test("upsertKnowledgeOccurrence adds new occurrence", () => {
  const list = [];
  const occurrence = { id: "o1", text: "hello" };
  const result = upsertKnowledgeOccurrence(list, occurrence);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].id, "o1");
});

test("upsertKnowledgeOccurrence updates existing by id", () => {
  const list = [{ id: "o1", text: "old" }];
  const occurrence = { id: "o1", text: "new" };
  const result = upsertKnowledgeOccurrence(list, occurrence);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].text, "new");
});

test("upsertKnowledgeOccurrence caps at 30", () => {
  const list = Array.from({ length: 30 }, (_, i) => ({ id: `o${i}`, text: "x" }));
  const occurrence = { id: "new", text: "y" };
  const result = upsertKnowledgeOccurrence(list, occurrence);
  assert.strictEqual(result.length, 30);
  assert.strictEqual(result[0].id, "new");
});

// ─── normalizePlaybook ───
test("normalizePlaybook fills missing defaults", () => {
  const item = { type: "测试" };
  const result = normalizePlaybook(item);
  assert.strictEqual(result.status, "standard");
  assert.strictEqual(result.version, 1);
  assert.deepStrictEqual(result.contractTypes, []);
  assert.deepStrictEqual(result.sourceOccurrences, []);
  assert.deepStrictEqual(result.variants, []);
  assert.deepStrictEqual(result.knowledgeSignals, []);
  assert.deepStrictEqual(result.sourceContractIds, []);
  assert.deepStrictEqual(result.sourceClauseIds, []);
  assert.strictEqual(result.reviewStatus, "active");
  assert.strictEqual(result.approvalStatus, "approved");
  assert.strictEqual(result.usageCount, 0);
  assert.strictEqual(result.confidenceScore, 0);
});

test("normalizePlaybook preserves existing fields", () => {
  const item = {
    type: "测试",
    status: "custom",
    version: 5,
    usageCount: 10,
    reviewStatus: "pending_review",
    confidenceScore: 80,
    keywords: ["a", "b"],
  };
  const result = normalizePlaybook(item);
  assert.strictEqual(result.status, "custom");
  assert.strictEqual(result.version, 5);
  assert.strictEqual(result.usageCount, 10);
  assert.strictEqual(result.reviewStatus, "pending_review");
  assert.strictEqual(result.confidenceScore, 80);
  assert.deepStrictEqual(result.keywords, ["a", "b"]);
});

// ─── getKnowledgeStats ───
test("getKnowledgeStats counts active and pending from state", () => {
  global.state.playbooks = [
    { reviewStatus: "active" },
    { reviewStatus: "active" },
    { reviewStatus: "pending_review" },
    { reviewStatus: "disabled" },
  ];
  global.state.aiSuggestionFeedback = [{ id: 1 }, { id: 2 }];
  const stats = getKnowledgeStats();
  assert.strictEqual(stats.active, 2);
  assert.strictEqual(stats.pending, 1);
  assert.strictEqual(stats.feedback, 2);
});

test("getKnowledgeStats counts unique source contracts", () => {
  global.state.playbooks = [
    { reviewStatus: "active", sourceContractIds: ["c1", "c2"] },
    { reviewStatus: "active", sourceContractIds: ["c2", "c3"] },
  ];
  global.state.aiSuggestionFeedback = [];
  const stats = getKnowledgeStats();
  assert.strictEqual(stats.sources, 3);
});

summary();
