function getCurrentReviewContext() {
  const contract = state.contracts.find((item) => item.id === state.activeContractId);
  if (!contract) return null;
  const material = getWorkbenchMaterial(contract);
  const clauses = splitVersionClauses(material.text, material.sourceKey);
  return { contract, material, clauses };
}

function enqueueBackendAudit(action, details = {}, contract = null, clauseId = "") {
  if (typeof appendBackendAudit !== "function") return;
  appendBackendAudit({
    action,
    contractId: contract?.id || state.activeContractId || null,
    contractName: contract?.name || "",
    clauseId: clauseId || null,
    details,
  }).catch(() => {});
}

function getContractRiskFindings(contract, clauses) {
  return getAnalysisFindings(contract, clauses).filter((item) => !item.clauseId && (item.fix || item.issue || item.title));
}

function adoptAllContractRiskSuggestions() {
  const context = getCurrentReviewContext();
  if (!context) return 0;
  const findings = getContractRiskFindings(context.contract, context.clauses).filter((finding) => getContractRiskDecision(context.contract.id, getContractRiskDecisionKey(finding))?.status !== "rejected");
  let adopted = 0;
  findings.forEach((finding) => {
    if (adoptContractRiskSuggestionByFinding(context, finding)) {
      adopted += 1;
      recordAiSuggestionFeedback("contract", "adopted", {
        contractId: context.contract.id,
        actionType: finding.actionType || "add_clause",
        title: finding.title || finding.issue,
        note: finding.fix || finding.proposedClauseText || "",
      });
    }
  });
  if (adopted) {
    recordAudit("一键采纳合同级AI建议", { contractName: context.contract.name, note: `新增 ${adopted} 条拟补充条款` });
    enqueueBackendAudit("一键采纳合同级AI建议", { contractName: context.contract.name, note: `新增 ${adopted} 条拟补充条款` }, context.contract);
    saveState();
    requestVisualQaAfterSuggestionAction(context.contract.id, "adopt-all-contract-risks");
    renderReview();
  }
  return adopted;
}

function recordAiSuggestionFeedback(scope, status, payload = {}) {
  const contract = state.contracts.find((item) => item.id === (payload.contractId || state.activeContractId));
  const clause = payload.clauseId
    ? [
        ...state.clauses,
        ...(contract ? splitVersionClauses(getWorkbenchMaterial(contract).text, getWorkbenchMaterial(contract).sourceKey) : []),
      ].find((item) => item.id === payload.clauseId)
    : null;
  state.aiSuggestionFeedback = state.aiSuggestionFeedback || [];
  state.aiSuggestionFeedback.unshift({
    id: uid("ai-feedback"),
    scope,
    status,
    contractId: payload.contractId || state.activeContractId || "",
    contractName: contract?.name || "",
    contractType: contract?.type || "",
    counterpartyId: contract?.counterpartyId || "",
    counterpartyName: contract?.counterpartyName || "",
    clauseId: payload.clauseId || "",
    clauseType: payload.clauseType || clause?.type || "",
    actionType: payload.actionType || "",
    title: payload.title || "",
    note: payload.note || "",
    createdAt: new Date().toISOString(),
  });
  state.aiSuggestionFeedback = state.aiSuggestionFeedback.slice(0, 1000);
}

function adoptContractRiskSuggestion(index) {
  const context = getCurrentReviewContext();
  if (!context) return false;
  const finding = getContractRiskFindings(context.contract, context.clauses)[Number(index)];
  if (!finding) return false;
  const adopted = adoptContractRiskSuggestionByFinding(context, finding);
  if (adopted) {
    recordAiSuggestionFeedback("contract", "adopted", {
      contractId: context.contract.id,
      actionType: finding.actionType || "add_clause",
      title: finding.title || finding.issue,
      note: finding.fix || finding.proposedClauseText || "",
    });
    recordAudit("采纳合同级AI建议", { contractName: context.contract.name, note: finding.title || finding.issue });
    enqueueBackendAudit("采纳合同级AI建议", { contractName: context.contract.name, note: finding.title || finding.issue }, context.contract);
    saveState();
    requestVisualQaAfterSuggestionAction(context.contract.id, "adopt-contract-risk");
    renderReview();
  }
  return adopted;
}

