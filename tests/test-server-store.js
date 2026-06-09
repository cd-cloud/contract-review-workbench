/**
 * Layer 7-A: Server store tests
 * Tests server/store.js: flattenClauseActions, readDb, writeDb, replaceDb, saveFile
 */

const fs = require("fs");
const path = require("path");
const assert = require("assert");

// Use a temp directory for tests
const TEST_DATA_DIR = path.join(__dirname, ".tmp-test-store");
fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
process.env.LEGAL_WORKBENCH_DATA_DIR = TEST_DATA_DIR;

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

async function testAsync(name, fn) {
  totalTests++;
  try {
    await fn();
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
    clauses: [{ id: "clause-1", contractId: "c1", versionId: "u1", title: "Clause 1", text: "Body" }],
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

test("readDb preserves auxiliary frontend state while using structured data as source of truth", () => {
  store.replaceDb({
    activeContractId: "c-aux",
    visualQaReports: { "c-aux:u1": { checkedAt: "2026-06-08T00:00:00.000Z", issues: [] } },
    contracts: [{ id: "c-aux", name: "Authoritative Contract", createdAt: "2026-06-08" }],
    updates: [{ id: "u1", contractId: "c-aux", createdAt: "2026-06-08" }],
    clauses: [],
    findings: [],
    counterparties: [],
    negotiations: [],
    playbooks: [],
    riskRules: [],
    auditLogs: [],
    users: [{ id: "local-admin", name: "Local Admin", role: "admin", permissions: ["contracts:read"] }],
  });

  const db = store.readDb();
  assert.strictEqual(db.snapshot.activeContractId, "c-aux");
  assert.ok(db.snapshot.visualQaReports["c-aux:u1"]);
  assert.strictEqual(db.snapshot.contracts[0].name, "Authoritative Contract");
  assert.strictEqual(db.snapshot.storageMeta.persistedVia, "sqlite-structured");
});

test("saveContractFile avoids overwriting duplicate original names", () => {
  const seed = store.replaceDb({
    contracts: [{ id: "c-files", name: "Files Test", counterpartyName: "Acme", createdAt: "2026-06-08" }],
    updates: [],
    clauses: [],
    findings: [],
    counterparties: [],
    negotiations: [],
    playbooks: [],
    riskRules: [],
    auditLogs: [],
    users: [],
  });
  assert.ok(seed.contracts.length === 1);

  const first = store.saveContractFile("c-files", null, Buffer.from("first"), "same-name.docx", "application/octet-stream", "attachment");
  const second = store.saveContractFile("c-files", null, Buffer.from("second"), "same-name.docx", "application/octet-stream", "attachment");
  assert.notStrictEqual(first.path, second.path);
  assert.notStrictEqual(first.name, second.name);
  assert.strictEqual(fs.readFileSync(first.path, "utf8"), "first");
  assert.strictEqual(fs.readFileSync(second.path, "utf8"), "second");

  store.deleteFile(first.id);
  store.deleteFile(second.id);
});

test("replaceDb prunes orphaned archived files when contracts disappear", () => {
  store.replaceDb({
    contracts: [{ id: "c-prune", name: "Prune Test", counterpartyName: "Acme", createdAt: "2026-06-08" }],
    updates: [{ id: "u-prune", contractId: "c-prune", createdAt: "2026-06-08" }],
    clauses: [],
    findings: [],
    counterparties: [],
    negotiations: [],
    playbooks: [],
    riskRules: [],
    auditLogs: [],
    users: [],
  });
  const saved = store.saveContractFile("c-prune", "u-prune", Buffer.from("prune-me"), "prune.docx", "application/octet-stream", "version");
  assert.ok(fs.existsSync(saved.path));

  store.replaceDb({
    contracts: [],
    updates: [],
    clauses: [],
    findings: [],
    counterparties: [],
    negotiations: [],
    playbooks: [],
    riskRules: [],
    auditLogs: [],
    users: [],
  });

  assert.strictEqual(store.getFileById(saved.id), null);
  assert.strictEqual(fs.existsSync(saved.path), false);
});

async function runAsyncTests() {
  await testAsync("backup sqlite can be reopened independently for restore inspection", async () => {
    store.replaceDb({
      contracts: [{ id: "c-restore", name: "Restore Test", counterpartyName: "Acme", createdAt: "2026-06-08" }],
      updates: [{ id: "u-restore", contractId: "c-restore", createdAt: "2026-06-08", text: "restore body" }],
      clauses: [],
      findings: [],
      counterparties: [],
      negotiations: [],
      playbooks: [],
      riskRules: [],
      auditLogs: [],
      users: [],
    });
    const uploaded = store.saveContractFile("c-restore", "u-restore", Buffer.from("restore-me"), "restore.docx", "application/octet-stream", "version");
    const backupPath = await store.runAutoBackup();
    const backupDb = require("better-sqlite3")(path.join(backupPath, "workbench.sqlite"), { readonly: true });
    const contractRow = backupDb.prepare("SELECT id, name FROM contracts WHERE id = ?").get("c-restore");
    const fileRows = backupDb.prepare("SELECT contract_id, version_id, original_name FROM files WHERE contract_id = ?").all("c-restore");
    backupDb.close();

    assert.ok(contractRow);
    assert.strictEqual(contractRow.name, "Restore Test");
    assert.ok(fileRows.some((row) => row.version_id === "u-restore" && row.original_name === "restore.docx"));

    store.deleteFile(uploaded.id);
  });

  await testAsync("restoreBackupToDirectory recreates sqlite and archive content in a new root", async () => {
    store.replaceDb({
      contracts: [{ id: "c-restore-copy", name: "Restore Copy Test", counterpartyName: "Acme", createdAt: "2026-06-08" }],
      updates: [{ id: "u-restore-copy", contractId: "c-restore-copy", createdAt: "2026-06-08", text: "restore body" }],
      clauses: [],
      findings: [],
      counterparties: [],
      negotiations: [],
      playbooks: [],
      riskRules: [],
      auditLogs: [],
      users: [],
    });
    const uploaded = store.saveContractFile("c-restore-copy", "u-restore-copy", Buffer.from("restore-copy"), "restore-copy.docx", "application/octet-stream", "version");
    const backupPath = await store.runAutoBackup();
    const restoreRoot = path.join(__dirname, ".tmp-restore-target");
    const restored = store.restoreBackupToDirectory(backupPath, restoreRoot);
    const restoredDb = require("better-sqlite3")(restored.database, { readonly: true });
    const contractRow = restoredDb.prepare("SELECT id, name FROM contracts WHERE id = ?").get("c-restore-copy");
    const fileRow = restoredDb.prepare("SELECT original_name FROM files WHERE contract_id = ?").get("c-restore-copy");
    restoredDb.close();

    assert.ok(contractRow);
    assert.strictEqual(contractRow.name, "Restore Copy Test");
    assert.ok(fileRow);
    assert.strictEqual(fileRow.original_name, "restore-copy.docx");
    const restoredDocxFiles = fs.readdirSync(restored.contractsDir, { recursive: true }).filter((entry) => String(entry).endsWith(".docx"));
    assert.ok(restoredDocxFiles.length >= 1);

    store.deleteFile(uploaded.id);
  });

  await testAsync("runAutoBackup includes sqlite and archive folders", async () => {
  store.replaceDb({
    contracts: [{ id: "c-backup", name: "Backup Test", counterpartyName: "Acme", createdAt: "2026-06-08" }],
    updates: [],
    clauses: [],
    findings: [],
    counterparties: [],
    negotiations: [],
    playbooks: [],
    riskRules: [],
    auditLogs: [],
    users: [],
  });
  const uploaded = store.saveContractFile("c-backup", null, Buffer.from("backup-file"), "backup.docx", "application/octet-stream", "attachment");
  const backupPath = await store.runAutoBackup();

  assert.ok(fs.existsSync(backupPath));
  assert.ok(fs.existsSync(path.join(backupPath, "workbench.sqlite")));
  assert.ok(fs.existsSync(path.join(backupPath, "contracts")));
  assert.ok(fs.existsSync(path.join(backupPath, "manifest.json")));
  const backupSqlite = require("better-sqlite3")(path.join(backupPath, "workbench.sqlite"));
  const backupContractCount = backupSqlite.prepare("SELECT COUNT(*) as c FROM contracts").get().c;
  backupSqlite.close();
  assert.ok(backupContractCount >= 1);
  const backedUpAttachmentDir = path.join(backupPath, "contracts");
  const backedUpFiles = fs.readdirSync(backedUpAttachmentDir, { recursive: true }).filter((entry) => String(entry).endsWith(".docx"));
  assert.ok(backedUpFiles.length >= 1);

  store.deleteFile(uploaded.id);
});
}

runAsyncTests().then(() => {
  const failed = totalTests - passedTests;
  process.stdout.write(`\n${passedTests}/${totalTests} passed${failed ? `, ${failed} failed` : ""}\n`);
  if (failed) {
    process.stdout.write(`\nFailed tests:\n`);
    failedTests.forEach(({ name, error }) => {
      process.stdout.write(`  - ${name}: ${error.message}\n`);
    });
    process.exit(1);
  }
});
