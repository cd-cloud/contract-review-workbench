/**
 * Tests for js/app-events.js click handler sub-functions
 */

const { loadScript, test, summary, assert } = require("./test-helper");

// Mock all dependencies before loading app-events
global.state = {
  auditLogsCollapsed: true,
  contracts: [],
  currentDraft: null,
  clauses: [],
  updates: [],
  activeContractId: null,
  activeClauseId: null,
  activeUpdateId: null,
  expandedTreeNodes: {},
  activeWorkbenchClauseId: null,
  activeSubclauseId: null,
  clauseViewModes: {},
  focusedAdviceKey: null,
  contractRiskCollapsed: false,
  insertionAudits: {},
  playbooks: [],
  readerFilters: {},
  autoReviewJobs: {},
  findings: [],
  taskFilters: {},
};

let lastView = null;
global.setView = (name) => { lastView = name; };
global.saveState = () => {};
global.renderDashboard = () => {};
global.renderReview = () => {};
global.render = () => {};
global.renderPlaybooks = () => {};
global.openUploadModal = () => {};
global.closeUploadModal = () => {};
global.closeAddClauseModal = () => {};
global.closeProgressModal = () => {};
global.closeSkillResultModal = () => {};
global.openSkillResultModal = () => {};
global.openProgressModal = () => {};
global.scrollToSubclause = () => {};
global.scrollToWorkbenchClause = () => {};
global.focusWorkbenchClause = () => {};
global.focusWorkbenchSubclause = () => {};
global.toggleTreeNodeExpansion = () => {};
global.hydrateContractAnalysis = () => {};
global.ensureInitialUpdate = () => {};
global.setActiveContract = () => {};
global.recordAudit = () => {};
global.showToast = () => {};
global.uid = (prefix) => `${prefix}-test-001`;
global.today = () => "2026-05-29";
global.clone = (obj) => JSON.parse(JSON.stringify(obj));
global.ensureCounterparty = (name) => ({ id: "cp-1", name });
global.adoptAllContractRiskSuggestions = () => {};
global.adoptContractRiskSuggestion = () => {};
global.rejectContractRiskSuggestion = () => {};
global.restoreContractRiskSuggestion = () => {};
global.scheduleVisualQa = () => {};
global.applyVisualQaAutoFixes = () => ({ applied: 0 });
global.runVisualQaForMaterial = async () => ({});
global.buildDocxRedlinePackage = () => new Blob([]);
global.buildDeliveryPackageZip = () => new Blob([]);
global.buildLegalSkillRequest = () => ({});
global.depositFinalClausesToPlaybook = () => ({ added: 0, updated: 0 });
global.toggleRiskRuleStatus = () => true;
global.playbookReviewStatusLabel = () => "已审阅";
global.addDays = (date, days) => date;
global.inferPlaybookConfidence = () => 0.8;
global.renderPlaybookCards = () => "";
global.getWorkbenchMaterial = () => ({ text: "", sourceKey: "" });
global.splitVersionClauses = () => [];
global.getClauseActions = () => ({});
global.getInsertedClauses = () => [];
global.findClauseOrSubclause = () => null;
global.findByDataAttribute = () => null;
global.composeEditableClauseText = (title, text) => `${title}\n${text}`;
global.buildClauseReferenceInfo = () => ({ outgoing: [], incoming: [] });
global.getContractUpdates = () => [];
global.deleteContract = () => {};
global.deleteContractVersion = () => {};
global.createPreparedSendingVersion = () => ({ text: "", update: { id: "u1" }, changeSummary: "", reviewChecks: [] });
global.summarizeAutomaticReviewChecks = () => "";
global.acceptRedlineText = (text) => text;
global.rejectRedlineText = (text) => text;
global.safeDownloadName = (name) => name;
global.downloadBlob = () => {};
global.scheduleAutomaticCodexReview = () => {};
global.setAnalysisStatus = () => {};
global.applyLegalSkillResult = () => {};
global.applyFocusedClauseSkillResult = () => {};
global.getStoredSkillFindings = () => [];
global.ensureAnalysisHasCodexSegmentation = async () => ({ text: "", sourceKey: "" });
global.runLegalSkillAnalysis = async () => ({});
global.syncBackendSnapshot = async () => ({ db: {} });
global.filterContracts = () => {};
global.filterPlaybooks = () => {};
global.filterCounterparties = () => {};
global.filterGlobalSearch = () => {};
global.filterFeedbackTasks = () => {};
global.getTaskFilters = () => ({});
global.getUploadedFileResult = () => null;
global.cacheUploadedFileResult = () => {};
global.readUploadedFile = async () => ({ displayText: "" });
global.generateDraftContract = () => ({ title: "草稿", text: "", type: "", summary: "", background: "", role: "", counterparty: "" });
global.runContractIntake = async () => ({ intake: {} });
global.adoptClauseRiskSuggestion = async () => {};
global.commentClauseRiskSuggestion = async () => {};
global.adjustClauseRiskSuggestion = async () => {};
global.confirmClauseRiskBusinessDecision = async () => {};
global.rejectClauseRiskSuggestion = async () => {};
global.reorderClauseByDrag = () => {};
global.reorderSubclauseByDrag = () => {};

