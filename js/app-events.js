async function handleGlobalClick(event) {
  if (handleNavClick(event)) return;
  if (handleModalClick(event)) return;
  if (handleProgressClick(event)) return;
  if (handleReviewClick(event)) return;
  if (handleContractNavClick(event)) return;
  if (handleWorkbenchClick(event)) return;
  if (handleContractRiskClick(event)) return;
  if (await handleClauseRiskClick(event)) return;
  if (await handleClauseActionClick(event)) return;
  if (await handleExportClick(event)) return;
  if (await handleBackendClick(event)) return;
  if (handleDraftClick(event)) return;
}

function handleNavClick(event) {
const nav = event.target.closest(".nav-item");
  if (nav) setView(nav.dataset.view);

  const viewTarget = event.target.closest("[data-view-target]");
  if (viewTarget) setView(viewTarget.dataset.viewTarget);

  const sidebarToggle = event.target.closest("[data-toggle-sidebar]");
  if (sidebarToggle) {
    document.body.classList.toggle("sidebar-expanded");
    sidebarToggle.setAttribute("aria-expanded", document.body.classList.contains("sidebar-expanded") ? "true" : "false");
  }

  if (event.target.closest("[data-toggle-audit-logs]")) {
    state.auditLogsCollapsed = state.auditLogsCollapsed === false;
    saveState();
    renderDashboard();
    return true;
  }
  return false;
}

function handleModalClick(event) {
  const uploadButton = event.target.closest("[data-open-upload]");
  if (uploadButton) openUploadModal();

  const closeUploadButton = event.target.closest("[data-close-upload]");
  if (closeUploadButton) closeUploadModal();

  const autofillNewReview = event.target.closest("[data-autofill-new-review]");
  if (autofillNewReview) {
    autofillNewReviewFromMaterial();
    return true;
  }

  const localAutofillNewReview = event.target.closest("[data-autofill-new-review-local]");
  if (localAutofillNewReview) {
    autofillNewReviewFromLocalRules();
    return true;
  }
  return false;
}

function handleProgressClick(event) {
  const progressButton = event.target.closest("[data-open-progress]");
  if (progressButton) openProgressModal(progressButton.dataset.openProgress);

  const activeProgressButton = event.target.closest("[data-open-active-progress]");
  if (activeProgressButton && state.activeContractId) openProgressModal(state.activeContractId);

  const deleteContractButton = event.target.closest("[data-delete-contract]");
  if (deleteContractButton) {
    event.preventDefault();
    event.stopPropagation();
    const contract = state.contracts.find((item) => item.id === deleteContractButton.dataset.deleteContract);
    if (contract && confirm(`确定删除合同“${contract.name}”及其全部版本和审阅记录吗？`)) {
      deleteContract(contract.id);
      saveState();
      render();
      showToast("合同已删除。");
    }
  }

  const deleteUpdateButton = event.target.closest("[data-delete-update]");
  if (deleteUpdateButton) {
    event.preventDefault();
    event.stopPropagation();
    const update = (state.updates || []).find((item) => item.id === deleteUpdateButton.dataset.deleteUpdate);
    if (update && confirm(`确定删除版本“${update.type} ${update.createdAt || ""}”吗？`)) {
      deleteContractVersion(update.id);
      saveState();
      renderReview();
      showToast("版本已删除。");
    }
  }

  const closeProgressButton = event.target.closest("[data-close-progress]");
  if (closeProgressButton) closeProgressModal();

  const closeSkillResultButton = event.target.closest("[data-close-skill-result]");
  if (closeSkillResultButton) closeSkillResultModal();
  return false;
}

function handleReviewClick(event) {
  const reviewModeButton = event.target.closest("[data-review-mode]");
  if (reviewModeButton && !reviewModeButton.disabled) {
    state.reviewMode = reviewModeButton.dataset.reviewMode;
    saveState();
    renderReview();
  }

  const clauseViewModeButton = event.target.closest("[data-clause-view-mode]");
  if (clauseViewModeButton) {
    event.preventDefault();
    event.stopPropagation();
    const [sourceKey, clauseId, mode] = clauseViewModeButton.dataset.clauseViewMode.split("||");
    state.clauseViewModes = state.clauseViewModes || {};
    state.clauseViewModes[`${sourceKey}||${clauseId}`] = mode;
    saveState();
    renderReview();
    clauseId.includes("::sub-") ? scrollToSubclause(clauseId) : scrollToWorkbenchClause(clauseId);
    return true;
  }

  const adviceAnchor = event.target.closest("[data-clause-advice-anchor]");
  if (adviceAnchor && !event.target.closest("button, textarea, input, select")) {
    event.preventDefault();
    event.stopPropagation();
    state.focusedAdviceKey = adviceAnchor.dataset.clauseAdviceAnchor;
    saveState();
    renderReview();
    requestAnimationFrame(() => {
      const body = findByDataAttribute("data-clause-body-anchor", state.focusedAdviceKey);
      body?.scrollIntoView({ block: "center" });
    });
    return true;
  }

  const bodyAnchor = event.target.closest("[data-clause-body-anchor]");
  if (bodyAnchor && !event.target.closest("button, textarea, input, select")) {
    event.preventDefault();
    state.focusedAdviceKey = bodyAnchor.dataset.clauseBodyAnchor;
    saveState();
    renderReview();
    requestAnimationFrame(() => {
      const advice = findByDataAttribute("data-clause-advice-anchor", state.focusedAdviceKey);
      advice?.scrollIntoView({ block: "nearest" });
    });
    return true;
  }

  const addClauseButton = event.target.closest("[data-open-add-clause]");
  if (addClauseButton) {
    event.preventDefault();
    event.stopPropagation();
    const contract = state.contracts.find((item) => item.id === state.activeContractId);
    if (contract) {
      const [sourceKey, clauseId] = addClauseButton.dataset.openAddClause.split("||");
      const material = getWorkbenchMaterial(contract);
      const clauses = splitVersionClauses(material.text, material.sourceKey);
      state.activeWorkbenchClauseId = clauseId || state.activeWorkbenchClauseId;
      state.inlineEditClauseId = null;
      state.inlineCommentClauseId = null;
      openAddClauseModal(sourceKey || material.sourceKey, clauses);
    }
    return true;
  }

  const inlineEditButton = event.target.closest("[data-open-inline-edit]");
  if (inlineEditButton) {
    event.preventDefault();
    event.stopPropagation();
    const [sourceKey, clauseId] = inlineEditButton.dataset.openInlineEdit.split("||");
    state.activeWorkbenchClauseId = clauseId.includes("::sub-") ? state.activeWorkbenchClauseId : clauseId;
    if (clauseId.includes("::sub-")) state.activeSubclauseId = clauseId;
    state.expandedTreeNodes = state.expandedTreeNodes || {};
    state.expandedTreeNodes[clauseId] = true;
    state.inlineEditClauseId = null;
    saveState();
    renderReview();
    requestAnimationFrame(() => {
      const exactEditor = findByDataAttribute("data-clause-edit", `${sourceKey}||${clauseId}`);
      const card = clauseId.includes("::sub-")
        ? findByDataAttribute("data-workbench-subclause", clauseId)?.closest(".subclause-card")
        : findByDataAttribute("data-workbench-clause", clauseId)?.closest(".inline-clause-card");
      const editor = exactEditor || card?.querySelector("[data-clause-edit]");
      editor?.focus();
      editor?.setSelectionRange?.(editor.value.length, editor.value.length);
      clauseId.includes("::sub-") ? scrollToSubclause(clauseId) : scrollToWorkbenchClause(clauseId);
    });
    return true;
  }

  const inlineCommentButton = event.target.closest("[data-toggle-inline-comment]");
  if (inlineCommentButton) {
    event.preventDefault();
    event.stopPropagation();
    const [sourceKey, clauseId] = inlineCommentButton.dataset.toggleInlineComment.split("||");
    state.activeWorkbenchClauseId = clauseId.includes("::sub-") ? state.activeWorkbenchClauseId : clauseId;
    if (clauseId.includes("::sub-")) state.activeSubclauseId = clauseId;
    state.inlineCommentClauseId = state.inlineCommentClauseId === clauseId ? null : clauseId;
    state.inlineEditClauseId = state.inlineCommentClauseId ? null : state.inlineEditClauseId;
    saveState();
    renderReview();
    clauseId.includes("::sub-") ? scrollToSubclause(clauseId) : scrollToWorkbenchClause(clauseId);
    return true;
  }

  const closeAddClauseButton = event.target.closest("[data-close-add-clause]");
  if (closeAddClauseButton) closeAddClauseModal();

  const readerTab = event.target.closest("[data-reader-tab]");
  if (readerTab) {
    event.preventDefault();
    event.stopPropagation();
    const tabName = readerTab.dataset.readerTab;
    const reader = readerTab.closest(".inline-clause-tools") || readerTab.closest(".contract-text");
    reader.querySelectorAll("[data-reader-tab]").forEach((button) => {
      button.classList.toggle("active", button.dataset.readerTab === tabName);
    });
    reader.querySelectorAll("[data-reader-pane]").forEach((pane) => {
      pane.classList.toggle("active", pane.dataset.readerPane === tabName);
    });
    return true;
  }

  const indexTab = event.target.closest("[data-index-tab]");
  if (indexTab) {
    event.preventDefault();
    event.stopPropagation();
    const tabName = indexTab.dataset.indexTab;
    const scope = indexTab.closest("[data-reader-pane='index']");
    scope.querySelectorAll("[data-index-tab]").forEach((button) => {
      button.classList.toggle("active", button.dataset.indexTab === tabName);
    });
    scope.querySelectorAll("[data-index-pane]").forEach((pane) => {
      pane.classList.toggle("active", pane.dataset.indexPane === tabName);
    });
    return true;
  }
  return false;
}

