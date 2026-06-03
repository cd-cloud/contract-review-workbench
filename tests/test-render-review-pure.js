/**
 * Tests for js/render-review.js pure helper functions
 */

const { loadScript, test, summary, assert } = require("./test-helper");

// Minimal globals needed to load render-review.js

global.state = {};
global.views = { review: { querySelector: () => null, querySelectorAll: () => [] } };
global.STALE_JOB_TIMEOUT_MS = 300000;

global.escapeHtml = (value) =>
  String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Stubs for functions render-review.js may reference at load time or indirectly
global.riskLabel = () => "";
global.materialKindLabel = () => "";
global.getContractUpdates = () => [];
global.getActiveMaterial = () => ({ text: "" });
global.splitVersionClauses = () => [];
global.getClauseSegmentationStatus = () => ({});
global.getReaderFilters = () => ({});
global.getClauseRiskSummary = () => [];
global.renderClauseRiskAdvice = () => "";
global.getAdvicePlacementClauses = () => [];
global.renderClauseTreeNode = () => "";
global.renderSubclauseTreeNode = () => "";
global.renderSubclauseStack = () => "";
global.buildClauseIndexGroups = () => [];
global.buildClauseAnalysis = () => ({});
global.buildRedlineDraft = () => "";
global.shouldShowClauseRiskSummary = () => false;
global.renderClauseIndexTabs = () => "";
global.renderClauseBodyWithTrace = () => "";
global.isTreeNodeExpanded = () => false;
global.getSelectedSubclause = () => null;
global.getLatestFeedbackDeadline = () => "";
global.getClauseActions = () => ({});
global.getEditedClauseText = () => "";
global.getEditedClauseTitle = () => "";
global.splitSubclauses = () => [];
global.normalizeText = (t) => t;
global.findHistoricalClauseMatch = () => null;
global.canUseRevisionMode = () => false;
global.getMissingCoreClauseTypes = () => [];
global.renderReviewTimeline = () => "";
global.renderCodexStatusPanel = () => "";
global.renderVisualQaPanel = () => "";
global.renderReviewNextActions = () => "";
global.renderContractStructureOverview = () => "";
global.renderReviewModeControl = () => "";
global.renderMaterialReader = () => "";
global.collectAdviceSidebarItems = () => [];
global.renderAdviceCommentItem = () => "";
global.getClauseAggregateQueueStatus = () => ({});
global.renderCardQuickActions = () => "";
global.renderInlineClauseEditor = () => "";
global.renderDirectClauseEditor = () => "";
global.renderEditableClauseTitle = () => "";
global.stripEditableTitleFromText = () => "";
global.wrapClauseBodyAnchor = () => "";
global.renderInlineClauseCard = () => "";
global.getTitlelessClausePreview = () => "";
global.renderSubclauseCard = () => "";
global.renderClauseAnalysisStatus = () => "";
global.buildClausePositionInfo = () => ({});
global.countHistoricalClauseMatches = () => 0;
global.isCoreClauseType = () => false;
global.findByDataAttribute = () => null;
global.getVisualQaState = () => ({});
global.ensureCodexSegmentation = () => {};
global.resetClauseRiskFindingCache = () => {};
global.renderContractBrief = () => "";
global.setupReviewAdviceScrollSync = () => {};
global.getWorkbenchMaterial = () => ({});
global.buildReviewQueueItems = () => [];

loadScript("js/render-review.js");

console.log("\n=== test-render-review-pure.js ===\n");

// --- latestTimestamp ---
test("latestTimestamp: empty array returns 0", () => {
  assert.strictEqual(latestTimestamp([]), 0);
});

test("latestTimestamp: single value returns its timestamp", () => {
  const ts = latestTimestamp(["2025-01-15T08:00:00.000Z"]);
  assert.strictEqual(ts, new Date("2025-01-15T08:00:00.000Z").getTime());
});

