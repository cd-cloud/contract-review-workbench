function deleteContract(contractId) {
  const contract = state.contracts.find((item) => item.id === contractId);
  if (!contract) return false;
  const sourcePrefix = `${contractId}:`;
  Store.mutate("delete-contract-local-state", (draft) => {
    draft.contracts = draft.contracts.filter((item) => item.id !== contractId);
    draft.updates = (draft.updates || []).filter((item) => item.contractId !== contractId);
    draft.clauses = (draft.clauses || []).filter((item) => item.contractId !== contractId);
    draft.findings = (draft.findings || []).filter((item) => item.contractId !== contractId);
    draft.negotiations = (draft.negotiations || []).filter((item) => item.contractId !== contractId);
    cleanSourceScopedState((key) => key.startsWith(sourcePrefix));
    draft.subclauseMoves = (draft.subclauseMoves || []).filter((move) => !String(move.fromParentId || "").startsWith(sourcePrefix) && !String(move.toParentId || "").startsWith(sourcePrefix));
    if (draft.legalSkillResults) delete draft.legalSkillResults[contractId];
    if (draft.analysisJobs) delete draft.analysisJobs[contractId];
    if (draft.activeContractId === contractId) {
      draft.activeContractId = draft.contracts[0]?.id || null;
      draft.activeUpdateId = null;
      draft.activeWorkbenchClauseId = null;
      draft.activeSubclauseId = null;
    }
  }, { save: false });
  recordAudit("删除合同", { contractName: contract.name });
  saveState();
  return true;
}

function deleteContractVersion(updateId) {
  const update = (state.updates || []).find((item) => item.id === updateId);
  if (!update) return false;
  const contract = state.contracts.find((item) => item.id === update.contractId);
  const sourceKey = `${update.contractId}:${update.id}`;
  Store.mutate("delete-contract-version-local-state", (draft) => {
    draft.updates = (draft.updates || []).filter((item) => item.id !== updateId);
    cleanSourceScopedState((key) => key === sourceKey || key.startsWith(`${sourceKey}:`));
    draft.subclauseMoves = (draft.subclauseMoves || []).filter((move) => !String(move.fromParentId || "").startsWith(sourceKey) && !String(move.toParentId || "").startsWith(sourceKey));
    if (draft.activeUpdateId === updateId) {
      draft.activeUpdateId = getContractUpdates(update.contractId).at(-1)?.id || null;
      draft.activeWorkbenchClauseId = null;
      draft.activeSubclauseId = null;
    }
  }, { save: false });
  if (contract && state.activeUpdateId) {
    const active = (state.updates || []).find((item) => item.id === state.activeUpdateId);
    const text = active?.acceptedText || active?.versionText || contract.cleanText || contract.text || "";
    contract.text = text;
    contract.cleanText = text;
    contract.updatedAt = today();
  }
  recordAudit("删除合同版本", { contractName: contract?.name, note: `${update.type} ${update.createdAt || ""}`.trim() });
  saveState();
  return true;
}

function cleanSourceScopedState(matchKey) {
  ["clauseActions", "insertedClauses", "clauseOrder", "subclauseOrder", "insertionAudits"].forEach((bucket) => {
    const target = state[bucket];
    if (!target) return;
    Object.keys(target).forEach((key) => {
      if (matchKey(key)) delete target[key];
    });
  });
}

function buildPreparedSendingVersionText(contract) {
  const activeMaterial = getActiveMaterial(contract);
  const cleanText = getDisplayTextForMode(contract, activeMaterial, "clean");
  const material = {
    ...getWorkbenchMaterial(contract),
    text: cleanText,
    mode: "clean",
  };
  const clauses = splitVersionClauses(cleanText, material.sourceKey);
  const actions = getClauseActions(material.sourceKey);
  const parts = clauses
    .filter((clause) => !actions[clause.id]?.deleted)
    .map((clause) => getEditedClauseText(material.sourceKey, clause))
    .filter(Boolean);
  return {
    material,
    clauses,
    text: parts.join("\n\n"),
  };
}

