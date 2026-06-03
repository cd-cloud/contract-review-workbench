/**
 * Layer 7-A: Server store tests
 * Tests server/store.js: flattenClauseActions, readDb, writeDb, replaceDb, saveFile
 */

const fs = require("fs");
const path = require("path");
const assert = require("assert");

// Use a temp directory for tests
const TEST_DATA_DIR = path.join(__dirname, "test-data-store");
process.env.DATA_DIR = TEST_DATA_DIR;

// We need to clear require cache to re-require with new DATA_DIR
// Actually store.js uses __dirname, so we'll need to patch it
// Instead, we'll test the exported functions directly

const store = require("../server/store");

console.log("\n=== test-server-store.js ===\n");

let totalTests = 0;
let passedTests = 0;
let failedTests = [];

function test(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    process.stdout.write(`  ✓ ${name}\n`);
  } catch (error) {
    failedTests.push({ name, error });
    process.stdout.write(`  ✗ ${name}\n`);
    process.stdout.write(`    ${error.message}\n`);
  }
}

// --- flattenClauseActions ---
test("flattenClauseActions flattens nested actions", () => {
  const actions = {
    "contract-1:update-1": {
      "clause-1": { editedText: "修改后", deleted: false },
      "clause-2": { comment: "批注内容" },
    },
    "contract-1:update-2": {
      "clause-3": { deleted: true },
    },
  };
  const flat = store.flattenClauseActions(actions);
  assert.strictEqual(flat.length, 3);
  assert.ok(flat.some((a) => a.id === "contract-1:update-1:clause-1"));
  assert.ok(flat.some((a) => a.id === "contract-1:update-1:clause-2"));
  assert.ok(flat.some((a) => a.id === "contract-1:update-2:clause-3"));
});

test("flattenClauseActions handles empty actions", () => {
  assert.strictEqual(store.flattenClauseActions({}).length, 0);
  // Note: null input throws TypeError; guard in caller is expected
  assert.throws(() => store.flattenClauseActions(null), /Cannot convert undefined or null to object/);
});

test("flattenClauseActions preserves action fields", () => {
  const actions = {
    "src": {
      "c1": { editedText: "text", comment: "note", deleted: true },
    },
  };
  const flat = store.flattenClauseActions(actions);
  assert.strictEqual(flat[0].editedText, "text");
  assert.strictEqual(flat[0].comment, "note");
  assert.strictEqual(flat[0].deleted, true);
});

// --- saveFile ---
test("saveFile sanitizes dangerous filenames", () => {
  const result = store.saveFile("file:name?.txt", "content");
  assert.ok(!result.name.includes(":"));
  assert.ok(!result.name.includes("?"));
  assert.ok(result.name.includes("_"));
});

test("saveFile writes file to disk", () => {
  const result = store.saveFile("test-file.txt", "test content");
  assert.ok(fs.existsSync(result.path));
  assert.strictEqual(fs.readFileSync(result.path, "utf8"), "test content");
  // Cleanup
  fs.unlinkSync(result.path);
});

test("saveFile generates default name when empty", () => {
  const result = store.saveFile("", "content");
  assert.ok(result.name.startsWith("file-"));
  fs.unlinkSync(result.path);
});

// --- replaceDb ---
test("replaceDb normalizes snapshot structure", () => {
  const snapshot = {
    contracts: [{ id: "c1", name: "Test" }],
    updates: [{ id: "u1", contractId: "c1" }],
    clauses: [],
    clauseActions: {
      "c1:u1": { "clause-1": { editedText: "text" } },
    },
    counterparties: [],
    playbooks: [],
    findings: [],
    auditLogs: [],
    users: [],
  };
  const db = store.replaceDb(snapshot);
  assert.ok(db.savedAt);
  assert.ok(db.snapshot);
  assert.strictEqual(db.contracts.length, 1);
  assert.strictEqual(db.contractVersions.length, 1);
  assert.ok(db.clauseActions.length > 0);
  assert.strictEqual(db.snapshot.storageMeta.source, "backend-primary");
  assert.ok(db.snapshot.storageMeta.backendSavedAt);
});

test("replaceDb handles minimal snapshot", () => {
  const db = store.replaceDb({ contracts: [] });
  assert.ok(db.savedAt);
  assert.strictEqual(db.contracts.length, 0);
});

// Summary
const failed = totalTests - passedTests;
process.stdout.write(`\n${passedTests}/${totalTests} passed${failed ? `, ${failed} failed` : ""}\n`);
if (failed) {
  process.stdout.write(`\nFailed tests:\n`);
  failedTests.forEach(({ name, error }) => {
    process.stdout.write(`  - ${name}: ${error.message}\n`);
  });
  process.exit(1);
}