function mockElement() {
  return { addEventListener: () => {}, dataset: {}, classList: { toggle: () => {} } };
}
global.document = {
  body: { classList: { toggle: () => {}, contains: () => false } },
  querySelector: (sel) => {
    if (sel === "#upload-form" || sel === "#progress-form" || sel === "#add-clause-form") return mockElement();
    return null;
  },
  addEventListener: () => {},
};

// Mock event factory
function mockEvent(selectorMap) {
  return {
    target: {
      closest: (sel) => selectorMap[sel] || null,
      dataset: {},
    },
    detail: selectorMap.detail || 1,
    preventDefault: () => {},
    stopPropagation: () => {},
  };
}

loadScript("js/app-events.js");

console.log("\n=== test-app-events.js ===\n");

// --- handleNavClick ---
test("handleNavClick handles nav-item click", () => {
  lastView = null;
  const event = mockEvent({ ".nav-item": { dataset: { view: "review" } } });
  const result = handleNavClick(event);
  assert.strictEqual(result, false); // no return in original
  assert.strictEqual(lastView, "review");
});

test("handleNavClick handles sidebar toggle", () => {
  let toggled = false;
  global.document = {
    body: { classList: { toggle: (name) => { if (name === "sidebar-expanded") toggled = true; }, contains: () => false } },
  };
  const event = mockEvent({ "[data-toggle-sidebar]": { setAttribute: () => {}, dataset: {} } });
  const result = handleNavClick(event);
  assert.strictEqual(result, false);
  assert.strictEqual(toggled, true);
});

test("handleNavClick handles audit logs toggle", () => {
  global.state = { auditLogsCollapsed: true };
  global.renderDashboard = () => {};
  const event = mockEvent({ "[data-toggle-audit-logs]": {} });
  const result = handleNavClick(event);
  assert.strictEqual(result, true);
  assert.strictEqual(state.auditLogsCollapsed, false);
});

test("handleNavClick returns false when no match", () => {
  const event = mockEvent({});
  const result = handleNavClick(event);
  assert.strictEqual(result, false);
});

// --- handleModalClick ---
test("handleModalClick opens upload modal", () => {
  let opened = false;
  global.openUploadModal = () => { opened = true; };
  const event = mockEvent({ "[data-open-upload]": {} });
  const result = handleModalClick(event);
  assert.strictEqual(result, false);
  assert.strictEqual(opened, true);
});

test("handleModalClick closes upload modal", () => {
  let closed = false;
  global.closeUploadModal = () => { closed = true; };
  const event = mockEvent({ "[data-close-upload]": {} });
  const result = handleModalClick(event);
  assert.strictEqual(result, false);
  assert.strictEqual(closed, true);
});

test("handleModalClick triggers autofill from material", () => {
  let called = false;
  global.autofillNewReviewFromMaterial = () => { called = true; };
  const event = mockEvent({ "[data-autofill-new-review]": {} });
  const result = handleModalClick(event);
  assert.strictEqual(result, true);
  assert.strictEqual(called, true);
});

