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

async function handleProgressClick(event) {
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
      try {
        await deleteBackendContract(contract.id);
      } catch (error) {
        showToast(`删除合同失败：${error.message || String(error)}`, "error");
        return true;
      }
      deleteContract(contract.id);
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
      try {
        await deleteBackendContractVersion(update.id);
      } catch (error) {
        showToast(`删除版本失败：${error.message || String(error)}`, "error");
        return true;
      }
      deleteContractVersion(update.id);
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

async function handleUploadFormSubmit(event) {
  event.preventDefault();
  const nameInput = document.querySelector("#contract-name-input");
  const counterpartyInput = document.querySelector("#counterparty-input");
  const roleInput = document.querySelector("#party-role-input");
  const typeInput = document.querySelector("#contract-type-input");
  const jurisdictionInput = document.querySelector("#contract-jurisdiction-input");
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
    type: typeInput?.value?.trim() || event.target.dataset.detectedContractType || "待识别",
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
    jurisdiction: jurisdictionInput?.value || event.target.dataset.detectedJurisdiction || "待确认",
    governingLaw: jurisdictionInput?.value || event.target.dataset.detectedJurisdiction || "待确认",
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
  try {
    await createBackendContract(contract);
  } catch (error) {
    showToast(`创建合同失败：${error.message || String(error)}`, "error");
    return;
  }
  Store.mutate("create-contract-review", (draft) => {
    draft.contracts.unshift(contract);
  }, {
    save: false,
    audit: true,
    auditDetails: { contractName: contract.name },
  });
  hydrateContractAnalysis(state, contract);
  ensureInitialUpdate(state, contract);
  Store.setActiveContract(contract.id);
  saveState();
  if (uploadResult?.originalBufferBase64) {
    archiveContractFile(contract.id, uploadResult.originalBufferBase64, uploadResult.fileName || "contract-upload", uploadResult.mimeType || "text/plain");
  }
  event.target.reset();
  delete event.target.dataset.detectedContractType;
  delete event.target.dataset.detectedPurpose;
  delete event.target.dataset.detectedJurisdiction;
  const autofillStatus = document.querySelector("#new-review-autofill-status");
  if (autofillStatus) autofillStatus.textContent = "";
  closeUploadModal();
  scheduleAutomaticCodexReview(contract.id, "new-review");
  setView("review");
}

async function handleProgressFormSubmit(event) {
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

  const nextUpdate = {
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
  };
  try {
    await createBackendContract(contract);
    await createBackendContractVersion(nextUpdate);
  } catch (error) {
    showToast(`创建版本失败：${error.message || String(error)}`, "error");
    return;
  }
  Store.mutate("append-progress-update", (draft) => {
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
    if (!versionText || materialKind === "comments") {
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
    draft.updates = draft.updates || [];
    draft.updates.unshift(nextUpdate);
    draft.activeContractId = contract.id;
    draft.activeUpdateId = nextUpdate.id;
  }, {
    save: false,
    audit: true,
    auditDetails: { contractName: contract.name, note: type },
  });

  if (versionText && materialKind !== "comments") {
    hydrateContractAnalysis(state, contract);
  }
  saveState();
  if (uploadResult?.originalBufferBase64) {
    archiveContractFile(contract.id, uploadResult.originalBufferBase64, uploadResult.fileName || "version-upload", uploadResult.mimeType || "text/plain");
  }
  event.target.reset();
  closeProgressModal();
  scheduleAutomaticCodexReview(contract.id, "progress-version");
  setView("review");
}

async function handleAddClauseFormSubmit(event) {
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
  try {
    await createBackendInsertedClause(sourceKey, item, contract);
  } catch (error) {
    showToast(`新增条款失败：${error.message || String(error)}`, "error");
    return;
  }
  Store.mutate("insert-clause", () => {
    getInsertedClauses(sourceKey).push(item);
  }, {
    save: false,
    audit: true,
    auditDetails: { contractName: contract?.name, clauseTitle: item.title },
  });
  closeAddClauseModal();
  saveState();
  renderReview();
  requestAnimationFrame(() => {
    const cards = [...document.querySelectorAll(".inline-clause-card")];
    const targetCard = cards.find((card) => card.textContent.includes(item.title));
    targetCard?.scrollIntoView({ block: "center" });
  });
}
