function openUploadModal() {
  const status = document.querySelector("#new-review-autofill-status");
  if (status) status.textContent = "";
  openModal("#upload-modal");
}

function closeUploadModal() {
  closeModal("#upload-modal");
}

function openProgressModal(contractId) {
  const select = document.querySelector("#progress-contract-id");
  select.innerHTML = state.contracts
    .map((contract) => `<option value="${contract.id}">${escapeHtml(contract.name)}｜${escapeHtml(contract.counterpartyName)}</option>`)
    .join("");
  const selectedId = contractId || state.activeContractId || state.contracts[0]?.id;
  if (selectedId) select.value = selectedId;
  document.querySelector("#progress-note-input").value = "";
  document.querySelector("#progress-deadline-input").value = "";
  document.querySelector("#progress-version-text-input").value = "";
  openModal("#progress-modal");
}

function closeProgressModal() {
  closeModal("#progress-modal");
}

function openSkillResultModal(result) {
  const preview = document.querySelector("#skill-result-preview");
  if (preview) preview.textContent = JSON.stringify(result, null, 2);
  openModal("#skill-result-modal");
}

function showToast(message, tone = "success") {
  let toast = document.querySelector("#app-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "app-toast";
    toast.className = "app-toast";
    document.body.appendChild(toast);
  }
  toast.textContent = tone === "error" ? summarizeUserFacingError(message) : message;
  toast.dataset.tone = tone;
  toast.classList.add("visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("visible"), 3200);
}

function summarizeUserFacingError(message) {
  const text = String(message || "");
  if (/阻断|blocking/i.test(text)) {
    return "界面校验发现需要先处理的问题。";
  }
  if (/Visual QA|界面校验|一致性检查|导出/i.test(text)) {
    return "界面校验暂未完成，请稍后重试。";
  }
  if (/切分|segmentation|clauseSegmentation/i.test(text)) {
    return "语义切分暂未完成，已先使用本地规则。";
  }
  if (/Legal Skill|AI|runner|fetch|ECONNREFUSED|timeout|超时|后端/i.test(text)) {
    return "AI 审阅暂未完成，请稍后重试。";
  }
  return "操作暂未完成，请稍后重试。";
}

function closeSkillResultModal() {
  closeModal("#skill-result-modal");
}

function openAddClauseModal(sourceKey, clauses) {
  document.querySelector("#add-clause-source-key").value = sourceKey;
  document.querySelector("#add-clause-target").innerHTML = clauses
    .map((clause) => `<option value="${clause.id}">${escapeHtml(clause.title)}｜${escapeHtml(clause.type)}</option>`)
    .join("");
  document.querySelector("#add-clause-type").innerHTML = clauseTypes.map((type) => `<option>${escapeHtml(type)}</option>`).join("");
  document.querySelector("#add-clause-title").value = "";
  document.querySelector("#add-clause-text").value = "";
  document.querySelector("#add-clause-comment").value = "";
  if (state.activeWorkbenchClauseId) document.querySelector("#add-clause-target").value = state.activeWorkbenchClauseId;
  openModal("#add-clause-modal");
}

function closeAddClauseModal() {
  closeModal("#add-clause-modal");
}

function openModal(selector) {
  const modal = document.querySelector(selector);
  if (typeof modal.showModal === "function") {
    modal.showModal();
    return;
  }
  modal.setAttribute("open", "");
  modal.classList.add("fallback-open");
  document.body.classList.add("modal-open");
}

function closeModal(selector) {
  const modal = document.querySelector(selector);
  if (typeof modal.close === "function") {
    modal.close();
  }
  modal.removeAttribute("open");
  modal.classList.remove("fallback-open");
  document.body.classList.remove("modal-open");
}
