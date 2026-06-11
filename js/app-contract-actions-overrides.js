function scheduleAutomaticCodexReview(contractId, reason = "auto") {
  const contract = state.contracts.find((item) => item.id === contractId);
  if (!contract) return;
  const material = getWorkbenchMaterial(contract);
  if (!material?.text?.trim()) return;
  const jobKey = material.sourceKey || contract.id;
  const existing = (state.autoReviewJobs || {})[jobKey];
  if (["queued", "running"].includes(existing?.status) && !isStaleCodexJob(existing, STALE_JOB_TIMEOUT_MS)) return;

  Store.mutate("queue-auto-review", (draft) => {
    draft.autoReviewJobs = draft.autoReviewJobs || {};
    draft.autoReviewJobs[jobKey] = {
      status: "queued",
      reason,
      message: "AI 自动审阅已排队",
      queuedAt: new Date().toISOString(),
    };
  });

  if (typeof persistBackendAuxState === "function") {
    persistBackendAuxState({
      autoReviewJobs: state.autoReviewJobs,
    }).catch(() => {});
  }

  saveState();
  setTimeout(() => runAutomaticCodexReview(contractId, jobKey, reason), 0);
}

async function runAutomaticCodexReview(contractId, expectedSourceKey, reason = "auto") {
  const contract = state.contracts.find((item) => item.id === contractId);
  if (!contract) return;
  const material = getWorkbenchMaterial(contract);
  const jobKey = material.sourceKey || contract.id;
  if (expectedSourceKey && jobKey !== expectedSourceKey) return;

  Store.mutate("start-auto-review", (draft) => {
    draft.autoReviewJobs = draft.autoReviewJobs || {};
    draft.autoReviewJobs[jobKey] = {
      ...(draft.autoReviewJobs[jobKey] || {}),
      status: "running",
      reason,
      message: "AI 正在自动进行条款切分与审阅分析",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }, { save: false });

  if (typeof persistBackendAuxState === "function") {
    persistBackendAuxState({
      autoReviewJobs: state.autoReviewJobs,
    }).catch(() => {});
  }

  setAnalysisStatus(contract.id, "queued", "AI 已自动开始合同审阅分析，并会同时返回条款切分...");
  saveState();
  renderReview();

  try {
    setAnalysisStatus(contract.id, "queued", "AI 正在自动运行 Legal Skill 审阅分析...");
    const result = await runLegalSkillAnalysis(contract, material.text);
    if (state.activeContractId !== contract.id) return;
    if (getWorkbenchMaterial(contract).sourceKey !== jobKey) {
      Store.mutate("supersede-auto-review", (draft) => {
        draft.autoReviewJobs = draft.autoReviewJobs || {};
        draft.autoReviewJobs[jobKey] = {
          status: "superseded",
          reason,
          message: "当前版本已切换，本次自动审阅结果未写入",
          completedAt: new Date().toISOString(),
        };
      });
      if (typeof persistBackendAuxState === "function") {
        persistBackendAuxState({
          autoReviewJobs: state.autoReviewJobs,
        }).catch(() => {});
      }
      saveState();
      return;
    }

    applyLegalSkillResult(contract, result, splitVersionClauses(material.text, material.sourceKey));
    const prepared = await ensureAnalysisHasCodexSegmentation(contract);
    const clauses = splitVersionClauses(prepared.text, prepared.sourceKey);

    Store.mutate("complete-auto-review", (draft) => {
      draft.findings = (draft.findings || []).filter((finding) => finding.contractId !== contract.id);
      draft.findings.push(...getStoredSkillFindings(contract, clauses));
      draft.autoReviewJobs = draft.autoReviewJobs || {};
      draft.autoReviewJobs[jobKey] = {
        status: "completed",
        reason,
        message: "AI 自动审阅分析已完成",
        completedAt: new Date().toISOString(),
      };
    }, { save: false });

    if (typeof persistBackendAuxState === "function") {
      persistBackendAuxState({
        autoReviewJobs: state.autoReviewJobs,
        findings: state.findings,
      }).catch(() => {});
    }

    recordAudit("自动运行 AI Legal Skill 分析", { contractName: contract.name, note: reason });
    saveState();
    renderReview();
    showToast("AI 已自动完成审阅分析。");
  } catch (error) {
    Store.mutate("fail-auto-review", (draft) => {
      draft.autoReviewJobs = draft.autoReviewJobs || {};
      draft.autoReviewJobs[jobKey] = {
        status: "failed",
        reason,
        message: error.message || String(error),
        failedAt: new Date().toISOString(),
      };
    }, { save: false });

    if (typeof persistBackendAuxState === "function") {
      persistBackendAuxState({
        autoReviewJobs: state.autoReviewJobs,
      }).catch(() => {});
    }

    setAnalysisStatus(contract.id, "failed", error.message || String(error));
    saveState();
    renderReview();
    showToast(`AI 自动审阅失败：${error.message || String(error)}`, "error");
  }
}
