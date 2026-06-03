const assert = require("assert");
const { buildFallbackVisualQa, toIssue } = require("../server/visual-qa-adapter");

function test(name, fn) {
  try {
    fn();
    console.log(`  ✔ ${name}`);
  } catch (err) {
    console.error(`  ✖ ${name}`);
    console.error(`    ${err.message}`);
    process.exitCode = 1;
  }
}

console.log("buildFallbackVisualQa");

test("empty checks returns pass status", () => {
  const result = buildFallbackVisualQa({ localChecks: [] });
  assert.strictEqual(result.visualQa.status, "pass");
});

test("high severity returns blocked", () => {
  const result = buildFallbackVisualQa({
    localChecks: [{ severity: "high", type: "numbering", title: "T" }],
  });
  assert.strictEqual(result.visualQa.status, "blocked");
});

test("medium severity returns needs_attention", () => {
  const result = buildFallbackVisualQa({
    localChecks: [{ severity: "medium", type: "reference", title: "T" }],
  });
  assert.strictEqual(result.visualQa.status, "needs_attention");
});

test("mixed severities uses highest", () => {
  const result = buildFallbackVisualQa({
    localChecks: [
      { severity: "low", type: "numbering", title: "L" },
      { severity: "medium", type: "reference", title: "M" },
      { severity: "high", type: "subclause-numbering", title: "H" },
    ],
  });
  assert.strictEqual(result.visualQa.status, "blocked");
});

console.log("toIssue");

test("normalizes valid severity", () => {
  const issue = toIssue({ severity: "high", type: "numbering", title: "T" });
  assert.strictEqual(issue.severity, "high");
});

test("clamps unknown severity to low", () => {
  const issue = toIssue({ severity: "critical", type: "numbering", title: "T" });
  assert.strictEqual(issue.severity, "low");
});

test("preserves message and location", () => {
  const issue = toIssue({
    severity: "medium",
    type: "reference",
    clauseId: "sec-3",
    title: "Ref missing",
    detail: "Detail text",
    recommendation: "Rec text",
  });
  assert.strictEqual(issue.type, "reference");
  assert.strictEqual(issue.targetId, "sec-3");
  assert.strictEqual(issue.title, "Ref missing");
  assert.strictEqual(issue.detail, "Detail text");
  assert.strictEqual(issue.recommendation, "Rec text");
});

console.log("\nAll pure tests completed.");
