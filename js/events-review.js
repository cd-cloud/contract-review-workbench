// clauseClickTimer managed by TimerRegistry

function getClauseIdFromAdviceKey(adviceKey) {
  const parts = String(adviceKey || "").split("||");
  return parts.length >= 2 ? parts.slice(1).join("||") : "";
}

function handleReviewClick(event) {
  const reviewModeButton = event.target.closest("[data-review-mode]");
  if (reviewModeButton && !reviewModeButton.disabled) {
    Store.mutate("change-review-mode", (draft) => {
      draft.reviewMode = reviewModeButton.dataset.reviewMode;
      draft.comparisonMode = false;
    });
    if (typeof persistBackendAuxState === "function") {
      persistBackendAuxState({ reviewMode: state.reviewMode }).catch(() => {});
    }
    renderReview();
  }

  const toggleComparison = event.target.closest("[data-toggle-comparison]");
  if (toggleComparison) {
    event.preventDefault();
    event.stopPropagation();
    Store.mutate("toggle-comparison-mode", (draft) => {
      draft.comparisonMode = !draft.comparisonMode;
    }, { save: false });
    renderReview();
    return true;
  }

  const clauseViewModeButton = event.target.closest("[data-clause-view-mode]");
  if (clauseViewModeButton) {
    event.preventDefault();
    event.stopPropagation();
    const [sourceKey, clauseId, mode] = clauseViewModeButton.dataset.clauseViewMode.split("||");
    Store.mutate("change-clause-view-mode", (draft) => {
      draft.clauseViewModes = draft.clauseViewModes || {};
      draft.clauseViewModes[`${sourceKey}||${clauseId}`] = mode;
    });
    if (typeof persistBackendAuxState === "function") {
      persistBackendAuxState({ clauseViewModes: state.clauseViewModes }).catch(() => {});
    }
    renderReview();
    clauseId.includes("::sub-") ? scrollToSubclause(clauseId) : scrollToWorkbenchClause(clauseId);
    return true;
  }

  const adviceAnchor = event.target.closest("[data-clause-advice-anchor]");
  if (adviceAnchor && !event.target.closest("button, textarea, input, select")) {
    event.preventDefault();
    event.stopPropagation();
    const adviceKey = adviceAnchor.dataset.clauseAdviceAnchor;
    const clauseId = getClauseIdFromAdviceKey(adviceKey);
    Store.mutate("focus-advice-anchor", (draft) => {
      draft.focusedAdviceKey = adviceKey;
      if (clauseId?.includes("::sub-")) {
        const parentId = String(clauseId).split("::sub-")[0];
        draft.expandedTreeNodes = draft.expandedTreeNodes || {};
        draft.expandedTreeNodes[parentId] = true;
        draft.activeWorkbenchClauseId = parentId;
        draft.activeSubclauseId = clauseId;
      } else if (clauseId) {
        draft.activeWorkbenchClauseId = clauseId;
        draft.activeSubclauseId = null;
      }
    });
    if (typeof persistBackendAuxState === "function") {
      persistBackendAuxState({
        focusedAdviceKey: state.focusedAdviceKey,
        expandedTreeNodes: state.expandedTreeNodes,
        activeWorkbenchClauseId: state.activeWorkbenchClauseId,
        activeSubclauseId: state.activeSubclauseId,
      }).catch(() => {});
    }
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
    Store.mutate("focus-body-anchor", (draft) => {
      draft.focusedAdviceKey = bodyAnchor.dataset.clauseBodyAnchor;
    });
    if (typeof persistBackendAuxState === "function") {
      persistBackendAuxState({ focusedAdviceKey: state.focusedAdviceKey }).catch(() => {});
    }
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
      Store.mutate("open-add-clause-modal", (draft) => {
        draft.activeWorkbenchClauseId = clauseId || draft.activeWorkbenchClauseId;
        draft.inlineEditClauseId = null;
        draft.inlineCommentClauseId = null;
      }, { save: false });
      if (typeof persistBackendAuxState === "function") {
        persistBackendAuxState({
          activeWorkbenchClauseId: state.activeWorkbenchClauseId,
          inlineEditClauseId: state.inlineEditClauseId,
          inlineCommentClauseId: state.inlineCommentClauseId,
        }).catch(() => {});
      }
      openAddClauseModal(sourceKey || material.sourceKey, clauses);
    }
    return true;
  }

  const inlineEditButton = event.target.closest("[data-open-inline-edit]");
  if (inlineEditButton) {
    event.preventDefault();
    event.stopPropagation();
    const [sourceKey, clauseId] = inlineEditButton.dataset.openInlineEdit.split("||");
    Store.mutate("open-inline-edit", (draft) => {
      draft.activeWorkbenchClauseId = clauseId.includes("::sub-") ? draft.activeWorkbenchClauseId : clauseId;
      if (clauseId.includes("::sub-")) draft.activeSubclauseId = clauseId;
      draft.expandedTreeNodes = draft.expandedTreeNodes || {};
      draft.expandedTreeNodes[clauseId] = true;
      draft.inlineEditClauseId = null;
    });
    if (typeof persistBackendAuxState === "function") {
      persistBackendAuxState({
        activeWorkbenchClauseId: state.activeWorkbenchClauseId,
        activeSubclauseId: state.activeSubclauseId,
        expandedTreeNodes: state.expandedTreeNodes,
        inlineEditClauseId: state.inlineEditClauseId,
      }).catch(() => {});
    }
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
    const [, clauseId] = inlineCommentButton.dataset.toggleInlineComment.split("||");
    Store.mutate("toggle-inline-comment", (draft) => {
      draft.activeWorkbenchClauseId = clauseId.includes("::sub-") ? draft.activeWorkbenchClauseId : clauseId;
      if (clauseId.includes("::sub-")) draft.activeSubclauseId = clauseId;
      draft.inlineCommentClauseId = draft.inlineCommentClauseId === clauseId ? null : clauseId;
      draft.inlineEditClauseId = draft.inlineCommentClauseId ? null : draft.inlineEditClauseId;
    });
    if (typeof persistBackendAuxState === "function") {
      persistBackendAuxState({
        activeWorkbenchClauseId: state.activeWorkbenchClauseId,
        activeSubclauseId: state.activeSubclauseId,
        inlineCommentClauseId: state.inlineCommentClauseId,
        inlineEditClauseId: state.inlineEditClauseId,
      }).catch(() => {});
    }
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
    if (reader?.dataset.readerScope) {
      Store.mutate("change-reader-tab", (draft) => {
        draft.readerPaneTabs = draft.readerPaneTabs || {};
        draft.readerPaneTabs[reader.dataset.readerScope] = tabName;
      });
      if (typeof persistBackendAuxState === "function") {
        persistBackendAuxState({ readerPaneTabs: state.readerPaneTabs }).catch(() => {});
      }
    }
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

function handleWorkbenchClick(event) {
  const workbenchClause = event.target.closest("[data-workbench-clause]");
  if (workbenchClause) {
    event.preventDefault();
    event.stopPropagation();
    const clauseId = workbenchClause.dataset.workbenchClause;
    if (event.detail >= 2) {
      TimerRegistry.clear("clause-click");
      const toggle = workbenchClause.closest("[data-clause-card]")?.querySelector(":scope > .tree-card-header [data-toggle-tree-node]");
      if (toggle) toggleTreeNodeExpansion(toggle.dataset.toggleTreeNode);
      return true;
    }
    if (workbenchClause.closest(".review-advice-sidebar")) {
      TimerRegistry.clear("clause-click");
      focusWorkbenchClause(clauseId);
      return true;
    }
    TimerRegistry.clear("clause-click");
    TimerRegistry.set("clause-click", setTimeout(() => {
      focusWorkbenchClause(clauseId);
      TimerRegistry.clear("clause-click");
    }, 180));
    return true;
  }

  const workbenchSubclause = event.target.closest("[data-workbench-subclause]");
  if (workbenchSubclause) {
    event.preventDefault();
    event.stopPropagation();
    const parentClauseId = workbenchSubclause.dataset.parentClause;
    const subclauseId = workbenchSubclause.dataset.workbenchSubclause;
    if (event.detail >= 2) {
      TimerRegistry.clear("clause-click");
      const toggle = workbenchSubclause.closest("[data-subclause-card]")?.querySelector(":scope > .tree-card-header [data-toggle-tree-node]");
      if (toggle) toggleTreeNodeExpansion(toggle.dataset.toggleTreeNode);
      return true;
    }
    if (workbenchSubclause.closest(".review-advice-sidebar")) {
      TimerRegistry.clear("clause-click");
      focusWorkbenchSubclause(parentClauseId, subclauseId);
      return true;
    }
    TimerRegistry.clear("clause-click");
    TimerRegistry.set("clause-click", setTimeout(() => {
      focusWorkbenchSubclause(parentClauseId, subclauseId);
      TimerRegistry.clear("clause-click");
    }, 180));
    return true;
  }

  if (event.target.closest("[data-toggle-contract-risk]")) {
    Store.mutate("toggle-contract-risk", (draft) => {
      draft.contractRiskCollapsed = !draft.contractRiskCollapsed;
    });
    if (typeof persistBackendAuxState === "function") {
      persistBackendAuxState({ contractRiskCollapsed: state.contractRiskCollapsed }).catch(() => {});
    }
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
    Store.mutate("save-clause-action", (draft) => {
      if (clauseId.includes("::sub-")) draft.activeSubclauseId = clauseId;
      else draft.activeWorkbenchClauseId = clauseId;
    }, {
      audit: true,
      auditDetails: { contractName: state.contracts.find((item) => item.id === state.activeContractId)?.name, clauseTitle: clauseId },
    });
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
    Store.mutate(actions[clauseId].deleted ? "mark-clause-delete" : "restore-clause-delete", (draft) => {
      draft.insertionAudits = draft.insertionAudits || {};
      draft.insertionAudits[sourceKey] = draft.insertionAudits[sourceKey] || [];
      draft.insertionAudits[sourceKey].push({
        id: uid("delete-audit"),
        message: actions[clauseId].deleted
          ? "已标记删除条款，系统会按删除后的有效条款顺序重排编号，并迁移可识别的“第X条”引用；请复核引用到被删除条款的内容是否需要改写或删除。"
          : "已撤销删除条款，系统会按恢复后的有效条款顺序重排编号，并迁移可识别的“第X条”引用。",
        createdAt: today(),
      });
      if (clauseId.includes("::sub-")) draft.activeSubclauseId = clauseId;
      else draft.activeWorkbenchClauseId = clauseId;
    }, {
      audit: true,
      auditDetails: { contractName: state.contracts.find((item) => item.id === state.activeContractId)?.name, clauseTitle: clauseId },
    });
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
    Store.mutate("run-clause-analysis", (draft) => {
      actions[clauseId].analysisRequest = requestNode?.value.trim() || "";
      actions[clauseId].analysisStatus = "running";
      delete actions[clauseId].analysisError;
      if (clauseId.includes("::sub-")) draft.activeSubclauseId = clauseId;
      else draft.activeWorkbenchClauseId = clauseId;
    });
    renderReview();
    runClauseAnalysis.disabled = true;
    try {
      const extraRequirements = buildFocusedClauseAnalysisRequirements(contract, target.clause, clauses, actions[clauseId].analysisRequest);
      const result = await runLegalSkillAnalysis(contract, material.text, extraRequirements);
      applyFocusedClauseSkillResult(contract, clauseId, result);
      Store.mutate("complete-clause-analysis", () => {
        actions[clauseId].analysisStatus = "completed";
        actions[clauseId].analysisCompletedAt = new Date().toISOString();
      }, {
        audit: true,
        auditDetails: { contractName: contract.name, clauseTitle: target.clause.title || clauseId, note: actions[clauseId].analysisRequest },
      });
      renderReview();
      showToast("条款级 AI 分析完成，建议已更新。");
    } catch (error) {
      Store.mutate("fail-clause-analysis", () => {
        actions[clauseId].analysisStatus = "failed";
        actions[clauseId].analysisError = error.message || String(error);
      });
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
