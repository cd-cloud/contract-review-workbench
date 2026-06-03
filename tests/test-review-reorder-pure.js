/**
 * Tests for js/review-reorder.js pure-ish functions
 */

const { loadScript, test, summary, assert } = require("./test-helper");

global.state = { subclauseOrder: {}, clauseOrder: {} };
global.getWorkbenchMaterial = () => ({ text: "" });
global.splitVersionClauses = () => [];
global.getSubclauseOrderKey = () => "key";
global.getSubclauseMoveList = () => [];
global.recordAudit = () => {};
global.saveState = () => {};
global.renderReview = () => {};
global.scrollToSubclause = () => {};
global.scrollToWorkbenchClause = () => {};
global.uid = () => "uid";
global.today = () => "2026-01-01";
global.splitSubclauses = (parent) => parent.subclauses || [];

loadScript("js/review-reorder.js");

console.log("\n=== test-review-reorder-pure.js ===\n");

// --- findSubclauseLocation ---

test("findSubclauseLocation: finds location in flat list", () => {
  const clauses = [
    { id: "p1", subclauses: [{ id: "s1", title: "Sub 1" }, { id: "s2", title: "Sub 2" }] },
    { id: "p2", subclauses: [{ id: "s3", title: "Sub 3" }] },
  ];
  const result = findSubclauseLocation(clauses, "s2");
  assert.ok(result);
  assert.strictEqual(result.parent.id, "p1");
  assert.strictEqual(result.subclause.id, "s2");
  assert.strictEqual(result.subclauses.length, 2);
});

test("findSubclauseLocation: returns null when not found", () => {
  const clauses = [
    { id: "p1", subclauses: [{ id: "s1", title: "Sub 1" }] },
  ];
  const result = findSubclauseLocation(clauses, "s99");
  assert.strictEqual(result, null);
});

test("findSubclauseLocation: empty list returns null", () => {
  const result = findSubclauseLocation([], "s1");
  assert.strictEqual(result, null);
});

test("findSubclauseLocation: finds first subclause in first parent", () => {
  const clauses = [
    { id: "p1", subclauses: [{ id: "s1", title: "Sub 1" }, { id: "s2", title: "Sub 2" }] },
    { id: "p2", subclauses: [{ id: "s3", title: "Sub 3" }] },
  ];
  const result = findSubclauseLocation(clauses, "s1");
  assert.ok(result);
  assert.strictEqual(result.parent.id, "p1");
  assert.strictEqual(result.subclause.id, "s1");
  assert.strictEqual(result.subclauses[0].id, "s1");
});

test("findSubclauseLocation: finds subclause in second parent", () => {
  const clauses = [
    { id: "p1", subclauses: [{ id: "s1", title: "Sub 1" }] },
    { id: "p2", subclauses: [{ id: "s2", title: "Sub 2" }, { id: "s3", title: "Sub 3" }] },
  ];
  const result = findSubclauseLocation(clauses, "s3");
  assert.ok(result);
  assert.strictEqual(result.parent.id, "p2");
  assert.strictEqual(result.subclause.id, "s3");
});

summary();
