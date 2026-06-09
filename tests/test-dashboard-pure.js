/**
 * Tests for js/dashboard.js pure functions
 */

const { loadScript, test, summary, assert } = require("./test-helper");

// Mock dependencies
global.escapeHtml = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
global.getDeadlineDeltaDays = () => -1;
global.getLatestFeedbackDeadline = () => "2026-05-30";
global.hasFinalVersion = () => false;
global.isDeadlineUrgent = () => false;
global.state = {
  contracts: [
    { id: "c1", name: "合同A", counterpartyName: "甲公司", type: "技术服务", workflowStatus: "审阅中", owner: "张三" },
    { id: "c2", name: "合同B", counterpartyName: "乙公司", type: "保密协议", workflowStatus: "定稿" },
  ],
  counterparties: [
    { id: "cp1", name: "甲公司", type: "科技公司", industry: "IT", notes: "" },
    { id: "cp2", name: "乙公司", type: "数据公司", industry: "大数据", notes: "" },
  ],
  updates: [
    { id: "u1", contractId: "c1", type: "初稿上传", note: "上传初稿", createdAt: "2026-05-20T10:00:00Z" },
    { id: "u2", contractId: "c2", type: "终稿", note: "上传终稿", createdAt: "2026-05-21T10:00:00Z" },
  ],
  clauses: [
    { id: "cl1", contractId: "c1", title: "第一条 服务范围", type: "服务范围", text: "服务内容" },
  ],
  playbooks: [
    { id: "pb1", type: "保密", standard: "标准文本", fallback: "", forbidden: "", negotiation: "" },
  ],
  legalSkillResults: {},
  aiSuggestionFeedback: [],
  taskFilters: { owner: "", counterpartyId: "" },
  auditLogs: [
    { action: "新建合同", details: { contractName: "合同A" }, createdAt: "2026-05-20T10:00:00Z" },
  ],
  auditLogsCollapsed: true,
  activeContractId: "c1",
  runnerStatus: {
    provider: "codex-cli",
    launcherMode: "codex-cli",
    lastRunState: "succeeded",
    summary: "Agent A healthy",
  },
  runnerStatuses: {
    intake: { provider: "kimi", lastRunState: "fallback", summary: "Intake degraded", promptVersion: "agent-intake-v1", downstreamSkill: "legal-contract-orchestrator", lastFallbackReason: "runner missing" },
    suggestion: { provider: "kimi", lastRunState: "succeeded", summary: "Suggestion healthy", promptVersion: "agent-suggestion-v1", downstreamSkill: "legal-contract-orchestrator" },
    visualQa: { provider: "kimi", lastRunState: "failed", summary: "Visual QA failed", promptVersion: "agent-b-visual-v1", downstreamSkill: "legal-contract-orchestrator" },
  },
};

loadScript("js/dashboard.js");

console.log("\n=== test-dashboard-pure.js ===\n");

// --- buildGlobalSearchResults ---
test("buildGlobalSearchResults finds contracts by name", () => {
  const results = buildGlobalSearchResults("合同A");
  assert.ok(results.some((r) => r.kind === "合同" && r.title === "合同A"));
});

test("buildGlobalSearchResults finds counterparties", () => {
  const results = buildGlobalSearchResults("甲公司");
  assert.ok(results.some((r) => r.kind === "相对方"));
});

test("buildGlobalSearchResults finds updates", () => {
  const results = buildGlobalSearchResults("初稿");
  assert.ok(results.some((r) => r.kind === "版本记录"));
});

test("buildGlobalSearchResults finds clauses", () => {
  const results = buildGlobalSearchResults("服务范围");
  assert.ok(results.some((r) => r.kind === "条款"));
});

test("buildGlobalSearchResults finds playbooks", () => {
  const results = buildGlobalSearchResults("保密");
  assert.ok(results.some((r) => r.kind === "条款库"));
});

test("buildGlobalSearchResults returns empty for no match", () => {
  const results = buildGlobalSearchResults("不存在的关键词");
  assert.strictEqual(results.length, 0);
});

// --- getFeedbackTasks ---
test("getFeedbackTasks returns contracts needing feedback", () => {
  const tasks = getFeedbackTasks();
  assert.ok(tasks.length >= 1);
  assert.ok(tasks.every((t) => !["定稿", "签署"].includes(t.contract.workflowStatus)));
});

test("getFeedbackTasks filters by owner", () => {
  const tasks = getFeedbackTasks({ owner: "张三" });
  assert.ok(tasks.every((t) => (t.contract.owner || "").includes("张三")));
});

// --- getRecentUpdates ---
test("getRecentUpdates returns latest updates", () => {
  const updates = getRecentUpdates(5);
  assert.ok(updates.length <= 5);
  assert.ok(updates.every((u) => u.contract));
});

// --- describeAudit ---
test("describeAudit formats audit details", () => {
  const log = { details: { contractName: "合同A", note: "测试" } };
  const desc = describeAudit(log);
  assert.ok(desc.includes("合同A"));
  assert.ok(desc.includes("测试"));
});

test("describeAudit falls back to default", () => {
  const desc = describeAudit({});
  assert.strictEqual(desc, "本地用户操作");
});

// --- statCard ---
test("statCard renders HTML", () => {
  const html = statCard("总数", 10, "详情");
  assert.ok(html.includes("总数"));
  assert.ok(html.includes("10"));
  assert.ok(html.includes("详情"));
});

// --- globalSearchRow ---
test("globalSearchRow renders contract link", () => {
  const html = globalSearchRow({ kind: "合同", title: "合同A", body: "甲公司", contractId: "c1" });
  assert.ok(html.includes("data-open-contract"));
  assert.ok(html.includes("合同A"));
});

test("renderRunnerDiagnostics renders runner summaries", () => {
  const html = renderRunnerDiagnostics();
  assert.ok(html.includes("Agent A"));
  assert.ok(html.includes("Intake"));
  assert.ok(html.includes("Visual QA"));
  assert.ok(html.includes("fallback"));
  assert.ok(html.includes("prompt=agent-intake-v1"));
  assert.ok(html.includes("skill=legal-contract-orchestrator"));
  assert.ok(html.includes("runner missing"));
});

// --- contractTaskRow ---
test("contractTaskRow renders overdue status", () => {
  global.getDeadlineDeltaDays = () => -1;
  const html = contractTaskRow(global.state.contracts[0], "2026-05-01");
  assert.ok(html.includes("逾期"));
});

test("contractTaskRow renders urgent status", () => {
  global.getDeadlineDeltaDays = () => 0;
  global.isDeadlineUrgent = () => true;
  const html = contractTaskRow(global.state.contracts[0], "2026-05-30");
  assert.ok(html.includes("临期"));
});

summary();
