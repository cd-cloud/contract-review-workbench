async function handleBackendClick(event) {
  const refreshRunnerStatusButton = event.target.closest("[data-refresh-runner-status]");
  if (refreshRunnerStatusButton) {
    refreshRunnerStatusButton.disabled = true;
    try {
      await refreshRunnerStatus();
      renderDashboard();
      showToast("运行状态已刷新。");
    } catch (error) {
      showToast(`运行状态刷新失败：${error.message || String(error)}`, "error");
    } finally {
      refreshRunnerStatusButton.disabled = false;
    }
    return true;
  }

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
    Store.mutate("review-playbook", () => {
      playbook.reviewStatus = reviewStatus;
      playbook.approvalStatus = reviewStatus === "active" ? "approved" : reviewStatus;
      playbook.lastReviewedAt = reviewStatus === "active" ? today() : playbook.lastReviewedAt;
      playbook.nextReviewAt = reviewStatus === "active" ? addDays(today(), 180) : playbook.nextReviewAt;
    }, {
      audit: true,
      auditDetails: { clauseTitle: playbook.type, note: playbookReviewStatusLabel(reviewStatus) },
    });
    renderPlaybooks();
  }

  const promoteVariant = event.target.closest("[data-playbook-promote-variant]");
  if (promoteVariant) {
    const [playbookId, variantId] = promoteVariant.dataset.playbookPromoteVariant.split(":");
    const playbook = state.playbooks.find((item) => item.id === playbookId);
    const variant = playbook?.variants?.find((item) => item.id === variantId);
    if (!playbook || !variant) return true;
    Store.mutate("promote-playbook-variant", () => {
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
    }, {
      audit: true,
      auditDetails: { clauseTitle: playbook.type, note: variant.contractName || "" },
    });
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