function getPreparedVersionBaseText(contract, currentUpdateId) {
  const updates = getContractUpdates(contract.id).filter((item) => item.type !== "拟发送版本" && item.sourceType !== "generated");
  const activeIndex = updates.findIndex((item) => item.id === currentUpdateId);
  const base = activeIndex >= 0 ? updates[activeIndex] : updates.at(-1);
  if (base?.materialKind === "redline") return base.acceptedText || acceptRedlineText(base.versionText || "");
  return base?.acceptedText || base?.versionText || contract.cleanText || contract.text || "";
}

function summarizePreparedVersionChanges(sourceKey) {
  const actions = getClauseActions(sourceKey);
  const actionItems = Object.values(actions);
  const inserted = getInsertedClauses(sourceKey).length;
  const modified = actionItems.filter((action) => action.editedText).length;
  const deleted = actionItems.filter((action) => action.deleted).length;
  const commented = actionItems.filter((action) => action.comment).length;
  const reordered = getClauseOrder(sourceKey).length ? 1 : 0;
  const movedSubclauses = (state.subclauseMoves || []).filter((move) => String(move.fromParentId || "").startsWith(sourceKey) || String(move.toParentId || "").startsWith(sourceKey)).length;
  return [
    inserted ? `新增条款 ${inserted} 项` : "",
    modified ? `修改条款/小条款 ${modified} 项` : "",
    deleted ? `删除条款/小条款 ${deleted} 项` : "",
    movedSubclauses ? `移动小条款 ${movedSubclauses} 项` : "",
    reordered ? "调整条款顺序" : "",
    commented ? `保留批注 ${commented} 项` : "",
  ].filter(Boolean).join("；") || "未识别到显式修改，仅基于当前版本生成复核版";
}

function createPreparedSendingVersion(contract) {
  const previousActiveUpdateId = state.activeUpdateId || null;
  const { material, clauses, text } = buildPreparedSendingVersionText(contract);
  const sourceKey = material.sourceKey;
  const changeSummary = summarizePreparedVersionChanges(sourceKey);
  const baseText = getPreparedVersionBaseText(contract, previousActiveUpdateId);
  const update = {
    id: uid("upd-send"),
    contractId: contract.id,
    type: "拟发送版本",
    note: `基于当前审阅台修订生成，用于发送前复核。${changeSummary}`,
    materialKind: "prepared",
    versionText: text,
    acceptedText: text,
    rejectedText: baseText,
    revisionText: baseText ? buildReadableComparisonText(baseText, text) : text,
    commentsText: changeSummary,
    sourceType: "generated",
    fileName: "",
    knowledgeEligible: false,
    generatedFromUpdateId: state.activeUpdateId || null,
    generatedFromSourceKey: sourceKey,
    generatedAt: new Date().toISOString(),
    createdAt: today(),
  };
  const preparedSourceKey = `${contract.id}:${update.id}`;
  const preparedClauses = splitVersionClauses(text, preparedSourceKey);
  const reviewChecks = buildAutomaticReviewChecks(contract, { ...material, text, sourceKey: preparedSourceKey }, preparedClauses);
  update.reviewChecks = reviewChecks;
  update.commentsText = [changeSummary, summarizeAutomaticReviewChecks(reviewChecks)]
    .filter(Boolean)
    .join("\n");
  state.updates = state.updates || [];
  state.updates = state.updates.filter((item) => item.contractId !== contract.id || (item.type !== "拟发送版本" && item.sourceType !== "generated"));
  state.updates.push(update);
  storeAutomaticReviewChecks(contract.id, update.id, reviewChecks);
  state.activeUpdateId = update.id;
  state.activeWorkbenchClauseId = null;
  state.activeSubclauseId = null;
  state.subclauseReferenceMap = {};
  contract.text = text;
  contract.cleanText = text;
  contract.workflowStatus = "拟发送版本复核";
  contract.status = "审阅中";
  contract.updatedAt = today();
  if (typeof persistBackendAuxState === "function") {
    persistBackendAuxState({
      activeUpdateId: state.activeUpdateId,
      activeWorkbenchClauseId: state.activeWorkbenchClauseId,
      activeSubclauseId: state.activeSubclauseId,
      subclauseReferenceMap: state.subclauseReferenceMap,
    }).catch(() => {});
  }
  return { update, sourceKey, changeSummary, reviewChecks, clauses, text };
}
