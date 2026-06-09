const POLL_TIMEOUT_MS = 8 * 60 * 1000;
const POLL_INTERVAL_MS = 2500;
const VISUAL_QA_DELAY_MS = 30 * 1000;
const VISUAL_QA_COOLDOWN_MS = 10 * 60 * 1000;
const BACKEND_SYNC_DELAY_MS = 700;

async function readBackendError(response, fallbackMessage = "请求失败") {
  let message = fallbackMessage;
  try {
    const data = await response.json();
    if (data?.error) message = data.error;
    if (data?.detail && data.detail !== data.error) message = `${message}：${data.detail}`;
  } catch (error) {}
  if (response.status === 401) return "AI 服务认证失败，请检查本地运行配置。";
  if (response.status === 429) return "AI 服务请求过于频繁，请稍后再试。";
  return `${message}（HTTP ${response.status}）`;
}

function buildLegalSkillRequest(contract, materialText, extraRequirements = "", options = {}) {
  const text = materialText || contract.text || "";
  const sourceKey = `${contract.id}:${state.activeUpdateId || "current"}`;
  const businessBackground = [contract.businessBackground, contract.purpose ? `系统识别合同目的：${contract.purpose}` : ""].filter(Boolean).join("\n");
  const clauses = options.omitClauses ? [] : buildLegalSkillClauseList(text, sourceKey);
  const playbookContext = state.playbooks
    .filter((item) => item.reviewStatus !== "disabled")
    .filter((item) => clauses.some((clause) => clause.type === item.type))
    .map((item) => ({
      type: item.type,
      status: item.status,
      reviewStatus: item.reviewStatus,
      ourRole: item.ourRole,
      standard: item.standard,
      fallback: item.fallback,
      forbidden: item.forbidden,
      negotiation: item.negotiation,
      keywords: item.keywords || [],
      confidenceScore: item.confidenceScore || 0,
      sourceOccurrences: (item.sourceOccurrences || []).slice(0, 5).map((occurrence) => ({
        contractName: occurrence.contractName,
        counterpartyName: occurrence.counterpartyName,
        clauseTitle: occurrence.clauseTitle,
        depositedAt: occurrence.depositedAt,
      })),
      variants: (item.variants || []).slice(0, 3).map((variant) => ({
        text: variant.text,
        status: variant.status,
        source: variant.contractName,
      })),
      knowledgeSignals: (item.knowledgeSignals || []).slice(0, 5),
    }));
  const versionHistory = (state.updates || [])
    .filter((item) => item.contractId === contract.id)
    .map((item) => ({
      id: item.id,
      type: item.type,
      note: item.note,
      materialKind: item.materialKind,
      createdAt: item.createdAt,
      feedbackDeadline: item.feedbackDeadline,
    }));
  const currentUpdate = versionHistory.find((item) => item.id === state.activeUpdateId) || versionHistory[0] || null;
  const progressContext = versionHistory
    .map((item) => {
      const parts = [
        item.createdAt ? `时间：${item.createdAt}` : "",
        item.type ? `版本性质：${item.type}` : "",
        item.materialKind ? `材料类型：${materialKindLabel(item.materialKind)}` : "",
        item.feedbackDeadline ? `反馈期限：${item.feedbackDeadline}` : "",
        item.note ? `进展说明：${item.note}` : "",
      ].filter(Boolean);
      return parts.join("；");
    })
    .filter(Boolean)
    .join("\n");
  return {
    workflow: "legal-contract-review",
    skill: "legal-work-orchestrator",
    downstream_skill: "legal-contract-orchestrator",
    prompt_version: "agent-a-review-v1",
    jurisdiction: contract.jurisdiction || contract.governingLaw || "待确认",
    contract_type: contract.type || "待识别",
    contract_type_category: contract.type || "待识别",
    business_background: businessBackground,
    commercial_context: contract.businessBackground || "",
    detected_contract_purpose: contract.purpose || "",
    party_roles: `我方：${contract.ourRole || "待识别"}；相对方：${contract.counterpartyName || "待识别"}`,
    represented_party: contract.ourRole || "待识别",
    mode: "review",
    contract_text: text,
    clauses,
    clause_playbook_context: playbookContext,
    version_history: versionHistory,
    progress_context: progressContext,
    current_progress_update: currentUpdate,
    counterparty_version: contract.redlineText || "",
    attachments_or_exhibits: contract.commentsText || "",
    drafting_requirements: extraRequirements,
    provider: state.runnerStatus?.provider || "",
    model: state.runnerStatus?.model || "",
    risk_preference: "平衡",
    language: "中文",
    output_format: "structured_json",
  };
}

function buildLegalSkillClauseList(text, sourceKey) {
  return splitVersionClauses(text, sourceKey).flatMap((clause) => {
    const base = {
      id: clause.id,
      stableId: clause.stableId,
      number: clause.number || clause.originalNumberText,
      title: clause.title,
      type: clause.type,
      text: clause.text,
      hierarchyLevel: clause.hierarchyLevel || "article",
    };
    const subclauses = splitSubclauses(clause).map((subclause) => ({
      id: subclause.id,
      stableId: subclause.stableId,
      parentId: clause.id,
      parentStableId: clause.stableId,
      number: extractLeadingDecimalNumber(subclause.text) || `${clause.number}.${subclause.number}`,
      title: subclause.title || extractLeadingDecimalNumber(subclause.text) || "",
      type: subclause.type || clause.type,
      text: subclause.text,
      hierarchyLevel: "subclause",
    }));
    return [base, ...subclauses];
  });
}

function extractLeadingDecimalNumber(text) {
  const match = String(text || "").trim().match(/^(\d+(?:\.\d+)*)(?:[.．、\s]|$)/);
  return match?.[1] || "";
}

async function runLegalSkillAnalysis(contract, materialText, extraRequirements = "", options = {}) {
  const request = buildLegalSkillRequest(contract, materialText, extraRequirements, options);
  try {
    const response = await legalWorkbenchFetch("/api/legal-review/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    if (response.status === 202) {
      const data = await response.json();
      return await pollLegalSkillJob(data.job.id, contract.id, options);
    }
    if (response.ok) return normalizeLegalSkillResult(await response.json());
    throw new Error(await readBackendError(response, "本地 Legal Skill 服务返回错误"));
  } catch (error) {
    if (!isLikelyServerUnavailableError(error)) throw error;
    if (!options.allowBrowserFallback) throw new Error("AI 后端不可用，无法执行 Legal Skill。请确认本地服务和 AI Runner 已启动。");
    // Debug: local legal skill server unavailable; using browser fallback.
  }
  // Browser fallback: preserve the Legal Skill IO shape when the local runner is unavailable.
  // A backend service should replace this with legal-work-orchestrator / legal-contract-orchestrator execution.
  const clauses = splitVersionClauses(request.contract_text, `${contract.id}:analysis-preview`);
  const findings = generateFindings(contract, clauses);
  return normalizeLegalSkillResult({
    ok: true,
    source: "browser-fallback",
    isFallback: true,
    fallbackReason: "Local backend unavailable; using browser fallback review.",
    request,
    response: {
      contractSummary: {
        contractName: contract.name,
        contractType: contract.type,
        purpose: contract.purpose,
        businessBackground: contract.businessBackground,
        ourRole: contract.ourRole,
        counterparty: contract.counterpartyName,
        riskLevel: contract.riskLevel,
        completionScore: null,
        positionDeviationLevel: null,
      },
      contractLevelRisks: findings.filter((finding) => !finding.clauseId),
      clauseAnalyses: findings
        .filter((finding) => finding.clauseId)
        .map((finding) => ({
          clauseId: finding.clauseId,
          severity: finding.severity,
          issue: finding.issue,
          consequence: finding.consequence,
          proposedRevision: finding.fix,
          negotiationPosition: finding.negotiation,
          fallbackText: "",
          businessDecision: finding.needsBusiness ? "需业务确认" : "",
        })),
      missingFacts: [],
      businessSummary: "",
    },
  });
}

function isLikelyServerUnavailableError(error) {
  const message = String(error?.message || error || "");
  return /Failed to fetch|NetworkError|Load failed|ECONNREFUSED|ERR_CONNECTION_REFUSED|fetch failed/i.test(message);
}

async function pollLegalSkillJob(jobId, contractId, options = {}) {
  const controller = new AbortController();
  pollControllers.set(jobId, controller);
  try {
    if (!options.silentStatus) setAnalysisStatus(contractId, "running", "AI Legal Skill 正在审阅合同，长合同通常需要 2-3 分钟。");
    const startedAt = Date.now();
    while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
      if (controller.signal.aborted) throw new Error("AI 分析已取消。");
      await delay(POLL_INTERVAL_MS);
      const response = await legalWorkbenchFetch(`/api/legal-review/jobs/${encodeURIComponent(jobId)}`, { signal: controller.signal });
      if (!response.ok) throw new Error(await readBackendError(response, "AI 分析任务状态读取失败"));
      const data = await response.json();
      const job = data.job;
      if (!options.silentStatus) setAnalysisStatus(contractId, job.status, `${job.phase || "分析中"}｜已等待 ${Math.round((Date.now() - startedAt) / 1000)} 秒`);
      if (job.status === "completed") return job.result;
      if (job.status === "failed") throw new Error(job.error || "AI 分析失败");
    }
    throw new Error("AI 分析超时，请稍后重试或缩短合同文本。");
  } finally {
    pollControllers.delete(jobId);
  }
}

