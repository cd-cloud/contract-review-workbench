/**
 * Tests for js/review-actions.js pure functions
 */

const { loadScript, test, summary, assert } = require("./test-helper");

global.clauseTypes = [
  "服务范围", "交付与验收", "付款", "知识产权", "数据使用",
  "个人信息保护", "保密", "陈述与保证", "合规承诺",
  "违约责任", "责任限制", "赔偿", "期限与终止", "争议解决", "通知", "其他",
];

global.escapeHtml = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
global.riskLabel = (level) => ({ low: "低", medium: "中", high: "高" }[level] || "低");
global.normalizeClauseTypeLabel = (value) => value || "其他";

global.state = {
  contracts: [{ id: "c1", name: "合同A", counterpartyName: "甲公司" }],
  clauses: [],
  findings: [
    { id: "f1", clauseId: "cl1", severity: "high", issue: "条款风险" },
    { id: "f2", severity: "high", issue: "合同级风险", fix: "建议修改", title: "风险标题" },
  ],
  contractRiskDecisions: {},
  aiSuggestionFeedback: [],
  activeContractId: "c1",
};

global.getAnalysisFindings = (contract, clauses) => global.state.findings;
global.getContractRiskDecision = () => null;
global.getContractRiskDecisionKey = (finding) => `${finding.title || finding.issue || ""}|${finding.fix || ""}`;
global.getWorkbenchMaterial = () => ({ text: "合同文本", sourceKey: "c1:test" });
global.splitVersionClauses = () => [];
global.getInsertedClauses = () => [];
global.getClauseActions = () => ({});
global.uid = (prefix) => `${prefix}-test-001`;
global.today = () => "2026-05-29";
global.saveState = () => {};
global.recordAudit = () => {};
global.renderReview = () => {};
global.requestVisualQaAfterSuggestionAction = () => {};
global.recordAiSuggestionFeedback = () => {};
global.appendBackendAudit = () => Promise.resolve();
global.persistBackendClauseActions = () => Promise.resolve({});
global.createBackendInsertedClause = () => Promise.resolve({});
global.persistBackendAuxState = () => Promise.resolve({});

global.buildClauseFromContractRisk = (finding, context) => ({
  type: finding.type || "其他",
  title: finding.title || finding.issue || "新增条款",
  text: finding.fix || finding.proposedClauseText || "",
});
global.buildConcreteContractRiskSuggestion = () => null;

loadScript("js/utils.js");
loadScript("js/review-actions.js");

console.log("\n=== test-review-actions-pure.js ===\n");

// --- getCurrentReviewContext ---
test("getCurrentReviewContext returns null when no active contract", () => {
  global.state.activeContractId = null;
  const ctx = getCurrentReviewContext();
  assert.strictEqual(ctx, null);
  global.state.activeContractId = "c1";
});

test("getCurrentReviewContext returns context with contract", () => {
  const ctx = getCurrentReviewContext();
  assert.ok(ctx);
  assert.strictEqual(ctx.contract.id, "c1");
});

// --- getContractRiskFindings ---
test("getContractRiskFindings filters contract-level findings", () => {
  const findings = getContractRiskFindings({ id: "test" }, []);
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].id, "f2");
});

test("getContractRiskFindings excludes empty findings", () => {
  global.state.findings = [{ id: "f1", severity: "high" }];
  const findings = getContractRiskFindings({ id: "test" }, []);
  assert.strictEqual(findings.length, 0);
  global.state.findings = [
    { id: "f1", clauseId: "cl1", severity: "high", issue: "条款风险" },
    { id: "f2", severity: "high", issue: "合同级风险", fix: "建议修改", title: "风险标题" },
  ];
});

// --- recordAiSuggestionFeedback ---
test("recordAiSuggestionFeedback creates feedback entry", () => {
  global.state.aiSuggestionFeedback = [];
  recordAiSuggestionFeedback("contract", "adopted", { contractId: "c1", title: "测试建议" });
  assert.strictEqual(global.state.aiSuggestionFeedback.length, 1);
  assert.strictEqual(global.state.aiSuggestionFeedback[0].scope, "contract");
  assert.strictEqual(global.state.aiSuggestionFeedback[0].status, "adopted");
});

test("recordAiSuggestionFeedback caps at 1000 entries", () => {
  global.state.aiSuggestionFeedback = Array(1000).fill({ id: "old" });
  recordAiSuggestionFeedback("clause", "rejected", {});
  assert.strictEqual(global.state.aiSuggestionFeedback.length, 1000);
});

test("adoptContractRiskSuggestionByFinding appends inserted clause", () => {
  global.state.contractRiskDecisions = {};
  const inserted = [];
  global.getInsertedClauses = () => inserted;
  const context = {
    contract: { id: "c1", name: "合同A" },
    material: { sourceKey: "c1:test" },
    clauses: [],
  };
  const adopted = adoptContractRiskSuggestionByFinding(context, {
    title: "保密条款",
    fix: "双方应保密",
    type: "保密",
  });
  assert.strictEqual(adopted, true);
  assert.strictEqual(inserted.length, 1);
  assert.strictEqual(inserted[0].title.includes("保密"), true);
});

summary();
