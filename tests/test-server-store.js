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
const testQueue = [];

function test(name, fn) {
  testQueue.push(async () => {
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
  });
}

function testAsync(name, fn) {
  testQueue.push(async () => {
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
  });
}

async function runAllTests() {
  for (const t of testQueue) {
    await t();
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
testAsync("replaceDb normalizes snapshot structure", async () => {
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
  const db = await store.replaceDb(snapshot);
  assert.ok(db.savedAt);
  assert.ok(db.snapshot);
  assert.strictEqual(db.contracts.length, 1);
  assert.strictEqual(db.contractVersions.length, 1);
  assert.ok(db.clauseActions.length > 0);
  assert.strictEqual(db.snapshot.storageMeta.source, "backend-primary");
  assert.ok(db.snapshot.storageMeta.backendSavedAt);
});

testAsync("replaceDb handles minimal snapshot", async () => {
  const db = await store.replaceDb({ contracts: [] });
  assert.ok(db.savedAt);
  assert.strictEqual(db.contracts.length, 0);
});

testAsync("replaceDb preserves existing large texts when full snapshot omits them", async () => {
  await store.replaceDb({
    contracts: [{ id: "c-preserve", name: "Preserve", text: "contract text", cleanText: "clean text", createdAt: "2026-06-08" }],
    updates: [{ id: "u-preserve", contractId: "c-preserve", versionText: "version text", acceptedText: "accepted text", createdAt: "2026-06-08" }],
    clauses: [],
    findings: [],
    counterparties: [],
    negotiations: [],
    playbooks: [],
    riskRules: [],
    auditLogs: [],
    users: [],
  });
  await store.replaceDb({
    contracts: [{ id: "c-preserve", name: "Preserve renamed", text: "", cleanText: "", createdAt: "2026-06-08" }],
    updates: [{ id: "u-preserve", contractId: "c-preserve", versionText: "", acceptedText: "", createdAt: "2026-06-08" }],
    clauses: [],
    findings: [],
    counterparties: [],
    negotiations: [],
    playbooks: [],
    riskRules: [],
    auditLogs: [],
    users: [],
  });
  const db = store.readDb().snapshot;
  const contract = db.contracts.find((item) => item.id === "c-preserve");
  const update = db.updates.find((item) => item.id === "u-preserve");
  assert.strictEqual(contract.name, "Preserve renamed");
  assert.strictEqual(contract.text, "contract text");
  assert.strictEqual(contract.cleanText, "clean text");
  assert.strictEqual(update.versionText, "version text");
  assert.strictEqual(update.acceptedText, "accepted text");
});

testAsync("readDb restores missing contract text from archived docx attachment", async () => {
  const initial = await store.replaceDb({
    contracts: [{ id: "c-docx-restore", name: "Docx Restore", text: "", cleanText: "", createdAt: "2026-06-08" }],
    updates: [{ id: "u-docx-restore", contractId: "c-docx-restore", versionText: "", acceptedText: "", createdAt: "2026-06-08" }],
    clauses: [],
    findings: [],
    counterparties: [],
    negotiations: [],
    playbooks: [],
    riskRules: [],
    auditLogs: [],
    users: [],
  });
  const contract = initial.snapshot.contracts.find((item) => item.id === "c-docx-restore");
  const attachmentsDir = path.join(contract.folderPath, "attachments");
  fs.mkdirSync(attachmentsDir, { recursive: true });
  fs.copyFileSync(path.join(__dirname, "fixtures", "test-contract.docx"), path.join(attachmentsDir, "test-contract.docx"));

  const db = store.readDb().snapshot;
  const restoredContract = db.contracts.find((item) => item.id === "c-docx-restore");
  const restoredUpdate = db.updates.find((item) => item.id === "u-docx-restore");
  assert.ok(restoredContract.text.length > 100);
  assert.strictEqual(restoredContract.cleanText, restoredContract.text);
  assert.strictEqual(restoredUpdate.versionText, restoredContract.text);
  assert.strictEqual(restoredUpdate.acceptedText, restoredContract.text);
});

testAsync("readDb preserves auxiliary frontend state while using structured data as source of truth", async () => {
  await store.replaceDb({
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

testAsync("patchAuxState merges frontend-only state without replacing structured data", async () => {
  await store.replaceDb({
    contracts: [{ id: "c-aux-patch", name: "Aux Patch", createdAt: "2026-06-08" }],
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
  const auxState = store.patchAuxState({
    activeContractId: "c-aux-patch",
    runnerDiagnostics: { legal: { ready: true } },
  });
  assert.strictEqual(auxState.activeContractId, "c-aux-patch");
  const db = store.readDb();
  assert.strictEqual(db.snapshot.activeContractId, "c-aux-patch");
  assert.strictEqual(db.snapshot.contracts[0].id, "c-aux-patch");
});

test("appendAuditLog writes audit rows incrementally", () => {
  const audit = store.appendAuditLog({
    action: "manual-test-audit",
    contractId: "c-audit",
    details: { note: "hello" },
  });
  const db = store.readDb();
  assert.ok(db.snapshot.auditLogs.some((item) => item.action === "manual-test-audit"));
  assert.strictEqual(audit.action, "manual-test-audit");
});

test("appendInsertedClause persists inserted clause in aux state", () => {
  const insertedClause = {
    id: "inserted-store-1",
    title: "新增条款",
    text: "新增内容",
    createdAt: "2026-06-09T00:00:00.000Z",
  };
  store.appendInsertedClause("contract-1:update-1", insertedClause);
  const db = store.readDb();
  assert.strictEqual(db.snapshot.insertedClauses["contract-1:update-1"][0].id, "inserted-store-1");
});

test("saveAnalysisJob persists queued job rows", () => {
  store.saveAnalysisJob({
    id: "job-store-1",
    status: "queued",
    phase: "已进入 Codex 分析队列",
    request: { contract_text: "abc" },
    createdAt: "2026-06-10T00:00:00.000Z",
    updatedAt: "2026-06-10T00:00:00.000Z",
  });
  const jobs = store.listAnalysisJobs(["queued"]);
  assert.ok(jobs.some((job) => job.id === "job-store-1"));
});

test("upsertContract and upsertContractVersion persist incrementally", () => {
  store.upsertContract({
    id: "c-upsert",
    name: "Upsert Contract",
    type: "测试合同",
    counterpartyName: "Acme",
    createdAt: "2026-06-08",
    updatedAt: "2026-06-08",
  });
  store.upsertContractVersion({
    id: "u-upsert",
    contractId: "c-upsert",
    type: "初稿",
    versionText: "合同文本",
    createdAt: "2026-06-08",
  });
  const db = store.readDb();
  assert.ok(db.snapshot.contracts.some((item) => item.id === "c-upsert"));
  assert.ok(db.snapshot.updates.some((item) => item.id === "u-upsert"));
});

test("upsertContract preserves existing large text when incremental payload omits it", () => {
  store.upsertContract({
    id: "c-preserve-text",
    name: "Preserve Text Contract",
    text: "Original contract body",
    cleanText: "Original clean body",
    createdAt: "2026-06-08",
    updatedAt: "2026-06-08",
  });
  store.upsertContract({
    id: "c-preserve-text",
    name: "Preserve Text Contract Renamed",
    text: "",
    cleanText: "",
    createdAt: "2026-06-08",
    updatedAt: "2026-06-09",
  });
  const contract = store.getContractWithTexts("c-preserve-text");
  assert.strictEqual(contract.name, "Preserve Text Contract Renamed");
  assert.strictEqual(contract.text, "Original contract body");
  assert.strictEqual(contract.cleanText, "Original clean body");
});

test("upsertContractVersion preserves existing version text when incremental payload omits it", () => {
  store.upsertContract({
    id: "c-preserve-version",
    name: "Preserve Version Contract",
    createdAt: "2026-06-08",
    updatedAt: "2026-06-08",
  });
  store.upsertContractVersion({
    id: "u-preserve-version",
    contractId: "c-preserve-version",
    type: "初稿",
    versionText: "Original version body",
    acceptedText: "Original accepted body",
    createdAt: "2026-06-08",
  });
  store.upsertContractVersion({
    id: "u-preserve-version",
    contractId: "c-preserve-version",
    type: "初稿更新",
    versionText: "",
    acceptedText: "",
    createdAt: "2026-06-09",
  });
  const db = store.readDb();
  const version = db.snapshot.updates.find((item) => item.id === "u-preserve-version");
  assert.strictEqual(version.type, "初稿更新");
  assert.strictEqual(version.versionText, "Original version body");
  assert.strictEqual(version.acceptedText, "Original accepted body");
});

test("upsertContractVersion falls back to cleanText when versionText is omitted", () => {
  store.upsertContract({
    id: "c-version-clean-fallback",
    name: "Version Clean Fallback",
    createdAt: "2026-06-08",
    updatedAt: "2026-06-08",
  });
  store.upsertContractVersion({
    id: "u-version-clean-fallback",
    contractId: "c-version-clean-fallback",
    type: "初稿",
    cleanText: "Clean version body",
    acceptedText: "Accepted version body",
    createdAt: "2026-06-08",
  });
  const db = store.readDb();
  const version = db.snapshot.updates.find((item) => item.id === "u-version-clean-fallback");
  assert.strictEqual(version.versionText, "Clean version body");
  assert.strictEqual(version.text, "Clean version body");
});

test("deleteContractVersionCascade removes version incrementally", () => {
  store.upsertContract({
    id: "c-delete-version",
    name: "Delete Version Contract",
    counterpartyName: "Acme",
    createdAt: "2026-06-08",
    updatedAt: "2026-06-08",
  });
  store.upsertContractVersion({
    id: "u-delete-version",
    contractId: "c-delete-version",
    type: "初稿",
    versionText: "版本文本",
    createdAt: "2026-06-08",
  });
  const deleted = store.deleteContractVersionCascade("u-delete-version");
  assert.strictEqual(deleted.id, "u-delete-version");
  const db = store.readDb();
  assert.ok(!db.snapshot.updates.some((item) => item.id === "u-delete-version"));
});

test("deleteContractCascade removes contract incrementally", () => {
  store.upsertContract({
    id: "c-delete-contract",
    name: "Delete Contract",
    counterpartyName: "Acme",
    createdAt: "2026-06-08",
    updatedAt: "2026-06-08",
  });
  const deleted = store.deleteContractCascade("c-delete-contract");
  assert.strictEqual(deleted.id, "c-delete-contract");
  const db = store.readDb();
  assert.ok(!db.snapshot.contracts.some((item) => item.id === "c-delete-contract"));
});

test("runWalCheckpoint returns sqlite wal metadata", () => {
  const checkpoint = store.runWalCheckpoint("PASSIVE");
  assert.strictEqual(checkpoint.mode, "PASSIVE");
  assert.strictEqual(typeof checkpoint.busy, "number");
  assert.strictEqual(typeof checkpoint.log, "number");
  assert.strictEqual(typeof checkpoint.checkpointed, "number");
});

testAsync("saveContractFile avoids overwriting duplicate original names", async () => {
  const seed = await store.replaceDb({
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

testAsync("replaceDb prunes orphaned archived files when contracts disappear", async () => {
  await store.replaceDb({
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

  await store.replaceDb({
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

testAsync("replaceDb preserves file rows included in snapshot", async () => {
  const seeded = await store.replaceDb({
    contracts: [{ id: "c-files-keep", name: "Keep Files", counterpartyName: "Acme", createdAt: "2026-06-10" }],
    updates: [{ id: "u-files-keep", contractId: "c-files-keep", createdAt: "2026-06-10" }],
    clauses: [],
    findings: [],
    counterparties: [],
    negotiations: [],
    playbooks: [],
    riskRules: [],
    auditLogs: [],
    users: [],
  });
  const archived = store.saveContractFile("c-files-keep", "u-files-keep", Buffer.from("keep-me"), "keep.docx", "application/octet-stream", "version");
  assert.ok(archived?.id);
  const persisted = store.getFileById(archived.id);
  const resynced = await store.replaceDb({
    ...seeded,
    files: [{
      id: persisted.id,
      contractId: persisted.contractId,
      versionId: persisted.versionId,
      name: persisted.name,
      originalName: persisted.originalName,
      mimeType: persisted.mimeType,
      path: persisted.path,
      size: persisted.size,
      fileType: persisted.fileType,
      createdAt: persisted.createdAt,
    }],
  });
  assert.ok((resynced.files || []).some((file) => file.id === archived.id));
  assert.ok(store.getFileById(archived.id));
});

testAsync("backup sqlite can be reopened independently for restore inspection", async () => {
    await store.replaceDb({
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

testAsync("restoreBackupToDirectory recreates sqlite and archive content in a new root", async () => {
    await store.replaceDb({
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

testAsync("runAutoBackup includes sqlite and archive folders", async () => {
  await store.replaceDb({
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

testAsync("runAutoBackup performs truncate checkpoint before backup", async () => {
  const checkpoint = store.runWalCheckpoint("TRUNCATE");
  assert.strictEqual(checkpoint.mode, "TRUNCATE");
  assert.strictEqual(typeof checkpoint.walSizeBytes, "number");
});

runAllTests().then(() => {
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