function cancelPollJob(jobId) {
  const controller = pollControllers.get(jobId);
  if (controller) {
    controller.abort();
    pollControllers.delete(jobId);
  }
}

function setAnalysisStatus(contractId, status, message) {
  state.analysisJobs = state.analysisJobs || {};
  state.analysisJobs[contractId] = {
    status,
    message,
    updatedAt: new Date().toISOString(),
  };
  if (typeof persistBackendAuxState === "function") {
    persistBackendAuxState({
      analysisJobs: state.analysisJobs,
    }).catch(() => {});
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (state.activeContractId === contractId) renderReview();
}

function clearAnalysisStatus(contractId) {
  if (!state.analysisJobs) return;
  delete state.analysisJobs[contractId];
  if (typeof persistBackendAuxState === "function") {
    persistBackendAuxState({
      analysisJobs: state.analysisJobs,
    }).catch(() => {});
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function setManualLegalSkillRunStatus(contract, material, status, message = "") {
  if (!contract || !material) return;
  const jobKey = material.sourceKey || contract.id;
  state.autoReviewJobs = state.autoReviewJobs || {};
  state.autoReviewJobs[jobKey] = {
    ...(state.autoReviewJobs[jobKey] || {}),
    status,
    reason: "manual",
    message,
    updatedAt: new Date().toISOString(),
    ...(status === "running" ? { startedAt: new Date().toISOString() } : {}),
    ...(status === "completed" ? { completedAt: new Date().toISOString() } : {}),
    ...(status === "failed" ? { failedAt: new Date().toISOString() } : {}),
  };
  if (typeof persistBackendAuxState === "function") {
    persistBackendAuxState({
      autoReviewJobs: state.autoReviewJobs,
    }).catch(() => {});
  }
}

function markLegalSkillRunCompleted(contract, material) {
  if (!contract || !material) return;
  const jobKey = material.sourceKey || contract.id;
  setManualLegalSkillRunStatus(contract, material, "completed", "AI Legal Skill 审阅已完成。");
  const segmentation = state.legalSkillResults?.[contract.id]?.response?.clauseSegmentation || [];
  if (segmentation.length) {
    state.segmentationJobs = state.segmentationJobs || {};
    state.segmentationJobs[jobKey] = {
      ...(state.segmentationJobs[jobKey] || {}),
      status: "completed",
      message: "AI 语义切分已完成。",
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
    if (typeof persistBackendAuxState === "function") {
      persistBackendAuxState({
        segmentationJobs: state.segmentationJobs,
      }).catch(() => {});
    }
  }
}

function hasUsableCodexSegmentation(contract, material) {
  return getClauseSegmentationStatus(material.text, material.sourceKey).source === "ai";
}

function getSegmentationJobTimestamp(job) {
  return [job?.updatedAt, job?.startedAt, job?.completedAt, job?.failedAt]
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => b - a)[0] || 0;
}

function isStaleSegmentationJob(job) {
  const timestamp = getSegmentationJobTimestamp(job);
  const timeoutMs = typeof STALE_JOB_TIMEOUT_MS === "number" ? STALE_JOB_TIMEOUT_MS : 3 * 60 * 1000;
  return Boolean(job?.status === "running" && timestamp && Date.now() - timestamp > timeoutMs);
}

function reconcileCodexSegmentationJob(contract, material) {
  if (!contract || !material) return null;
  const jobKey = material.sourceKey || contract.id;
  const job = state.segmentationJobs?.[jobKey];
  if (!job) return null;
  const now = new Date().toISOString();
  if (job.status === "running" && hasUsableCodexSegmentation(contract, material)) {
    state.segmentationJobs[jobKey] = {
      ...job,
      status: "completed",
      message: "AI 语义切分已完成。",
      completedAt: job.completedAt || now,
      updatedAt: now,
    };
    saveState();
    return state.segmentationJobs[jobKey];
  }
  if (isStaleSegmentationJob(job)) {
    state.segmentationJobs[jobKey] = {
      ...job,
      status: "failed",
      message: "AI 语义切分任务已超时，请稍后重试。",
      failedAt: job.failedAt || now,
      updatedAt: now,
    };
    saveState();
    return state.segmentationJobs[jobKey];
  }
  return job;
}

function inferFindingSourceKey(clauses = [], contractId = "") {
  const clauseId = clauses.find((clause) => typeof clause?.id === "string" && clause.id.includes(":seg-"))?.id || "";
  const match = clauseId.match(/^(.*):seg-\d+(?:::sub-\d+)?$/);
  return match?.[1] || contractId;
}

function isCodexSegmentationRunning(sourceKey) {
  const job = state.segmentationJobs?.[sourceKey];
  if (!job) return false;
  if (isStaleSegmentationJob(job)) {
    const now = new Date().toISOString();
    state.segmentationJobs[sourceKey] = {
      ...job,
      status: "failed",
      message: "AI 语义切分任务已超时，请稍后重试。",
      failedAt: job.failedAt || now,
      updatedAt: now,
    };
    saveState();
    return false;
  }
  return job.status === "running";
}

async function ensureCodexSegmentation(contract, material) {
  if (!contract || !material?.text) return false;
  const jobKey = material.sourceKey || contract.id;
  if (hasUsableCodexSegmentation(contract, material) || isCodexSegmentationRunning(jobKey)) return false;
  state.segmentationJobs = state.segmentationJobs || {};
  state.segmentationJobs[jobKey] = {
    status: "running",
    message: "AI 正在阅读合同并进行章节/条款语义切分。",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  renderReview();
  try {
    const result = await runLegalSkillAnalysis(contract, material.text, buildSegmentationOnlyRequirements(), { omitClauses: true, silentStatus: true });
    mergeSegmentationOnlyResult(contract, result);
    scheduleVisualQa(contract.id, "segmentation-applied", { delay: 500, force: true });
    state.segmentationJobs[jobKey] = {
      status: "completed",
      message: "AI 条款切分已完成。",
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
    saveState();
    renderReview();
    return true;
  } catch (error) {
    state.segmentationJobs[jobKey] = {
      status: "failed",
      message: error.message || String(error),
      updatedAt: new Date().toISOString(),
      failedAt: new Date().toISOString(),
    };
    saveState();
    renderReview();
    return false;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function syncBackendSnapshot() {
  const response = await legalWorkbenchFetch("/api/db/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state),
  });
  if (!response.ok) throw new Error(await readBackendError(response, "本地后端同步失败"));
  return await response.json();
}

async function runBackendSuggestionAction(payload) {
  const response = await legalWorkbenchFetch("/api/ai-suggestion/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await readBackendError(response, "后端 AI 建议动作失败"));
  const result = await response.json();
  return {
    ...result,
    ...normalizeRunnerResultMeta(result),
  };
}

async function runContractIntake(contractText) {
  const response = await legalWorkbenchFetch("/api/contract-intake", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contractText }),
  });
  if (!response.ok) throw new Error(await readBackendError(response, "AI 信息填充失败"));
  const result = await response.json();
  return {
    ...result,
    ...normalizeRunnerResultMeta(result),
  };
}

async function archiveContractFile(contractId, base64Content, originalName, mimeType) {
  const response = await legalWorkbenchFetch(`/api/contracts/${encodeURIComponent(contractId)}/files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contentBase64: base64Content,
      originalName,
      mimeType,
      fileType: "attachment",
    }),
  });
  if (!response.ok) console.error("[Archive] File upload failed:", response.status);
  return response.ok;
}

async function createBackendContract(contract) {
  const response = await legalWorkbenchFetch("/api/contracts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contract }),
  });
  if (!response.ok) throw new Error(await readBackendError(response, "创建合同失败"));
  const data = await response.json();
  return data.contract || contract;
}

async function createBackendContractVersion(version) {
  const response = await legalWorkbenchFetch("/api/contract-versions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version }),
  });
  if (!response.ok) throw new Error(await readBackendError(response, "创建合同版本失败"));
  const data = await response.json();
  return data.version || version;
}

async function createBackendInsertedClause(sourceKey, insertedClause, contract = null) {
  const response = await legalWorkbenchFetch("/api/inserted-clauses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sourceKey,
      contractId: contract?.id || null,
      contractName: contract?.name || "",
      insertedClause,
    }),
  });
  if (!response.ok) throw new Error(await readBackendError(response, "新增条款失败"));
  const data = await response.json();
  return data.insertedClause || insertedClause;
}

async function persistBackendClauseActions(sourceKey, clauseActions) {
  const response = await legalWorkbenchFetch("/api/clause-actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sourceKey,
      clauseActions,
    }),
  });
  if (!response.ok) throw new Error(await readBackendError(response, "保存条款动作失败"));
  const data = await response.json();
  return data.clauseActions || clauseActions;
}

async function deleteBackendContract(contractId) {
  const response = await legalWorkbenchFetch(`/api/contracts/${encodeURIComponent(contractId)}`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error(await readBackendError(response, "删除合同失败"));
  const data = await response.json();
  return data.contract || null;
}

async function deleteBackendContractVersion(versionId) {
  const response = await legalWorkbenchFetch(`/api/contract-versions/${encodeURIComponent(versionId)}`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error(await readBackendError(response, "删除版本失败"));
  const data = await response.json();
  return data.version || null;
}

async function archiveContractExport(contractId, base64Content, originalName, mimeType) {
  const response = await legalWorkbenchFetch(`/api/contracts/${encodeURIComponent(contractId)}/exports`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contentBase64: base64Content,
      originalName,
      mimeType,
    }),
  });
  if (!response.ok) console.error("[Archive] Export save failed:", response.status);
  return response.ok;
}

async function appendBackendAudit(entry = {}) {
  const response = await legalWorkbenchFetch("/api/audit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
  });
  if (!response.ok) return null;
  const data = await response.json();
  return data.audit || null;
}

async function persistBackendAuxState(partialState = {}) {
  const response = await legalWorkbenchFetch("/api/db/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      syncMode: "aux-patch",
      state: partialState,
    }),
  });
  if (!response.ok) throw new Error(await readBackendError(response, "同步辅助状态失败"));
  const data = await response.json();
  return data.db?.auxState || partialState;
}

let backendSyncTimer = null;
let backendSyncInFlight = false;
let backendSyncDirty = false;

const pollControllers = new Map();

async function fetchBackendSnapshot() {
  const response = await legalWorkbenchFetch("/api/db");
  if (!response.ok) throw new Error("本地后端数据加载失败");
  const db = await response.json();
  return db.snapshot || null;
}

async function hydrateFromBackendOnStart() {
  try {
    const snapshot = await fetchBackendSnapshot();
    if (!snapshot?.contracts?.length) return false;
    const loaded = replaceWorkbenchState(snapshot, { source: "backend-primary" });
    if (loaded) {
      state.backendSync = {
        ok: true,
        source: "backend-primary",
        syncedAt: new Date().toISOString(),
      };
      saveState(state, { localOnly: true, preserveUpdatedAt: true });
    }
    return loaded;
  } catch (error) {
    // Debug: backend snapshot unavailable; using localStorage.
    return false;
  }
}

async function refreshRunnerStatus() {
  try {
    const response = await legalWorkbenchFetch("/api/legal-review/runner-status");
    if (!response.ok) throw new Error("runner status unavailable");
    const data = await response.json();
    state.runnerStatus = data.runner;
    state.runnerStatuses = data.runners || {};
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return data.runner;
  } catch (error) {
    state.runnerStatus = { configured: false, mode: "browser-fallback", error: error.message || String(error) };
    state.runnerStatuses = {};
    return state.runnerStatus;
  }
}

function normalizeRunnerResultMeta(result = {}) {
  return {
    source: result.source || "",
    isFallback: Boolean(result.isFallback) || /fallback/i.test(result.source || ""),
    fallbackReason: result.fallbackReason || "",
    promptVersion: result.promptVersion || result.prompt_version || "",
    skillPath: result.skillPath || result.skill_path || "",
    downstreamSkill: result.downstreamSkill || result.downstream_skill || "",
    checkedAt: result.checkedAt || result.checked_at || "",
  };
}

function scheduleBackendSync() {
  backendSyncDirty = true;
  clearTimeout(backendSyncTimer);
  backendSyncTimer = setTimeout(() => flushBackendSync(), BACKEND_SYNC_DELAY_MS);
}

async function flushBackendSync() {
  if (backendSyncInFlight) {
    backendSyncDirty = true;
    return;
  }
  backendSyncInFlight = true;
  backendSyncDirty = false;
  const snapshot = clone(state);
  try {
    const response = await legalWorkbenchFetch("/api/db/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(snapshot),
    });
    if (!response.ok) throw new Error("自动同步失败");
    state.backendSync = {
      ok: true,
      syncedAt: new Date().toISOString(),
    };
    saveState(state, { localOnly: true, preserveUpdatedAt: true });
  } catch (error) {
    state.backendSync = {
      ok: false,
      error: error.message || String(error),
      failedAt: new Date().toISOString(),
    };
    saveState(state, { localOnly: true, preserveUpdatedAt: true });
    // Debug: backend autosync failed; local browser cache remains available.
  } finally {
    backendSyncInFlight = false;
    if (backendSyncDirty) scheduleBackendSync(state);
  }
}

function getStoredSkillResult(contractId) {
  return state.legalSkillResults?.[contractId]?.response || null;
}

const VISUAL_QA_CONTRACT_TEXT_LIMIT = 12000;
const VISUAL_QA_CLAUSE_TEXT_LIMIT = 320;
const VISUAL_QA_FINDING_TEXT_LIMIT = 220;
const VISUAL_QA_MAX_CLAUSES = 120;
const VISUAL_QA_MAX_FINDINGS = 80;
const VISUAL_QA_MAX_ACTIONS = 80;
const VISUAL_QA_MAX_INSERTED_CLAUSES = 40;
const VISUAL_QA_MAX_LOCAL_CHECKS = 40;

function compactVisualQaText(text, maxLength = VISUAL_QA_CLAUSE_TEXT_LIMIT) {
  const value = String(text || "").trim();
  if (!value) return "";
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
}

function visualQaSeverityRank(severity) {
  return severity === "high" ? 3 : severity === "medium" ? 2 : 1;
}

function summarizeVisualQaPayload(clauses, findings, actions, insertedClauses, localChecks, materialText) {
  return {
    contractTextLength: String(materialText || "").length,
    clauses: clauses.length,
    findings: findings.length,
    highFindings: findings.filter((item) => item.severity === "high").length,
    changedClauses: actions.filter((item) => item.edited || item.deleted || item.commented).length,
    insertedClauses: insertedClauses.length,
    localChecks: localChecks.length,
    highLocalChecks: localChecks.filter((item) => item.severity === "high").length,
  };
}

function buildVisualQaRequest(contract, material, clauses, reason = "review-state") {
  const actions = getClauseActions(material.sourceKey);
  const findings = getAnalysisFindings(contract, clauses);
  const localChecks = buildAutomaticReviewChecks(contract, material, clauses);
  const trimmedClauses = clauses
    .map((clause) => ({
      id: clause.id,
      stableId: clause.stableId,
      number: clause.number,
      originalNumber: clause.originalNumber,
      title: clause.title,
      text: compactVisualQaText(clause.text, VISUAL_QA_CLAUSE_TEXT_LIMIT),
      type: clause.type,
      chapterTitle: clause.chapterTitle || "",
      hierarchyLevel: clause.hierarchyLevel || "article",
      inserted: Boolean(clause.inserted),
      unnumbered: Boolean(clause.unnumbered),
      textTruncated: String(clause.text || "").length > VISUAL_QA_CLAUSE_TEXT_LIMIT,
    }))
    .slice(0, VISUAL_QA_MAX_CLAUSES);
  const prioritizedFindings = findings
    .map((finding) => ({
      id: finding.id,
      clauseId: finding.clauseId || "",
      title: compactVisualQaText(finding.title, 120),
      severity: finding.severity,
      actionType: finding.actionType || finding.action || "",
      issue: compactVisualQaText(finding.issue || "", VISUAL_QA_FINDING_TEXT_LIMIT),
      fix: compactVisualQaText(finding.fix || finding.proposedClauseText || "", VISUAL_QA_FINDING_TEXT_LIMIT),
      linkedClauseIds: (finding.linkedClauseIds || []).slice(0, 8),
      targetInsertPosition: compactVisualQaText(finding.targetInsertPosition || "", 120),
      originalClauseId: finding.originalClauseId || "",
      placementMethod: finding.placementMethod || "",
      placementConfidence: finding.placementConfidence ?? null,
      placementWarning: compactVisualQaText(finding.placementWarning || "", 140),
      routedFromContractRisk: Boolean(finding.routedFromContractRisk),
      needsAttentionScore:
        visualQaSeverityRank(finding.severity) * 100 +
        (finding.placementWarning ? 40 : 0) +
        (finding.actionType === "add_clause" ? 20 : 0) +
        Math.round((Number(finding.placementConfidence) || 0) * -10),
    }))
    .sort((a, b) => b.needsAttentionScore - a.needsAttentionScore)
    .slice(0, VISUAL_QA_MAX_FINDINGS)
    .map(({ needsAttentionScore, ...finding }) => finding);
  const relevantActions = Object.entries(actions)
    .map(([clauseId, action]) => ({
      clauseId,
      edited: Boolean(action.editedText),
      deleted: Boolean(action.deleted),
      commented: Boolean(action.comment),
      riskDecision: action.riskDecision || "",
      hasAnalysisRequest: Boolean(action.analysisRequest),
    }))
    .filter((item) => item.edited || item.deleted || item.commented || item.riskDecision || item.hasAnalysisRequest)
    .slice(0, VISUAL_QA_MAX_ACTIONS);
  const insertedClauses = getInsertedClauses(material.sourceKey)
    .map((item) => ({
      id: item.id,
      targetClauseId: item.targetClauseId || "",
      targetStableId: item.targetStableId || "",
      position: item.position || "",
      title: compactVisualQaText(item.title || "", 120),
      type: item.type || "",
      text: compactVisualQaText(item.text || "", VISUAL_QA_CLAUSE_TEXT_LIMIT),
      textTruncated: String(item.text || "").length > VISUAL_QA_CLAUSE_TEXT_LIMIT,
    }))
    .slice(0, VISUAL_QA_MAX_INSERTED_CLAUSES);
  const prioritizedLocalChecks = localChecks
    .slice()
    .sort((a, b) => visualQaSeverityRank(b.severity) - visualQaSeverityRank(a.severity))
    .slice(0, VISUAL_QA_MAX_LOCAL_CHECKS);
  return {
    reason,
    inputScope: {
      kind: "truncated-visual-qa-snapshot",
      contractTextTruncated: String(material.text || "").length > VISUAL_QA_CONTRACT_TEXT_LIMIT,
      clauseTextLimit: VISUAL_QA_CLAUSE_TEXT_LIMIT,
      findingTextLimit: VISUAL_QA_FINDING_TEXT_LIMIT,
      maxClauses: VISUAL_QA_MAX_CLAUSES,
      maxFindings: VISUAL_QA_MAX_FINDINGS,
    },
    contract: {
      id: contract.id,
      name: contract.name,
      type: contract.type,
      ourRole: contract.ourRole,
      counterpartyName: contract.counterpartyName,
      businessBackground: contract.businessBackground,
      riskLevel: contract.riskLevel,
    },
    material: {
      sourceKey: material.sourceKey,
      title: material.title,
      mode: material.mode,
    },
    contractText: compactVisualQaText(material.text, VISUAL_QA_CONTRACT_TEXT_LIMIT),
    contractTextTruncated: String(material.text || "").length > VISUAL_QA_CONTRACT_TEXT_LIMIT,
    clauses: trimmedClauses,
    findings: prioritizedFindings,
    actions: relevantActions,
    insertedClauses,
    localChecks: prioritizedLocalChecks,
    summary: summarizeVisualQaPayload(clauses, findings, relevantActions, insertedClauses, localChecks, material.text),
  };
}

async function runVisualQa(contract, material, clauses, reason = "review-state") {
  const response = await legalWorkbenchFetch("/api/visual-qa", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildVisualQaRequest(contract, material, clauses, reason)),
  });
  if (!response.ok) throw new Error(await readBackendError(response, "Visual QA 返回错误"));
  return normalizeVisualQaResult(await response.json());
}

function normalizeVisualQaResult(result = {}) {
  const report = result.visualQa || {};
  const normalizeIssue = (item = {}) => ({
    severity: ["high", "medium", "low"].includes(item.severity) ? item.severity : "low",
    type: item.type || "visual",
    targetId: item.targetId || "",
    title: item.title || "待复核事项",
    detail: item.detail || "",
    recommendation: item.recommendation || "",
    findingId: item.findingId || "",
    fromClauseId: item.fromClauseId || "",
    toClauseId: item.toClauseId || "",
    confidence: Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : null,
  });
  return {
    ok: result.ok !== false,
    source: result.source || "",
    promptVersion: result.promptVersion || result.prompt_version || "",
    skillPath: result.skillPath || result.skill_path || "",
    downstreamSkill: result.downstreamSkill || result.downstream_skill || "",
    fallbackReason: result.fallbackReason || "",
    visualQa: {
      status: ["pass", "needs_attention", "blocked"].includes(report.status) ? report.status : "needs_attention",
      summary: report.summary || "",
      displayIssues: (report.displayIssues || []).map(normalizeIssue),
      structureIssues: (report.structureIssues || []).map(normalizeIssue),
      suggestionPlacementIssues: (report.suggestionPlacementIssues || []).map(normalizeIssue),
      numberingIssues: (report.numberingIssues || []).map(normalizeIssue),
      autoFixes: (report.autoFixes || []).map((item) => ({
        type: item.type || "visual",
        targetId: item.targetId || "",
        title: item.title || "可自动修复项",
        description: item.description || "",
        safeToApply: Boolean(item.safeToApply),
        operation: item.operation || "",
        findingId: item.findingId || "",
        fromClauseId: item.fromClauseId || "",
        toClauseId: item.toClauseId || "",
        confidence: Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : null,
      })),
      blockingExportIssues: (report.blockingExportIssues || []).map(normalizeIssue),
      manualReviewItems: (report.manualReviewItems || []).map(normalizeIssue),
    },
  };
}

const visualQaTimers = {};
const VISUAL_QA_INTERACTION_DELAY_MS = VISUAL_QA_DELAY_MS;
const VISUAL_QA_AUTO_REASONS = new Set([
  "segmentation-applied",
  "legal-review-applied",
  "visual-qa-autofix-applied",
]);

function scheduleVisualQa(contractId = state.activeContractId, reason = "review-state", options = {}) {
  const contract = state.contracts.find((item) => item.id === contractId);
  if (!contract) return;
  const material = getWorkbenchMaterial(contract);
  const sourceKey = material.sourceKey;
  const current = state.visualQaJobs?.[sourceKey];
  state.visualQaJobs = state.visualQaJobs || {};
  if (!options.force && !shouldAutoRunVisualQa(reason)) {
    return;
  }
  if (!options.force && isVisualQaInCooldown(sourceKey)) {
    state.visualQaJobs[sourceKey] = {
      status: "deferred",
      reason,
      message: "Agent B 模型检查已节流；本地即时兜底仍在运行。可手动点击“运行 Agent B 检查”。",
      deferredAt: new Date().toISOString(),
    };
    if (typeof persistBackendAuxState === "function") {
      persistBackendAuxState({
        visualQaJobs: state.visualQaJobs,
      }).catch(() => {});
    }
    saveState();
    return;
  }
  if (!options.force && current?.status === "running") {
    state.visualQaJobs[sourceKey] = {
      ...current,
      pending: true,
      pendingReason: reason,
      message: "Visual QA 正在运行；本次变更已加入下一轮后台检查。",
      updatedAt: new Date().toISOString(),
    };
    if (typeof persistBackendAuxState === "function") {
      persistBackendAuxState({
        visualQaJobs: state.visualQaJobs,
      }).catch(() => {});
    }
    saveState();
    return;
  }
  clearTimeout(visualQaTimers[sourceKey]);
  const delay = options.delay ?? (options.force ? 0 : VISUAL_QA_DELAY_MS);
  state.visualQaJobs[sourceKey] = {
    status: "queued",
    reason,
    message: options.force
      ? "Visual QA 即将执行强制检查。"
      : `Visual QA 已排队，将在 ${Math.round(delay / 1000)} 秒内后台检查本次展示和结构变更。`,
    queuedAt: new Date().toISOString(),
    scheduledFor: new Date(Date.now() + delay).toISOString(),
  };
  if (typeof persistBackendAuxState === "function") {
    persistBackendAuxState({
      visualQaJobs: state.visualQaJobs,
    }).catch(() => {});
  }
  saveState();
  visualQaTimers[sourceKey] = setTimeout(() => runVisualQaForMaterial(contract, material, reason), delay);
}

function shouldAutoRunVisualQa(reason = "") {
  return VISUAL_QA_AUTO_REASONS.has(reason);
}

function isVisualQaInCooldown(sourceKey) {
  const reportTime = state.visualQaReports?.[sourceKey]?.checkedAt ? new Date(state.visualQaReports[sourceKey].checkedAt).getTime() : 0;
  const job = state.visualQaJobs?.[sourceKey];
  const jobTime = job?.completedAt || job?.failedAt || job?.startedAt;
  const latest = Math.max(reportTime, jobTime ? new Date(jobTime).getTime() : 0);
  return latest && Date.now() - latest < VISUAL_QA_COOLDOWN_MS;
}

async function runVisualQaForMaterial(contract, material = getWorkbenchMaterial(contract), reason = "review-state") {
  const sourceKey = material.sourceKey;
  clearTimeout(visualQaTimers[sourceKey]);
  state.visualQaJobs = state.visualQaJobs || {};
  state.visualQaJobs[sourceKey] = {
    status: "running",
    reason,
    message: "Visual QA 正在检查审阅台展示、建议归属和编号一致性。",
    startedAt: new Date().toISOString(),
  };
  if (typeof persistBackendAuxState === "function") {
    persistBackendAuxState({
      visualQaJobs: state.visualQaJobs,
    }).catch(() => {});
  }
  saveState();
  if (state.activeContractId === contract.id) renderReview();
  try {
    const clauses = splitVersionClauses(material.text, material.sourceKey);
    const report = await runVisualQa(contract, material, clauses, reason);
    state.visualQaReports = state.visualQaReports || {};
    state.visualQaReports[sourceKey] = {
      ...report.visualQa,
      source: report.source || "",
      promptVersion: report.promptVersion || "",
      skillPath: report.skillPath || "",
      downstreamSkill: report.downstreamSkill || "",
      fallbackReason: report.fallbackReason || "",
      reason,
      checkedAt: new Date().toISOString(),
    };
    const queuedNext = state.visualQaJobs[sourceKey]?.pending;
    const queuedReason = state.visualQaJobs[sourceKey]?.pendingReason || "visual-qa-pending-change";
    state.visualQaJobs[sourceKey] = {
      status: "completed",
      reason,
      message: report.visualQa.summary || "Visual QA 已完成。",
      completedAt: new Date().toISOString(),
    };
    if (typeof persistBackendAuxState === "function") {
      persistBackendAuxState({
        visualQaJobs: state.visualQaJobs,
        visualQaReports: state.visualQaReports,
      }).catch(() => {});
    }
    saveState();
    if (state.activeContractId === contract.id) renderReview();
    if (queuedNext) scheduleVisualQa(contract.id, queuedReason, { delay: VISUAL_QA_INTERACTION_DELAY_MS });
    return report;
  } catch (error) {
    const queuedNext = state.visualQaJobs[sourceKey]?.pending;
    const queuedReason = state.visualQaJobs[sourceKey]?.pendingReason || "visual-qa-pending-change";
    state.visualQaJobs[sourceKey] = {
      status: "failed",
      reason,
      message: error.message || String(error),
      failedAt: new Date().toISOString(),
    };
    if (typeof persistBackendAuxState === "function") {
      persistBackendAuxState({
        visualQaJobs: state.visualQaJobs,
      }).catch(() => {});
    }
    saveState();
    if (state.activeContractId === contract.id) renderReview();
    if (queuedNext) scheduleVisualQa(contract.id, queuedReason, { delay: VISUAL_QA_INTERACTION_DELAY_MS });
    return null;
  }
}

function getVisualQaState(sourceKey) {
  return {
    job: state.visualQaJobs?.[sourceKey] || null,
    report: state.visualQaReports?.[sourceKey] || null,
  };
}

function applyVisualQaAutoFixes(sourceKey, options = {}) {
  const report = state.visualQaReports?.[sourceKey];
  const safeFixes = (report?.autoFixes || []).filter((fix) => fix.safeToApply);
  if (!safeFixes.length) return { applied: 0, skipped: 0, message: "Visual QA 没有返回可安全自动执行的修复项。" };
  const contractId = String(sourceKey || "").split(":")[0];
  const contract = state.contracts.find((item) => item.id === contractId);
  const stored = state.legalSkillResults?.[contractId];
  const response = stored?.response;
  if (!contract || !response) return { applied: 0, skipped: safeFixes.length, message: "没有找到对应合同或 AI 审阅结果。" };
  let applied = 0;
  let skipped = 0;
  safeFixes.forEach((fix) => {
    const operation = normalizeVisualQaFixOperation(fix);
    if (operation === "relocate_finding") {
      const moved = relocateSkillFindingInResult(contractId, response, fix);
      moved ? applied += 1 : skipped += 1;
      return;
    }
    if (operation === "dedupe_finding") {
      const removed = dedupeSkillFindingInResult(contractId, response, fix);
      removed ? applied += removed : skipped += 1;
      return;
    }
    skipped += 1;
  });
  if (!applied) {
    report.summary = `Agent B 提出了 ${safeFixes.length} 项安全修复，但未匹配到可执行的本地建议。请重新运行 Visual QA 或查看建议归属字段。`;
    state.visualQaJobs = state.visualQaJobs || {};
    state.visualQaJobs[sourceKey] = {
      ...(state.visualQaJobs[sourceKey] || {}),
      status: "completed",
      message: report.summary,
      completedAt: new Date().toISOString(),
    };
    if (typeof persistBackendAuxState === "function") {
      persistBackendAuxState({
        visualQaJobs: state.visualQaJobs,
        visualQaReports: state.visualQaReports,
      }).catch(() => {});
    }
    saveState();
    if (state.activeContractId === contract.id) renderReview();
    return { applied, skipped, message: "Agent B 的修复项没有匹配到本地建议。" };
  }
  state.visualQaAutoFixAudits = state.visualQaAutoFixAudits || {};
  state.visualQaAutoFixAudits[sourceKey] = state.visualQaAutoFixAudits[sourceKey] || [];
  state.visualQaAutoFixAudits[sourceKey].push({
    id: uid("visual-fix-audit"),
    applied,
    skipped,
    source: report.source || "",
    createdAt: new Date().toISOString(),
  });
  stored.appliedAt = new Date().toISOString();
  const material = getWorkbenchMaterial(contract);
  const clauses = splitVersionClauses(material.text, material.sourceKey);
  state.findings = (state.findings || []).filter((finding) => finding.contractId !== contract.id);
  state.findings.push(...getStoredSkillFindings(contract, clauses));
  report.autoFixes = (report.autoFixes || []).map((fix) => fix.safeToApply ? { ...fix, applied: true } : fix);
  report.summary = `已执行 ${applied} 项 Agent B 安全修复。${report.summary || ""}`;
  if (typeof persistBackendAuxState === "function") {
    persistBackendAuxState({
      visualQaReports: state.visualQaReports,
      visualQaAutoFixAudits: state.visualQaAutoFixAudits,
    }).catch(() => {});
  }
  saveState();
  if (options.rerun !== false) scheduleVisualQa(contract.id, "visual-qa-autofix-applied", { delay: 800, force: true });
  if (state.activeContractId === contract.id) renderReview();
  return { applied, skipped };
}

function normalizeVisualQaFixOperation(fix = {}) {
  if (["relocate_finding", "dedupe_finding", "hide_duplicate_text", "renumber_clause", "other"].includes(fix.operation)) return fix.operation;
  const source = `${fix.type || ""}\n${fix.title || ""}\n${fix.description || ""}`.toLowerCase();
  if (/relocate|move|placement|归属|放错|移动|重定位/.test(source)) return "relocate_finding";
  if (/dedupe|duplicate|重复|去重/.test(source)) return "dedupe_finding";
  return fix.operation || "other";
}

function relocateSkillFindingInResult(contractId, response, fix = {}) {
  const toClauseId = fix.toClauseId || fix.targetId;
  if (!toClauseId) return false;
  const clauseItem = findRawSkillFindingItem(contractId, response.clauseAnalyses || [], fix, "clause");
  if (clauseItem) {
    clauseItem.previousClauseId = clauseItem.clauseId || clauseItem.targetClauseId || "";
    clauseItem.clauseId = toClauseId;
    clauseItem.targetClauseId = toClauseId;
    clauseItem.placementAdjustedByAgentB = true;
    return true;
  }
  const contractItem = findRawSkillFindingItem(contractId, response.contractLevelRisks || [], fix, "contract")
    || findRawSkillFindingItem(contractId, response.contractLevelRisks || [], fix, "contract-routed");
  if (contractItem) {
    contractItem.previousLinkedClauseIds = contractItem.linkedClauseIds || [];
    contractItem.linkedClauseIds = [toClauseId];
    contractItem.targetClauseId = toClauseId;
    contractItem.placementAdjustedByAgentB = true;
    return true;
  }
  return false;
}

function dedupeSkillFindingInResult(contractId, response, fix = {}) {
  const removedClause = removeRawSkillFindingItem(contractId, response.clauseAnalyses || [], fix, "clause");
  const removedContract = removeRawSkillFindingItem(contractId, response.contractLevelRisks || [], fix, "contract")
    || removeRawSkillFindingItem(contractId, response.contractLevelRisks || [], fix, "contract-routed");
  return removedClause + removedContract;
}

function findRawSkillFindingItem(contractId, items, fix, scope) {
  return items.find((item) => rawSkillFindingMatchesFix(contractId, item, fix, scope))
    || findBestRawSkillFindingItem(items, fix)
    || null;
}

function removeRawSkillFindingItem(contractId, items, fix, scope) {
  const index = items.findIndex((item) => rawSkillFindingMatchesFix(contractId, item, fix, scope));
  if (index < 0) return 0;
  items.splice(index, 1);
  return 1;
}

function rawSkillFindingMatchesFix(contractId, item, fix, scope) {
  if (!item) return false;
  const stableId = buildSkillFindingStableId(contractId, item, scope);
  if (fix.findingId && fix.findingId === stableId) return true;
  if (fix.fromClauseId && [item.clauseId, item.targetClauseId, ...(item.linkedClauseIds || [])].includes(fix.fromClauseId)) {
    const fixText = normalizeText([fix.title, fix.description, fix.targetId].filter(Boolean).join("|"));
    const itemText = normalizeText([item.title, item.issue, item.proposedRevision, item.proposedClauseText, item.fix, item.suggestion].filter(Boolean).join("|"));
    return !fixText || jaccard(tokenize(fixText), tokenize(itemText)) >= 0.08;
  }
  return false;
}

function findBestRawSkillFindingItem(items = [], fix = {}) {
  const fixText = normalizeText([fix.title, fix.description, fix.targetId].filter(Boolean).join("|"));
  if (!fixText) return null;
  let best = null;
  let bestScore = 0;
  items.forEach((item) => {
    const itemText = normalizeText([item.title, item.issue, item.proposedRevision, item.proposedClauseText, item.fix, item.suggestion].filter(Boolean).join("|"));
    const score = jaccard(tokenize(fixText), tokenize(itemText));
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  });
  return bestScore >= 0.12 ? best : null;
}

function getAiClauseSegmentationForSource(text, sourceKey) {
  const validation = getValidatedAiClauseSegmentation(text, sourceKey);
  if (!validation.accepted) return null;
  return validation.segments.map((item, index) => ({
    id: uid("clause"),
    contractId: sourceKey,
    number: index + 1,
    title: item.title,
    text: item.text,
    type: item.type || classifyClause(item.text, item.title),
    chapterTitle: item.chapterTitle || "",
    hierarchyLevel: item.hierarchyLevel || "article",
    keyClause: item.type !== "其他",
    riskLevel: "low",
    deviates: false,
    sourceKind: "ai-segmented",
    aiStableId: item.stableId,
  }));
}

function getClauseSegmentationStatus(text, sourceKey) {
  const validation = getValidatedAiClauseSegmentation(text, sourceKey);
  if (!validation.available) return { source: "local", label: "本地规则切分", count: 0, overlap: 0 };
  if (!validation.accepted) {
    return {
      source: "local",
      label: "本地规则切分",
      count: validation.segments.length,
      overlap: validation.overlap,
      note: validation.reason || "AI 切分与当前文本重合度不足，已回退。",
    };
  }
  return {
    source: "ai",
    label: "AI 语义切分",
    count: validation.segments.length,
    overlap: validation.overlap,
  };
}

function getValidatedAiClauseSegmentation(text, sourceKey) {
  const contractId = String(sourceKey || "").split(":")[0];
  const result = getStoredSkillResult(contractId);
  const segments = normalizeSkillClauseSegmentation(result?.clauseSegmentation || []);
  if (segments.length < 2) return { available: false, accepted: false, segments: [], overlap: 0 };
  const structureIssue = detectAiSegmentationStructureIssue(text, segments);
  if (structureIssue) {
    return { available: true, accepted: false, segments, overlap: 0, reason: structureIssue };
  }
  const sourceFingerprint = normalizeText(text).slice(0, 1200);
  const segmentFingerprint = normalizeText(segments.map((item) => item.text).join("\n")).slice(0, 1200);
  if (!sourceFingerprint || !segmentFingerprint) return { available: true, accepted: false, segments, overlap: 0 };
  const overlap = jaccard(tokenize(sourceFingerprint), tokenize(segmentFingerprint));
  return { available: true, accepted: overlap >= 0.28, segments, overlap };
}

function detectAiSegmentationStructureIssue(text, segments = []) {
  const sourceArticles = extractExplicitArticleRefs(text);
  if (sourceArticles.length < 2) return "";
  const sourceArticleSet = new Set(sourceArticles);
  const aiArticleRefs = segments.flatMap((segment) => extractExplicitArticleRefs(`${segment.title || ""}\n${segment.text || ""}`));
  const merged = segments.find((segment) => {
    const title = String(segment.title || "");
    const refs = extractExplicitArticleRefs(`${segment.title || ""}\n${segment.text || ""}`);
    const uniqueRefs = [...new Set(refs.filter((ref) => sourceArticleSet.has(ref)))];
    return uniqueRefs.length > 1 || /第\s*[一二三四五六七八九十百零〇两0-9]+\s*条\s*(?:至|到|-|—|－)\s*第?\s*[一二三四五六七八九十百零〇两0-9]+\s*条/.test(title);
  });
  if (merged) return "AI 切分合并了原合同中明确编号的多个正式条款，已按原合同编号回退。";
  const aiArticleSet = new Set(aiArticleRefs);
  const preservedCount = sourceArticles.filter((ref) => aiArticleSet.has(ref)).length;
  if (sourceArticles.length >= 4 && preservedCount < Math.ceil(sourceArticles.length * 0.72)) {
    return "AI 切分未充分保留原合同明确条款编号，已按原合同编号回退。";
  }
  return "";
}

function extractExplicitArticleRefs(text) {
  const refs = [];
  const source = String(text || "");
  for (const match of source.matchAll(/第\s*([一二三四五六七八九十百零〇两0-9]+)\s*条/g)) {
    const value = parseChineseOrArabicNumber(match[1]) || normalizeNumberRef(match[1]);
    if (value) refs.push(`article-${value}`);
  }
  return [...new Set(refs)];
}

function getStoredSkillFindings(contract, clauses = []) {
  const result = getStoredSkillResult(contract.id);
  if (!result?.clauseAnalyses?.length && !result?.contractLevelRisks?.length) return [];
  const sourceKey = inferFindingSourceKey(clauses, contract.id);
  const byId = new Map(clauses.map((clause) => [clause.id, clause]));
  clauses.forEach((clause) => {
    if (clause.stableId) byId.set(clause.stableId, clause);
  });
  const byTitle = new Map(clauses.map((clause) => [normalizeClauseTitle(clause.title), clause]));
  const matchedClauseIds = new Set();
  const clauseFindings = (result.clauseAnalyses || []).map((item) => {
    const placement = resolveSkillClausePlacement(item, clauses, byId, byTitle);
    const clause = placement.clause;
    if (clause?.id) matchedClauseIds.add(clause.id);
    return {
      id: buildSkillFindingStableId(contract.id, item, "clause"),
      contractId: contract.id,
      sourceKey,
      clauseId: clause?.id || item.clauseId || null,
      originalClauseId: item.clauseId || item.targetClauseId || "",
      placementMethod: placement.method,
      placementConfidence: placement.confidence,
      placementWarning: placement.relocated ? `建议已从 ${placement.originalClauseId || "未指定条款"} 重新匹配到 ${clause?.title || clause?.id || "当前条款"}` : "",
      title: item.title || item.issue || "Skill 条款风险",
      severity: normalizeSeverity(item.severity),
      actionType: normalizeClauseActionType(item.actionType, item),
      issue: item.issue || item.summary || "",
      consequence: item.consequence || "",
      fix: item.replacementText || item.proposedRevision || item.fix || item.suggestion || item.commentText || "",
      fallbackText: item.fallbackText || item.replacementText || "",
      negotiation: item.negotiationPosition || item.negotiation || "",
      needsBusiness: Boolean(item.businessDecision),
      targetText: item.targetText || "",
      commentText: item.commentText || "",
      adoptionNote: item.adoptionNote || "",
      negotiationBottomLine: item.negotiationBottomLine || "",
      acceptableFallback: item.acceptableFallback || item.fallbackText || "",
      linkedClauseIds: item.linkedClauseIds || [],
      qualityScore: item.qualityScore ?? null,
      needsManagement: normalizeSeverity(item.severity) === "high",
      status: "待处理",
    };
  });
  const contractFindings = (result.contractLevelRisks || []).map((item) => {
    const placement = resolveContractRiskTargetPlacement(item, clauses, byId, byTitle);
    const targetClause = placement.clause;
    const isTargetedAddClause = targetClause && item.actionType !== "comment_only";
    return {
      id: buildSkillFindingStableId(contract.id, item, isTargetedAddClause ? "contract-routed" : "contract"),
      contractId: contract.id,
      sourceKey,
      clauseId: targetClause?.id || null,
      originalClauseId: (item.linkedClauseIds || [])[0] || item.targetClauseId || "",
      placementMethod: placement.method,
      placementConfidence: placement.confidence,
      placementWarning: placement.relocated ? `合同级建议已重新归入 ${targetClause?.title || targetClause?.id || "当前条款"}` : "",
      title: item.title || item.issue || "Skill 合同级风险",
      severity: normalizeSeverity(item.severity),
      actionType: isTargetedAddClause ? "add_clause" : item.actionType === "comment_only" ? "comment_only" : "add_clause",
      issue: item.issue || item.summary || "",
      consequence: item.consequence || "",
      fix: item.proposedClauseText || item.fix || item.suggestion || item.proposedRevision || "",
      negotiation: item.negotiation || "",
      proposedClauseText: item.proposedClauseText || "",
      targetInsertPosition: item.targetInsertPosition || "",
      adoptionNote: item.adoptionNote || "",
      negotiationBottomLine: item.negotiationBottomLine || "",
      acceptableFallback: item.acceptableFallback || "",
      linkedClauseIds: item.linkedClauseIds || [],
      qualityScore: item.qualityScore ?? null,
      needsBusiness: true,
      needsManagement: normalizeSeverity(item.severity) === "high",
      status: "待处理",
      routedFromContractRisk: Boolean(targetClause),
    };
  });
  return dedupeSkillFindings([...contractFindings, ...clauseFindings]);
}

function dedupeSkillFindings(findings = []) {
  const grouped = new Map();
  findings.forEach((finding) => {
    const key = buildSkillFindingDedupKey(finding);
    const previous = grouped.get(key);
    if (!previous || skillFindingPlacementScore(finding) > skillFindingPlacementScore(previous)) grouped.set(key, finding);
  });
  return [...grouped.values()];
}

function buildSkillFindingStableId(contractId, item = {}, scope = "clause") {
  const source = [
    contractId,
    scope,
    item.id,
    item.clauseId,
    item.targetClauseId,
    item.title,
    item.issue,
    item.proposedRevision,
    item.replacementText,
    item.proposedClauseText,
    item.fix,
    item.suggestion,
    item.targetInsertPosition,
  ]
    .filter(Boolean)
    .join("|");
  return `skill-finding-${hashStableText(normalizeText(source).slice(0, 800))}`;
}

function hashStableText(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function skillFindingPlacementScore(finding = {}) {
  let score = 0;
  if (finding.clauseId) score += 50;
  if (finding.routedFromContractRisk) score += 20;
  if (finding.targetInsertPosition) score += 8;
  if ((finding.linkedClauseIds || []).length) score += 8;
  score += riskRank(finding.severity || "low");
  score += Math.min(Number(finding.qualityScore) || 0, 100) / 100;
  return score;
}

function normalizeClauseActionType(value, item = {}) {
  const explicit = String(value || "");
  if (["replace_clause", "revise_clause", "delete_clause", "comment_only"].includes(explicit)) return explicit;
  const source = `${item.title || ""}\n${item.issue || ""}\n${item.proposedRevision || item.fix || item.suggestion || ""}`;
  if (/删除|删去|移除|不建议保留/.test(source)) return "delete_clause";
  if (/替换为|修改为|改为|全文替换/.test(source)) return "replace_clause";
  if (!String(item.proposedRevision || item.fix || item.suggestion || "").trim()) return "comment_only";
  return "revise_clause";
}

function matchSkillClause(item, clauses, byId, byTitle) {
  return resolveSkillClausePlacement(item, clauses, byId, byTitle).clause;
}

function resolveSkillClausePlacement(item, clauses, byId, byTitle) {
  if (!item || !clauses.length) return emptyClausePlacement();
  const direct = byId.get(item.clauseId) || byId.get(item.targetClauseId);
  const numbered = matchClauseByExplicitNumber(item, clauses);
  if (numbered && (!direct || numbered.id !== direct.id)) {
    return buildClausePlacement(numbered, "explicit-number", 0.98, item, direct);
  }

  const title = item.title || item.clauseTitle || "";
  const titleMatch = byTitle.get(normalizeClauseTitle(title));
  const best = findBestSkillClause(item, clauses);
  if (direct) {
    const directScore = scoreSkillClausePlacement(item, direct);
    const bestIsDifferent = best.clause && best.clause.id !== direct.id;
    if (bestIsDifferent && best.score >= 0.62 && best.score >= directScore + 0.18) {
      return buildClausePlacement(best.clause, "semantic-reroute", best.score, item, direct);
    }
    return buildClausePlacement(direct, "agent-id-verified", Math.max(directScore, best.clause?.id === direct.id ? best.score : 0.45), item);
  }
  if (numbered) return buildClausePlacement(numbered, "explicit-number", 0.98, item);
  if (titleMatch) return buildClausePlacement(titleMatch, "title", Math.max(0.72, scoreSkillClausePlacement(item, titleMatch)), item);
  if (best.clause && best.score >= 0.38) return buildClausePlacement(best.clause, "semantic", best.score, item);
  return emptyClausePlacement();
}

function emptyClausePlacement() {
  return { clause: null, method: "unmatched", confidence: 0, relocated: false, originalClauseId: "" };
}

function buildClausePlacement(clause, method, confidence, item = {}, originalClause = null) {
  return {
    clause,
    method,
    confidence: Number(Math.max(0, Math.min(1, confidence || 0)).toFixed(2)),
    relocated: Boolean(originalClause && clause && originalClause.id !== clause.id),
    originalClauseId: originalClause?.id || item.clauseId || item.targetClauseId || "",
  };
}

function findBestSkillClause(item, clauses) {
  let best = { clause: null, score: 0 };
  clauses.forEach((clause) => {
    const score = scoreSkillClausePlacement(item, clause);
    if (score > best.score) best = { clause, score };
  });
  return best;
}

function scoreSkillClausePlacement(item, clause) {
  if (!item || !clause) return 0;
  const source = buildSkillPlacementText(item);
  const title = item.title || item.clauseTitle || "";
  let score = clauseMatchScore(source, title, item.clauseType, clause);
  const targetText = normalizeText(item.targetText || "");
  const clauseText = normalizeText(`${clause.title || ""}\n${clause.text || ""}`);
  if (targetText && clauseText.includes(targetText.slice(0, Math.min(targetText.length, 160)))) score += 0.72;
  if (source.includes(clause.id) || (clause.stableId && source.includes(clause.stableId))) score += 0.15;
  const explicitNumbers = extractClauseNumberRefs(source);
  const clauseNumbers = getClauseNumberRefs(clause);
  if (explicitNumbers.length && clauseNumbers.some((number) => explicitNumbers.includes(number))) score += 0.55;
  if (explicitNumbers.length && !clauseNumbers.some((number) => explicitNumbers.includes(number))) score -= 0.25;
  const normalizedTitle = normalizeClauseTitle(clause.title);
  if (normalizedTitle && normalizeText(source).includes(normalizedTitle)) score += 0.25;
  if (clause.chapterTitle && normalizeText(source).includes(normalizeText(clause.chapterTitle))) score += 0.12;
  score += scoreDocumentRegionContext(source, clause);
  if (item.clauseType && clause.type && String(item.clauseType).includes(clause.type)) score += 0.1;
  return Math.max(0, Math.min(1, score));
}

function buildSkillPlacementText(item = {}) {
  return [
    item.clauseId,
    item.targetClauseId,
    item.clauseTitle,
    item.title,
    item.targetText,
    item.issue,
    item.summary,
    item.proposedRevision,
    item.replacementText,
    item.proposedClauseText,
    item.fix,
    item.suggestion,
    item.commentText,
    item.targetInsertPosition,
    ...(item.linkedClauseIds || []),
  ]
    .filter(Boolean)
    .join("\n");
}

function matchClauseByExplicitNumber(item, clauses) {
  const source = [
    item.clauseId,
    item.targetClauseId,
    item.clauseTitle,
    item.title,
    item.targetText,
    item.issue,
    item.summary,
    item.proposedRevision,
    item.replacementText,
    item.proposedClauseText,
    item.fix,
    item.suggestion,
    item.commentText,
    item.targetInsertPosition,
    ...(item.linkedClauseIds || []),
  ].filter(Boolean).join("\n");
  const numbers = extractClauseNumberRefs(source);
  if (!numbers.length) return null;
  const candidates = clauses.filter((clause) => getClauseNumberRefs(clause).some((number) => numbers.includes(number)));
  if (candidates.length <= 1) return candidates[0] || null;
  const ranked = candidates
    .map((clause) => ({ clause, score: scoreNumberedClauseContext(source, clause) + scoreSkillClausePlacement(item, clause) }))
    .sort((a, b) => b.score - a.score);
  if (!ranked.length || ranked[0].score < 0.12) return null;
  if (ranked[1] && ranked[0].score - ranked[1].score < 0.12) return null;
  return ranked[0].clause;
}

function matchContractRiskTargetClause(item, clauses, byId, byTitle) {
  return resolveContractRiskTargetPlacement(item, clauses, byId, byTitle).clause;
}

function resolveContractRiskTargetPlacement(item, clauses, byId, byTitle) {
  if (!item || !clauses.length) return emptyClausePlacement();
  const linked = (item.linkedClauseIds || [])
    .map((id) => byId.get(id))
    .find(Boolean);
  const targetText = buildContractRiskTargetText(item);
  const numbered = matchClauseByExplicitNumber({ ...item, targetText }, clauses);
  if (numbered && (!linked || numbered.id !== linked.id)) {
    return buildClausePlacement(numbered, "explicit-number", 0.98, item, linked);
  }

  const directTitle = byTitle.get(normalizeClauseTitle(item.targetInsertPosition || item.title || ""));
  const suggestedType = normalizeSuggestedClauseType(`${item.title || ""}\n${item.issue || ""}\n${item.suggestion || ""}\n${item.proposedClauseText || ""}`);
  const best = findBestContractRiskTarget(targetText, suggestedType, clauses);
  if (linked) {
    const linkedScore = contractRiskTargetScore(targetText, suggestedType, linked);
    if (best.clause && best.clause.id !== linked.id && best.score >= 0.62 && best.score >= linkedScore + 0.18) {
      return buildClausePlacement(best.clause, "semantic-reroute", best.score, item, linked);
    }
    return buildClausePlacement(linked, "agent-linked-id-verified", Math.max(linkedScore, best.clause?.id === linked.id ? best.score : 0.45), item);
  }
  if (numbered) return buildClausePlacement(numbered, "explicit-number", 0.98, item);
  if (directTitle) return buildClausePlacement(directTitle, "title", Math.max(0.72, contractRiskTargetScore(targetText, suggestedType, directTitle)), item);
  if (best.clause && best.score >= 0.55) return buildClausePlacement(best.clause, "semantic", best.score, item);
  return emptyClausePlacement();
}

function buildContractRiskTargetText(item = {}) {
  return [
    item.targetInsertPosition,
    item.targetClauseId,
    item.title,
    item.issue,
    item.suggestion,
    item.proposedClauseText,
    item.proposedRevision,
    item.replacementText,
    item.businessRationale,
    ...(item.linkedClauseIds || []),
  ]
    .filter(Boolean)
    .join("\n");
}

function findBestContractRiskTarget(targetText, suggestedType, clauses) {
  let best = { clause: null, score: 0 };
  clauses.forEach((clause) => {
    const score = contractRiskTargetScore(targetText, suggestedType, clause);
    if (score > best.score) best = { clause, score };
  });
  return best;
}

function contractRiskTargetScore(targetText, suggestedType, clause) {
  const source = String(targetText || "");
  let score = 0;
  if (!source.trim()) return 0;
  if (source.includes(clause.id) || (clause.stableId && source.includes(clause.stableId))) score += 1;
  const explicitNumbers = extractClauseNumberRefs(source);
  const clauseNumbers = [
    clause.originalNumberText,
    clause.number,
    extractLeadingDecimalNumber(clause.title),
    extractLeadingDecimalNumber(clause.text),
  ].filter(Boolean).map(normalizeNumberRef);
  if (clauseNumbers.some((number) => explicitNumbers.includes(number))) score += 1.2;
  const number = clause.originalNumber || clause.number || parseClauseNumberFromText(clause.title) || parseClauseNumberFromText(clause.text);
  if (number && source.includes(`第${numberToChinese(number)}条`)) score += 0.85;
  if (number && source.includes(`第${number}条`)) score += 0.85;
  const normalizedTitle = normalizeClauseTitle(clause.title);
  if (normalizedTitle && source.includes(normalizedTitle)) score += 0.75;
  if (clause.chapterTitle && source.includes(clause.chapterTitle)) score += 0.48;
  score += scoreDocumentRegionContext(source, clause);
  if (suggestedType && suggestedType !== "其他" && clause.type === suggestedType) score += 0.46;
  if (clause.type && source.includes(clause.type)) score += 0.42;
  score += clauseMatchScore(source, itemTitleFromTargetText(source), suggestedType, clause) * 0.35;
  return score;
}

function scoreNumberedClauseContext(source, clause) {
  let score = 0;
  const normalizedSource = normalizeText(source);
  const normalizedTitle = normalizeClauseTitle(clause.title);
  const normalizedChapter = normalizeText(clause.chapterTitle || "");
  if (normalizedTitle && normalizedSource.includes(normalizedTitle)) score += 0.55;
  if (normalizedChapter && normalizedSource.includes(normalizedChapter)) score += 0.48;
  score += clauseMatchScore(source, "", "", clause) * 0.35;
  score += scoreDocumentRegionContext(source, clause);
  return score;
}

function scoreDocumentRegionContext(source, clause) {
  const sourceRegion = inferDocumentRegion(source);
  const clauseRegion = inferDocumentRegion(`${clause.chapterTitle || ""}\n${clause.title || ""}\n${String(clause.text || "").slice(0, 260)}`);
  if (!sourceRegion || !clauseRegion) return 0;
  return sourceRegion === clauseRegion ? 0.5 : -0.65;
}

function inferDocumentRegion(text) {
  const source = String(text || "");
  if (/(附件|附录|附表|appendix|schedule|exhibit|sow|statement\s+of\s+work)/i.test(source)) return "attachment";
  if (/(正文|主合同|协议正文|合同正文|main\s+agreement)/i.test(source)) return "body";
  return "";
}

function itemTitleFromTargetText(text) {
  return String(text || "").split(/\n/).find(Boolean) || "";
}

function buildSkillFindingDedupKey(finding = {}) {
  const addClause = finding.actionType === "add_clause";
  const source = [
    finding.actionType,
    finding.title,
    finding.issue,
    finding.fix || finding.proposedClauseText,
    addClause ? "" : finding.targetInsertPosition,
  ]
    .filter(Boolean)
    .join("|");
  return normalizeText(source)
    .replace(/第[一二三四五六七八九十百零〇两0-9]+条/g, "")
    .replace(/\b\d+(?:\.\d+)+\b/g, "")
    .slice(0, 260);
}

function clauseMatchScore(itemText, itemTitle, itemType, clause) {
  const titleA = tokenize(normalizeClauseTitle(itemTitle));
  const titleB = tokenize(normalizeClauseTitle(clause.title));
  const textA = tokenize(itemText);
  const textB = tokenize(`${clause.title}\n${clause.text}`);
  const titleScore = jaccard(titleA, titleB);
  const textScore = jaccard(textA, textB);
  const typeScore = itemType && clause.type && String(itemType).includes(clause.type) ? 0.25 : 0;
  return titleScore * 0.5 + textScore * 0.35 + typeScore;
}

function tokenize(text) {
  const cleaned = String(text || "")
    .toLowerCase()
    .replace(/[^\u4e00-\u9fa5a-z0-9]+/g, " ")
    .trim();
  const zh = cleaned.match(/[\u4e00-\u9fa5]{2}/g) || [];
  const words = cleaned.split(/\s+/).filter((word) => word.length >= 2);
  return new Set([...zh, ...words]);
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  a.forEach((item) => {
    if (b.has(item)) intersection += 1;
  });
  return intersection / (a.size + b.size - intersection);
}

function getAnalysisFindings(contract, clauses = []) {
  const stored = getStoredSkillFindings(contract, clauses);
  if (stored.length) return stored;
  const sourceKey = inferFindingSourceKey(clauses, contract.id);
  const persisted = (state.findings || []).filter((finding) => finding.contractId === contract.id && (!sourceKey || !finding.sourceKey || finding.sourceKey === sourceKey));
  return persisted.length ? dedupeSkillFindings(persisted) : [];
}

function applyLegalSkillResult(contract, result, clauses = []) {
  result = normalizeLegalSkillResult(result);
  state.legalSkillResults = state.legalSkillResults || {};
  state.legalSkillResults[contract.id] = {
    ...result,
    appliedAt: new Date().toISOString(),
  };
  const summary = result.response?.contractSummary || {};
  contract.type = summary.contractType || summary.contract_type || contract.type;
  contract.purpose = summary.purpose || contract.purpose;
  contract.riskLevel = normalizeSeverity(summary.riskLevel || contract.riskLevel);
  const findings = getStoredSkillFindings(contract, clauses);
  state.findings = (state.findings || []).filter((finding) => finding.contractId !== contract.id);
  if (findings.length) {
    state.findings.push(...findings);
  }
  clearAnalysisStatus(contract.id);
  contract.updatedAt = today();
  scheduleVisualQa(contract.id, "legal-review-applied", { delay: 500, force: true });
}

function applyFocusedClauseSkillResult(contract, clauseId, result) {
  result = normalizeLegalSkillResult(result);
  state.legalSkillResults = state.legalSkillResults || {};
  const previous = state.legalSkillResults[contract.id]?.response || {
    contractSummary: {},
    clauseSegmentation: [],
    contractLevelRisks: [],
    clauseAnalyses: [],
    missingFacts: [],
    businessSummary: "",
  };
  const incoming = result.response?.clauseAnalyses || [];
  state.legalSkillResults[contract.id] = {
    ...(state.legalSkillResults[contract.id] || {}),
    ...result,
    response: {
      contractSummary: {
        ...previous.contractSummary,
        ...(result.response?.contractSummary || {}),
      },
      contractLevelRisks: previous.contractLevelRisks || [],
      clauseSegmentation: (previous.clauseSegmentation || []).length ? previous.clauseSegmentation : result.response?.clauseSegmentation || [],
      clauseAnalyses: [
        ...(previous.clauseAnalyses || []).filter((item) => item.clauseId !== clauseId && item.targetClauseId !== clauseId),
        ...incoming.map((item) => ({ ...item, clauseId: item.clauseId || clauseId })),
      ],
      missingFacts: [...new Set([...(previous.missingFacts || []), ...(result.response?.missingFacts || [])])],
      businessSummary: result.response?.businessSummary || previous.businessSummary || "",
    },
    focusedClauseId: clauseId,
    appliedAt: new Date().toISOString(),
  };
  state.findings = (state.findings || []).filter((finding) => finding.contractId !== contract.id || finding.clauseId !== clauseId);
  const focusedFindings = getStoredSkillFindings(contract, [{ id: clauseId }]).filter((finding) => finding.clauseId === clauseId);
  if (focusedFindings.length) state.findings.push(...focusedFindings);
  contract.updatedAt = today();
}

function getClauseNumberRefs(clause = {}) {
  return [
    clause.originalNumberText,
    clause.number,
    clause.originalNumber,
    parseArticleNumberRef(clause.title),
    parseArticleNumberRef(clause.text),
    extractLeadingDecimalNumber(clause.title),
    extractLeadingDecimalNumber(clause.text),
  ].filter(Boolean).map(normalizeNumberRef);
}

function extractClauseNumberRefs(text) {
  const source = String(text || "");
  const decimalRefs = source.match(/\b\d+(?:\.\d+)+\b/g) || [];
  const articleRefs = [...source.matchAll(/第\s*([一二三四五六七八九十百零〇两0-9]+)\s*条/g)]
    .map((match) => parseChineseOrArabicNumber(match[1]))
    .filter(Boolean);
  const plainArticleRefs = [...source.matchAll(/(?:^|[^\d.])(\d+)\s*条/g)]
    .map((match) => match[1])
    .filter(Boolean);
  return [...new Set([...decimalRefs, ...articleRefs, ...plainArticleRefs].map(normalizeNumberRef).filter(Boolean))];
}

function parseArticleNumberRef(text) {
  const match = String(text || "").trim().match(/^第\s*([一二三四五六七八九十百零〇两0-9]+)\s*条/);
  return match ? parseChineseOrArabicNumber(match[1]) : "";
}

function parseChineseOrArabicNumber(value) {
  const source = String(value || "").replace(/\s+/g, "");
  if (!source) return "";
  if (/^\d+$/.test(source)) return source;
  const digits = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (source === "十") return "10";
  if (source.includes("百")) {
    const [hundredsText, restText = ""] = source.split("百");
    const rest = restText ? Number(parseChineseOrArabicNumber(restText)) : 0;
    return String((digits[hundredsText] || 1) * 100 + rest);
  }
  if (source.includes("十")) {
    const [tensText, onesText = ""] = source.split("十");
    return String((tensText ? digits[tensText] || 0 : 1) * 10 + (onesText ? digits[onesText] || 0 : 0));
  }
  return digits[source] === undefined ? "" : String(digits[source]);
}

function normalizeNumberRef(value) {
  const text = String(value || "").replace(/\s+/g, "");
  const decimal = text.match(/\d+(?:\.\d+)*/)?.[0] || "";
  return decimal.replace(/\.$/, "");
}
