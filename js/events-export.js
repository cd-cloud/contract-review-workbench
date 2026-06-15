async function handleExportClick(event) {
  const generateSendVersion = event.target.closest("[data-generate-send-version]");
  if (generateSendVersion) {
    const contract = state.contracts.find((item) => item.id === generateSendVersion.dataset.generateSendVersion);
    if (!contract) return true;
    generateSendVersion.disabled = true;
    generateSendVersion.textContent = "生成并复核中...";
    try {
      const prepared = createPreparedSendingVersion(contract);
      if (typeof createBackendContractVersion === "function") {
        await createBackendContractVersion(prepared.update);
      }
      if (typeof persistBackendAuxState === "function") {
        persistBackendAuxState({
          activeUpdateId: state.activeUpdateId,
          activeWorkbenchClauseId: state.activeWorkbenchClauseId,
          activeSubclauseId: state.activeSubclauseId,
          reviewChecks: state.reviewChecks,
          subclauseReferenceMap: state.subclauseReferenceMap,
        }).catch(() => {});
      }
      recordAudit("生成拟发送版本", {
        contractName: contract.name,
        note: prepared.changeSummary,
      });
      saveState();
      renderReview();
      setAnalysisStatus(contract.id, "queued", "正在提交拟发送版本的发送前复核...");
      const extraRequirements = [
        "这是基于审阅台中新建、删除、移动、修改后生成的拟发送版本，请作为发送前复核处理。",
        "重点核查：相关修改是否合理；既存风险是否已经解决；是否产生新的风险；格式、条款编号、大小条款顺序和交叉引用关系是否妥当；是否适合发送给相对方。",
        `本次修改摘要：${prepared.changeSummary}`,
        `自动检查摘要：${summarizeAutomaticReviewChecks(prepared.reviewChecks || [])}`,
      ].join("\n");
      const preparedMaterial = {
        id: prepared.update.id,
        materialId: prepared.update.id,
        sourceKey: `${contract.id}:${prepared.update.id}`,
        text: prepared.text,
        mode: "clean",
      };
      const result = await runLegalSkillAnalysis(contract, prepared.text, extraRequirements, { material: preparedMaterial, sourceKey: preparedMaterial.sourceKey });
      const clauses = splitVersionClauses(prepared.text, preparedMaterial.sourceKey);
      applyLegalSkillResult(contract, result, clauses);
      recordAudit("复核拟发送版本", {
        contractName: contract.name,
        note: result.source || result.response?.source || "codex",
      });
      saveState();
      renderReview();
      showToast("拟发送版本复核完成，结果已更新到审阅台。");
    } catch (error) {
      setAnalysisStatus(contract.id, "failed", error.message || String(error));
      renderReview();
      showToast(`拟发送版本复核失败：${error.message || String(error)}`, "error");
    } finally {
      generateSendVersion.disabled = false;
      generateSendVersion.textContent = "生成拟发送版本";
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
    const request = buildLegalSkillRequest(contract, material.text, "", { material, sourceKey: material.sourceKey });
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
    runLegalSkill.textContent = "分析中...";
    try {
      setManualLegalSkillRunStatus(contract, material, "running", "AI Legal Skill 正在审阅合同。");
      setAnalysisStatus(contract.id, "queued", "正在提交 AI Legal Skill 审阅分析任务...");
      runLegalSkill.textContent = "AI 审阅中...";
      const result = await runLegalSkillAnalysis(contract, material.text, "", { material, sourceKey: material.sourceKey });
      applyLegalSkillResult(contract, result, splitVersionClauses(material.text, material.sourceKey));
      const prepared = await ensureAnalysisHasCodexSegmentation(contract);
      const updatedClauses = splitVersionClauses(prepared.text, prepared.sourceKey);
      Store.mutate("sync-legal-skill-findings", (draft) => {
        draft.findings = (draft.findings || []).filter((finding) => finding.contractId !== contract.id);
        draft.findings.push(...getStoredSkillFindings(contract, updatedClauses));
      }, { save: false });
      markLegalSkillRunCompleted(contract, prepared);
      recordAudit("运行 AI Legal Skill 分析", { contractName: contract.name, note: result.source || result.response?.source || "ai" });
      saveState();
      renderReview();
      showToast("AI Legal Skill 分析完成，结果已更新到审阅台。");
    } catch (error) {
      setManualLegalSkillRunStatus(contract, material, "failed", error.message || String(error));
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
