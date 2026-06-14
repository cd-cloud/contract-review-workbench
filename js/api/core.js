const POLL_TIMEOUT_MS = 8 * 60 * 1000;
const POLL_INTERVAL_MS = 2500;
const VISUAL_QA_DELAY_MS = 30 * 1000;
const VISUAL_QA_COOLDOWN_MS = 10 * 60 * 1000;
const BACKEND_SYNC_DELAY_MS = 2500;

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
  const showLoading = !options.silentStatus;
  if (showLoading && typeof showGlobalLoading === "function") {
    showGlobalLoading({
      title: "AI 正在审阅合同",
      detail: "正在提交本地 Legal Skill 任务。长合同通常需要 1-3 分钟。",
      meta: "会依次读取合同、切分条款、匹配风险并生成修改建议。",
      steps: buildLegalSkillLoadingSteps("submitting"),
      showCancel: true,
      cancelText: "取消等待",
      onCancel: () => {
        if (typeof setGlobalLoadingStatus === "function") {
          setGlobalLoadingStatus({ detail: "任务正在提交，稍后可在运行阶段取消。", showCancel: false });
        }
      },
    });
  }
  const request = buildLegalSkillRequest(contract, materialText, extraRequirements, options);
  try {
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
  } finally {
    if (showLoading && typeof hideGlobalLoading === "function") hideGlobalLoading();
  }
}

function isLikelyServerUnavailableError(error) {
  const message = String(error?.message || error || "");
  return /Failed to fetch|NetworkError|Load failed|ECONNREFUSED|ERR_CONNECTION_REFUSED|fetch failed/i.test(message);
}

function buildLegalSkillLoadingSteps(activeStatus = "submitting") {
  const order = ["submitting", "queued", "running", "completed"];
  const labels = {
    submitting: "提交本地审阅任务",
    queued: "等待 AI Runner 接单",
    running: "读取合同并生成审阅意见",
    completed: "写回风险、建议和结构化结果",
  };
  const activeIndex = Math.max(0, order.indexOf(activeStatus));
  return order.map((status, index) => ({
    label: labels[status],
    status: index < activeIndex ? "done" : (index === activeIndex ? "running" : "pending"),
  }));
}

function normalizeLoadingJobStatus(job) {
  if (!job) return "queued";
  if (job.status === "completed") return "completed";
  if (job.status === "running") return "running";
  if (job.status === "queued") return "queued";
  return "running";
}

function updateLegalSkillLoading(job) {
  if (typeof setGlobalLoadingStatus !== "function") return;
  const status = normalizeLoadingJobStatus(job);
  const queueText = job?.status === "queued" && Number.isFinite(job.positionInQueue)
    ? `当前排队第 ${job.positionInQueue + 1} 位。`
    : "";
  const phase = job?.phase || (status === "queued" ? "任务已进入队列" : "AI Runner 正在处理合同");
  setGlobalLoadingStatus({
    title: status === "queued" ? "AI 审阅已排队" : "AI 正在审阅合同",
    detail: [phase, queueText, "长合同通常需要 1-3 分钟。"].filter(Boolean).join(" "),
    meta: "完成后会自动回到审阅台。",
    steps: buildLegalSkillLoadingSteps(status),
    showCancel: true,
    cancelText: "取消等待",
  });
}

