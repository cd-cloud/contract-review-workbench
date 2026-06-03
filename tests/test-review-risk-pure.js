/**
 * Tests for js/review-risk.js pure functions
 */

const { loadScript, test, summary, assert } = require("./test-helper");

// clauseTypes is used by normalizeClauseTypeLabel but defined in state.js with const,
// which doesn't leak to global in indirect eval. Define it manually here.
global.clauseTypes = [
  "服务范围", "交付与验收", "付款", "知识产权", "数据使用",
  "个人信息保护", "保密", "陈述与保证", "合规承诺",
  "违约责任", "责任限制", "赔偿", "期限与终止", "争议解决", "通知", "其他",
];

// Mock dependencies
global.escapeHtml = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
global.riskLabel = (level) => ({ low: "低", medium: "中", high: "高" }[level] || "低");
global.state = {
  playbooks: [
    { id: "pb1", type: "保密", standard: "双方应对保密信息承担保密义务", reviewStatus: "active" },
    { id: "pb2", type: "付款", standard: "甲方应在收到发票后30日内付款", reviewStatus: "active" },
  ],
  clauses: [],
  findings: [],
  contractRiskDecisions: {},
};

global.getAnalysisFindings = (contract, clauses) => global.state.findings;
global.getContractRiskDecision = (contractId, key) => {
  const map = global.state.contractRiskDecisions[contractId] || {};
  return map[key];
};
global.setContractRiskDecision = (contractId, finding, status) => {
  global.state.contractRiskDecisions[contractId] = global.state.contractRiskDecisions[contractId] || {};
  global.state.contractRiskDecisions[contractId][getContractRiskDecisionKey(finding)] = { status, finding };
};
global.getContractRiskDecisionKey = (finding) => `${finding.title || finding.issue || ""}|${finding.fix || ""}`;
global.normalizeText = (text) => String(text || "").replace(/\s+/g, "").toLowerCase();
global.stripStandaloneAdviceNumbering = (text) => String(text || "").replace(/^第[一二三四五六七八九十]+条[、.\s]*/, "");

global.uid = (prefix) => `${prefix}-test-001`;
global.today = () => "2026-05-29";
global.saveState = () => {};
global.recordAudit = () => {};
global.renderReview = () => {};
global.getWorkbenchMaterial = () => ({ text: "", sourceKey: "test" });
global.splitVersionClauses = () => [];
global.getInsertedClauses = () => [];
global.buildClauseFromContractRisk = (finding, context) => ({
  type: finding.type || "其他",
  title: finding.title || finding.issue || "新增条款",
  text: finding.fix || finding.proposedClauseText || "",
});

loadScript("js/review-risk.js");

console.log("\n=== test-review-risk-pure.js ===\n");

// --- getContractRiskDecisionKey ---
test("getContractRiskDecisionKey combines title and fix", () => {
  const key = getContractRiskDecisionKey({ title: "保密义务", fix: "增加期限" });
  assert.ok(key.includes("保密义务"));
  assert.ok(key.includes("增加期限"));
});

loadScript("js/utils.js");

// --- uniqueContractRiskFindings ---
test("uniqueContractRiskFindings deduplicates by key", () => {
  const findings = [
    { title: "风险A", fix: "修复A" },
    { title: "风险A", fix: "修复A" },
    { title: "风险B", fix: "修复B" },
  ];
  const unique = uniqueContractRiskFindings({ id: "c1" }, { text: "" }, [], findings);
  assert.strictEqual(unique.length, 2);
});

// --- buildClauseFromContractRisk ---
test("buildClauseFromContractRisk builds clause from finding", () => {
  const clause = buildClauseFromContractRisk(
    { title: "保密条款", fix: "双方应保密", type: "保密" },
    { contract: { id: "c1" } }
  );
  assert.strictEqual(clause.type, "保密");
  assert.ok(clause.title.includes("保密"));
});

summary();