function adoptContractRiskSuggestionByFinding(context, finding) {
  setContractRiskDecision(context.contract.id, finding, "adopted");
  const inserted = getInsertedClauses(context.material.sourceKey);
  const clause = buildClauseFromContractRisk(finding, context);
  const exists = inserted.some((item) => normalizeText(item.title) === normalizeText(clause.title) && normalizeText(item.text) === normalizeText(clause.text));
  if (exists) return false;
  inserted.push({
    id: uid("ai-clause"),
    targetClauseId: "",
    targetStableId: "",
    targetOriginalNumber: null,
    position: "end",
    type: clause.type,
    title: clause.title,
    text: clause.text,
    comment: `采纳合同级AI建议：${finding.title || finding.issue || ""}`,
    createdAt: new Date().toISOString(),
  });
  state.expandedTreeNodes = state.expandedTreeNodes || {};
  state.activeWorkbenchClauseId = null;
  return true;
}

function rejectContractRiskSuggestion(index) {
  const context = getCurrentReviewContext();
  if (!context) return false;
  const finding = getContractRiskFindings(context.contract, context.clauses)[Number(index)];
  if (!finding) return false;
  setContractRiskDecision(context.contract.id, finding, "rejected");
  recordAiSuggestionFeedback("contract", "rejected", {
    contractId: context.contract.id,
    actionType: finding.actionType || "add_clause",
    title: finding.title || finding.issue,
    note: finding.fix || "",
  });
  recordAudit("拒绝合同级AI建议", { contractName: context.contract.name, note: finding.title || finding.issue });
  enqueueBackendAudit("拒绝合同级AI建议", { contractName: context.contract.name, note: finding.title || finding.issue }, context.contract);
  saveState();
  requestVisualQaAfterSuggestionAction(context.contract.id, "reject-contract-risk");
  renderReview();
  return true;
}

function restoreContractRiskSuggestion(index) {
  const context = getCurrentReviewContext();
  if (!context) return false;
  const finding = getContractRiskFindings(context.contract, context.clauses)[Number(index)];
  if (!finding) return false;
  setContractRiskDecision(context.contract.id, finding, "pending");
  recordAiSuggestionFeedback("contract", "restored", {
    contractId: context.contract.id,
    actionType: finding.actionType || "add_clause",
    title: finding.title || finding.issue,
  });
  recordAudit("恢复合同级AI建议", { contractName: context.contract.name, note: finding.title || finding.issue });
  enqueueBackendAudit("恢复合同级AI建议", { contractName: context.contract.name, note: finding.title || finding.issue }, context.contract);
  saveState();
  requestVisualQaAfterSuggestionAction(context.contract.id, "restore-contract-risk");
  renderReview();
  return true;
}

function getContractRiskDecision(contractId, key) {
  state.contractRiskDecisions = state.contractRiskDecisions || {};
  state.contractRiskDecisions[contractId] = state.contractRiskDecisions[contractId] || {};
  return state.contractRiskDecisions[contractId][key] || null;
}

function setContractRiskDecision(contractId, finding, status) {
  state.contractRiskDecisions = state.contractRiskDecisions || {};
  state.contractRiskDecisions[contractId] = state.contractRiskDecisions[contractId] || {};
  const key = getContractRiskDecisionKey(finding);
  if (status === "pending") delete state.contractRiskDecisions[contractId][key];
  else {
    state.contractRiskDecisions[contractId][key] = {
      status,
      title: finding.title || finding.issue || "",
      updatedAt: new Date().toISOString(),
    };
  }
}

function getContractRiskDecisionKey(finding) {
  return normalizeText([finding.title, finding.issue, finding.fix, finding.actionType].filter(Boolean).join("|")).slice(0, 180);
}

function buildClauseFromContractRisk(finding, context = null) {
  const concrete = context ? buildConcreteContractRiskSuggestion(context.contract, context.material, context.clauses, finding) : null;
  if (concrete?.draftText) {
    return {
      type: concrete.type || "其他",
      title: getAdoptedInsertedClauseTitle(concrete.title || concrete.type || finding.title || finding.issue || concrete.draftText, concrete.type),
      text: concrete.draftText,
    };
  }
  const source = `${finding.title || ""}\n${finding.issue || ""}\n${finding.fix || ""}`;
  const type = clauseTypes.find((item) => source.includes(item)) || "其他";
  const title = source.match(/缺少(.+?)条款/)?.[1] ? `${source.match(/缺少(.+?)条款/)?.[1]}条款` : `${type}条款`;
  const body = finding.fix || finding.issue || finding.title || "请根据交易背景补充本条款。";
  const text = /^第[一二三四五六七八九十百零〇两0-9]+条/.test(body) || body.includes("\n") ? body : `${title}\n${body}`;
  return { type, title, text };
}