async function pollLegalSkillJob(jobId, contractId, options = {}) {
  const oldController = pollControllers.get(jobId);
  if (oldController) oldController.abort();
  const controller = new AbortController();
  pollControllers.set(jobId, controller);
  try {
    if (!options.silentStatus) {
      setAnalysisStatus(contractId, "running", "AI Legal Skill 正在审阅合同，长合同通常需要 1-3 分钟。");
      if (typeof setGlobalLoadingStatus === "function") {
        setGlobalLoadingStatus({
          title: "AI 审阅已提交",
          detail: "任务已提交到本地队列，正在等待 AI Runner 返回进度。",
          meta: "可以继续等待，也可以取消本次等待。",
          steps: buildLegalSkillLoadingSteps("queued"),
          showCancel: true,
          cancelText: "取消等待",
        });
      }
      if (typeof document !== "undefined") {
        const cancelBtn = document.getElementById("global-loading-cancel");
        if (cancelBtn) {
          cancelBtn.onclick = async () => {
            cancelBtn.disabled = true;
            if (typeof setGlobalLoadingStatus === "function") {
              setGlobalLoadingStatus({ detail: "正在取消本次 AI 审阅任务...", showCancel: false });
            }
            try {
              await legalWorkbenchFetch(`/api/legal-review/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" });
            } catch (error) {}
            controller.abort();
          };
        }
      }
    }
    const startedAt = Date.now();
    while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
      if (controller.signal.aborted) throw new Error("AI 分析已取消。");
      await delay(POLL_INTERVAL_MS, controller.signal);
      const response = await legalWorkbenchFetch(`/api/legal-review/jobs/${encodeURIComponent(jobId)}`, { signal: controller.signal });
      if (!response.ok) throw new Error(await readBackendError(response, "AI 分析任务状态读取失败"));
      const data = await response.json();
      const job = data.job;
      const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
      if (!options.silentStatus) {
        setAnalysisStatus(contractId, job.status, `${job.phase || "分析中"}｜已等待 ${elapsedSeconds} 秒`);
        updateLegalSkillLoading(job);
      }
      if (job.status === "completed") return job.result;
      if (job.status === "failed") throw new Error(job.error || "AI 分析失败");
      if (job.status === "cancelled") throw new Error("AI 分析已取消。");
    }
    throw new Error("AI 分析超时，请稍后重试或缩短合同文本。");
  } finally {
    if (pollControllers.get(jobId) === controller) {
      pollControllers.delete(jobId);
    }
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
  saveState();
  if (state.activeContractId !== contractId) return;
  const active = document.activeElement;
  const isEditing = active && (active.isContentEditable || active.tagName === "INPUT" || active.tagName === "TEXTAREA");
  if (isEditing) {
    setTimeout(() => renderReview(), 500);
  } else {
    renderReview();
  }
}

function clearAnalysisStatus(contractId) {
  if (!state.analysisJobs) return;
  delete state.analysisJobs[contractId];
  if (typeof persistBackendAuxState === "function") {
    persistBackendAuxState({
      analysisJobs: state.analysisJobs,
    }).catch(() => {});
  }
  saveState();
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
  saveState();
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

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new Error("Cancelled"));
      }, { once: true });
    }
  });
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

// backendSyncTimer managed by TimerRegistry
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
    state.runtimePreference = data.runtimePreference || state.runtimePreference || { profile: "ai", label: "自动选择" };
    saveState();
    return data.runner;
  } catch (error) {
    state.runnerStatus = { configured: false, mode: "browser-fallback", error: error.message || String(error) };
    state.runnerStatuses = {};
    return state.runnerStatus;
  }
}

async function setRuntimeProfile(profile) {
  const response = await legalWorkbenchFetch("/api/runtime-profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profile }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "保存 AI 运行方式失败");
  state.runtimePreference = data.preference;
  saveState();
  return data;
}

function normalizeRunnerResultMeta(result = {}) {
  const r = result || {};
  return {
    source: r.source || "",
    isFallback: Boolean(r.isFallback) || /fallback/i.test(r.source || ""),
    fallbackReason: r.fallbackReason || "",
    promptVersion: r.promptVersion || r.prompt_version || "",
    skillPath: r.skillPath || r.skill_path || "",
    downstreamSkill: r.downstreamSkill || r.downstream_skill || "",
    checkedAt: r.checkedAt || r.checked_at || "",
  };
}

async function fetchContractWithTexts(contractId) {
  const response = await legalWorkbenchFetch(`/api/contracts/${encodeURIComponent(contractId)}`);
  if (!response.ok) throw new Error("获取合同文本失败");
  const data = await response.json();
  return data.contract || null;
}

async function ensureContractTextsLoaded(contractId) {
  const contract = state.contracts.find((c) => c.id === contractId);
  if (!contract) return;
  // If the contract already has large texts in memory, nothing to do.
  const hasLargeText = CORE_SYNC_TEXT_FIELDS.some((field) => contract[field] && contract[field].length > 200);
  if (hasLargeText) return;
  try {
    const backendContract = await fetchContractWithTexts(contractId);
    if (backendContract) {
      for (const field of CORE_SYNC_TEXT_FIELDS) {
        if (backendContract[field]) contract[field] = backendContract[field];
      }
      if (typeof renderReview === "function" && state.activeContractId === contractId) {
        renderReview();
      }
    }
  } catch (error) {
    console.error("[ensureContractTextsLoaded] Failed to load contract texts:", error.message);
  }
}

let lastSyncedSnapshot = null;
const CORE_SYNC_TEXT_FIELDS = ["text", "cleanText", "redlineText", "commentsText"];
const UPDATE_SYNC_TEXT_FIELDS = ["versionText", "acceptedText", "rejectedText", "revisionText", "commentsText"];

function stripLargeTextsFromSnapshot(snapshot) {
  const stripped = clone(snapshot);
  for (const contract of stripped.contracts || []) {
    for (const field of CORE_SYNC_TEXT_FIELDS) {
      if (contract[field] && contract[field].length > 200) {
        contract[field] = "";
      }
    }
  }
  for (const update of stripped.updates || []) {
    for (const field of UPDATE_SYNC_TEXT_FIELDS) {
      if (update[field] && update[field].length > 200) {
        update[field] = "";
      }
    }
  }
  return stripped;
}

function buildIncrementalPayload(current, last) {
  if (!last) return stripLargeTextsFromSnapshot(current);
  // Lightweight diff: compare sync generation counters instead of stringify.
  const currentGen = current?.storageMeta?.__syncGeneration || 0;
  const lastGen = last?.storageMeta?.__syncGeneration || 0;
  if (currentGen === lastGen) {
    return { syncMode: "incremental" }; // nothing changed
  }
  const currentStripped = stripLargeTextsFromSnapshot(current);
  currentStripped.syncMode = "incremental";
  return currentStripped;
}

function scheduleBackendSync() {
  backendSyncDirty = true;
  TimerRegistry.clear("backend-sync");
  TimerRegistry.set("backend-sync", setTimeout(() => flushBackendSync(), BACKEND_SYNC_DELAY_MS));
}

async function flushBackendSync() {
  if (backendSyncInFlight) {
    backendSyncDirty = true;
    return;
  }
  backendSyncInFlight = true;
  backendSyncDirty = false;
  // Defer state cloning to an idle period to avoid blocking user input
  const snapshot = await new Promise((resolve) => {
    const doClone = () => resolve(clone(state));
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(doClone, { timeout: 1000 });
    } else {
      TimerRegistry.set("backend-sync-clone", setTimeout(doClone, 0));
    }
  });
  // Build an incremental payload stripped of large texts.
  // The backend is the source of truth for large text fields.
  const payload = buildIncrementalPayload(snapshot, lastSyncedSnapshot);
  try {
    const response = await legalWorkbenchFetch("/api/db/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error("自动同步失败");
    // Only update the baseline after a successful sync; otherwise the next
    // incremental payload would be computed against a state the backend has
    // not yet persisted, causing changes to be silently dropped.
    lastSyncedSnapshot = stripLargeTextsFromSnapshot(snapshot);
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
    if (backendSyncDirty) scheduleBackendSync();
  }
}

function getStoredSkillResult(contractId) {
  return state.legalSkillResults?.[contractId]?.response || null;
}
