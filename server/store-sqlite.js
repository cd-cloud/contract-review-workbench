/**
 * SQLite-based persistent storage for Legal Contract Workbench.
 * Replaces JSON file storage with structured tables + full snapshot blob.
 * Keeps backward-compatible readDb/replaceDb/saveFile interfaces.
 */

const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { isPathInsideRoot, safeJsonStringify } = require("./http-utils");

const config = require("./config");
const WORKBENCH_ROOT = config.dataDir;
const DATA_DIR = path.join(WORKBENCH_ROOT, "data");
const FILE_DIR = path.join(WORKBENCH_ROOT, "files");
const DB_PATH = path.join(DATA_DIR, "workbench.sqlite");
const WAL_PATH = `${DB_PATH}-wal`;
const MAX_WAL_SIZE_BYTES = config.maxWalBytes;

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(FILE_DIR, { recursive: true });

let db = new Database(DB_PATH, { timeout: 5000 });
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

function runWalCheckpoint(mode = "PASSIVE") {
  const normalizedMode = ["PASSIVE", "FULL", "RESTART", "TRUNCATE"].includes(String(mode || "").toUpperCase())
    ? String(mode).toUpperCase()
    : "PASSIVE";
  const result = db.pragma(`wal_checkpoint(${normalizedMode})`, { simple: false }) || [];
  const row = result[0] || {};
  return {
    mode: normalizedMode,
    busy: Number(row.busy || 0),
    log: Number(row.log || 0),
    checkpointed: Number(row.checkpointed || 0),
    walPath: WAL_PATH,
    walSizeBytes: fs.existsSync(WAL_PATH) ? fs.statSync(WAL_PATH).size : 0,
  };
}

function checkpointIfWalLarge() {
  if (!fs.existsSync(WAL_PATH)) return null;
  const size = fs.statSync(WAL_PATH).size;
  if (size < MAX_WAL_SIZE_BYTES) return { skipped: true, walSizeBytes: size, threshold: MAX_WAL_SIZE_BYTES };
  return runWalCheckpoint("TRUNCATE");
}

const checkpointInterval = setInterval(() => {
  try {
    checkpointIfWalLarge();
  } catch (error) {}
}, 5 * 60 * 1000);
if (typeof checkpointInterval.unref === "function") checkpointInterval.unref();

/* ─────────────── Migrations ─────────────── */
function getMigrationVersion() {
  try {
    const row = db.prepare("PRAGMA user_version").get();
    return row?.user_version || 0;
  } catch (error) {
    return 0;
  }
}

function setMigrationVersion(version) {
  db.prepare(`PRAGMA user_version = ${version}`).run();
}

