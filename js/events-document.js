function handleDocumentInput(event) {
  if (event.target.id === "task-owner-filter") {
    Store.mutate("filter-task-owner", (draft) => {
      draft.taskFilters = { ...getTaskFilters(), owner: event.target.value.trim() };
    });
    if (typeof persistBackendAuxState === "function") {
      persistBackendAuxState({ taskFilters: state.taskFilters }).catch(() => {});
    }
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
    Store.mutate("filter-reader-clauses", (draft) => {
      draft.readerFilters = {
        ...(draft.readerFilters || {}),
        keyword: document.querySelector("#reader-clause-search")?.value.trim() || "",
        type: document.querySelector("#reader-type-filter")?.value || "",
        risk: document.querySelector("#reader-risk-filter")?.value || "",
      };
    });
    if (typeof persistBackendAuxState === "function") {
      persistBackendAuxState({ readerFilters: state.readerFilters }).catch(() => {});
    }
    TimerRegistry.clear("reader-filter-debounce");
    TimerRegistry.set("reader-filter-debounce", setTimeout(() => {
      renderReview();
      requestAnimationFrame(() => {
        const restored = document.querySelector(`#${sourceId}`);
        restored?.focus();
        if (sourceId === "reader-clause-search") restored?.setSelectionRange?.(cursor, cursor);
      });
    }, 200));
  }

  const reviewQueueButton = event.target.closest("[data-review-queue]");
  if (reviewQueueButton) {
    event.preventDefault();
    Store.mutate("filter-review-queue", (draft) => {
      draft.readerFilters = {
        ...(draft.readerFilters || {}),
        queue: reviewQueueButton.dataset.reviewQueue || "",
      };
    });
    if (typeof persistBackendAuxState === "function") {
      persistBackendAuxState({ readerFilters: state.readerFilters }).catch(() => {});
    }
    renderReview();
    return;
  }
}

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
      Store.mutate("focus-subclause-card", (draft) => {
        draft.activeWorkbenchClauseId = parentCard?.dataset.clauseCard || draft.activeWorkbenchClauseId;
        draft.activeSubclauseId = subcard.dataset.subclauseCard;
      });
      if (typeof persistBackendAuxState === "function") {
        persistBackendAuxState({
          activeWorkbenchClauseId: state.activeWorkbenchClauseId,
          activeSubclauseId: state.activeSubclauseId,
        }).catch(() => {});
      }
      renderReview();
      scrollToSubclause(state.activeSubclauseId);
      return;
    }
    const clauseCard = treeCard.closest("[data-clause-card]");
    if (clauseCard) {
      Store.mutate("focus-clause-card", (draft) => {
        draft.activeWorkbenchClauseId = clauseCard.dataset.clauseCard;
      });
      if (typeof persistBackendAuxState === "function") {
        persistBackendAuxState({
          activeWorkbenchClauseId: state.activeWorkbenchClauseId,
        }).catch(() => {});
      }
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

function handleDocumentFocusout(event) {
  const clauseEdit = event.target.closest("[data-clause-edit], [data-clause-title-edit]");
  if (!clauseEdit) return;
  TimerRegistry.clear("clause-edit-autosave");
  saveState();
  clauseEdit.classList.remove("autosaved");
}

function handleDocumentChange(event) {
  const clauseSelect = event.target.closest("[data-workbench-clause-select]");
  if (clauseSelect) {
    Store.mutate("select-workbench-clause", (draft) => {
      draft.activeWorkbenchClauseId = clauseSelect.value;
    });
    if (typeof persistBackendAuxState === "function") {
      persistBackendAuxState({
        activeWorkbenchClauseId: state.activeWorkbenchClauseId,
      }).catch(() => {});
    }
    renderReview();
    return;
  }
  if (event.target.id === "task-counterparty-filter") {
    Store.mutate("filter-task-counterparty", (draft) => {
      draft.taskFilters = { ...getTaskFilters(), counterpartyId: event.target.value };
    });
    if (typeof persistBackendAuxState === "function") {
      persistBackendAuxState({ taskFilters: state.taskFilters }).catch(() => {});
    }
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
    Store.mutate("change-reader-filter", (draft) => {
      draft.readerFilters = {
        ...(draft.readerFilters || {}),
        keyword: document.querySelector("#reader-clause-search")?.value.trim() || "",
        type: document.querySelector("#reader-type-filter")?.value || "",
        risk: document.querySelector("#reader-risk-filter")?.value || "",
      };
    });
    if (typeof persistBackendAuxState === "function") {
      persistBackendAuxState({ readerFilters: state.readerFilters }).catch(() => {});
    }
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
      target.value = `【文件解析失败】${error.message}`;
    });
}

function handleClauseEditInput(event) {
  const clauseTitleEdit = event.target.closest("[data-clause-title-edit]");
  if (clauseTitleEdit) {
    const [sourceKey, clauseId] = clauseTitleEdit.dataset.clauseTitleEdit.split("||");
    const actions = getClauseActions(sourceKey);
    actions[clauseId] = actions[clauseId] || {};
    actions[clauseId].editedTitle = clauseTitleEdit.value;
    const bodyNode = findByDataAttribute("data-clause-edit", `${sourceKey}||${clauseId}`);
    if (bodyNode) actions[clauseId].editedText = composeEditableClauseText(clauseTitleEdit.value, bodyNode.value);
    Store.mutate("draft-clause-title-edit", (draft) => {
      if (clauseId.includes("::sub-")) draft.activeSubclauseId = clauseId;
      else draft.activeWorkbenchClauseId = clauseId;
    }, { save: false });
    clauseTitleEdit.classList.add("autosaved");
    TimerRegistry.clear("clause-edit-autosave");
    TimerRegistry.set("clause-edit-autosave", setTimeout(() => {
      saveState();
      clauseTitleEdit.classList.remove("autosaved");
      TimerRegistry.clear("clause-edit-autosave");
    }, 800));
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
    Store.mutate("draft-clause-text-edit", (draft) => {
      if (clauseId.includes("::sub-")) draft.activeSubclauseId = clauseId;
      else draft.activeWorkbenchClauseId = clauseId;
    }, { save: false });
    clauseEdit.classList.add("autosaved");
    TimerRegistry.clear("clause-edit-autosave");
    TimerRegistry.set("clause-edit-autosave", setTimeout(() => {
      saveState();
      clauseEdit.classList.remove("autosaved");
      TimerRegistry.clear("clause-edit-autosave");
    }, 800));
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

function attachDocumentListeners() {
  if (typeof document.removeEventListener !== "function" || typeof document.addEventListener !== "function") return;
  document.removeEventListener("input", handleDocumentInput);
  document.removeEventListener("dblclick", handleDocumentDblclick);
  document.removeEventListener("focusout", handleDocumentFocusout);
  document.removeEventListener("change", handleDocumentChange);
  document.removeEventListener("input", handleClauseEditInput);
  document.addEventListener("input", handleDocumentInput);
  document.addEventListener("dblclick", handleDocumentDblclick);
  document.addEventListener("focusout", handleDocumentFocusout);
  document.addEventListener("change", handleDocumentChange);
  document.addEventListener("input", handleClauseEditInput);
}
attachDocumentListeners();
