/**
 * SQLite-based persistent storage for Legal Contract Workbench.
 * Replaces JSON file storage with structured tables + full snapshot blob.
 * Keeps backward-compatible readDb/replaceDb/saveFile interfaces.
 */

const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");
const os = require("os");

const WORKBENCH_ROOT = process.env.LEGAL_WORKBENCH_DATA_DIR
  || path.join(os.homedir(), "LegalWorkbench");
const DATA_DIR = path.join(WORKBENCH_ROOT, "data");
const FILE_DIR = path.join(WORKBENCH_ROOT, "files");
const DB_PATH = path.join(DATA_DIR, "workbench.sqlite");

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(FILE_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

/* ─────────────── Migrations ─────────────── */
function migrate() {
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
      created_at TEXT
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
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS clause_actions (
      id TEXT PRIMARY KEY,
      source_key TEXT NOT NULL,
      clause_id TEXT NOT NULL,
      action_type TEXT,
      text TEXT,
      comment TEXT,
      created_at TEXT
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
      created_at TEXT
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
      created_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_contract_versions_contract_id ON contract_versions(contract_id);
    CREATE INDEX IF NOT EXISTS idx_clauses_contract_id ON clauses(contract_id);
    CREATE INDEX IF NOT EXISTS idx_findings_contract_id ON findings(contract_id);
    CREATE INDEX IF NOT EXISTS idx_clause_actions_source_key ON clause_actions(source_key);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_files_contract_id ON files(contract_id);

    -- Full-text search index (FTS5 with unicode61; CJK chars are space-separated on insert)
    -- Note: if you need to change tokenizer, delete workbench.sqlite and let it recreate
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
}
migrate();

/* ─────────────── Helpers ─────────────── */
function safeJson(value) {
  try { return JSON.stringify(value); } catch { return "null"; }
}
function parseJson(text, fallback = null) {
  try { return JSON.parse(text); } catch { return fallback; }
}
function nowIso() { return new Date().toISOString(); }

const emptyDb = {
  snapshot: null,
  contracts: [],
  contractVersions: [],
  clauses: [],
  clauseActions: [],
  counterparties: [],
  playbooks: [],
  reviewRecords: [],
  auditLogs: [],
  users: [{ id: "local-admin", name: "Local Admin", role: "admin", permissions: ["contracts:read", "contracts:write", "playbooks:write", "admin"] }],
};

/* ─────────────── Contract archive helpers ─────────────── */
function ensureContractFolder(contract) {
  const year = (contract.createdAt || nowIso()).slice(0, 4);
  const safeCounterparty = String(contract.counterpartyName || "unknown").replace(/[\\/:*?"<>|]/g, "_").slice(0, 40);
  const safeName = String(contract.name || "untitled").replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
  const folderName = `${contract.id}-${safeCounterparty}-${safeName}`;
  const folderPath = path.join(WORKBENCH_ROOT, "contracts", year, folderName);
  fs.mkdirSync(folderPath, { recursive: true });
  fs.mkdirSync(path.join(folderPath, "versions"), { recursive: true });
  fs.mkdirSync(path.join(folderPath, "exports"), { recursive: true });
  fs.mkdirSync(path.join(folderPath, "attachments"), { recursive: true });
  return folderPath;
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
  const normalizedSnapshot = {
    ...snapshot,
    storageMeta: {
      ...(snapshot.storageMeta || {}),
      backendSavedAt: savedAt,
      source: "backend-primary",
    },
  };

  const tx = db.transaction(() => {
    // 1. Save full snapshot blob
    db.prepare(`INSERT OR REPLACE INTO app_state (key, value) VALUES ('snapshot', ?)`)
      .run(safeJson(normalizedSnapshot));

    // 2. Clear structured tables
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
  });

  tx();
  rebuildSearchIndex(normalizedSnapshot);

  // Deep clone to avoid circular references when serialized to JSON
  const returnSnapshot = JSON.parse(JSON.stringify(normalizedSnapshot));
  // Clone again for top-level fields so they don't share references with snapshot internals
  const clonedFields = JSON.parse(JSON.stringify({
    contracts: returnSnapshot.contracts || [],
    contractVersions: returnSnapshot.updates || returnSnapshot.contractVersions || [],
    clauses: returnSnapshot.clauses || [],
    clauseActions: flattenClauseActions(returnSnapshot.clauseActions || {}),
    counterparties: returnSnapshot.counterparties || [],
    playbooks: returnSnapshot.playbooks || [],
    reviewRecords: returnSnapshot.findings || returnSnapshot.reviewRecords || [],
    auditLogs: returnSnapshot.auditLogs || [],
    users: returnSnapshot.users || emptyDb.users,
  }));
  return {
    snapshot: returnSnapshot,
    ...clonedFields,
    savedAt,
  };
}

/* ─────────────── readDb (assemble from structured tables) ─────────────── */
function readDb() {
  const savedAt = nowIso();

  // Try to read full snapshot blob first
  const snapshotRow = db.prepare("SELECT value FROM app_state WHERE key = 'snapshot'").get();
  if (snapshotRow?.value) {
    const snapshot = parseJson(snapshotRow.value, null);
    if (snapshot) {
      // Deep clone to avoid circular references in JSON serialization
      // (snapshot.contracts and top-level contracts point to the same array)
      const snapshotCopy = JSON.parse(JSON.stringify(snapshot));
      const clonedFields = JSON.parse(JSON.stringify({
        contracts: snapshotCopy.contracts || [],
        contractVersions: snapshotCopy.updates || snapshotCopy.contractVersions || [],
        clauses: snapshotCopy.clauses || [],
        clauseActions: flattenClauseActions(snapshotCopy.clauseActions || {}),
        counterparties: snapshotCopy.counterparties || [],
        playbooks: snapshotCopy.playbooks || [],
        reviewRecords: snapshotCopy.findings || snapshotCopy.reviewRecords || [],
        auditLogs: snapshotCopy.auditLogs || [],
        users: snapshotCopy.users || emptyDb.users,
      }));
      return {
        snapshot: snapshotCopy,
        ...clonedFields,
        savedAt,
      };
    }
  }

  // Fallback: assemble from structured tables
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

  const users = db.prepare("SELECT * FROM users").all().map(row => ({
    id: row.id, name: row.name, role: row.role,
    permissions: parseJson(row.permissions, []),
  }));

  const snapshot = {
    contracts, updates: contractVersions, clauses, findings,
    clauseActions, counterparties, negotiations, playbooks, riskRules,
    auditLogs, users,
  };

  return {
    snapshot,
    contracts,
    contractVersions,
    clauses,
    clauseActions: flattenClauseActions(clauseActions),
    counterparties,
    playbooks,
    reviewRecords: findings,
    auditLogs,
    users,
    savedAt,
  };
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
  const fileName = fileType === "export"
    ? `${timestamp}-${base}${ext}`
    : `${base}${ext}`;
  const filePath = path.join(destDir, fileName);

  fs.writeFileSync(filePath, buffer);

  const id = `file-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
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

/* ─────────────── Auto-backup ─────────────── */
async function runAutoBackup() {
  try {
    const backupDir = path.join(WORKBENCH_ROOT, "backups");
    fs.mkdirSync(backupDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const backupPath = path.join(backupDir, `auto-${timestamp}.sqlite`);
    await db.backup(backupPath);
    // Keep last 20 backups
    const files = fs.readdirSync(backupDir)
      .filter(f => f.startsWith("auto-") && f.endsWith(".sqlite"))
      .map(f => ({ name: f, time: fs.statSync(path.join(backupDir, f)).mtime.getTime() }))
      .sort((a, b) => b.time - a.time);
    files.slice(20).forEach(f => fs.unlinkSync(path.join(backupDir, f.name)));
    return backupPath;
  } catch (err) {
    console.error("[store-sqlite] Backup failed:", err.message);
    return null;
  }
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
    db.prepare("DELETE FROM search_index").run();
    const insert = db.prepare(`
      INSERT INTO search_index (content, title, entity_type, entity_id, contract_id, extra)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    // Index contracts
    for (const c of snapshot.contracts || []) {
      const content = tokenizeForFts([c.name, c.type, c.purpose, c.businessBackground, c.counterpartyName, c.text, c.cleanText].filter(Boolean).join("\n"));
      insert.run(content, c.name, "contract", c.id, c.id, safeJson({ status: c.status, riskLevel: c.riskLevel, counterpartyName: c.counterpartyName }));
    }

    // Index clauses
    for (const cl of snapshot.clauses || []) {
      const content = tokenizeForFts([cl.title, cl.text, cl.type].filter(Boolean).join("\n"));
      insert.run(content, cl.title || cl.type || "", "clause", cl.id, cl.contractId || "", safeJson({ type: cl.type, hierarchyLevel: cl.hierarchyLevel }));
    }

    // Index findings
    for (const f of snapshot.findings || []) {
      const content = tokenizeForFts([f.title, f.issue, f.consequence, f.proposedRevision, f.commentText, f.negotiationPosition].filter(Boolean).join("\n"));
      insert.run(content, f.title || f.issue || "", "finding", f.id, f.contractId || "", safeJson({ severity: f.severity, actionType: f.actionType }));
    }

    // Index playbooks
    for (const pb of snapshot.playbooks || []) {
      const content = tokenizeForFts([pb.type, pb.standard, pb.fallback, pb.forbidden, pb.negotiation, pb.keywords?.join(" ")].filter(Boolean).join("\n"));
      insert.run(content, pb.type || "", "playbook", pb.id, "", safeJson({ ourRole: pb.ourRole, usageCount: pb.usageCount }));
    }

    // Index counterparties
    for (const cp of snapshot.counterparties || []) {
      const content = tokenizeForFts([cp.name, cp.type, cp.industry, cp.notes, cp.contact, cp.email].filter(Boolean).join("\n"));
      insert.run(content, cp.name || "", "counterparty", cp.id, "", safeJson({ riskLevel: cp.riskLevel, importance: cp.importance }));
    }

    // Index risk rules
    for (const r of snapshot.riskRules || []) {
      const content = tokenizeForFts([r.title, r.issue, r.suggestion, r.pattern].filter(Boolean).join("\n"));
      insert.run(content, r.title || r.type || "", "risk_rule", r.id, "", safeJson({ severity: r.severity, status: r.status }));
    }
  } catch (err) {
    console.error("[store-sqlite] rebuildSearchIndex failed:", err.message);
  }
}

function search(query, options = {}) {
  const { types = [], limit = 50, contractId = null } = options;
  if (!query || String(query).trim().length < 1) return [];

  const q = String(query).trim();
  // Tokenize CJK for matching, escape FTS5 special chars
  const safeQuery = tokenizeForFts(q).replace(/["*]/g, "");
  if (!safeQuery) return [];

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
  params.push(limit);

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

/* ─────────────── Exports ─────────────── */
module.exports = {
  readDb,
  writeDb,
  replaceDb,
  saveFile,
  flattenClauseActions,
  saveContractFile,
  getContractFiles,
  getFileById,
  deleteFile,
  getContractFolder,
  listAllContractsWithPaths,
  runAutoBackup,
  search,
  searchContracts,
  searchClauses,
  searchGlobal,
  DATA_DIR,
  DB_PATH,
  FILE_DIR,
  WORKBENCH_ROOT,
};