async function adoptClauseRiskSuggestion(sourceKey, clauseId) {
  const context = getCurrentReviewContext();
  if (!context) return false;
  const target = findClauseOrSubclause(context.clauses, clauseId);
  if (!target) return false;
  const risk = getClauseRiskSummary(context.contract, target.clause, sourceKey, clauseId);
  if (!risk?.fix) return false;
  const backendApplied = await applyBackendSuggestionAction(context, sourceKey, clauseId, target, risk, "adopt").catch((error) => {
    handleBackendSuggestionActionError(error);
    return false;
  });
  if (backendApplied) return true;
  return false;
}

async function commentClauseRiskSuggestion(sourceKey, clauseId) {
  return closeClauseRiskSuggestion(sourceKey, clauseId, "comment_only");
}

async function adjustClauseRiskSuggestion(sourceKey, clauseId, userInstruction = "") {
  const context = getCurrentReviewContext();
  if (!context) return false;
  const target = findClauseOrSubclause(context.clauses, clauseId);
  if (!target) return false;
  const risk = getClauseRiskSummary(context.contract, target.clause, sourceKey, clauseId);
  if (!risk?.fix) return false;
  if (typeof runBackendSuggestionAction !== "function") return false;
  const result = await runBackendSuggestionAction({
    userAction: "adjust",
    userInstruction,
    contract: {
      id: context.contract.id,
      name: context.contract.name,
      type: context.contract.type,
      ourRole: context.contract.ourRole,
      counterpartyName: context.contract.counterpartyName,
      businessBackground: context.contract.businessBackground,
    },
    material: {
      sourceKey,
      title: context.material.title,
      text: context.material.text,
    },
    targetClauseId: clauseId,
    targetClause: target.clause,
    parentClause: target.parent || null,
    clauses: context.clauses.map((clause) => ({
      id: clause.id,
      stableId: clause.stableId,
      title: clause.title,
      type: clause.type,
      text: clause.text,
      number: clause.number,
    })),
    suggestion: risk,
  }).catch((error) => {
    handleBackendSuggestionActionError(error);
    return null;
  });
  if (!result?.action) return false;
  applyStructuredSuggestionAdjustment(context, sourceKey, clauseId, target, risk, result.action, userInstruction);
  return true;
}

async function confirmClauseRiskBusinessDecision(sourceKey, clauseId) {
  return closeClauseRiskSuggestion(sourceKey, clauseId, "business_confirmed");
}

async function rejectClauseRiskSuggestion(sourceKey, clauseId) {
  return closeClauseRiskSuggestion(sourceKey, clauseId, "rejected");
}

async function closeClauseRiskSuggestion(sourceKey, clauseId, status) {
  const context = getCurrentReviewContext();
  if (!context) return false;
  const target = findClauseOrSubclause(context.clauses, clauseId);
  if (!target) return false;
  const risk = getClauseRiskSummary(context.contract, target.clause, sourceKey, clauseId);
  const backendApplied = await applyBackendSuggestionAction(context, sourceKey, clauseId, target, risk, status === "rejected" ? "reject" : status).catch((error) => {
    handleBackendSuggestionActionError(error);
    return false;
  });
  if (backendApplied) return true;
  return false;
}

function handleBackendSuggestionActionError(error) {
  const message = error?.message || String(error || "未知错误");
  showToast(`AI 建议动作失败：${message}`, "error");
}

async function applyBackendSuggestionAction(context, sourceKey, clauseId, target, risk, userAction, userInstruction = "") {
  if (typeof runBackendSuggestionAction !== "function") return false;
  const result = await runBackendSuggestionAction({
    userAction,
    userInstruction,
    contract: {
      id: context.contract.id,
      name: context.contract.name,
      type: context.contract.type,
      ourRole: context.contract.ourRole,
      counterpartyName: context.contract.counterpartyName,
      businessBackground: context.contract.businessBackground,
    },
    material: {
      sourceKey,
      title: context.material.title,
      text: context.material.text,
    },
    targetClauseId: clauseId,
    targetClause: target.clause,
    parentClause: target.parent || null,
    clauses: context.clauses.map((clause) => ({
      id: clause.id,
      stableId: clause.stableId,
      title: clause.title,
      type: clause.type,
      text: clause.text,
      number: clause.number,
    })),
    suggestion: risk,
  });
  if (!result?.action) return false;
  applyStructuredSuggestionAction(context, sourceKey, clauseId, target, risk, result.action);
  return true;
}

