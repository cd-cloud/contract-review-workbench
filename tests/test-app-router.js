/**
 * Tests for js/app-router.js
 */

const { loadScript, test, summary, assert } = require("./test-helper");

// Mock render functions before loading router
global.renderDashboard = () => {};
global.renderContracts = () => {};
global.renderReview = () => {};
global.renderDrafting = () => {};
global.renderPlaybooks = () => {};
global.renderCounterparties = () => {};
global.saveState = () => {};

// Mock DOM
global.document = {
  body: {
    classList: {
      classes: {},
      toggle(name, force) { this.classes[name] = force !== undefined ? force : !this.classes[name]; },
      remove(...names) { names.forEach((n) => delete this.classes[n]); },
      contains(name) { return !!this.classes[name]; },
    },
  },
  querySelector: (sel) => {
    if (sel === "#dashboard-view") return { classList: { toggle: () => {} } };
    if (sel === "#contracts-view") return { classList: { toggle: () => {} } };
    if (sel === "#review-view") return { classList: { toggle: () => {} } };
    if (sel === "#drafting-view") return { classList: { toggle: () => {} } };
    if (sel === "#playbooks-view") return { classList: { toggle: () => {} } };
    if (sel === "#counterparties-view") return { classList: { toggle: () => {} } };
    if (sel === "#view-title") return { textContent: "" };
    if (sel === "#view-subtitle") return { textContent: "" };
    if (sel === ".nav-item") return null;
    if (sel === "[data-toggle-sidebar]") return { setAttribute: () => {} };
    return null;
  },
  querySelectorAll: (sel) => {
    if (sel === ".nav-item") {
      return [
        { dataset: { view: "dashboard" }, classList: { toggle: () => {} } },
        { dataset: { view: "review" }, classList: { toggle: () => {} } },
      ];
    }
    return [];
  },
};

loadScript("js/app-router.js");

console.log("\n=== test-app-router.js ===\n");

// --- getCurrentViewName ---
test("getCurrentViewName returns current view", () => {
  // currentViewName is set in app-router.js to "dashboard"
  assert.strictEqual(getCurrentViewName(), "dashboard");
});

// --- setView ---
test("setView updates currentViewName", () => {
  setView("review");
  assert.strictEqual(getCurrentViewName(), "review");
  // Reset back
  setView("dashboard");
});

test("setView toggles review-nav-collapsed class", () => {
  setView("review");
  assert.strictEqual(document.body.classList.contains("review-nav-collapsed"), true);
  setView("dashboard");
  assert.strictEqual(document.body.classList.contains("review-nav-collapsed"), false);
});

// --- toggleTreeNodeExpansion ---
test("toggleTreeNodeExpansion toggles node state", () => {
  global.state = { expandedTreeNodes: {} };
  toggleTreeNodeExpansion("node-1");
  assert.strictEqual(state.expandedTreeNodes["node-1"], true);
  toggleTreeNodeExpansion("node-1");
  assert.strictEqual(state.expandedTreeNodes["node-1"], false);
});

test("toggleTreeNodeExpansion guards empty id", () => {
  global.state = { expandedTreeNodes: {} };
  toggleTreeNodeExpansion("");
  assert.deepStrictEqual(state.expandedTreeNodes, {});
  toggleTreeNodeExpansion(null);
  assert.deepStrictEqual(state.expandedTreeNodes, {});
});

// --- focusWorkbenchClause ---
test("focusWorkbenchClause updates active clause", () => {
  global.state = { activeWorkbenchClauseId: null };
  global.saveState = () => {};
  global.renderReview = () => {};
  global.scrollToWorkbenchClause = () => {};
  focusWorkbenchClause("clause-1");
  assert.strictEqual(state.activeWorkbenchClauseId, "clause-1");
});

// --- focusWorkbenchSubclause ---
test("focusWorkbenchSubclause updates active subclause", () => {
  global.state = { expandedTreeNodes: {}, activeWorkbenchClauseId: null, activeSubclauseId: null };
  global.saveState = () => {};
  global.renderReview = () => {};
  global.scrollToSubclause = () => {};
  focusWorkbenchSubclause("parent-1", "parent-1::sub-1");
  assert.strictEqual(state.activeSubclauseId, "parent-1::sub-1");
  assert.strictEqual(state.activeWorkbenchClauseId, "parent-1");
  assert.strictEqual(state.expandedTreeNodes["parent-1"], true);
});

summary();