test("handleModalClick triggers local autofill", () => {
  let called = false;
  global.autofillNewReviewFromLocalRules = () => { called = true; };
  const event = mockEvent({ "[data-autofill-new-review-local]": {} });
  const result = handleModalClick(event);
  assert.strictEqual(result, true);
  assert.strictEqual(called, true);
});

test("handleReviewClick persists reader tab per clause scope", () => {
  let saved = false;
  global.saveState = () => { saved = true; };
  global.state = { readerPaneTabs: {} };
  const buttons = [
    { dataset: { readerTab: "index" }, classList: { toggle: () => {} } },
    { dataset: { readerTab: "analysis" }, classList: { toggle: () => {} } },
  ];
  const panes = [
    { dataset: { readerPane: "index" }, classList: { toggle: () => {} } },
    { dataset: { readerPane: "analysis" }, classList: { toggle: () => {} } },
  ];
  const reader = {
    dataset: { readerScope: "source-1||clause-1" },
    querySelectorAll: (selector) => selector === "[data-reader-tab]" ? buttons : panes,
  };
  const event = {
    target: {
      closest: (selector) => selector === "[data-reader-tab]"
        ? { dataset: { readerTab: "analysis" }, closest: () => reader }
        : null,
    },
    preventDefault: () => {},
    stopPropagation: () => {},
  };
  const result = handleReviewClick(event);
  assert.strictEqual(result, true);
  assert.strictEqual(saved, true);
  assert.strictEqual(state.readerPaneTabs["source-1||clause-1"], "analysis");
});

// --- handleContractNavClick ---
test("handleContractNavClick opens contract", () => {
  let activated = null;
  global.setActiveContract = (id) => { activated = id; };
  global.scheduleAutomaticCodexReview = () => {};
  const event = mockEvent({ "[data-open-contract]": { dataset: { openContract: "contract-1" } } });
  const result = handleContractNavClick(event);
  assert.strictEqual(result, false);
  assert.strictEqual(activated, "contract-1");
  assert.strictEqual(lastView, "review");
});

test("handleContractNavClick opens clause", () => {
  global.state = { activeContractId: null, activeClauseId: null, activeUpdateId: "x" };
  const event = mockEvent({ "[data-open-clause]": { dataset: { openClause: "contract-1:clause-1" } } });
  const result = handleContractNavClick(event);
  assert.strictEqual(result, false);
  assert.strictEqual(state.activeContractId, "contract-1");
  assert.strictEqual(state.activeClauseId, "clause-1");
  assert.strictEqual(state.activeUpdateId, null);
});

test("handleContractNavClick returns false when no match", () => {
  const event = mockEvent({});
  const result = handleContractNavClick(event);
  assert.strictEqual(result, false);
});

// --- handleDraftClick ---
test("handleDraftClick creates review from draft", () => {
  global.state = { contracts: [], currentDraft: { title: "草稿合同", text: "内容", type: "技术服务", summary: "摘要", background: "背景", role: "甲方", counterparty: "乙公司" } };
  global.ensureCounterparty = (name) => ({ id: "cp-test", name });
  const event = mockEvent({ "[data-create-review-from-draft]": {} });
  const result = handleDraftClick(event);
  assert.strictEqual(result, false);
  assert.strictEqual(state.contracts.length, 1);
  assert.strictEqual(state.contracts[0].name, "草稿合同");
});

test("handleDraftClick handles reset demo", () => {
  global.state = { contracts: [{ name: "旧合同" }] };
  global.seedData = { contracts: [{ name: "示例合同" }], clauses: [], findings: [], updates: [] };
  global.hydrateContractAnalysis = () => {};
  const event = mockEvent({ "#reset-demo": {} });
  const result = handleDraftClick(event);
  assert.strictEqual(result, false);
  assert.strictEqual(state.contracts[0].name, "示例合同");
});

test("handleDraftClick returns false when no match", () => {
  const event = mockEvent({});
  const result = handleDraftClick(event);
  assert.strictEqual(result, false);
});

summary();