function applyStructuredSuggestionAdjustment(context, sourceKey, clauseId, target, risk, action, userInstruction = "") {
  const adjusted = buildAdjustedClauseRisk(risk, action, userInstruction);
  setAdjustedClauseSuggestion(sourceKey, clauseId, adjusted);
  recordAiSuggestionFeedback("clause", "adjusted", {
    contractId: context.contract.id,
    clauseId,
    actionType: adjusted.actionType || risk.actionType || risk.action || "comment_only",
    title: adjusted.summary || risk.summary || target.clause.title,
    note: adjusted.fix || adjusted.issue || action.comment || "",
  });
  recordAudit("调整AI建议文本", { contractName: context.contract.name, clauseTitle: target.clause.title || clauseId, note: userInstruction || action.comment });
  enqueueBackendAudit("调整AI建议文本", { contractName: context.contract.name, clauseTitle: target.clause.title || clauseId, note: userInstruction || action.comment }, context.contract, clauseId);
  if (clauseId.includes("::sub-")) state.activeSubclauseId = clauseId;
  else state.activeWorkbenchClauseId = clauseId;
  saveState();
  requestVisualQaAfterSuggestionAction(context.contract.id, "adjust-clause-risk");
  renderReview();
  clauseId.includes("::sub-") ? scrollToSubclause(clauseId) : scrollToWorkbenchClause(clauseId);
}

function buildAdjustedClauseRisk(risk = {}, action = {}, userInstruction = "") {
  const insertedText = action.insertedClause?.text || "";
  const nextFix = action.actionType === "add_clause" ? insertedText : action.editedText || insertedText || risk.fix || action.comment || "";
  const nextActionType = action.actionType && action.actionType !== "none" ? action.actionType : risk.actionType || "";
  return {
    ...risk,
    severity: risk.severity || "medium",
    summary: action.comment || risk.summary || risk.issue || "已调整AI建议",
    issue: risk.issue || action.comment || "",
    fix: nextFix,
    actionType: nextActionType,
    action: inferAdjustedRiskAction(nextActionType, risk.action),
    negotiationBottomLine: risk.negotiationBottomLine || "",
    acceptableFallback: risk.acceptableFallback || "",
    adjusted: true,
    adjustedInstruction: userInstruction,
    adjustedAt: new Date().toISOString(),
    knowledgeNote: action.knowledgeNote || risk.knowledgeNote || "",
  };
}

function inferAdjustedRiskAction(actionType, fallback) {
  if (actionType === "add_clause") return "新增";
  if (actionType === "delete_clause") return "删除";
  if (actionType === "replace_clause") return "替换";
  if (actionType === "revise_clause") return "修改";
  if (actionType === "comment_only") return "批注";
  return fallback || "修改";
}