function handleContractNavClick(event) {
  const openContract = event.target.closest("[data-open-contract]");
  if (openContract) {
    const contractId = openContract.dataset.openContract;
    setActiveContract(contractId);
    saveState();
    scheduleAutomaticCodexReview(contractId, "draft-to-review");
    setView("review");
  }

  const openClause = event.target.closest("[data-open-clause]");
  if (openClause) {
    const [contractId, clauseId] = openClause.dataset.openClause.split(":");
    state.activeContractId = contractId;
    state.activeClauseId = clauseId;
    state.activeUpdateId = null;
    saveState();
    setView("review");
  }

  const openUpdate = event.target.closest("[data-open-update]");
  if (openUpdate) {
    if (openUpdate.dataset.updateContract) state.activeContractId = openUpdate.dataset.updateContract;
    state.activeUpdateId = openUpdate.dataset.openUpdate;
    saveState();
    setView("review");
  }
  return false;
}

function handleWorkbenchClick(event) {
  const workbenchClause = event.target.closest("[data-workbench-clause]");
  if (workbenchClause) {
    event.preventDefault();
    event.stopPropagation();
    const clauseId = workbenchClause.dataset.workbenchClause;
    if (event.detail >= 2) {
      clearTimeout(clauseClickTimer);
      clauseClickTimer = null;
      const toggle = workbenchClause.closest("[data-clause-card]")?.querySelector(":scope > .tree-card-header [data-toggle-tree-node]");
      if (toggle) toggleTreeNodeExpansion(toggle.dataset.toggleTreeNode);
      return true;
    }
    if (workbenchClause.closest(".review-advice-sidebar")) {
      clearTimeout(clauseClickTimer);
      clauseClickTimer = null;
      focusWorkbenchClause(clauseId);
      return true;
    }
    clearTimeout(clauseClickTimer);
    clauseClickTimer = setTimeout(() => {
      focusWorkbenchClause(clauseId);
      clauseClickTimer = null;
    }, 180);
    return true;
  }

  const workbenchSubclause = event.target.closest("[data-workbench-subclause]");
  if (workbenchSubclause) {
    event.preventDefault();
    event.stopPropagation();
    const parentClauseId = workbenchSubclause.dataset.parentClause;
    const subclauseId = workbenchSubclause.dataset.workbenchSubclause;
    if (event.detail >= 2) {
      clearTimeout(clauseClickTimer);
      clauseClickTimer = null;
      const toggle = workbenchSubclause.closest("[data-subclause-card]")?.querySelector(":scope > .tree-card-header [data-toggle-tree-node]");
      if (toggle) toggleTreeNodeExpansion(toggle.dataset.toggleTreeNode);
      return true;
    }
    if (workbenchSubclause.closest(".review-advice-sidebar")) {
      clearTimeout(clauseClickTimer);
      clauseClickTimer = null;
      focusWorkbenchSubclause(parentClauseId, subclauseId);
      return true;
    }
    clearTimeout(clauseClickTimer);
    clauseClickTimer = setTimeout(() => {
      focusWorkbenchSubclause(parentClauseId, subclauseId);
      clauseClickTimer = null;
    }, 180);
    return true;
  }

  if (event.target.closest("[data-toggle-contract-risk]")) {
    state.contractRiskCollapsed = !state.contractRiskCollapsed;
    saveState();
    renderReview();
  }

  const treeToggle = event.target.closest("[data-toggle-tree-node]");
  if (treeToggle) {
    if (event.detail > 1) return true;
    toggleTreeNodeExpansion(treeToggle.dataset.toggleTreeNode);
    return true;
  }
  return false;
}

