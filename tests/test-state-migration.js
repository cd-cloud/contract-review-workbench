/**
 * Layer 8: State migration / data compatibility tests
 * Tests normalizeWorkbenchState handles old data formats.
 */

const { loadScript, test, summary, assert } = require("./test-helper");

// Load dependencies in order: playbook.js defines normalizePlaybook used by state.js
loadScript("js/playbook.js");
// Stub ensureInitialUpdate to avoid loading entire app.js
global.ensureInitialUpdate = (targetState, contract) => {
  targetState.updates = targetState.updates || [];
  const exists = targetState.updates.some((item) => item.contractId === contract.id && item.type === "初稿上传");
  if (exists) return;
  targetState.updates.push({
    id: `upd-test`,
    contractId: contract.id,
    type: "初稿上传",
    note: "通过新建审阅上传合同初稿。",
    materialKind: "version",
    versionText: contract.cleanText || contract.text || "",
    acceptedText: contract.cleanText || contract.text || "",
    rejectedText: "",
    revisionText: contract.cleanText || contract.text || "",
    commentsText: "",
    hasClean: true,
    createdAt: new Date().toISOString().slice(0, 10),
  });
};
loadScript("js/state.js");

console.log("\n=== test-state-migration.js ===\n");

// --- normalizeWorkbenchState deep clone ---
test("normalizeWorkbenchState clones input instead of mutating", () => {
  const original = {
    contracts: [{ id: "c1", name: "Test", text: "text", cleanText: "", redlineText: "", commentsText: "" }],
    clauses: [],
    findings: [],
    currentView: "dashboard", // should be deleted
  };
  const originalCopy = JSON.stringify(original);
  const result = normalizeWorkbenchState(original);
  assert.ok(result, "Should return normalized state");
  assert.strictEqual(JSON.stringify(original), originalCopy, "Original should not be mutated");
  assert.strictEqual(result.currentView, undefined, "currentView should be removed from result");
});

test("normalizeWorkbenchState fills missing contract fields", () => {
  const oldState = {
    contracts: [{ id: "c1", name: "Test", text: "content" }],
    clauses: [],
    findings: [],
  };
  const result = normalizeWorkbenchState(oldState);
  const contract = result.contracts[0];
  assert.strictEqual(contract.cleanText, "content", "cleanText should fallback to text");
  assert.strictEqual(contract.redlineText, "", "redlineText should default to empty");
  assert.strictEqual(contract.commentsText, "", "commentsText should default to empty");
  assert.strictEqual(contract.businessBackground, "", "businessBackground should default to empty");
  assert.strictEqual(contract.clauseSource, "draft", "clauseSource should default to draft");
  assert.strictEqual(contract.owner, "", "owner should default to empty");
  assert.strictEqual(contract.workflowStatus, "初审", "workflowStatus should default to 初审");
});

test("normalizeWorkbenchState normalizes update text aliases", () => {
  const oldState = {
    contracts: [{ id: "c1", name: "Test", text: "", cleanText: "" }],
    updates: [{ id: "u1", contractId: "c1", text: "Version body", cleanText: "Clean body" }],
    clauses: [],
    findings: [],
  };
  const result = normalizeWorkbenchState(oldState);
  const update = result.updates.find((item) => item.id === "u1");
  assert.strictEqual(update.versionText, "Version body");
  assert.strictEqual(update.acceptedText, "Clean body");
  assert.strictEqual(update.revisionText, "Version body");
  assert.strictEqual(update.commentsText, "");
});

test("normalizeWorkbenchState initializes missing top-level arrays", () => {
  const minimal = {
    contracts: [{ id: "c1", name: "Test", text: "", cleanText: "" }],
    clauses: [],
    findings: [],
  };
  const result = normalizeWorkbenchState(minimal);
  assert.deepStrictEqual(result.clauseActions, {});
  assert.deepStrictEqual(result.analysisRequests, {});
  assert.deepStrictEqual(result.insertedClauses, {});
  assert.deepStrictEqual(result.insertionAudits, {});
  assert.deepStrictEqual(result.clauseOrder, {});
  assert.deepStrictEqual(result.subclauseOrder, {});
  assert.deepStrictEqual(result.subclauseMoves, []);
  assert.deepStrictEqual(result.subclauseReferenceMap, {});
  assert.deepStrictEqual(result.legalSkillResults, {});
  assert.deepStrictEqual(result.visualQaJobs, {});
  assert.deepStrictEqual(result.visualQaReports, {});
  assert.deepStrictEqual(result.visualQaAutoFixAudits, {});
  assert.deepStrictEqual(result.auditLogs, []);
  assert.deepStrictEqual(result.aiSuggestionFeedback, []);
  assert.deepStrictEqual(result.expandedTreeNodes, {});
  assert.deepStrictEqual(result.readerPaneTabs, {});
  assert.deepStrictEqual(result.contractRiskDecisions, {});
});

test("normalizeWorkbenchState creates initial update for contracts", () => {
  const state = {
    contracts: [{ id: "c1", name: "Test", text: "content", cleanText: "content" }],
    clauses: [],
    findings: [],
  };
  const result = normalizeWorkbenchState(state);
  assert.ok(result.updates && result.updates.length > 0, "Should create initial update");
  assert.strictEqual(result.updates[0].contractId, "c1");
});

test("normalizeWorkbenchState seeds riskRules when missing", () => {
  const state = {
    contracts: [{ id: "c1", name: "Test", text: "", cleanText: "" }],
    clauses: [],
    findings: [],
  };
  const result = normalizeWorkbenchState(state);
  assert.ok(Array.isArray(result.riskRules), "riskRules should be array");
  assert.ok(result.riskRules.length > 0, "riskRules should be seeded");
});

test("normalizeWorkbenchState returns null for invalid input", () => {
  assert.strictEqual(normalizeWorkbenchState(null), null);
  assert.strictEqual(normalizeWorkbenchState({}), null);
  assert.strictEqual(normalizeWorkbenchState({ contracts: [] }), null);
});

test("writeLocalState handles localStorage errors gracefully", () => {
  // Simulate localStorage quota exceeded
  const originalSetItem = localStorage.setItem;
  let errorCaught = false;
  localStorage.setItem = () => { throw new Error("QuotaExceededError"); };
  try {
    writeLocalState({ contracts: [], clauses: [], findings: [] });
    errorCaught = true; // Should not throw because of try-catch
  } finally {
    localStorage.setItem = originalSetItem;
  }
  assert.ok(errorCaught, "writeLocalState should catch and log error instead of throwing");
});

summary();