function applyStructuredSuggestionAction(context, sourceKey, clauseId, target, risk, action) {
  const actions = getClauseActions(sourceKey);
  actions[clauseId] = actions[clauseId] || {};
  if (action.actionType === "add_clause" && action.insertedClause?.text) {
    const inserted = getInsertedClauses(sourceKey);
    const anchor = target.parent || target.clause;
    const exists = inserted.some((item) => normalizeText(item.text) === normalizeText(action.insertedClause.text));
    if (!exists) {
      inserted.push({
        id: uid("ai-clause"),
        targetClauseId: action.insertedClause.targetClauseId || anchor.id,
        targetStableId: anchor.stableId || anchor.id,
        targetOriginalNumber: anchor.originalNumber || anchor.number || null,
        position: action.insertedClause.position === "before" ? "before" : action.insertedClause.position === "end" ? "end" : "after",
        type: action.insertedClause.type || target.clause.type || "其他",
        title: getAdoptedInsertedClauseTitle(action.insertedClause.title || risk.summary || risk.issue || action.insertedClause.text, action.insertedClause.type || target.clause.type),
        text: action.insertedClause.text,
        comment: action.comment || `采纳AI新增建议：${risk.summary || risk.issue || ""}`,
        createdAt: new Date().toISOString(),
        adoptedFromSuggestion: true,
      });
    }
  } else if (action.actionType === "delete_clause") {
    actions[clauseId].deleted = true;
  } else if (["replace_clause", "revise_clause"].includes(action.actionType) && action.editedText) {
    actions[clauseId].editedText = action.editedText;
  }
  if (action.comment) actions[clauseId].comment = appendActionComment(actions[clauseId].comment, action.comment);
  if (["rejected", "comment_only", "business_confirmed"].includes(action.status)) actions[clauseId].riskDecision = action.status;
  recordAiSuggestionFeedback("clause", action.status || "adopted", {
    contractId: context.contract.id,
    clauseId,
    actionType: action.actionType || risk.actionType || risk.action || "comment_only",
    title: risk.summary || risk.issue || target.clause.title,
    note: action.knowledgeNote || action.comment || risk.fix || risk.issue || "",
  });
  recordAudit("后端 AI 处理建议", { contractName: context.contract.name, clauseTitle: target.clause.title || clauseId, note: action.comment || action.status });
  enqueueBackendAudit("后端 AI 处理建议", { contractName: context.contract.name, clauseTitle: target.clause.title || clauseId, note: action.comment || action.status }, context.contract, clauseId);
  if (clauseId.includes("::sub-")) state.activeSubclauseId = clauseId;
  else state.activeWorkbenchClauseId = clauseId;
  saveState();
  requestVisualQaAfterSuggestionAction(context.contract.id, `clause-action-${action.actionType || action.status || "updated"}`);
  renderReview();
  clauseId.includes("::sub-") ? scrollToSubclause(clauseId) : scrollToWorkbenchClause(clauseId);
}

function requestVisualQaAfterSuggestionAction(contractId, reason) {
  // Suggestion actions update the UI immediately; model-backed Agent B is now manual,
  // AI-result-triggered, or export-triggered to keep token use under control.
}

function findClauseOrSubclause(clauses, clauseId) {
  for (const clause of clauses) {
    if (clause.id === clauseId) return { clause, parent: null };
    const subclause = splitSubclauses(clause).find((item) => item.id === clauseId);
    if (subclause) return { clause: subclause, parent: clause };
  }
  return null;
}

function buildAdoptedClauseText(originalText, suggestion) {
  const cleanSuggestion = String(suggestion || "").trim();
  if (!cleanSuggestion) return originalText;
  const replacement = cleanSuggestion.match(/^建议修改为[:：]\s*\n?([\s\S]+)$/)?.[1]?.trim();
  if (replacement) return replacement;
  if (looksLikeReplacementText(cleanSuggestion)) return cleanSuggestion;
  return `${originalText}\n\n【AI修改建议】${cleanSuggestion}`;
}

function looksLikeReplacementText(text) {
  return /^第[一二三四五六七八九十百零〇两0-9]+条/.test(text) || /^\d+(?:\.\d+)*\s+/.test(text) || text.includes("\n") || text.length >= 90;
}

function appendActionComment(existing, next) {
  return [existing, next].filter(Boolean).join("\n");
}

function getAdoptedInsertedClauseTitle(source, type = "") {
  const cleaned = cleanAdoptedInsertedTitle(source);
  if (cleaned) return cleaned;
  const typeTitle = cleanAdoptedInsertedTitle(type);
  if (typeTitle) return typeTitle.endsWith("条款") ? typeTitle : `${typeTitle}条款`;
  return "补充安排";
}

function cleanAdoptedInsertedTitle(source) {
  const text = String(source || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)[0] || "";
  const cleaned = text
    .replace(/^第[\u4e00-\u9fa50-9]+条[：:、.\s]*/u, "")
    .replace(/^[0-9]+(?:\.[0-9]+)*[.、\s]+/u, "")
    .replace(/^(建议)?新增(条款|约定|安排)?[：:、.\s]*/u, "")
    .replace(/^补充(条款|约定|安排)?[：:、.\s]*/u, "")
    .split(/[：:，,。；;]/u)[0]
    .trim();
  if (!cleaned || /^(新增条款|建议新增条款)$/u.test(cleaned)) return "";
  return cleaned.length > 36 ? "" : cleaned;
}

function normalizeText(text) {
  return String(text || "").replace(/\s+/g, "");
}