function handleContractRiskClick(event) {
  const adoptAllContractRisks = event.target.closest("[data-adopt-all-contract-risks]");
  if (adoptAllContractRisks) {
    adoptAllContractRiskSuggestions();
    return true;
  }

  const adoptContractRisk = event.target.closest("[data-adopt-contract-risk]");
  if (adoptContractRisk) {
    adoptContractRiskSuggestion(adoptContractRisk.dataset.adoptContractRisk);
    return true;
  }

  const rejectContractRisk = event.target.closest("[data-reject-contract-risk]");
  if (rejectContractRisk) {
    rejectContractRiskSuggestion(rejectContractRisk.dataset.rejectContractRisk);
    return true;
  }

  const restoreContractRisk = event.target.closest("[data-restore-contract-risk]");
  if (restoreContractRisk) {
    restoreContractRiskSuggestion(restoreContractRisk.dataset.restoreContractRisk);
    return true;
  }

  const applyVisualQaFixes = event.target.closest("[data-apply-visual-qa-fixes]");
  if (applyVisualQaFixes) {
    event.preventDefault();
    event.stopPropagation();
    applyVisualQaFixes.disabled = true;
    const result = applyVisualQaAutoFixes(applyVisualQaFixes.dataset.applyVisualQaFixes);
    recordAudit("执行 Agent B 安全修复", {
      contractName: state.contracts.find((item) => item.id === state.activeContractId)?.name,
      applied: result.applied,
      skipped: result.skipped,
    });
    showToast(result.applied ? `已执行 ${result.applied} 项安全修复。` : `未执行修复：${result.message || "没有匹配到可自动处理的建议。"}`);
    return true;
  }

  const runVisualQaButton = event.target.closest("[data-run-visual-qa]");
  if (runVisualQaButton) {
    event.preventDefault();
    event.stopPropagation();
    const contract = state.contracts.find((item) => item.id === state.activeContractId);
    if (!contract) return true;
    runVisualQaButton.disabled = true;
    scheduleVisualQa(contract.id, "manual-visual-qa", { delay: 0, force: true });
    renderReview();
    return true;
  }
  return false;
}

async function handleClauseRiskClick(event) {
  const adoptClauseRisk = event.target.closest("[data-adopt-clause-risk]");
  if (adoptClauseRisk) {
    const [sourceKey, clauseId] = adoptClauseRisk.dataset.adoptClauseRisk.split("||");
    adoptClauseRisk.disabled = true;
    await adoptClauseRiskSuggestion(sourceKey, clauseId);
    return true;
  }

  const commentClauseRisk = event.target.closest("[data-comment-clause-risk]");
  if (commentClauseRisk) {
    const [sourceKey, clauseId] = commentClauseRisk.dataset.commentClauseRisk.split("||");
    commentClauseRisk.disabled = true;
    await commentClauseRiskSuggestion(sourceKey, clauseId);
    return true;
  }

  const adjustClauseRisk = event.target.closest("[data-adjust-clause-risk]");
  if (adjustClauseRisk) {
    const [sourceKey, clauseId] = adjustClauseRisk.dataset.adjustClauseRisk.split("||");
    const userInstruction = window.prompt("请写明希望 AI 如何进一步调整这条建议，例如：更强硬、更平衡、保留甲方现场管理权、减少乙方责任。", "");
    if (userInstruction === null) return true;
    adjustClauseRisk.disabled = true;
    await adjustClauseRiskSuggestion(sourceKey, clauseId, userInstruction.trim());
    return true;
  }

  const businessConfirmClauseRisk = event.target.closest("[data-business-confirm-clause-risk]");
  if (businessConfirmClauseRisk) {
    const [sourceKey, clauseId] = businessConfirmClauseRisk.dataset.businessConfirmClauseRisk.split("||");
    businessConfirmClauseRisk.disabled = true;
    await confirmClauseRiskBusinessDecision(sourceKey, clauseId);
    return true;
  }

  const rejectClauseRisk = event.target.closest("[data-reject-clause-risk]");
  if (rejectClauseRisk) {
    const [sourceKey, clauseId] = rejectClauseRisk.dataset.rejectClauseRisk.split("||");
    rejectClauseRisk.disabled = true;
    await rejectClauseRiskSuggestion(sourceKey, clauseId);
    return true;
  }
  return false;
}

async function handleClauseActionClick(event) {
  const saveClauseAction = event.target.closest("[data-save-clause-action]");
  if (saveClauseAction) {
    const [sourceKey, clauseId] = saveClauseAction.dataset.saveClauseAction.split("||");
    const actions = getClauseActions(sourceKey);
    actions[clauseId] = actions[clauseId] || {};
    const editNode = findByDataAttribute("data-clause-edit", `${sourceKey}||${clauseId}`);
    const titleNode = findByDataAttribute("data-clause-title-edit", `${sourceKey}||${clauseId}`);
    const commentNode = findByDataAttribute("data-clause-comment", `${sourceKey}||${clauseId}`);
    if (titleNode) actions[clauseId].editedTitle = titleNode.value;
    if (editNode) actions[clauseId].editedText = composeEditableClauseText(actions[clauseId].editedTitle || titleNode?.value || "", editNode.value);
    if (commentNode) actions[clauseId].comment = commentNode.value.trim();
    if (clauseId.includes("::sub-")) state.activeSubclauseId = clauseId;
    else state.activeWorkbenchClauseId = clauseId;
    recordAudit("保存条款修改/批注", { contractName: state.contracts.find((item) => item.id === state.activeContractId)?.name, clauseTitle: clauseId });
    saveState();
    renderReview();
    clauseId.includes("::sub-") ? scrollToSubclause(clauseId) : scrollToWorkbenchClause(clauseId);
    return true;
  }

  const toggleClauseDelete = event.target.closest("[data-toggle-clause-delete]");
  if (toggleClauseDelete) {
    const [sourceKey, clauseId] = toggleClauseDelete.dataset.toggleClauseDelete.split("||");
    const actions = getClauseActions(sourceKey);
    actions[clauseId] = actions[clauseId] || {};
    actions[clauseId].deleted = !actions[clauseId].deleted;
    state.insertionAudits = state.insertionAudits || {};
    state.insertionAudits[sourceKey] = state.insertionAudits[sourceKey] || [];
    state.insertionAudits[sourceKey].push({
      id: uid("delete-audit"),
      message: actions[clauseId].deleted
        ? "已标记删除条款，系统会按删除后的有效条款顺序重排编号，并迁移可识别的“第X条”引用；请复核引用到被删除条款的内容是否需要改写或删除。"
        : "已撤销删除条款，系统会按恢复后的有效条款顺序重排编号，并迁移可识别的“第X条”引用。",
      createdAt: today(),
    });
    if (clauseId.includes("::sub-")) state.activeSubclauseId = clauseId;
    else state.activeWorkbenchClauseId = clauseId;
    recordAudit(actions[clauseId].deleted ? "标记删除条款" : "撤销删除条款", {
      contractName: state.contracts.find((item) => item.id === state.activeContractId)?.name,
      clauseTitle: clauseId,
    });
    saveState();
    renderReview();
    clauseId.includes("::sub-") ? scrollToSubclause(clauseId) : scrollToWorkbenchClause(clauseId);
    return true;
  }

  const runClauseAnalysis = event.target.closest("[data-run-clause-analysis]");
  if (runClauseAnalysis) {
    const [sourceKey, clauseId] = runClauseAnalysis.dataset.runClauseAnalysis.split("||");
    const contract = state.contracts.find((item) => item.id === state.activeContractId);
    if (!contract) return true;
    const material = getWorkbenchMaterial(contract);
    const clauses = splitVersionClauses(material.text, material.sourceKey);
    const target = findClauseOrSubclause(clauses, clauseId);
    if (!target) return true;
    const actions = getClauseActions(sourceKey);
    actions[clauseId] = actions[clauseId] || {};
    const requestNode = findByDataAttribute("data-analysis-request", `${sourceKey}||${clauseId}`);
    actions[clauseId].analysisRequest = requestNode?.value.trim() || "";
    actions[clauseId].analysisStatus = "running";
    if (clauseId.includes("::sub-")) state.activeSubclauseId = clauseId;
    else state.activeWorkbenchClauseId = clauseId;
    saveState();
    renderReview();
    runClauseAnalysis.disabled = true;
    try {
      const extraRequirements = buildFocusedClauseAnalysisRequirements(contract, target.clause, clauses, actions[clauseId].analysisRequest);
      const result = await runLegalSkillAnalysis(contract, material.text, extraRequirements);
      applyFocusedClauseSkillResult(contract, clauseId, result);
      actions[clauseId].analysisStatus = "completed";
      actions[clauseId].analysisCompletedAt = new Date().toISOString();
      recordAudit("运行条款级 AI 分析", { contractName: contract.name, clauseTitle: target.clause.title || clauseId, note: actions[clauseId].analysisRequest });
      saveState();
      renderReview();
      showToast("条款级 AI 分析完成，建议已更新。");
    } catch (error) {
      actions[clauseId].analysisStatus = "failed";
      actions[clauseId].analysisError = error.message || String(error);
      saveState();
      renderReview();
      showToast(`条款级 AI 分析失败：${error.message || String(error)}`, "error");
    } finally {
      runClauseAnalysis.disabled = false;
      clauseId.includes("::sub-") ? scrollToSubclause(clauseId) : scrollToWorkbenchClause(clauseId);
    }
    return true;
  }
  return false;
}

