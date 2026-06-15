const os = require("os");
const path = require("path");

/**
 * Centralized configuration for the server process.
 * All environment variable reads are collected here so callers
 * don't scatter process.env access across 15+ files.
 */

function asNumber(value, defaultValue) {
  const n = Number(value);
  return Number.isFinite(n) ? n : defaultValue;
}

function asString(value, defaultValue) {
  return value !== undefined && value !== null && value !== ""
    ? String(value)
    : defaultValue;
}

function asBool(value, defaultValue) {
  if (value === undefined || value === null || value === "") return defaultValue;
  const s = String(value).toLowerCase().trim();
  if (["1", "true", "yes", "on", "y"].includes(s)) return true;
  if (["0", "false", "no", "off", "n", "null", "undefined", ""].includes(s)) return false;
  return defaultValue;
}

const config = {
  // Server basics
  port: asNumber(process.env.LEGAL_WORKBENCH_PORT, 8787),
  dataDir: asString(process.env.LEGAL_WORKBENCH_DATA_DIR, path.join(os.homedir(), "LegalWorkbench")),
  token: asString(process.env.LEGAL_WORKBENCH_TOKEN, ""),

  // Runtime / deployment
  nodeEnv: asString(process.env.NODE_ENV, "production"),
  isPackaged: asBool(process.env.ELECTRON_IS_PACKAGED, false),
  verboseErrors: asBool(process.env.LEGAL_WORKBENCH_VERBOSE_ERRORS, false),

  // Job queue
  maxJobs: asNumber(process.env.LEGAL_WORKBENCH_MAX_JOBS, 2),
  jobTimeoutMs: asNumber(process.env.LEGAL_WORKBENCH_JOB_TIMEOUT_MS, 12 * 60 * 1000),
  jobTtlMs: asNumber(process.env.LEGAL_WORKBENCH_JOB_TTL_MS, 30 * 60 * 1000),
  maxRetries: asNumber(process.env.LEGAL_WORKBENCH_MAX_RETRIES, 2),
  retryBaseMs: asNumber(process.env.LEGAL_WORKBENCH_RETRY_BASE_MS, 2000),

  // Analysis chunking
  directAnalysisMaxText: asNumber(process.env.LEGAL_WORKBENCH_DIRECT_ANALYSIS_MAX_TEXT, 90000),
  directAnalysisMaxClauses: asNumber(process.env.LEGAL_WORKBENCH_DIRECT_ANALYSIS_MAX_CLAUSES, 220),
  chunkAnalysisMaxText: asNumber(process.env.LEGAL_WORKBENCH_CHUNK_ANALYSIS_MAX_TEXT, 45000),
  chunkAnalysisMaxClauses: asNumber(process.env.LEGAL_WORKBENCH_CHUNK_ANALYSIS_MAX_CLAUSES, 80),
  chunkMaxRetries: asNumber(process.env.LEGAL_WORKBENCH_CHUNK_MAX_RETRIES, 2),
  chunkRetryBaseMs: asNumber(process.env.LEGAL_WORKBENCH_CHUNK_RETRY_BASE_MS, 1500),
  chunkConcurrency: asNumber(process.env.LEGAL_WORKBENCH_CHUNK_CONCURRENCY, 3),

  // Runner / skill
  legalSkillAllowFallback: asBool(process.env.LEGAL_SKILL_ALLOW_FALLBACK, true),
  legalSkillRunnerScript: asString(process.env.LEGAL_SKILL_RUNNER_SCRIPT, ""),
  legalSkillCommand: asString(process.env.LEGAL_SKILL_COMMAND, ""),
  legalSkillArgsJson: asString(process.env.LEGAL_SKILL_ARGS_JSON, ""),
  legalWorkOrchestratorSkill: asString(
    process.env.LEGAL_WORK_ORCHESTRATOR_SKILL,
    path.join(os.homedir(), ".codex", "skills", "legal-work-orchestrator", "SKILL.md")
  ),
  runtimeProfile: asString(process.env.LEGAL_WORKBENCH_RUNTIME_PROFILE, ""),
  runtimeMode: asString(process.env.LEGAL_WORKBENCH_RUNTIME_MODE, ""),
  runtimeReason: asString(process.env.LEGAL_WORKBENCH_RUNTIME_REASON, ""),
  effectiveProvider: asString(process.env.LEGAL_WORKBENCH_EFFECTIVE_PROVIDER, ""),

  // Storage
  maxWalBytes: asNumber(process.env.LEGAL_WORKBENCH_MAX_WAL_BYTES, 100 * 1024 * 1024),
  maxBackups: asNumber(process.env.LEGAL_WORKBENCH_MAX_BACKUPS, 20),
  maxBackupSize: asNumber(process.env.LEGAL_WORKBENCH_MAX_BACKUP_SIZE, 50 * 1024 * 1024 * 1024),

  // File upload
  maxFileBytes: asNumber(process.env.LEGAL_WORKBENCH_MAX_FILE_BYTES, 50 * 1024 * 1024),
  maxJsonPayloadBytes: asNumber(
    process.env.LEGAL_WORKBENCH_MAX_JSON_PAYLOAD_BYTES,
    Math.max(20 * 1024 * 1024, Math.floor(asNumber(process.env.LEGAL_WORKBENCH_MAX_FILE_BYTES, 50 * 1024 * 1024) * 1.5))
  ),

  // Cache
  cacheMaxEntries: asNumber(process.env.LEGAL_WORKBENCH_CACHE_MAX, 100),
  cacheTtlMs: asNumber(process.env.LEGAL_WORKBENCH_CACHE_TTL_MS, 24 * 60 * 60 * 1000),
};

module.exports = config;