const MIGRATIONS = [
  // v0 → v1: initial schema
  function migrate_v1() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS app_state (
        key TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE TABLE IF NOT EXISTS contracts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT,
        purpose TEXT,
        business_background TEXT,
        status TEXT,
        our_role TEXT,
        counterparty_id TEXT,
        counterparty_name TEXT,
        amount TEXT,
        term TEXT,
        payment TEXT,
        governing_law TEXT,
        dispute TEXT,
        text TEXT,
        clean_text TEXT,
        redline_text TEXT,
        comments_text TEXT,
        clause_source TEXT,
        risk_level TEXT,
        ai_tags TEXT,
        created_at TEXT,
        updated_at TEXT,
        folder_path TEXT
      );

      CREATE TABLE IF NOT EXISTS contract_versions (
        id TEXT PRIMARY KEY,
        contract_id TEXT NOT NULL,
        version_number INTEGER,
        type TEXT,
        note TEXT,
        material_kind TEXT,
        text TEXT,
        clean_text TEXT,
        redline_text TEXT,
        comments_text TEXT,
        accepted_text TEXT,
        file_path TEXT,
        created_at TEXT,
        feedback_deadline TEXT,
        status TEXT,
        FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS clauses (
        id TEXT PRIMARY KEY,
        contract_id TEXT,
        version_id TEXT,
        stable_id TEXT,
        number TEXT,
        title TEXT,
        clause_type TEXT,
        text TEXT,
        hierarchy_level TEXT,
        chapter_title TEXT,
        created_at TEXT,
        FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE,
        FOREIGN KEY (version_id) REFERENCES contract_versions(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS findings (
        id TEXT PRIMARY KEY,
        contract_id TEXT NOT NULL,
        clause_id TEXT,
        severity TEXT,
        action_type TEXT,
        title TEXT,
        issue TEXT,
        consequence TEXT,
        proposed_revision TEXT,
        target_text TEXT,
        replacement_text TEXT,
        comment_text TEXT,
        negotiation_position TEXT,
        fallback_text TEXT,
        business_decision TEXT,
        adoption_note TEXT,
        negotiation_bottom_line TEXT,
        acceptable_fallback TEXT,
        linked_clause_ids TEXT,
        quality_score INTEGER,
        status TEXT,
        created_at TEXT,
        FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE,
        FOREIGN KEY (clause_id) REFERENCES clauses(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS clause_actions (
        id TEXT PRIMARY KEY,
        source_key TEXT NOT NULL,
        clause_id TEXT NOT NULL,
        action_type TEXT,
        text TEXT,
        comment TEXT,
        created_at TEXT,
        FOREIGN KEY (clause_id) REFERENCES clauses(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS counterparties (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT,
        industry TEXT,
        importance TEXT,
        risk_level TEXT,
        notes TEXT,
        contact TEXT,
        email TEXT,
        phone TEXT,
        risk_profile TEXT,
        created_at TEXT,
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS negotiations (
        id TEXT PRIMARY KEY,
        contract_id TEXT,
        counterparty_id TEXT,
        clause_id TEXT,
        round INTEGER,
        counterparty_position TEXT,
        our_response TEXT,
        final_result TEXT,
        concession TEXT,
        reason TEXT,
        decision_maker TEXT,
        captured INTEGER,
        created_at TEXT,
        FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE,
        FOREIGN KEY (counterparty_id) REFERENCES counterparties(id) ON DELETE SET NULL,
        FOREIGN KEY (clause_id) REFERENCES clauses(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS playbooks (
        id TEXT PRIMARY KEY,
        clause_type TEXT NOT NULL,
        contract_types TEXT,
        our_role TEXT,
        standard TEXT,
        fallback TEXT,
        forbidden TEXT,
        negotiation TEXT,
        keywords TEXT,
        confidence_score INTEGER,
        source_occurrences TEXT,
        variants TEXT,
        knowledge_signals TEXT,
        usage_count INTEGER DEFAULT 0,
        created_at TEXT,
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS risk_rules (
        id TEXT PRIMARY KEY,
        rule_type TEXT,
        title TEXT,
        severity TEXT,
        action_type TEXT,
        pattern TEXT,
        missing_pattern TEXT,
        issue TEXT,
        suggestion TEXT,
        status TEXT,
        source TEXT,
        created_at TEXT
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        contract_id TEXT,
        contract_name TEXT,
        clause_id TEXT,
        user_id TEXT,
        details TEXT,
        created_at TEXT
      );

      CREATE TABLE IF NOT EXISTS analysis_jobs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        phase TEXT,
        request_json TEXT,
        result_json TEXT,
        error TEXT,
        cost_meta_json TEXT,
        created_at TEXT,
        updated_at TEXT,
        completed_at TEXT,
        position_in_queue INTEGER
      );

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT,
        role TEXT,
        permissions TEXT
      );

      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        contract_id TEXT,
        version_id TEXT,
        name TEXT NOT NULL,
        original_name TEXT,
        mime_type TEXT,
        file_path TEXT NOT NULL,
        size INTEGER,
        file_type TEXT,
        created_at TEXT,
        FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE,
        FOREIGN KEY (version_id) REFERENCES contract_versions(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_contract_versions_contract_id ON contract_versions(contract_id);
      CREATE INDEX IF NOT EXISTS idx_clauses_contract_id ON clauses(contract_id);
      CREATE INDEX IF NOT EXISTS idx_findings_contract_id ON findings(contract_id);
      CREATE INDEX IF NOT EXISTS idx_clause_actions_source_key ON clause_actions(source_key);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_files_contract_id ON files(contract_id);
      CREATE INDEX IF NOT EXISTS idx_analysis_jobs_status ON analysis_jobs(status);

      CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
        content,
        title,
        entity_type UNINDEXED,
        entity_id UNINDEXED,
        contract_id UNINDEXED,
        extra UNINDEXED,
        tokenize = 'unicode61'
      );
    `);
  },
  // v1 → v2: analysis cache persistence
  function migrate_v2() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS analysis_cache (
        hash TEXT PRIMARY KEY,
        result_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        hits INTEGER NOT NULL DEFAULT 1,
        size_bytes INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_analysis_cache_created_at ON analysis_cache(created_at);
    `);
  },
];

function migrate() {
  const currentVersion = getMigrationVersion();
  const targetVersion = MIGRATIONS.length;

  if (targetVersion <= currentVersion) return;

  for (let v = currentVersion; v < targetVersion; v++) {
    try {
      MIGRATIONS[v]();
      setMigrationVersion(v + 1);
      console.log(`[store] Migrated database from version ${v} to ${v + 1}`);
    } catch (err) {
      console.error(`[store] Migration to version ${v + 1} failed:`, err.message);
      throw err;
    }
  }
}
migrate();

/* ─────────────── Helpers ─────────────── */
function safeJson(value) {
  try {
    const seen = new WeakSet();
    return JSON.stringify(value, (key, val) => {
      if (typeof val === "object" && val !== null) {
        if (seen.has(val)) return "[Circular]";
        seen.add(val);
      }
      return val;
    });
  } catch { return "null"; }
}
function parseJson(text, fallback = null) {
  try { return JSON.parse(text); } catch { return fallback; }
}
function nowIso() { return new Date().toISOString(); }
function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

const AUTHORITATIVE_STATE_KEYS = new Set([
  "contracts",
  "updates",
  "contractVersions",
  "clauses",
  "findings",
  "reviewRecords",
  "clauseActions",
  "files",
  "counterparties",
  "negotiations",
  "playbooks",
  "riskRules",
  "auditLogs",
  "users",
]);

const emptyDb = {
  snapshot: null,
  contracts: [],
  contractVersions: [],
  clauses: [],
  clauseActions: [],
  files: [],
  counterparties: [],
  playbooks: [],
  reviewRecords: [],
  auditLogs: [],
  users: [{ id: "local-admin", name: "Local Admin", role: "admin", permissions: ["contracts:read", "contracts:write", "playbooks:write", "admin"] }],
};

/* ─────────────── Contract archive helpers ─────────────── */
function ensureContractFolder(contract) {
  const year = (contract.createdAt || nowIso()).slice(0, 4);
  const safeId = String(contract.id || "contract").replace(/[.]{2,}/g, "_").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "contract";
  const safeCounterparty = String(contract.counterpartyName || "unknown").replace(/[.]{2,}/g, "_").replace(/[\\/:*?"<>|]/g, "_").slice(0, 40);
  const safeName = String(contract.name || "untitled").replace(/[.]{2,}/g, "_").replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
  const folderName = `${safeId}-${safeCounterparty}-${safeName}`;
  const folderPath = path.join(WORKBENCH_ROOT, "contracts", year, folderName);
  if (!isPathInsideRoot(WORKBENCH_ROOT, folderPath)) {
    throw new Error("Resolved contract folder path escaped workbench root");
  }
  fs.mkdirSync(folderPath, { recursive: true });
  fs.mkdirSync(path.join(folderPath, "versions"), { recursive: true });
  fs.mkdirSync(path.join(folderPath, "exports"), { recursive: true });
  fs.mkdirSync(path.join(folderPath, "attachments"), { recursive: true });
  return folderPath;
}

function extractAuxState(snapshot = {}) {
  const auxState = {};
  for (const [key, value] of Object.entries(snapshot || {})) {
    if (AUTHORITATIVE_STATE_KEYS.has(key)) continue;
    if (value === undefined) continue;
    auxState[key] = value;
  }
  return auxState;
}

function writeAuxState(auxState = {}) {
  db.prepare(`
    INSERT OR REPLACE INTO app_state (key, value) VALUES ('frontend_state', ?)
  `).run(safeJson(auxState));
}

function readAuxState() {
  const row = db.prepare("SELECT value FROM app_state WHERE key = 'frontend_state'").get();
  return parseJson(row?.value, {}) || {};
}

function buildDbResponse(snapshot, savedAt = nowIso()) {
  const snapshotCopy = deepClone(snapshot);
  const clonedFields = deepClone({
    contracts: snapshotCopy.contracts || [],
    contractVersions: snapshotCopy.updates || snapshotCopy.contractVersions || [],
    clauses: snapshotCopy.clauses || [],
    clauseActions: flattenClauseActions(snapshotCopy.clauseActions || {}),
    files: snapshotCopy.files || [],
    counterparties: snapshotCopy.counterparties || [],
    playbooks: snapshotCopy.playbooks || [],
    reviewRecords: snapshotCopy.findings || snapshotCopy.reviewRecords || [],
    auditLogs: snapshotCopy.auditLogs || [],
    users: snapshotCopy.users || emptyDb.users,
  });
  return {
    snapshot: snapshotCopy,
    ...clonedFields,
    savedAt,
  };
}

function assembleStructuredSnapshot() {
  const contracts = db.prepare("SELECT * FROM contracts").all().map(row => ({
    id: row.id, name: row.name, type: row.type, purpose: row.purpose,
    businessBackground: row.business_background, status: row.status, ourRole: row.our_role,
    counterpartyId: row.counterparty_id, counterpartyName: row.counterparty_name,
    amount: row.amount, term: row.term, payment: row.payment,
    governingLaw: row.governing_law, dispute: row.dispute,
    text: row.text, cleanText: row.clean_text, redlineText: row.redline_text,
    commentsText: row.comments_text, clauseSource: row.clause_source,
    riskLevel: row.risk_level, aiTags: parseJson(row.ai_tags, []),
    createdAt: row.created_at, updatedAt: row.updated_at,
    folderPath: row.folder_path,
  }));

  const contractVersions = db.prepare("SELECT * FROM contract_versions").all().map(row => ({
    id: row.id, contractId: row.contract_id, versionNumber: row.version_number,
    type: row.type, note: row.note, materialKind: row.material_kind,
    versionText: row.text, cleanText: row.clean_text, redlineText: row.redline_text,
    commentsText: row.comments_text, acceptedText: row.accepted_text,
    filePath: row.file_path, createdAt: row.created_at,
    feedbackDeadline: row.feedback_deadline, status: row.status,
  }));

  const clauses = db.prepare("SELECT * FROM clauses").all().map(row => ({
    id: row.id, contractId: row.contract_id, versionId: row.version_id,
    stableId: row.stable_id, number: row.number, title: row.title,
    type: row.clause_type, text: row.text,
    hierarchyLevel: row.hierarchy_level, chapterTitle: row.chapter_title,
    createdAt: row.created_at,
  }));

  const findings = db.prepare("SELECT * FROM findings").all().map(row => ({
    id: row.id, contractId: row.contract_id, clauseId: row.clause_id,
    severity: row.severity, actionType: row.action_type, title: row.title,
    issue: row.issue, consequence: row.consequence,
    proposedRevision: row.proposed_revision, targetText: row.target_text,
    replacementText: row.replacement_text, commentText: row.comment_text,
    negotiationPosition: row.negotiation_position, fallbackText: row.fallback_text,
    businessDecision: row.business_decision, adoptionNote: row.adoption_note,
    negotiationBottomLine: row.negotiation_bottom_line,
    acceptableFallback: row.acceptable_fallback,
    linkedClauseIds: parseJson(row.linked_clause_ids, []),
    qualityScore: row.quality_score, status: row.status, createdAt: row.created_at,
  }));

  const clauseActions = db.prepare("SELECT * FROM clause_actions").all().reduce((acc, row) => {
    acc[row.source_key] = acc[row.source_key] || {};
    acc[row.source_key][row.clause_id] = {
      actionType: row.action_type, text: row.text, comment: row.comment, createdAt: row.created_at,
    };
    return acc;
  }, {});

  const counterparties = db.prepare("SELECT * FROM counterparties").all().map(row => ({
    id: row.id, name: row.name, type: row.type, industry: row.industry,
    importance: row.importance, riskLevel: row.risk_level, notes: row.notes,
    contact: row.contact, email: row.email, phone: row.phone,
    riskProfile: parseJson(row.risk_profile, {}),
    createdAt: row.created_at, updatedAt: row.updated_at,
  }));

  const negotiations = db.prepare("SELECT * FROM negotiations").all().map(row => ({
    id: row.id, contractId: row.contract_id, counterpartyId: row.counterparty_id,
    clauseId: row.clause_id, round: row.round,
    counterpartyPosition: row.counterparty_position, ourResponse: row.our_response,
    finalResult: row.final_result, concession: row.concession,
    reason: row.reason, decisionMaker: row.decision_maker,
    captured: Boolean(row.captured), createdAt: row.created_at,
  }));

  const playbooks = db.prepare("SELECT * FROM playbooks").all().map(row => ({
    id: row.id, type: row.clause_type,
    contractTypes: parseJson(row.contract_types, []), ourRole: row.our_role,
    standard: row.standard, fallback: row.fallback, forbidden: row.forbidden,
    negotiation: row.negotiation, keywords: parseJson(row.keywords, []),
    confidenceScore: row.confidence_score,
    sourceOccurrences: parseJson(row.source_occurrences, []),
    variants: parseJson(row.variants, []),
    knowledgeSignals: parseJson(row.knowledge_signals, []),
    usageCount: row.usage_count,
    createdAt: row.created_at, updatedAt: row.updated_at,
  }));

  const riskRules = db.prepare("SELECT * FROM risk_rules").all().map(row => ({
    id: row.id, type: row.rule_type, title: row.title, severity: row.severity,
    actionType: row.action_type, pattern: row.pattern, missingPattern: row.missing_pattern,
    issue: row.issue, suggestion: row.suggestion, status: row.status,
    source: row.source, createdAt: row.created_at,
  }));

  const auditLogs = db.prepare("SELECT * FROM audit_logs ORDER BY created_at DESC").all().map(row => ({
    id: String(row.id), action: row.action, contractId: row.contract_id,
    contractName: row.contract_name, clauseId: row.clause_id, userId: row.user_id,
    details: parseJson(row.details, {}), createdAt: row.created_at,
  }));

  const files = db.prepare("SELECT * FROM files ORDER BY created_at DESC").all().map(row => ({
    id: row.id,
    contractId: row.contract_id,
    versionId: row.version_id,
    name: row.name,
    originalName: row.original_name,
    mimeType: row.mime_type,
    path: row.file_path,
    size: row.size,
    fileType: row.file_type,
    createdAt: row.created_at,
  }));

  const users = db.prepare("SELECT * FROM users").all().map(row => ({
    id: row.id, name: row.name, role: row.role,
    permissions: parseJson(row.permissions, []),
  }));

  return {
    contracts,
    updates: contractVersions,
    contractVersions,
    clauses,
    findings,
    reviewRecords: findings,
    clauseActions,
    counterparties,
    negotiations,
    playbooks,
    riskRules,
    auditLogs,
    files,
    users,
  };
}

function mergeSnapshots(structuredSnapshot, auxState = {}) {
  const merged = deepClone(auxState || {});
  merged.contracts = structuredSnapshot.contracts || [];
  merged.updates = structuredSnapshot.updates || structuredSnapshot.contractVersions || [];
  merged.contractVersions = structuredSnapshot.updates || structuredSnapshot.contractVersions || [];
  merged.clauses = structuredSnapshot.clauses || [];
  merged.findings = structuredSnapshot.findings || structuredSnapshot.reviewRecords || [];
  merged.reviewRecords = merged.findings;
  merged.clauseActions = structuredSnapshot.clauseActions || {};
  merged.files = structuredSnapshot.files || [];
  merged.counterparties = structuredSnapshot.counterparties || [];
  merged.negotiations = structuredSnapshot.negotiations || [];
  merged.playbooks = structuredSnapshot.playbooks || [];
  merged.riskRules = structuredSnapshot.riskRules || [];
  merged.auditLogs = structuredSnapshot.auditLogs || [];
  merged.users = structuredSnapshot.users?.length ? structuredSnapshot.users : emptyDb.users;
  merged.storageMeta = {
    ...(auxState.storageMeta || {}),
    source: "backend-primary",
    persistedVia: "sqlite-structured",
  };
  return merged;
}

function normalizeSnapshotRelations(snapshot = {}) {
  const normalized = deepClone(snapshot || {});
  const contracts = (normalized.contracts || []).filter((contract) => contract?.id);
  const contractIds = new Set(contracts.map((contract) => contract.id));

  const updates = (normalized.updates || normalized.contractVersions || [])
    .filter((version) => version?.id && contractIds.has(version.contractId));
  const versionIds = new Set(updates.map((version) => version.id));

  const counterparties = (normalized.counterparties || []).filter((counterparty) => counterparty?.id);
  const counterpartyIds = new Set(counterparties.map((counterparty) => counterparty.id));

  const clauses = (normalized.clauses || [])
    .filter((clause) => clause?.id && contractIds.has(clause.contractId))
    .map((clause) => ({
      ...clause,
      versionId: clause.versionId && versionIds.has(clause.versionId) ? clause.versionId : null,
    }));
  const clauseIds = new Set(clauses.map((clause) => clause.id));

  const findings = (normalized.findings || normalized.reviewRecords || [])
    .filter((finding) => finding?.id && contractIds.has(finding.contractId))
    .map((finding) => ({
      ...finding,
      clauseId: finding.clauseId && clauseIds.has(finding.clauseId) ? finding.clauseId : null,
      linkedClauseIds: (finding.linkedClauseIds || []).filter((clauseId) => clauseIds.has(clauseId)),
    }));

  const clauseActions = {};
  for (const [sourceKey, clauseMap] of Object.entries(normalized.clauseActions || {})) {
    const nextMap = {};
    for (const [clauseId, action] of Object.entries(clauseMap || {})) {
      if (!clauseIds.has(clauseId)) continue;
      nextMap[clauseId] = action;
    }
    if (Object.keys(nextMap).length) clauseActions[sourceKey] = nextMap;
  }

  const negotiations = (normalized.negotiations || [])
    .filter((negotiation) => negotiation?.id && contractIds.has(negotiation.contractId))
    .map((negotiation) => ({
      ...negotiation,
      counterpartyId: negotiation.counterpartyId && counterpartyIds.has(negotiation.counterpartyId)
        ? negotiation.counterpartyId
        : null,
      clauseId: negotiation.clauseId && clauseIds.has(negotiation.clauseId)
        ? negotiation.clauseId
        : null,
    }));

  const files = (normalized.files || [])
    .filter((file) => file?.id && contractIds.has(file.contractId))
    .map((file) => ({
      ...file,
      versionId: file.versionId && versionIds.has(file.versionId) ? file.versionId : null,
    }));

  normalized.contracts = contracts;
  normalized.updates = updates;
  normalized.contractVersions = updates;
  normalized.counterparties = counterparties;
  normalized.clauses = clauses;
  normalized.findings = findings;
  normalized.reviewRecords = findings;
  normalized.clauseActions = clauseActions;
  normalized.files = files;
  normalized.negotiations = negotiations;
  normalized.users = normalized.users?.length ? normalized.users.filter((user) => user?.id) : emptyDb.users;
  return normalized;
}

function pruneOrphanedFiles(validContractIds, validVersionIds, validFileIds = new Set()) {
  const rows = db.prepare("SELECT id, contract_id, version_id, file_path FROM files").all();
  const remove = db.prepare("DELETE FROM files WHERE id = ?");
  for (const row of rows) {
    if (validFileIds.has(row.id)) continue;
    const invalidContract = !row.contract_id || !validContractIds.has(row.contract_id);
    const invalidVersion = row.version_id && !validVersionIds.has(row.version_id);
    if (!invalidContract && !invalidVersion) continue;
    if (row.file_path && fs.existsSync(row.file_path)) {
      try {
        if (!isPathInsideRoot(WORKBENCH_ROOT, row.file_path)) {
          logger.error(`[pruneOrphanedFiles] Refusing to delete file outside workbench root: ${row.file_path}`);
        } else {
          fs.unlinkSync(row.file_path);
        }
      } catch (error) {}
    }
    remove.run(row.id);
  }
}

function getContractFolder(contractId) {
  const row = db.prepare("SELECT folder_path FROM contracts WHERE id = ?").get(contractId);
  if (row?.folder_path && fs.existsSync(row.folder_path)) return row.folder_path;
  // Fallback: try to reconstruct path by scanning
  const contractsDir = path.join(WORKBENCH_ROOT, "contracts");
  if (!fs.existsSync(contractsDir)) return null;
  for (const yearDir of fs.readdirSync(contractsDir)) {
    const yearPath = path.join(contractsDir, yearDir);
    if (!fs.statSync(yearPath).isDirectory()) continue;
    for (const folder of fs.readdirSync(yearPath)) {
      if (folder.startsWith(contractId + "-")) {
        return path.join(yearPath, folder);
      }
    }
  }
  return null;
}

/* ─────────────── replaceDb (full snapshot sync) ─────────────── */
function replaceDb(snapshot) {
  const savedAt = nowIso();
  const normalizedSnapshot = normalizeSnapshotRelations({
    ...snapshot,
    storageMeta: {
      ...(snapshot.storageMeta || {}),
      backendSavedAt: savedAt,
      source: "backend-primary",
      persistedVia: "sqlite-structured",
    },
  });
  const auxState = extractAuxState(normalizedSnapshot);
  const validContractIds = new Set((normalizedSnapshot.contracts || []).map((contract) => contract.id));
  const validVersionIds = new Set((normalizedSnapshot.updates || normalizedSnapshot.contractVersions || []).map((version) => version.id));
  const validFileIds = new Set((normalizedSnapshot.files || []).map((file) => file.id).filter(Boolean));

  pruneOrphanedFiles(validContractIds, validVersionIds, validFileIds);

  db.pragma("foreign_keys = OFF");
  db.prepare("BEGIN IMMEDIATE").run();
  try {
    // 1. Persist non-authoritative frontend state separately from structured data.
    writeAuxState(auxState);
    db.prepare("DELETE FROM app_state WHERE key = 'snapshot'").run();

    // 2. Clear structured tables
    db.prepare("DELETE FROM files").run();
    db.prepare("DELETE FROM contract_versions").run();
    db.prepare("DELETE FROM clauses").run();
    db.prepare("DELETE FROM findings").run();
    db.prepare("DELETE FROM clause_actions").run();
    db.prepare("DELETE FROM negotiations").run();
    db.prepare("DELETE FROM contracts").run();
    db.prepare("DELETE FROM counterparties").run();
    db.prepare("DELETE FROM playbooks").run();
    db.prepare("DELETE FROM risk_rules").run();
    db.prepare("DELETE FROM audit_logs").run();
    db.prepare("DELETE FROM users").run();

    // 3. Insert contracts
    const insertContract = db.prepare(`
      INSERT INTO contracts (id, name, type, purpose, business_background, status, our_role,
        counterparty_id, counterparty_name, amount, term, payment, governing_law, dispute,
        text, clean_text, redline_text, comments_text, clause_source, risk_level, ai_tags,
        created_at, updated_at, folder_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const c of normalizedSnapshot.contracts || []) {
      const folderPath = ensureContractFolder(c);
      insertContract.run(
        c.id, c.name, c.type, c.purpose, c.businessBackground, c.status, c.ourRole,
        c.counterpartyId, c.counterpartyName, c.amount, c.term, c.payment, c.governingLaw, c.dispute,
        c.text, c.cleanText, c.redlineText, c.commentsText, c.clauseSource, c.riskLevel,
        safeJson(c.aiTags), c.createdAt, c.updatedAt, folderPath
      );
    }

    // 4. Insert contract versions (updates)
    const insertVersion = db.prepare(`
      INSERT INTO contract_versions (id, contract_id, version_number, type, note, material_kind,
        text, clean_text, redline_text, comments_text, accepted_text, file_path, created_at, feedback_deadline, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const v of normalizedSnapshot.updates || normalizedSnapshot.contractVersions || []) {
      insertVersion.run(
        v.id, v.contractId, v.versionNumber || 0, v.type, v.note, v.materialKind,
        v.versionText || v.text, v.cleanText, v.redlineText, v.commentsText, v.acceptedText,
        v.filePath || null, v.createdAt, v.feedbackDeadline, v.status
      );
    }

    const insertFile = db.prepare(`
      INSERT INTO files (id, contract_id, version_id, name, original_name, mime_type, file_path, size, file_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const file of normalizedSnapshot.files || []) {
      insertFile.run(
        file.id, file.contractId, file.versionId || null, file.name,
        file.originalName || file.name, file.mimeType || "application/octet-stream",
        file.path || file.filePath || "", Number(file.size || 0),
        file.fileType || "attachment", file.createdAt || savedAt
      );
    }

    // 5. Insert clauses
    const insertClause = db.prepare(`
      INSERT INTO clauses (id, contract_id, version_id, stable_id, number, title, clause_type,
        text, hierarchy_level, chapter_title, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const cl of normalizedSnapshot.clauses || []) {
      insertClause.run(
        cl.id, cl.contractId, cl.versionId || null, cl.stableId, cl.number, cl.title, cl.type,
        cl.text, cl.hierarchyLevel, cl.chapterTitle, cl.createdAt
      );
    }

    // 6. Insert findings (reviewRecords)
    const insertFinding = db.prepare(`
      INSERT INTO findings (id, contract_id, clause_id, severity, action_type, title, issue,
        consequence, proposed_revision, target_text, replacement_text, comment_text,
        negotiation_position, fallback_text, business_decision, adoption_note,
        negotiation_bottom_line, acceptable_fallback, linked_clause_ids, quality_score, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const f of normalizedSnapshot.findings || normalizedSnapshot.reviewRecords || []) {
      insertFinding.run(
        f.id, f.contractId, f.clauseId || null, f.severity, f.actionType, f.title, f.issue,
        f.consequence, f.proposedRevision, f.targetText, f.replacementText, f.commentText,
        f.negotiationPosition, f.fallbackText, f.businessDecision, f.adoptionNote,
        f.negotiationBottomLine, f.acceptableFallback, safeJson(f.linkedClauseIds),
        f.qualityScore, f.status, f.createdAt
      );
    }

    // 7. Insert clause actions (flattened)
    const insertAction = db.prepare(`
      INSERT INTO clause_actions (id, source_key, clause_id, action_type, text, comment, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const actions = normalizedSnapshot.clauseActions || {};
    for (const [sourceKey, clauseMap] of Object.entries(actions)) {
      for (const [clauseId, action] of Object.entries(clauseMap || {})) {
        insertAction.run(
          `${sourceKey}:${clauseId}`, sourceKey, clauseId,
          action.actionType, action.text, action.comment, action.createdAt
        );
      }
    }

    // 8. Insert counterparties
    const insertCp = db.prepare(`
      INSERT INTO counterparties (id, name, type, industry, importance, risk_level, notes,
        contact, email, phone, risk_profile, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const cp of normalizedSnapshot.counterparties || []) {
      insertCp.run(
        cp.id, cp.name, cp.type, cp.industry, cp.importance, cp.riskLevel, cp.notes,
        cp.contact, cp.email, cp.phone, safeJson(cp.riskProfile), cp.createdAt, cp.updatedAt
      );
    }

    // 9. Insert negotiations
    const insertNeg = db.prepare(`
      INSERT INTO negotiations (id, contract_id, counterparty_id, clause_id, round,
        counterparty_position, our_response, final_result, concession, reason, decision_maker, captured, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const n of normalizedSnapshot.negotiations || []) {
      insertNeg.run(
        n.id, n.contractId, n.counterpartyId, n.clauseId, n.round,
        n.counterpartyPosition, n.ourResponse, n.finalResult, n.concession,
        n.reason, n.decisionMaker, n.captured ? 1 : 0, n.createdAt
      );
    }

    // 10. Insert playbooks
    const insertPb = db.prepare(`
      INSERT INTO playbooks (id, clause_type, contract_types, our_role, standard, fallback,
        forbidden, negotiation, keywords, confidence_score, source_occurrences, variants,
        knowledge_signals, usage_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const pb of normalizedSnapshot.playbooks || []) {
      insertPb.run(
        pb.id, pb.type, safeJson(pb.contractTypes), pb.ourRole, pb.standard, pb.fallback,
        pb.forbidden, pb.negotiation, safeJson(pb.keywords), pb.confidenceScore,
        safeJson(pb.sourceOccurrences), safeJson(pb.variants), safeJson(pb.knowledgeSignals),
        pb.usageCount || 0, pb.createdAt, pb.updatedAt
      );
    }

    // 11. Insert risk rules
    const insertRule = db.prepare(`
      INSERT INTO risk_rules (id, rule_type, title, severity, action_type, pattern,
        missing_pattern, issue, suggestion, status, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of normalizedSnapshot.riskRules || []) {
      insertRule.run(
        r.id, r.type, r.title, r.severity, r.actionType, r.pattern, r.missingPattern,
        r.issue, r.suggestion, r.status, r.source, r.createdAt
      );
    }
    // 12. Insert audit logs
    const insertAudit = db.prepare(`
      INSERT INTO audit_logs (action, contract_id, contract_name, clause_id, user_id, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const a of normalizedSnapshot.auditLogs || []) {
      insertAudit.run(
        a.action, a.contractId || null, a.contractName || null,
        a.clauseId || null, a.userId || "local-admin", safeJson(a.details), a.createdAt
      );
    }

    // 13. Insert users
    const insertUser = db.prepare(`
      INSERT INTO users (id, name, role, permissions) VALUES (?, ?, ?, ?)
    `);
    for (const u of normalizedSnapshot.users || emptyDb.users) {
      insertUser.run(u.id, u.name, u.role, safeJson(u.permissions));
    }

    const fkViolations = db.pragma("foreign_key_check", { simple: false });
    if (fkViolations && fkViolations.length > 0) {
      throw new Error(`Foreign key violations detected: ${JSON.stringify(fkViolations)}`);
    }

    db.prepare("COMMIT").run();
  } catch (err) {
    try { db.prepare("ROLLBACK").run(); } catch (e) {}
    throw err;
  } finally {
    db.pragma("foreign_keys = ON");
  }
  runWalCheckpoint("PASSIVE");
  pruneOrphanedFiles(validContractIds, validVersionIds, validFileIds);
  const structuredSnapshot = assembleStructuredSnapshot();
  rebuildSearchIndex(structuredSnapshot);
  return buildDbResponse(mergeSnapshots(structuredSnapshot, auxState), savedAt);
}

/* ─────────────── readDb (assemble from structured tables) ─────────────── */
function readDb() {
  const savedAt = nowIso();
  const structuredSnapshot = assembleStructuredSnapshot();
  const auxState = readAuxState();
  return buildDbResponse(mergeSnapshots(structuredSnapshot, auxState), savedAt);
}

/* ─────────────── writeDb (legacy alias) ─────────────── */
function writeDb(dbObj) {
  // No-op for SQLite; replaceDb handles everything
  return dbObj;
}

/* ─────────────── flattenClauseActions ─────────────── */
function flattenClauseActions(actions) {
  return Object.entries(actions).flatMap(([sourceKey, clauseMap]) =>
    Object.entries(clauseMap || {}).map(([clauseId, action]) => ({
      id: `${sourceKey}:${clauseId}`,
      sourceKey,
      clauseId,
      ...action,
    }))
  );
}

/* ─────────────── saveFile (legacy) ─────────────── */
function saveFile(name, content) {
  const safeName = String(name || `file-${Date.now()}.txt`).replace(/[\\/:*?"<>|]/g, "_");
  const filePath = path.join(FILE_DIR, safeName);
  fs.writeFileSync(filePath, content || "", "utf8");
  return { name: safeName, path: filePath };
}

function upsertContract(contract = {}) {
  if (!contract?.id) throw new Error("Contract id is required");
  const contractForFolder = {
    id: contract.id,
    name: contract.name || "untitled",
    counterpartyName: contract.counterpartyName || "unknown",
    createdAt: contract.createdAt || nowIso(),
  };
  const folderPath = ensureContractFolder(contractForFolder);
  db.prepare(`
    INSERT INTO contracts (
      id, name, type, purpose, business_background, status, our_role, counterparty_id, counterparty_name,
      amount, term, payment, governing_law, dispute, text, clean_text, redline_text, comments_text,
      clause_source, risk_level, ai_tags, created_at, updated_at, folder_path
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      type = excluded.type,
      purpose = excluded.purpose,
      business_background = excluded.business_background,
      status = excluded.status,
      our_role = excluded.our_role,
      counterparty_id = excluded.counterparty_id,
      counterparty_name = excluded.counterparty_name,
      amount = excluded.amount,
      term = excluded.term,
      payment = excluded.payment,
      governing_law = excluded.governing_law,
      dispute = excluded.dispute,
      text = excluded.text,
      clean_text = excluded.clean_text,
      redline_text = excluded.redline_text,
      comments_text = excluded.comments_text,
      clause_source = excluded.clause_source,
      risk_level = excluded.risk_level,
      ai_tags = excluded.ai_tags,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      folder_path = excluded.folder_path
  `).run(
    contract.id,
    contract.name || "",
    contract.type || "",
    contract.purpose || "",
    contract.businessBackground || "",
    contract.status || "",
    contract.ourRole || "",
    contract.counterpartyId || "",
    contract.counterpartyName || "",
    contract.amount || "",
    contract.term || "",
    contract.payment || "",
    contract.governingLaw || contract.jurisdiction || "",
    contract.dispute || "",
    contract.text || "",
    contract.cleanText || "",
    contract.redlineText || "",
    contract.commentsText || "",
    contract.clauseSource || "draft",
    contract.riskLevel || "low",
    safeJson(contract.aiTags || []),
    contract.createdAt || nowIso(),
    contract.updatedAt || nowIso(),
    folderPath
  );
  return {
    ...contract,
    folderPath,
  };
}

function getContractWithTexts(contractId) {
  const row = db.prepare(`
    SELECT
      id, name, type, purpose, business_background, status, our_role,
      counterparty_id, counterparty_name, amount, term, payment,
      governing_law, dispute, text, clean_text, redline_text, comments_text,
      clause_source, risk_level, ai_tags, created_at, updated_at, folder_path
    FROM contracts WHERE id = ?
  `).get(contractId);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    purpose: row.purpose,
    businessBackground: row.business_background,
    status: row.status,
    ourRole: row.our_role,
    counterpartyId: row.counterparty_id,
    counterpartyName: row.counterparty_name,
    amount: row.amount,
    term: row.term,
    payment: row.payment,
    governingLaw: row.governing_law,
    dispute: row.dispute,
    text: row.text,
    cleanText: row.clean_text,
    redlineText: row.redline_text,
    commentsText: row.comments_text,
    clauseSource: row.clause_source,
    riskLevel: row.risk_level,
    aiTags: parseJson(row.ai_tags, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    folderPath: row.folder_path,
  };
}

function upsertContractWithAudit(contract, auditEntry) {
  const tx = db.transaction(() => {
    const result = upsertContract(contract);
    appendAuditLog({ ...auditEntry, contractId: result.id, contractName: result.name });
    return result;
  });
  return tx();
}

function upsertContractVersionWithAudit(version, auditEntry) {
  const tx = db.transaction(() => {
    const result = upsertContractVersion(version);
    appendAuditLog({ ...auditEntry, contractId: result.contractId, details: { note: result.type || result.note || "" } });
    return result;
  });
  return tx();
}

function upsertContractVersion(version = {}) {
  if (!version?.id || !version?.contractId) throw new Error("Version id and contractId are required");
  db.prepare(`
    INSERT INTO contract_versions (
      id, contract_id, version_number, type, note, material_kind, text, clean_text, redline_text,
      comments_text, accepted_text, file_path, created_at, feedback_deadline, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      contract_id = excluded.contract_id,
      version_number = excluded.version_number,
      type = excluded.type,
      note = excluded.note,
      material_kind = excluded.material_kind,
      text = excluded.text,
      clean_text = excluded.clean_text,
      redline_text = excluded.redline_text,
      comments_text = excluded.comments_text,
      accepted_text = excluded.accepted_text,
      file_path = excluded.file_path,
      created_at = excluded.created_at,
      feedback_deadline = excluded.feedback_deadline,
      status = excluded.status
  `).run(
    version.id,
    version.contractId,
    version.versionNumber || 0,
    version.type || "",
    version.note || "",
    version.materialKind || "",
    version.versionText || version.text || "",
    version.cleanText || "",
    version.redlineText || "",
    version.commentsText || "",
    version.acceptedText || "",
    version.filePath || null,
    version.createdAt || nowIso(),
    version.feedbackDeadline || "",
    version.status || ""
  );
  return version;
}

function replaceContractClauses(contractId, versionId, clauses = []) {
  if (!contractId) throw new Error("Contract id is required");
  const deleteSql = versionId
    ? "DELETE FROM clauses WHERE contract_id = ? AND version_id = ?"
    : "DELETE FROM clauses WHERE contract_id = ? AND version_id IS NULL";
  const deleteArgs = versionId ? [contractId, versionId] : [contractId];
  const insertClause = db.prepare(`
    INSERT INTO clauses (id, contract_id, version_id, stable_id, number, title, clause_type, text, hierarchy_level, chapter_title, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const tx = db.transaction(() => {
    db.prepare(deleteSql).run(...deleteArgs);
    for (const clause of clauses) {
      insertClause.run(
        clause.id,
        contractId,
        versionId || clause.versionId || null,
        clause.stableId || clause.id,
        clause.number || "",
        clause.title || "",
        clause.type || "",
        clause.text || "",
        clause.hierarchyLevel || "article",
        clause.chapterTitle || "",
        clause.createdAt || nowIso()
      );
    }
  });
  tx();
  return clauses;
}

function replaceContractFindings(contractId, findings = []) {
  if (!contractId) throw new Error("Contract id is required");
  const insertFinding = db.prepare(`
    INSERT INTO findings (
      id, contract_id, clause_id, severity, action_type, title, issue, consequence, proposed_revision, target_text,
      replacement_text, comment_text, negotiation_position, fallback_text, business_decision, adoption_note,
      negotiation_bottom_line, acceptable_fallback, linked_clause_ids, quality_score, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM findings WHERE contract_id = ?").run(contractId);
    for (const finding of findings) {
      insertFinding.run(
        finding.id,
        contractId,
        finding.clauseId || null,
        finding.severity || "low",
        finding.actionType || "",
        finding.title || "",
        finding.issue || "",
        finding.consequence || "",
        finding.proposedRevision || "",
        finding.targetText || "",
        finding.replacementText || "",
        finding.commentText || "",
        finding.negotiationPosition || "",
        finding.fallbackText || "",
        finding.businessDecision || "",
        finding.adoptionNote || "",
        finding.negotiationBottomLine || "",
        finding.acceptableFallback || "",
        safeJson(finding.linkedClauseIds || []),
        finding.qualityScore || 0,
        finding.status || "",
        finding.createdAt || nowIso()
      );
    }
  });
  tx();
  return findings;
}

function replaceClauseActions(sourceKey, clauseMap = {}) {
  if (!sourceKey) throw new Error("sourceKey is required");
  const insertAction = db.prepare(`
    INSERT INTO clause_actions (id, source_key, clause_id, action_type, text, comment, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM clause_actions WHERE source_key = ?").run(sourceKey);
    for (const [clauseId, action] of Object.entries(clauseMap || {})) {
      insertAction.run(
        `${sourceKey}:${clauseId}`,
        sourceKey,
        clauseId,
        action.actionType || "",
        action.text || action.editedText || "",
        action.comment || "",
        action.createdAt || nowIso()
      );
    }
  });
  tx();
  return clauseMap;
}

function appendInsertedClause(sourceKey, insertedClause = {}) {
  const auxState = readAuxState();
  auxState.insertedClauses = auxState.insertedClauses || {};
  auxState.insertedClauses[sourceKey] = auxState.insertedClauses[sourceKey] || [];
  auxState.insertedClauses[sourceKey].push(deepClone(insertedClause));
  writeAuxState(auxState);
  return insertedClause;
}

function patchAuxState(partialState = {}) {
  const current = readAuxState();
  const merged = {
    ...current,
    ...deepClone(partialState || {}),
  };
  writeAuxState(merged);
  return merged;
}

function appendAuditLog(entry = {}) {
  const audit = {
    id: entry.id || `audit-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
    action: entry.action || "state-update",
    contractId: entry.contractId || null,
    contractName: entry.contractName || null,
    clauseId: entry.clauseId || null,
    userId: entry.userId || "local-admin",
    details: entry.details || {},
    createdAt: entry.createdAt || nowIso(),
  };
  db.prepare(`
    INSERT INTO audit_logs (action, contract_id, contract_name, clause_id, user_id, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    audit.action,
    audit.contractId,
    audit.contractName,
    audit.clauseId,
    audit.userId,
    safeJson(audit.details),
    audit.createdAt
  );
  return audit;
}

function saveAnalysisJob(job = {}) {
  // Strip large text fields from request before persisting to avoid WAL bloat
  const requestForPersist = job.request ? { ...job.request } : {};
  delete requestForPersist.contract_text;
  delete requestForPersist.previous_text;
  delete requestForPersist.text;
  delete requestForPersist.clauses;
  const persisted = {
    id: job.id,
    status: job.status || "queued",
    phase: job.phase || "",
    request_json: safeJson(requestForPersist),
    result_json: safeJson(job.result || null),
    error: job.error || null,
    cost_meta_json: safeJson(job.costMeta || null),
    created_at: job.createdAt || nowIso(),
    updated_at: job.updatedAt || nowIso(),
    completed_at: job.completedAt || null,
    position_in_queue: Number.isFinite(Number(job.positionInQueue)) ? Number(job.positionInQueue) : null,
  };
  db.prepare(`
    INSERT INTO analysis_jobs (
      id, status, phase, request_json, result_json, error, cost_meta_json,
      created_at, updated_at, completed_at, position_in_queue
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      phase = excluded.phase,
      request_json = excluded.request_json,
      result_json = excluded.result_json,
      error = excluded.error,
      cost_meta_json = excluded.cost_meta_json,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      completed_at = excluded.completed_at,
      position_in_queue = excluded.position_in_queue
  `).run(
    persisted.id,
    persisted.status,
    persisted.phase,
    persisted.request_json,
    persisted.result_json,
    persisted.error,
    persisted.cost_meta_json,
    persisted.created_at,
    persisted.updated_at,
    persisted.completed_at,
    persisted.position_in_queue
  );
  return persisted;
}

function listAnalysisJobs(statuses = []) {
  const normalized = Array.isArray(statuses) ? statuses.filter(Boolean) : [];
  const rows = normalized.length
    ? db.prepare(`SELECT * FROM analysis_jobs WHERE status IN (${normalized.map(() => "?").join(",")}) ORDER BY created_at ASC`).all(...normalized)
    : db.prepare("SELECT * FROM analysis_jobs ORDER BY created_at ASC").all();
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    phase: row.phase,
    request: parseJson(row.request_json, {}) || {},
    result: parseJson(row.result_json, null),
    error: row.error || null,
    costMeta: parseJson(row.cost_meta_json, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    positionInQueue: Number.isFinite(Number(row.position_in_queue)) ? Number(row.position_in_queue) : null,
  }));
}

function deleteAnalysisJob(id) {
  db.prepare("DELETE FROM analysis_jobs WHERE id = ?").run(id);
}

/* ─────────────── File archive API ─────────────── */
function saveContractFile(contractId, versionId, buffer, originalName, mimeType, fileType = "attachment") {
  const contract = db.prepare("SELECT id, name, counterparty_name as counterpartyName, created_at FROM contracts WHERE id = ?").get(contractId);
  if (!contract) throw new Error(`Contract ${contractId} not found`);

  const folderPath = ensureContractFolder(contract);
  const subDir = fileType === "export" ? "exports" : fileType === "version" ? "versions" : "attachments";
  const destDir = path.join(folderPath, subDir);
  fs.mkdirSync(destDir, { recursive: true });

  const ext = path.extname(originalName) || ".bin";
  const base = path.basename(originalName, ext).replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const uniqueSuffix = crypto.randomBytes(4).toString("hex");
  let fileName = `${timestamp}-${base}-${uniqueSuffix}${ext}`;
  let filePath = path.join(destDir, fileName);
  while (fs.existsSync(filePath)) {
    fileName = `${timestamp}-${base}-${crypto.randomBytes(4).toString("hex")}${ext}`;
    filePath = path.join(destDir, fileName);
  }

  fs.writeFileSync(filePath, buffer);

  const id = `file-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const size = fs.statSync(filePath).size;
  db.prepare(`
    INSERT INTO files (id, contract_id, version_id, name, original_name, mime_type, file_path, size, file_type, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, contractId, versionId || null, fileName, originalName, mimeType, filePath, size, fileType, nowIso());

  return { id, name: fileName, originalName, path: filePath, size, fileType };
}

function getContractFiles(contractId, fileType = null) {
  const stmt = fileType
    ? db.prepare("SELECT * FROM files WHERE contract_id = ? AND file_type = ? ORDER BY created_at DESC")
    : db.prepare("SELECT * FROM files WHERE contract_id = ? ORDER BY created_at DESC");
  const rows = fileType ? stmt.all(contractId, fileType) : stmt.all(contractId);
  return rows.map(row => ({
    id: row.id, contractId: row.contract_id, versionId: row.version_id,
    name: row.name, originalName: row.original_name, mimeType: row.mime_type,
    path: row.file_path, size: row.size, fileType: row.file_type, createdAt: row.created_at,
  }));
}

function getFileById(fileId) {
  const row = db.prepare("SELECT * FROM files WHERE id = ?").get(fileId);
  if (!row) return null;
  return {
    id: row.id, contractId: row.contract_id, versionId: row.version_id,
    name: row.name, originalName: row.original_name, mimeType: row.mime_type,
    path: row.file_path, size: row.size, fileType: row.file_type, createdAt: row.created_at,
  };
}

function deleteFilesForContract(contractId) {
  const files = getContractFiles(contractId);
  files.forEach((file) => {
    if (file?.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
  });
  db.prepare("DELETE FROM files WHERE contract_id = ?").run(contractId);
}

function deleteFilesForVersion(versionId) {
  const rows = db.prepare("SELECT id FROM files WHERE version_id = ?").all(versionId);
  rows.forEach((row) => deleteFile(row.id));
}

function deleteFile(fileId) {
  const file = getFileById(fileId);
  if (file && fs.existsSync(file.path)) {
    fs.unlinkSync(file.path);
  }
  db.prepare("DELETE FROM files WHERE id = ?").run(fileId);
  return file;
}

function listAllContractsWithPaths() {
  return db.prepare("SELECT id, name, counterparty_name, folder_path FROM contracts").all().map(row => ({
    id: row.id, name: row.name, counterpartyName: row.counterparty_name, folderPath: row.folder_path,
  }));
}

function deleteContractCascade(contractId) {
  const contract = db.prepare("SELECT id, name, folder_path FROM contracts WHERE id = ?").get(contractId);
  if (!contract) return null;
  deleteFilesForContract(contractId);
  db.prepare("DELETE FROM contracts WHERE id = ?").run(contractId);
  if (contract.folder_path && isPathInsideRoot(WORKBENCH_ROOT, contract.folder_path) && fs.existsSync(contract.folder_path)) {
    fs.rmSync(contract.folder_path, { recursive: true, force: true });
  }
  return {
    id: contract.id,
    name: contract.name,
    folderPath: contract.folder_path,
  };
}

function deleteContractVersionCascade(versionId) {
  const version = db.prepare("SELECT id, contract_id as contractId, type, created_at as createdAt FROM contract_versions WHERE id = ?").get(versionId);
  if (!version) return null;
  deleteFilesForVersion(versionId);
  db.prepare("DELETE FROM contract_versions WHERE id = ?").run(versionId);
  return version;
}

/* ─────────────── Auto-backup ─────────────── */
function copyDirectoryIfExists(sourceDir, targetDir) {
  if (!fs.existsSync(sourceDir)) return;
  fs.cpSync(sourceDir, targetDir, { recursive: true });
}

function snapshotDirectoryIfExists(sourceDir, tempPath) {
  if (!fs.existsSync(sourceDir)) return;
  fs.rmSync(tempPath, { recursive: true, force: true });
  fs.cpSync(sourceDir, tempPath, { recursive: true });
}

function readBackupManifest(backupPath) {
  const manifestPath = path.join(backupPath, "manifest.json");
  if (!fs.existsSync(manifestPath)) return null;
  return parseJson(fs.readFileSync(manifestPath, "utf8"), null);
}

async function runAutoBackup() {
  const backupDir = path.join(WORKBENCH_ROOT, "backups");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backupPath = path.join(backupDir, `auto-${timestamp}`);
  const tempContractsSnapshot = path.join(backupDir, `.snapshot-contracts-${timestamp}`);
  const tempFilesSnapshot = path.join(backupDir, `.snapshot-files-${timestamp}`);
  try {
    runWalCheckpoint("FULL");
    fs.mkdirSync(backupDir, { recursive: true });
    fs.mkdirSync(backupPath, { recursive: true });
    snapshotDirectoryIfExists(path.join(WORKBENCH_ROOT, "contracts"), tempContractsSnapshot);
    snapshotDirectoryIfExists(FILE_DIR, tempFilesSnapshot);
    const backupDbPath = path.join(backupPath, "workbench.sqlite");
    await db.backup(backupDbPath);
    copyDirectoryIfExists(tempContractsSnapshot, path.join(backupPath, "contracts"));
    copyDirectoryIfExists(tempFilesSnapshot, path.join(backupPath, "files"));
    runWalCheckpoint("TRUNCATE");
    fs.writeFileSync(path.join(backupPath, "manifest.json"), safeJson({
      createdAt: nowIso(),
      dbFile: "workbench.sqlite",
      included: ["contracts", "files"],
    }));
    // Prune old backups by count and total size
    const MAX_BACKUP_COUNT = config.maxBackups;
    const MAX_BACKUP_SIZE_BYTES = config.maxBackupSize;

    function getDirectorySize(dir) {
      let size = 0;
      try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const entryPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            size += getDirectorySize(entryPath);
          } else {
            try { size += fs.statSync(entryPath).size; } catch (e) {}
          }
        }
      } catch (e) {}
      return size;
    }

    let backups = fs.readdirSync(backupDir)
      .filter(f => f.startsWith("auto-"))
      .map(f => {
        const p = path.join(backupDir, f);
        return { name: f, path: p, time: fs.statSync(p).mtime.getTime(), size: getDirectorySize(p) };
      })
      .sort((a, b) => b.time - a.time);

    // Prune by count
    backups.slice(MAX_BACKUP_COUNT).forEach(b => {
      try { fs.rmSync(b.path, { recursive: true, force: true }); } catch (e) {}
    });
    backups = backups.slice(0, MAX_BACKUP_COUNT);

    // Prune by total size (oldest first)
    let totalSize = backups.reduce((sum, b) => sum + b.size, 0);
    while (totalSize > MAX_BACKUP_SIZE_BYTES && backups.length > 1) {
      const oldest = backups.pop();
      try { fs.rmSync(oldest.path, { recursive: true, force: true }); } catch (e) {}
      totalSize -= oldest.size;
    }

    return backupPath;
  } catch (err) {
    console.error("[store-sqlite] Backup failed:", err.message);
    return null;
  } finally {
    try {
      if (fs.existsSync(tempContractsSnapshot)) fs.rmSync(tempContractsSnapshot, { recursive: true, force: true });
    } catch (e) {
      console.error("[store-sqlite] Failed to clean up tempContractsSnapshot:", e.message);
    }
    try {
      if (fs.existsSync(tempFilesSnapshot)) fs.rmSync(tempFilesSnapshot, { recursive: true, force: true });
    } catch (e) {
      console.error("[store-sqlite] Failed to clean up tempFilesSnapshot:", e.message);
    }
  }
}

function restoreBackupToDirectory(backupPath, targetRoot) {
  const resolvedBackup = path.resolve(backupPath);
  const resolvedTarget = path.resolve(targetRoot);
  if (resolvedTarget === path.resolve(WORKBENCH_ROOT)) {
    throw new Error("Refusing to restore backup over the active workbench root");
  }
  const manifest = readBackupManifest(resolvedBackup);
  const backupDbPath = path.join(resolvedBackup, manifest?.dbFile || "workbench.sqlite");
  if (!fs.existsSync(backupDbPath)) {
    throw new Error(`Backup sqlite file not found: ${backupDbPath}`);
  }

  const targetDataDir = path.join(resolvedTarget, "data");
  const targetContractsDir = path.join(resolvedTarget, "contracts");
  const targetFilesDir = path.join(resolvedTarget, "files");
  const targetDbPath = path.join(targetDataDir, "workbench.sqlite");
  if (path.resolve(targetDbPath) === path.resolve(DB_PATH)) {
    throw new Error("Refusing to overwrite the active sqlite database");
  }
  fs.mkdirSync(targetDataDir, { recursive: true });
  // Close active DB connection before copying to avoid EBUSY / WAL inconsistency
  try { closeDb(); } catch (e) {}
  try {
    fs.copyFileSync(backupDbPath, targetDbPath);
  } finally {
    // Re-open database connection
    try {
      const newDb = new Database(DB_PATH, { timeout: 5000 });
      newDb.pragma("journal_mode = WAL");
      newDb.pragma("foreign_keys = ON");
      // Replace the module-level db reference used by other functions
      db = newDb;
    } catch (reopenErr) {
      console.error("[store-sqlite] Failed to reopen database after backup restore:", reopenErr.message);
      throw new Error("Database connection lost after backup restore. Please restart the application.");
    }
  }
  copyDirectoryIfExists(path.join(resolvedBackup, "contracts"), targetContractsDir);
  copyDirectoryIfExists(path.join(resolvedBackup, "files"), targetFilesDir);
  return {
    targetRoot: resolvedTarget,
    database: targetDbPath,
    contractsDir: targetContractsDir,
    filesDir: targetFilesDir,
    manifest,
  };
}

/* ─────────────── Full-text search ─────────────── */
function tokenizeForFts(text) {
  if (!text) return "";
  const str = String(text);
  // Insert space between CJK characters to enable single-char matching with unicode61
  return str
    .replace(/([\u4e00-\u9fa5])/g, " $1 ")
    .replace(/\s+/g, " ")
    .trim();
}

function rebuildSearchIndex(snapshot) {
  try {
    const tx = db.transaction(() => {
      db.prepare("DELETE FROM search_index").run();
      const insert = db.prepare(`
        INSERT INTO search_index (content, title, entity_type, entity_id, contract_id, extra)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      for (const c of snapshot.contracts || []) {
        const content = tokenizeForFts([c.name, c.type, c.purpose, c.businessBackground, c.counterpartyName, c.text, c.cleanText].filter(Boolean).join("\n"));
        insert.run(content, c.name, "contract", c.id, c.id, safeJson({ status: c.status, riskLevel: c.riskLevel, counterpartyName: c.counterpartyName }));
      }
      for (const cl of snapshot.clauses || []) {
        const content = tokenizeForFts([cl.title, cl.text, cl.type].filter(Boolean).join("\n"));
        insert.run(content, cl.title || cl.type || "", "clause", cl.id, cl.contractId || "", safeJson({ type: cl.type, hierarchyLevel: cl.hierarchyLevel }));
      }
      for (const f of snapshot.findings || []) {
        const content = tokenizeForFts([f.title, f.issue, f.consequence, f.proposedRevision, f.commentText, f.negotiationPosition].filter(Boolean).join("\n"));
        insert.run(content, f.title || f.issue || "", "finding", f.id, f.contractId || "", safeJson({ severity: f.severity, actionType: f.actionType }));
      }
      for (const pb of snapshot.playbooks || []) {
        const content = tokenizeForFts([pb.type, pb.standard, pb.fallback, pb.forbidden, pb.negotiation, pb.keywords?.join(" ")].filter(Boolean).join("\n"));
        insert.run(content, pb.type || "", "playbook", pb.id, "", safeJson({ ourRole: pb.ourRole, usageCount: pb.usageCount }));
      }
      for (const cp of snapshot.counterparties || []) {
        const content = tokenizeForFts([cp.name, cp.type, cp.industry, cp.notes, cp.contact, cp.email].filter(Boolean).join("\n"));
        insert.run(content, cp.name || "", "counterparty", cp.id, "", safeJson({ riskLevel: cp.riskLevel, importance: cp.importance }));
      }
      for (const r of snapshot.riskRules || []) {
        const content = tokenizeForFts([r.title, r.issue, r.suggestion, r.pattern].filter(Boolean).join("\n"));
        insert.run(content, r.title || r.type || "", "risk_rule", r.id, "", safeJson({ severity: r.severity, status: r.status }));
      }
    });
    tx();
    try {
      db.prepare("INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)").run("searchIndexStatus", safeJson({ status: "ok", rebuiltAt: new Date().toISOString() }));
    } catch (e) {}
  } catch (err) {
    console.error("[store-sqlite] rebuildSearchIndex failed:", err.message);
    try {
      db.prepare("INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)").run("searchIndexStatus", safeJson({ status: "failed", error: err.message, failedAt: new Date().toISOString() }));
    } catch (e) {}
  }
}

function escapeFts5Term(term) {
  // Escape FTS5 special characters and prefix operators
  let t = String(term || "").replace(/"/g, '""');
  // Escape backslash first, then other specials
  t = t.replace(/\\/g, '\\\\');
  // Escape remaining FTS5 metacharacters: * (prefix), - (NOT), ^ (initial)
  t = t.replace(/[*^]/g, '\\$&');
  return t;
}

function search(query, options = {}) {
  const { types = [], limit = 50, contractId = null } = options;
  if (!query || String(query).trim().length < 1) return [];

  const q = String(query).trim();
  const rawTerms = tokenizeForFts(q)
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
  // Filter out bare FTS5 boolean operators to avoid syntax errors
  const reserved = new Set(["and", "or", "not"]);
  const terms = rawTerms
    .filter((term) => !reserved.has(term.toLowerCase()))
    .map((term) => `"${escapeFts5Term(term)}"`);
  const safeQuery = terms.join(" ");
  if (!safeQuery) return [];
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
  const searchIndexCount = db.prepare("SELECT COUNT(*) as c FROM search_index").get().c;
  if (searchIndexCount === 0) {
    rebuildSearchIndex(assembleStructuredSnapshot());
  }

  let sql = `SELECT * FROM search_index WHERE search_index MATCH ?`;
  const params = [safeQuery];

  if (types.length) {
    const placeholders = types.map(() => "?").join(",");
    sql += ` AND entity_type IN (${placeholders})`;
    params.push(...types);
  }

  if (contractId) {
    sql += ` AND contract_id = ?`;
    params.push(contractId);
  }

  sql += ` LIMIT ?`;
  params.push(safeLimit);

  const rows = db.prepare(sql).all(...params);
  return rows.map((row, idx) => ({
    rank: idx,
    content: row.content,
    title: row.title,
    entityType: row.entity_type,
    entityId: row.entity_id,
    contractId: row.contract_id,
    extra: parseJson(row.extra, {}),
  }));
}

function searchContracts(query, limit = 20) {
  return search(query, { types: ["contract"], limit });
}

function searchClauses(query, contractId, limit = 20) {
  return search(query, { types: ["clause"], limit, contractId });
}

function searchGlobal(query, limit = 50) {
  return search(query, { limit });
}

/* ─────────────── Analysis cache persistence ─────────────── */
function loadAnalysisCache({ maxEntries = 100, ttlMs = 24 * 60 * 60 * 1000 } = {}) {
  const cutoff = Date.now() - ttlMs;
  const rows = db.prepare(
    `SELECT hash, result_json, created_at, hits, size_bytes FROM analysis_cache WHERE created_at > ? ORDER BY created_at DESC LIMIT ?`
  ).all(cutoff, maxEntries);
  const entries = new Map();
  const accessOrder = [];
  let currentBytes = 0;
  for (const row of rows) {
    const result = parseJson(row.result_json, null);
    if (!result) continue;
    entries.set(row.hash, {
      result,
      createdAt: row.created_at,
      hits: row.hits,
      sizeBytes: row.size_bytes,
    });
    accessOrder.push(row.hash);
    currentBytes += row.size_bytes;
  }
  return { entries, accessOrder, currentBytes };
}

function saveAnalysisCacheEntry(hash, result, sizeBytes, hits = 1) {
  db.prepare(
    `INSERT INTO analysis_cache (hash, result_json, created_at, hits, size_bytes)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(hash) DO UPDATE SET
       result_json = excluded.result_json,
       created_at = excluded.created_at,
       hits = excluded.hits,
       size_bytes = excluded.size_bytes`
  ).run(hash, safeJson(result), Date.now(), hits, sizeBytes);
}

function pruneAnalysisCache({ maxEntries = 100, ttlMs = 24 * 60 * 60 * 1000, maxBytes = 100 * 1024 * 1024 } = {}) {
  const cutoff = Date.now() - ttlMs;
  db.prepare(`DELETE FROM analysis_cache WHERE created_at <= ?`).run(cutoff);
  const count = db.prepare(`SELECT COUNT(*) as c FROM analysis_cache`).get().c;
  if (count > maxEntries) {
    const excess = count - maxEntries;
    db.prepare(`DELETE FROM analysis_cache WHERE hash IN (
      SELECT hash FROM analysis_cache ORDER BY created_at ASC LIMIT ?
    )`).run(excess);
  }
  const totalSize = db.prepare(`SELECT COALESCE(SUM(size_bytes), 0) as s FROM analysis_cache`).get().s;
  if (totalSize > maxBytes) {
    db.prepare(`DELETE FROM analysis_cache WHERE hash IN (
      SELECT hash FROM analysis_cache ORDER BY created_at ASC LIMIT (
        SELECT COUNT(*) FROM analysis_cache WHERE size_bytes > 0
      ) / 4 + 1
    )`).run();
  }
}

/* ─────────────── Exports ─────────────── */
function closeDb() {
  try { clearInterval(checkpointInterval); } catch (e) {}
  try { db.close(); } catch (e) {}
}

function runInTransaction(fn) {
  const tx = db.transaction(fn);
  return tx();
}

module.exports = {
  readDb,
  closeDb,
  writeDb,
  replaceDb,
  runInTransaction,
  upsertContract,
  getContractWithTexts,
  upsertContractWithAudit,
  upsertContractVersion,
  upsertContractVersionWithAudit,
  replaceContractClauses,
  replaceContractFindings,
  replaceClauseActions,
  appendInsertedClause,
  patchAuxState,
  appendAuditLog,
  saveAnalysisJob,
  listAnalysisJobs,
  deleteAnalysisJob,
  deleteContractCascade,
  deleteContractVersionCascade,
  saveFile,
  flattenClauseActions,
  saveContractFile,
  getContractFiles,
  getFileById,
  deleteFile,
  getContractFolder,
  listAllContractsWithPaths,
  runAutoBackup,
  runWalCheckpoint,
  checkpointIfWalLarge,
  restoreBackupToDirectory,
  search,
  searchContracts,
  searchClauses,
  searchGlobal,
  loadAnalysisCache,
  saveAnalysisCacheEntry,
  pruneAnalysisCache,
  DATA_DIR,
  DB_PATH,
  WAL_PATH,
  FILE_DIR,
  WORKBENCH_ROOT,
};