async function handleExportClick(event) {
  const generateSendVersion = event.target.closest("[data-generate-send-version]");
  if (generateSendVersion) {
    const contract = state.contracts.find((item) => item.id === generateSendVersion.dataset.generateSendVersion);
    if (!contract) return true;
    generateSendVersion.disabled = true;
    generateSendVersion.textContent = "\u751f\u6210\u5e76\u590d\u6838\u4e2d...";
    try {
      const prepared = createPreparedSendingVersion(contract);
      recordAudit("\u751f\u6210\u62df\u53d1\u9001\u7248\u672c", {
        contractName: contract.name,
        note: prepared.changeSummary,
      });
      saveState();
      renderReview();
      setAnalysisStatus(contract.id, "queued", "\u6b63\u5728\u63d0\u4ea4\u62df\u53d1\u9001\u7248\u672c\u7684\u53d1\u9001\u524d\u590d\u6838...");
      const extraRequirements = [
        "\u8fd9\u662f\u57fa\u4e8e\u5ba1\u9605\u53f0\u4e2d\u65b0\u589e\u3001\u5220\u9664\u3001\u79fb\u52a8\u3001\u4fee\u6539\u540e\u751f\u6210\u7684\u62df\u53d1\u9001\u7248\u672c\uff0c\u8bf7\u4f5c\u4e3a\u53d1\u9001\u524d\u590d\u6838\u5904\u7406\u3002",
        "\u91cd\u70b9\u6838\u67e5\uff1a\u76f8\u5173\u4fee\u6539\u662f\u5426\u5408\u7406\uff1b\u65e2\u5b58\u98ce\u9669\u662f\u5426\u5df2\u7ecf\u89e3\u51b3\uff1b\u662f\u5426\u4ea7\u751f\u65b0\u7684\u98ce\u9669\uff1b\u683c\u5f0f\u3001\u6761\u6b3e\u7f16\u53f7\u3001\u5927\u5c0f\u6761\u6b3e\u987a\u5e8f\u548c\u4ea4\u53c9\u5f15\u7528\u5173\u7cfb\u662f\u5426\u59a5\u5f53\uff1b\u662f\u5426\u9002\u5408\u53d1\u9001\u7ed9\u76f8\u5bf9\u65b9\u3002",
        `\u672c\u6b21\u4fee\u6539\u6458\u8981\uff1a${prepared.changeSummary}`,
        `\u81ea\u52a8\u6838\u67e5\u6458\u8981\uff1a${summarizeAutomaticReviewChecks(prepared.reviewChecks || [])}`,
      ].join("\\n");
      const result = await runLegalSkillAnalysis(contract, prepared.text, extraRequirements);
      const clauses = splitVersionClauses(prepared.text, `${contract.id}:${prepared.update.id}`);
      applyLegalSkillResult(contract, result, clauses);
      recordAudit("\u590d\u6838\u62df\u53d1\u9001\u7248\u672c", {
        contractName: contract.name,
        note: result.source || result.response?.source || "codex",
      });
      saveState();
      renderReview();
      showToast("\u62df\u53d1\u9001\u7248\u672c\u590d\u6838\u5b8c\u6210\uff0c\u7ed3\u679c\u5df2\u66f4\u65b0\u5230\u5ba1\u9605\u53f0\u3002");
    } catch (error) {
      setAnalysisStatus(contract.id, "failed", error.message || String(error));
      renderReview();
      showToast(`\u62df\u53d1\u9001\u7248\u672c\u590d\u6838\u5931\u8d25\uff1a${error.message || String(error)}`, "error");
    } finally {
      generateSendVersion.disabled = false;
      generateSendVersion.textContent = "\u751f\u6210\u62df\u53d1\u9001\u7248\u672c";
    }
  }


  const exportWordRedline = event.target.closest("[data-export-word-redline]");
  if (exportWordRedline) {
    const contract = state.contracts.find((item) => item.id === exportWordRedline.dataset.exportWordRedline);
    if (!contract) return true;
    const material = getWorkbenchMaterial(contract);
    const qa = await runVisualQaForMaterial(contract, material, "export-word-redline");
    if (qa?.visualQa?.status === "blocked") {
      showToast("Visual QA 发现阻断问题，请先处理后再导出。", "error");
      return true;
    }
    const docx = buildDocxRedlinePackage(contract);
    downloadBlob(
      `${safeDownloadName(contract.name)}_Word红线批注稿.docx`,
      docx,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    // Archive to local contract folder
    if (typeof uint8ArrayToBase64 === "function") {
      archiveContractExport(contract.id, uint8ArrayToBase64(docx), `${safeDownloadName(contract.name)}_Word红线批注稿.docx`, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    }
    recordAudit("导出 Word 红线/批注稿", { contractName: contract.name });
    saveState();
  }

  const exportDeliveryPackage = event.target.closest("[data-export-delivery-package]");
  if (exportDeliveryPackage) {
    const contract = state.contracts.find((item) => item.id === exportDeliveryPackage.dataset.exportDeliveryPackage);
    if (!contract) return true;
    const zip = buildDeliveryPackageZip(contract);
    downloadBlob(
      `${safeDownloadName(contract.name)}_交付包.zip`,
      zip,
      "application/zip"
    );
    // Archive to local contract folder
    if (typeof uint8ArrayToBase64 === "function") {
      archiveContractExport(contract.id, uint8ArrayToBase64(zip), `${safeDownloadName(contract.name)}_交付包.zip`, "application/zip");
    }
    recordAudit("导出交付包", { contractName: contract.name });
    saveState();
  }

  const exportSkillRequest = event.target.closest("[data-export-skill-request]");
  if (exportSkillRequest) {
    const contract = state.contracts.find((item) => item.id === exportSkillRequest.dataset.exportSkillRequest);
    if (!contract) return true;
    const material = getWorkbenchMaterial(contract);
    const request = buildLegalSkillRequest(contract, material.text);
    downloadBlob(`${safeDownloadName(contract.name)}_legal_skill_request.json`, JSON.stringify(request, null, 2), "application/json;charset=utf-8");
    recordAudit("导出 Skill 请求包", { contractName: contract.name });
    saveState();
  }

  const runLegalSkill = event.target.closest("[data-run-legal-skill]");
  if (runLegalSkill) {
    const contract = state.contracts.find((item) => item.id === runLegalSkill.dataset.runLegalSkill);
    if (!contract) return true;
    const material = getWorkbenchMaterial(contract);
    runLegalSkill.disabled = true;
    runLegalSkill.textContent = "\u5206\u6790\u4e2d...";
    try {
      setAnalysisStatus(contract.id, "queued", "正在提交 AI Legal Skill 审阅分析任务...");
      runLegalSkill.textContent = "AI 审阅中...";
      const result = await runLegalSkillAnalysis(contract, material.text);
      applyLegalSkillResult(contract, result, splitVersionClauses(material.text, material.sourceKey));
      const prepared = await ensureAnalysisHasCodexSegmentation(contract);
      const updatedClauses = splitVersionClauses(prepared.text, prepared.sourceKey);
      state.findings = (state.findings || []).filter((finding) => finding.contractId !== contract.id);
      state.findings.push(...getStoredSkillFindings(contract, updatedClauses));
      recordAudit("运行 AI Legal Skill 分析", { contractName: contract.name, note: result.source || result.response?.source || "ai" });
      saveState();
      renderReview();
      showToast("AI Legal Skill 分析完成，结果已更新到审阅台。");
    } catch (error) {
      setAnalysisStatus(contract.id, "failed", error.message || String(error));
      renderReview();
      showToast(`AI Legal Skill 分析失败：${error.message || String(error)}`, "error");
    } finally {
      runLegalSkill.disabled = false;
      runLegalSkill.textContent = "运行 AI Legal Skill";
    }
  }
  return false;
}

async function handleBackendClick(event) {
  const syncBackend = event.target.closest("[data-sync-backend]");
  if (syncBackend) {
    syncBackend.disabled = true;
    syncBackend.textContent = "同步中...";
    try {
      const result = await syncBackendSnapshot();
      recordAudit("同步到本地后端", { note: Object.keys(result.db || {}).join(", ") });
      saveState();
      openSkillResultModal({ ok: true, action: "sync-backend", tables: Object.keys(result.db || {}) });
    } catch (error) {
      openSkillResultModal({ ok: false, error: error.message || String(error) });
    } finally {
      syncBackend.disabled = false;
      syncBackend.textContent = "同步到本地后端";
    }
  }

  const depositFinalClauses = event.target.closest("[data-deposit-final-clauses]");
  if (depositFinalClauses && !depositFinalClauses.disabled) {
    const contract = state.contracts.find((item) => item.id === depositFinalClauses.dataset.depositFinalClauses);
    if (!contract) return true;
    const result = depositFinalClausesToPlaybook(contract);
    recordAudit("终稿条款沉淀到条款库", { contractName: contract.name, note: `新增 ${result.added}，更新 ${result.updated}` });
    saveState();
    render();
    openSkillResultModal({
      ok: true,
      action: "deposit-final-clauses",
      message: `已沉淀 ${result.added} 条新口径，更新 ${result.updated} 条既有口径。`,
      result,
    });
  }

  const playbookReview = event.target.closest("[data-playbook-review]");
  if (playbookReview) {
    const [playbookId, reviewStatus] = playbookReview.dataset.playbookReview.split(":");
    const playbook = state.playbooks.find((item) => item.id === playbookId);
    if (!playbook) return true;
    playbook.reviewStatus = reviewStatus;
    playbook.approvalStatus = reviewStatus === "active" ? "approved" : reviewStatus;
    playbook.lastReviewedAt = reviewStatus === "active" ? today() : playbook.lastReviewedAt;
    playbook.nextReviewAt = reviewStatus === "active" ? addDays(today(), 180) : playbook.nextReviewAt;
    recordAudit("更新条款库治理状态", { clauseTitle: playbook.type, note: playbookReviewStatusLabel(reviewStatus) });
    saveState();
    renderPlaybooks();
  }

  const promoteVariant = event.target.closest("[data-playbook-promote-variant]");
  if (promoteVariant) {
    const [playbookId, variantId] = promoteVariant.dataset.playbookPromoteVariant.split(":");
    const playbook = state.playbooks.find((item) => item.id === playbookId);
    const variant = playbook?.variants?.find((item) => item.id === variantId);
    if (!playbook || !variant) return true;
    playbook.variants = [
      {
        id: uid("pbv"),
        text: playbook.standard,
        sourceOccurrenceId: "",
        contractName: "上一标准口径",
        counterpartyName: "",
        createdAt: today(),
        status: "archived",
        note: "因候选变体提升为标准口径而归档。",
      },
      ...(playbook.variants || []).filter((item) => item.id !== variantId),
    ].slice(0, 12);
    playbook.standard = variant.text;
    playbook.status = "standard";
    playbook.reviewStatus = "active";
    playbook.approvalStatus = "approved";
    playbook.version = (playbook.version || 1) + 1;
    playbook.lastReviewedAt = today();
    playbook.nextReviewAt = addDays(today(), 180);
    playbook.confidenceScore = inferPlaybookConfidence(playbook);
    recordAudit("提升候选条款口径为标准版本", { clauseTitle: playbook.type, note: variant.contractName || "" });
    saveState();
    renderPlaybooks();
    showToast("候选口径已提升为标准版本。");
  }

  const riskRuleStatus = event.target.closest("[data-risk-rule-status]");
  if (riskRuleStatus) {
    const [ruleId, status] = riskRuleStatus.dataset.riskRuleStatus.split(":");
    if (toggleRiskRuleStatus(ruleId, status)) showToast(status === "active" ? "风险规则已启用。" : "风险规则已禁用。");
  }
  return false;
}

function handleDraftClick(event) {
  if (event.target.closest("[data-create-review-from-draft]")) {
    const draft = state.currentDraft;
    if (!draft) return true;
    const counterparty = ensureCounterparty(draft.counterparty || "未命名相对方");
    const contract = {
      id: uid("contract"),
      name: draft.title,
      type: draft.type || "待识别",
      purpose: draft.summary,
      businessBackground: draft.background || "",
      status: "审阅中",
      ourRole: draft.role || "",
      counterpartyId: counterparty.id,
      counterpartyName: counterparty.name,
      amount: "待识别",
      term: "待识别",
      payment: "待识别",
      governingLaw: "中国大陆",
      dispute: "待识别",
      text: draft.text,
      cleanText: draft.text,
      redlineText: "",
      commentsText: "",
      clauseSource: "draft",
      riskLevel: "low",
      aiTags: [],
      createdAt: today(),
      updatedAt: today(),
    };
    state.contracts.unshift(contract);
    hydrateContractAnalysis(state, contract);
    ensureInitialUpdate(state, contract);
    setActiveContract(contract.id);
    recordAudit("从起草结果创建审阅", { contractName: contract.name });
    saveState();
    setView("review");
  }

  if (event.target.closest("#reset-demo")) {
    state = clone(seedData);
    hydrateContractAnalysis(state, state.contracts[0]);
    saveState();
    setView("dashboard");
  }
  return false;
}


function handleDragStart(event) {
  const subcard = event.target.closest("[data-subclause-card]");
  if (subcard) {
    event.dataTransfer.setData("application/x-subclause", subcard.dataset.subclauseCard);
    event.dataTransfer.effectAllowed = "move";
    return;
  }
  const card = event.target.closest("[data-clause-card]");
  if (!card) return;
  event.dataTransfer.setData("text/plain", card.dataset.clauseCard);
  event.dataTransfer.effectAllowed = "move";
}
document.addEventListener("dragstart", handleDragStart);
function handleDragOver(event) {
  const subcard = event.target.closest("[data-subclause-card]");
  if (subcard) {
    event.preventDefault();
    subcard.classList.add("drag-over");
    return;
  }
  const card = event.target.closest("[data-clause-card]");
  if (!card) return;
  event.preventDefault();
  card.classList.add("drag-over");
}
document.addEventListener("dragover", handleDragOver);
function handleDragLeave(event) {
  const subcard = event.target.closest("[data-subclause-card]");
  if (subcard) subcard.classList.remove("drag-over");
  const card = event.target.closest("[data-clause-card]");
  if (card) card.classList.remove("drag-over");
}
document.addEventListener("dragleave", handleDragLeave);
function handleDrop(event) {
  const targetSubcard = event.target.closest("[data-subclause-card]");
  if (targetSubcard) {
    event.preventDefault();
    document.querySelectorAll(".drag-over").forEach((node) => node.classList.remove("drag-over"));
    const draggedSubclauseId = event.dataTransfer.getData("application/x-subclause");
    const targetSubclauseId = targetSubcard.dataset.subclauseCard;
    if (!draggedSubclauseId || draggedSubclauseId === targetSubclauseId) return;
    reorderSubclauseByDrag(draggedSubclauseId, targetSubclauseId);
    return;
  }
  const targetCard = event.target.closest("[data-clause-card]");
  if (!targetCard) return;
  event.preventDefault();
  document.querySelectorAll(".drag-over").forEach((node) => node.classList.remove("drag-over"));
  const draggedClauseId = event.dataTransfer.getData("text/plain");
  const targetClauseId = targetCard.dataset.clauseCard;
  if (!draggedClauseId || draggedClauseId === targetClauseId) return;
  reorderClauseByDrag(draggedClauseId, targetClauseId);
}
document.addEventListener("drop", handleDrop);
function handleUploadFormSubmit(event) {
  event.preventDefault();
  const nameInput = document.querySelector("#contract-name-input");
  const counterpartyInput = document.querySelector("#counterparty-input");
  const roleInput = document.querySelector("#party-role-input");
  const deadlineInput = document.querySelector("#contract-deadline-input");
  const ownerInput = document.querySelector("#contract-owner-input");
  const backgroundInput = document.querySelector("#contract-background-input");
  const cleanTextInput = document.querySelector("#clean-text-input");
  const rawText = cleanTextInput.value.trim();
  const uploadResult = getUploadedFileResult("#clean-text-input");
  const payload = buildVersionPayload(rawText, uploadResult);
  const cleanText = payload.acceptedText || rawText;
  const redlineText = payload.hasRevisions ? payload.revisionText : "";
  const commentsText = payload.commentsText || "";
  const text = cleanText;
  if (!text) return;

  const counterparty = ensureCounterparty(counterpartyInput.value);
  const contract = {
    id: uid("contract"),
    name: nameInput.value.trim() || "未命名合同",
    type: event.target.dataset.detectedContractType || "待识别",
    purpose: event.target.dataset.detectedPurpose || "待识别",
    businessBackground: backgroundInput.value.trim(),
    status: "审阅中",
    workflowStatus: "初审",
    owner: ownerInput.value.trim(),
    ourRole: roleInput.value,
    counterpartyId: counterparty.id,
    counterpartyName: counterparty.name,
    amount: "待识别",
    term: "待识别",
    payment: "待识别",
    governingLaw: "中国大陆",
    dispute: "待识别",
    text,
    cleanText,
    redlineText,
    rejectedText: payload.rejectedText,
    commentsText,
    paragraphs: payload.paragraphs,
    sourceType: payload.sourceType,
    fileName: payload.fileName,
    initialMaterialKind: payload.materialKind,
    clauseSource: "draft",
    feedbackDeadline: deadlineInput.value,
    riskLevel: "low",
    aiTags: [],
    createdAt: today(),
    updatedAt: today(),
  };
  state.contracts.unshift(contract);
  hydrateContractAnalysis(state, contract);
  ensureInitialUpdate(state, contract);
  setActiveContract(contract.id);
  recordAudit("新建合同审阅", { contractName: contract.name });
  saveState();
  // Archive original uploaded file to local contract folder
  if (uploadResult?.originalBufferBase64) {
    archiveContractFile(contract.id, uploadResult.originalBufferBase64, uploadResult.fileName || "contract-upload", "application/octet-stream");
  }
  event.target.reset();
  delete event.target.dataset.detectedContractType;
  delete event.target.dataset.detectedPurpose;
  const autofillStatus = document.querySelector("#new-review-autofill-status");
  if (autofillStatus) autofillStatus.textContent = "";
  closeUploadModal();
  scheduleAutomaticCodexReview(contract.id, "new-review");
  setView("review");
}
document.querySelector("#upload-form").addEventListener("submit", handleUploadFormSubmit);
function handleProgressFormSubmit(event) {
  event.preventDefault();
  const contractId = document.querySelector("#progress-contract-id").value;
  const contract = state.contracts.find((item) => item.id === contractId);
  if (!contract) return;

  const versionTextInput = document.querySelector("#progress-version-text-input");
  const rawVersionText = versionTextInput.value.trim();
  const uploadResult = getUploadedFileResult("#progress-version-text-input");
  const payload = buildVersionPayload(rawVersionText, uploadResult);
  const versionText = payload.versionText;
  const note = document.querySelector("#progress-note-input").value.trim();
  const feedbackDeadline = document.querySelector("#progress-deadline-input").value;
  const type = document.querySelector("#progress-type-input").value;
  const workflowStatus = document.querySelector("#progress-status-input").value;
  const materialKind = payload.materialKind;

  if (!note && !versionText) return;

  if (versionText) {
    if (materialKind === "comments") {
      contract.commentsText = versionText;
    } else if (materialKind === "redline") {
      contract.redlineText = payload.revisionText || versionText;
      contract.rejectedText = payload.rejectedText;
      contract.cleanText = payload.acceptedText || acceptRedlineText(versionText);
      contract.text = contract.cleanText;
    } else {
      contract.cleanText = payload.acceptedText || versionText;
      contract.text = contract.cleanText;
    }
    contract.commentsText = payload.commentsText || contract.commentsText;
    contract.paragraphs = payload.paragraphs || contract.paragraphs;
    contract.sourceType = payload.sourceType;
    contract.fileName = payload.fileName;
    contract.clauseSource = type === "终稿" ? "clean" : "draft";
  }
  contract.feedbackDeadline = feedbackDeadline;
  contract.workflowStatus = type === "终稿" ? "定稿" : workflowStatus;
  contract.status = type === "终稿" ? "待签署" : workflowStatus;
  contract.updatedAt = today();

  if (versionText && materialKind !== "comments") {
    hydrateContractAnalysis(state, contract);
  } else {
    contract.aiTags = [
      ...new Set([
        ...(contract.aiTags || []),
        /训练|模型|微调/.test(versionText) ? "模型训练" : null,
        /个人信息|隐私/.test(versionText) ? "个人信息" : null,
        /数据/.test(versionText) ? "数据" : null,
        /知识产权|算法|软件/.test(versionText) ? "知识产权" : null,
      ].filter(Boolean)),
    ];
  }

  state.updates = state.updates || [];
  state.updates.unshift({
    id: uid("upd"),
    contractId,
    type,
    note,
    feedbackDeadline,
    materialKind,
    versionText,
    acceptedText: payload.acceptedText,
    rejectedText: payload.rejectedText,
    revisionText: payload.revisionText,
    commentsText: payload.commentsText,
    paragraphs: payload.paragraphs,
    sourceType: payload.sourceType,
    fileName: payload.fileName,
    knowledgeEligible: type === "终稿" && materialKind !== "comments",
    hasClean: type === "终稿" && materialKind !== "redline" && materialKind !== "comments",
    hasRedline: materialKind === "redline",
    hasComments: materialKind === "comments",
    createdAt: today(),
  });

  const latestUpdate = state.updates[0];
  state.activeContractId = contract.id;
  state.activeUpdateId = latestUpdate.id;
  recordAudit("更新合同进度", { contractName: contract.name, note: type });
  saveState();
  // Archive original uploaded file to local contract folder
  if (uploadResult?.originalBufferBase64) {
    archiveContractFile(contract.id, uploadResult.originalBufferBase64, uploadResult.fileName || "version-upload", "application/octet-stream");
  }
  event.target.reset();
  closeProgressModal();
  scheduleAutomaticCodexReview(contract.id, "progress-version");
  setView("review");
}
document.querySelector("#progress-form").addEventListener("submit", handleProgressFormSubmit);
function handleAddClauseFormSubmit(event) {
  event.preventDefault();
  const sourceKey = document.querySelector("#add-clause-source-key").value;
  const targetClauseId = document.querySelector("#add-clause-target").value;
  const position = document.querySelector("#add-clause-position").value;
  const type = document.querySelector("#add-clause-type").value;
  const titleInput = document.querySelector("#add-clause-title").value.trim();
  const textInput = document.querySelector("#add-clause-text").value.trim();
  const comment = document.querySelector("#add-clause-comment").value.trim();
  if (!sourceKey || !textInput) return;

  const contract = state.contracts.find((item) => item.id === state.activeContractId);
  const material = contract ? getWorkbenchMaterial(contract) : null;
  const clauses = material ? splitVersionClauses(material.text, sourceKey) : [];
  const target = clauses.find((clause) => clause.id === targetClauseId);
  const item = {
    id: uid("inserted"),
    targetClauseId,
    targetStableId: target?.stableId || target?.id,
    targetOriginalNumber: target?.originalNumber || target?.number || clauses.length,
    position,
    type,
    title: titleInput || `${type || "新增"}条款`,
    text: textInput,
    comment,
    createdAt: new Date().toISOString(),
  };
  getInsertedClauses(sourceKey).push(item);
  closeAddClauseModal();
  recordAudit("新增条款", { contractName: contract?.name, clauseTitle: item.title });
  saveState();
  renderReview();
  requestAnimationFrame(() => {
    const cards = [...document.querySelectorAll(".inline-clause-card")];
    const targetCard = cards.find((card) => card.textContent.includes(item.title));
    targetCard?.scrollIntoView({ block: "center" });
  });
}
document.querySelector("#add-clause-form").addEventListener("submit", handleAddClauseFormSubmit);
function handleDocumentSubmit(event) {
  if (event.target.id !== "draft-form") return;
  event.preventDefault();
  state.currentDraft = generateDraftContract({
    type: document.querySelector("#draft-contract-type").value.trim(),
    background: document.querySelector("#draft-background").value.trim(),
    role: document.querySelector("#draft-role").value.trim(),
    counterparty: document.querySelector("#draft-counterparty").value.trim(),
  });
  recordAudit("生成合同初稿", { contractName: state.currentDraft.title });
  saveState();
  renderDrafting();
}
document.addEventListener("submit", handleDocumentSubmit);
function handleDocumentInput(event) {
  if (event.target.id === "task-owner-filter") {
    state.taskFilters = { ...getTaskFilters(), owner: event.target.value.trim() };
    saveState();
    filterFeedbackTasks();
    return;
  }
  if (event.target.id === "contract-search" || event.target.id === "contract-type-filter" || event.target.id === "contract-status-filter") {
    filterContracts();
    return;
  }
  if (event.target.id === "global-search") {
    filterGlobalSearch();
    return;
  }
  if (
    event.target.id === "playbook-search" ||
    event.target.id === "playbook-type-filter" ||
    event.target.id === "playbook-role-filter" ||
    event.target.id === "playbook-review-filter"
  ) {
    filterPlaybooks();
    return;
  }
  if (
    event.target.id === "counterparty-search" ||
    event.target.id === "counterparty-type-filter" ||
    event.target.id === "counterparty-risk-filter"
  ) {
    filterCounterparties();
    return;
  }
  if (event.target.id === "reader-clause-search" || event.target.id === "reader-type-filter" || event.target.id === "reader-risk-filter") {
    const sourceId = event.target.id;
    const cursor = event.target.selectionStart || 0;
    state.readerFilters = {
      ...(state.readerFilters || {}),
      keyword: document.querySelector("#reader-clause-search")?.value.trim() || "",
      type: document.querySelector("#reader-type-filter")?.value || "",
      risk: document.querySelector("#reader-risk-filter")?.value || "",
    };
    saveState();
    renderReview();
    requestAnimationFrame(() => {
      const restored = document.querySelector(`#${sourceId}`);
      restored?.focus();
      if (sourceId === "reader-clause-search") restored?.setSelectionRange?.(cursor, cursor);
    });
  }

  const reviewQueueButton = event.target.closest("[data-review-queue]");
  if (reviewQueueButton) {
    event.preventDefault();
    state.readerFilters = {
      ...(state.readerFilters || {}),
      queue: reviewQueueButton.dataset.reviewQueue || "",
    };
    saveState();
    renderReview();
    return;
  }
}
document.addEventListener("input", handleDocumentInput);
function handleDocumentDblclick(event) {
  const interactiveButton = event.target.closest("button");
  if (event.target.closest("input, select, textarea, a, button, [contenteditable='true']") || interactiveButton) return;

  const treeCard = event.target.closest(".chapter-card, [data-clause-card], [data-subclause-card]");
  if (treeCard) {
    const toggle = treeCard.querySelector(":scope > .tree-card-header [data-toggle-tree-node]");
    if (toggle) {
      toggleTreeNodeExpansion(toggle.dataset.toggleTreeNode);
      return;
    }
    const subcard = treeCard.closest("[data-subclause-card]");
    if (subcard) {
      const parentCard = subcard.closest("[data-clause-card]");
      state.activeWorkbenchClauseId = parentCard?.dataset.clauseCard || state.activeWorkbenchClauseId;
      state.activeSubclauseId = subcard.dataset.subclauseCard;
      saveState();
      renderReview();
      scrollToSubclause(state.activeSubclauseId);
      return;
    }
    const clauseCard = treeCard.closest("[data-clause-card]");
    if (clauseCard) {
      state.activeWorkbenchClauseId = clauseCard.dataset.clauseCard;
      saveState();
      renderReview();
      scrollToWorkbenchClause(state.activeWorkbenchClauseId);
      return;
    }
  }

  const contractCard = event.target.closest("[data-contract-card]");
  if (!contractCard || event.target.closest("button, input, select, textarea, a")) return;
  setActiveContract(contractCard.dataset.contractCard);
  saveState();
  setView("review");
}
document.addEventListener("dblclick", handleDocumentDblclick);
function handleDocumentFocusout(event) {
  const clauseEdit = event.target.closest("[data-clause-edit], [data-clause-title-edit]");
  if (!clauseEdit) return;
  clearTimeout(clauseEditAutosaveTimer);
  saveState();
  clauseEdit.classList.remove("autosaved");
  // Direct text edits are protected by local visual guards; model-backed Agent B runs manually,
  // after AI result changes, or before export to avoid token-heavy checks on every edit.
}
document.addEventListener("focusout", handleDocumentFocusout);
function handleDocumentChange(event) {
  const clauseSelect = event.target.closest("[data-workbench-clause-select]");
  if (clauseSelect) {
    state.activeWorkbenchClauseId = clauseSelect.value;
    saveState();
    renderReview();
    return;
  }
  if (event.target.id === "task-counterparty-filter") {
    state.taskFilters = { ...getTaskFilters(), counterpartyId: event.target.value };
    saveState();
    filterFeedbackTasks();
    return;
  }
  if (event.target.id === "contract-type-filter" || event.target.id === "contract-status-filter") {
    filterContracts();
    return;
  }
  if (event.target.id === "playbook-type-filter" || event.target.id === "playbook-role-filter" || event.target.id === "playbook-review-filter") {
    filterPlaybooks();
    return;
  }
  if (event.target.id === "counterparty-type-filter" || event.target.id === "counterparty-risk-filter") {
    filterCounterparties();
    return;
  }
  if (event.target.id === "reader-type-filter" || event.target.id === "reader-risk-filter") {
    state.readerFilters = {
      ...(state.readerFilters || {}),
      keyword: document.querySelector("#reader-clause-search")?.value.trim() || "",
      type: document.querySelector("#reader-type-filter")?.value || "",
      risk: document.querySelector("#reader-risk-filter")?.value || "",
    };
    saveState();
    renderReview();
    return;
  }
  const input = event.target.closest("[data-file-target]");
  if (!input || !input.files?.[0]) return;
  const target = document.querySelector(`#${input.dataset.fileTarget}`);
  readUploadedFile(input.files[0])
    .then((result) => {
      cacheUploadedFileResult(target, result);
      target.value = result.displayText || "";
    })
    .catch((error) => {
      target.value = `銆愭枃浠惰В鏋愬け璐ャ€?{error.message}`;
    });
}
document.addEventListener("change", handleDocumentChange);
function handleClauseEditInput(event) {
  const clauseTitleEdit = event.target.closest("[data-clause-title-edit]");
  if (clauseTitleEdit) {
    const [sourceKey, clauseId] = clauseTitleEdit.dataset.clauseTitleEdit.split("||");
    const actions = getClauseActions(sourceKey);
    actions[clauseId] = actions[clauseId] || {};
    actions[clauseId].editedTitle = clauseTitleEdit.value;
    const bodyNode = findByDataAttribute("data-clause-edit", `${sourceKey}||${clauseId}`);
    if (bodyNode) actions[clauseId].editedText = composeEditableClauseText(clauseTitleEdit.value, bodyNode.value);
    if (clauseId.includes("::sub-")) state.activeSubclauseId = clauseId;
    else state.activeWorkbenchClauseId = clauseId;
    clauseTitleEdit.classList.add("autosaved");
    clearTimeout(clauseEditAutosaveTimer);
    clauseEditAutosaveTimer = setTimeout(() => {
      saveState();
      clauseTitleEdit.classList.remove("autosaved");
    }, 180);
    return;
  }

  const clauseEdit = event.target.closest("[data-clause-edit]");
  if (clauseEdit) {
    const [sourceKey, clauseId] = clauseEdit.dataset.clauseEdit.split("||");
    const actions = getClauseActions(sourceKey);
    actions[clauseId] = actions[clauseId] || {};
    const titleNode = findByDataAttribute("data-clause-title-edit", `${sourceKey}||${clauseId}`);
    const title = titleNode?.value ?? actions[clauseId].editedTitle ?? "";
    actions[clauseId].editedTitle = title;
    actions[clauseId].editedText = composeEditableClauseText(title, clauseEdit.value);
    if (clauseId.includes("::sub-")) state.activeSubclauseId = clauseId;
    else state.activeWorkbenchClauseId = clauseId;
    clauseEdit.classList.add("autosaved");
    clearTimeout(clauseEditAutosaveTimer);
    clauseEditAutosaveTimer = setTimeout(() => {
      saveState();
      clauseEdit.classList.remove("autosaved");
    }, 180);
    return;
  }

  if (event.target.matches("#clean-text-input, #progress-version-text-input")) {
    delete event.target.dataset.uploadCacheId;
    delete event.target.dataset.uploadFileName;
    if (event.target.id === "clean-text-input") {
      const uploadForm = document.querySelector("#upload-form");
      if (uploadForm) {
        delete uploadForm.dataset.detectedContractType;
        delete uploadForm.dataset.detectedPurpose;
      }
      const autofillStatus = document.querySelector("#new-review-autofill-status");
      if (autofillStatus) autofillStatus.textContent = "";
    }
  }
}
document.addEventListener("input", handleClauseEditInput);
function filterPlaybooks() {
  const keyword = document.querySelector("#playbook-search")?.value.trim() || "";
  const type = document.querySelector("#playbook-type-filter")?.value || "";
  const role = document.querySelector("#playbook-role-filter")?.value || "";
  const reviewStatus = document.querySelector("#playbook-review-filter")?.value || "";
  const items = state.playbooks.filter((item) => {
    const haystack = `${item.type}${item.ourRole}${item.standard}${item.fallback}${item.forbidden}${item.negotiation}${item.contractTypes.join("")}${(item.keywords || []).join("")}${(item.variants || []).map((variant) => variant.text).join("")}${(item.knowledgeSignals || []).map((signal) => `${signal.title}${signal.note}`).join("")}`;
    const matchesKeyword = !keyword || haystack.includes(keyword);
    const matchesType = !type || item.type === type;
    const matchesRole = !role || item.ourRole === role;
    const matchesReviewStatus = !reviewStatus || item.reviewStatus === reviewStatus;
    return matchesKeyword && matchesType && matchesRole && matchesReviewStatus;
  });
  const listNode = document.querySelector("#playbook-list");
  if (listNode) listNode.innerHTML = renderPlaybookCards(items);
}
