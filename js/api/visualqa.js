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
    // Auto-apply safe fixes after Visual QA completes
    const fixResult = applyVisualQaAutoFixes(sourceKey, { rerun: false });
    if (fixResult.applied > 0) {
      showToast(`Agent B 已自动执行 ${fixResult.applied} 项安全修复。`);
    }
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