test("latestTimestamp: multiple values returns latest", () => {
  const ts = latestTimestamp([
    "2025-01-10T00:00:00.000Z",
    "2025-01-15T00:00:00.000Z",
    "2025-01-12T00:00:00.000Z",
  ]);
  assert.strictEqual(ts, new Date("2025-01-15T00:00:00.000Z").getTime());
});

test("latestTimestamp: null and undefined values are filtered", () => {
  const ts = latestTimestamp([null, undefined, "2025-06-01T00:00:00.000Z", null]);
  assert.strictEqual(ts, new Date("2025-06-01T00:00:00.000Z").getTime());
});

test("latestTimestamp: invalid date strings are filtered", () => {
  const ts = latestTimestamp(["not-a-date", undefined, "2025-03-01T00:00:00.000Z"]);
  assert.strictEqual(ts, new Date("2025-03-01T00:00:00.000Z").getTime());
});

// --- formatJobStatus ---
test("formatJobStatus: queued returns '已排队'", () => {
  assert.strictEqual(formatJobStatus({ status: "queued" }, "fallback"), "已排队");
});

test("formatJobStatus: running returns '运行中'", () => {
  assert.strictEqual(formatJobStatus({ status: "running" }, "fallback"), "运行中");
});

test("formatJobStatus: completed returns '已完成'", () => {
  assert.strictEqual(formatJobStatus({ status: "completed" }, "fallback"), "已完成");
});

test("formatJobStatus: failed returns '失败'", () => {
  assert.strictEqual(formatJobStatus({ status: "failed" }, "fallback"), "失败");
});

test("formatJobStatus: unknown status returns the status string itself", () => {
  assert.strictEqual(formatJobStatus({ status: "unknown" }, "fallback"), "unknown");
});

test("formatJobStatus: falsy status returns fallback", () => {
  assert.strictEqual(formatJobStatus({ status: "" }, "fallback"), "fallback");
});

test("formatJobStatus: missing job returns fallback", () => {
  assert.strictEqual(formatJobStatus(null, "fallback"), "fallback");
});

test("formatJobStatus: job with message returns message", () => {
  assert.strictEqual(formatJobStatus({ status: "running", message: "自定义消息" }, "fallback"), "自定义消息");
});

// --- jobTone ---
test("jobTone: failed returns 'medium'", () => {
  assert.strictEqual(jobTone({ status: "failed" }), "medium");
});

test("jobTone: completed returns 'low'", () => {
  assert.strictEqual(jobTone({ status: "completed" }), "low");
});

test("jobTone: running returns 'medium'", () => {
  assert.strictEqual(jobTone({ status: "running" }), "medium");
});

test("jobTone: queued returns 'medium'", () => {
  assert.strictEqual(jobTone({ status: "queued" }), "medium");
});

test("jobTone: null returns 'low'", () => {
  assert.strictEqual(jobTone(null), "low");
});

// --- buildCodexWorkflowSteps ---
test("buildCodexWorkflowSteps: all pending when no status fields", () => {
  const steps = buildCodexWorkflowSteps({});
  assert.strictEqual(steps.length, 5);
  steps.forEach((step) => assert.strictEqual(step.status, "pending"));
});

test("buildCodexWorkflowSteps: segmentation running sets step 2 to running", () => {
  const steps = buildCodexWorkflowSteps({ segmentation: { status: "running" } });
  assert.strictEqual(steps[1].label, "切分条款");
  assert.strictEqual(steps[1].status, "running");
  assert.strictEqual(steps[1].text, "进行中");
});

test("buildCodexWorkflowSteps: analysis running sets steps 1, 3, 4 to running", () => {
  const steps = buildCodexWorkflowSteps({ analysis: { status: "running" } });
  assert.strictEqual(steps[0].status, "running");
  assert.strictEqual(steps[2].status, "running");
  assert.strictEqual(steps[3].status, "running");
  assert.strictEqual(steps[0].text, "进行中");
});

test("buildCodexWorkflowSteps: legalResult present sets steps 1, 3, 4 to done", () => {
  const steps = buildCodexWorkflowSteps({ legalResult: { response: { clauseSegmentation: [1] } } });
  assert.strictEqual(steps[0].status, "done");
  assert.strictEqual(steps[2].status, "done");
  assert.strictEqual(steps[3].status, "done");
});

test("buildCodexWorkflowSteps: visual completed sets step 5 to done", () => {
  const steps = buildCodexWorkflowSteps({ visual: { status: "completed" } });
  assert.strictEqual(steps[4].status, "done");
  assert.strictEqual(steps[4].text, "已检查");
});

// --- getClauseQueueStatus ---
test("getClauseQueueStatus: risk high sets high flag", () => {
  const q = getClauseQueueStatus({ severity: "high" }, {});
  assert.strictEqual(q.high, true);
  assert.strictEqual(q.ai, false);
  assert.strictEqual(q.edited, false);
});

test("getClauseQueueStatus: risk fix + medium sets ai flag", () => {
  const q = getClauseQueueStatus({ severity: "medium", fix: "something" }, {});
  assert.strictEqual(q.ai, true);
  assert.strictEqual(q.high, false);
});

test("getClauseQueueStatus: risk fix + high sets both high and ai", () => {
  const q = getClauseQueueStatus({ severity: "high", fix: "something" }, {});
  assert.strictEqual(q.high, true);
  assert.strictEqual(q.ai, true);
});

test("getClauseQueueStatus: low severity does not set ai even with fix", () => {
  const q = getClauseQueueStatus({ severity: "low", fix: "something" }, {});
  assert.strictEqual(q.ai, false);
});

test("getClauseQueueStatus: action flags mapped correctly", () => {
  const q = getClauseQueueStatus({}, { editedText: "x", comment: "y", deleted: true });
  assert.strictEqual(q.edited, true);
  assert.strictEqual(q.commented, true);
  assert.strictEqual(q.deleted, true);
});

test("getClauseQueueStatus: all false when empty", () => {
  const q = getClauseQueueStatus({}, {});
  assert.strictEqual(q.high, false);
  assert.strictEqual(q.ai, false);
  assert.strictEqual(q.edited, false);
  assert.strictEqual(q.commented, false);
  assert.strictEqual(q.deleted, false);
});

// --- extractClauseDomOrder ---
test("extractClauseDomOrder: seg-1 returns 1000", () => {
  assert.strictEqual(extractClauseDomOrder("c:seg-1"), 1000);
});

test("extractClauseDomOrder: seg-10 returns 10000", () => {
  assert.strictEqual(extractClauseDomOrder("c:seg-10"), 10000);
});

test("extractClauseDomOrder: seg-1::sub-2 returns 1002", () => {
  assert.strictEqual(extractClauseDomOrder("c:seg-1::sub-2"), 1002);
});

test("extractClauseDomOrder: non-matching returns undefined", () => {
  assert.strictEqual(extractClauseDomOrder("clause-1"), undefined);
});

test("extractClauseDomOrder: empty string returns undefined", () => {
  assert.strictEqual(extractClauseDomOrder(""), undefined);
});

// --- cssEscapeValue ---
test("cssEscapeValue: normal string unchanged", () => {
  assert.strictEqual(cssEscapeValue("abc123"), "abc123");
});

test("cssEscapeValue: escapes quotes and backslashes when CSS.escape unavailable", () => {
  const original = global.window.CSS;
  global.window.CSS = undefined;
  assert.strictEqual(cssEscapeValue('a"b\\c'), 'a\\"b\\\\c');
  global.window.CSS = original;
});

test("cssEscapeValue: empty string handled", () => {
  assert.strictEqual(cssEscapeValue(""), "");
});

test("cssEscapeValue: uses window.CSS.escape when available", () => {
  const original = global.window.CSS;
  global.window.CSS = { escape: (v) => `escaped:${v}` };
  assert.strictEqual(cssEscapeValue("test"), "escaped:test");
  global.window.CSS = original;
});

summary();
