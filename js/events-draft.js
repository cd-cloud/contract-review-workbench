function handleDraftClick(event) {
  if (event.target.closest("[data-create-review-from-draft]")) {
    const draft = state.currentDraft;
    if (!draft) return true;
    const counterparty = ensureCounterparty(draft.counterparty || "未命名相对方");
    const jurisdiction = draft.jurisdiction || draft.governingLaw || "待确认";
    const contract = {
      id: uid("contract"),
      name: draft.title,
      type: draft.type || "待识别",
      purpose: draft.summary,
      businessBackground: draft.background || "",
      status: "审阅中",
      workflowStatus: "初审",
      ourRole: draft.role || "",
      counterpartyId: counterparty.id,
      counterpartyName: counterparty.name,
      amount: "待识别",
      term: "待识别",
      payment: "待识别",
      jurisdiction,
      governingLaw: jurisdiction,
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
    Store.mutate("create-review-from-draft", (current) => {
      current.contracts.unshift(contract);
    }, {
      save: false,
      audit: true,
      auditDetails: { contractName: contract.name },
    });
    hydrateContractAnalysis(state, contract);
    ensureInitialUpdate(state, contract);
    setActiveContract(contract.id);
    saveState();
    setView("review");
  }

  if (event.target.closest("#reset-demo")) {
    Store.mutate("reset-demo", () => {
      state = clone(seedData);
    }, { save: false });
    hydrateContractAnalysis(state, state.contracts[0]);
    saveState();
    setView("dashboard");
  }
  return false;
}

function handleDocumentSubmit(event) {
  if (event.target.id !== "draft-form") return;
  event.preventDefault();
  let nextDraft = null;
  Store.mutate("generate-draft-contract", (current) => {
    nextDraft = generateDraftContract({
      type: document.querySelector("#draft-contract-type").value.trim(),
      background: document.querySelector("#draft-background").value.trim(),
      role: document.querySelector("#draft-role").value.trim(),
      counterparty: document.querySelector("#draft-counterparty").value.trim(),
    });
    current.currentDraft = nextDraft;
  }, {
    audit: true,
    auditDetails: () => ({ contractName: nextDraft?.title || "" }),
  });
  renderDrafting();
}

function attachDraftListeners() {
  if (typeof document.removeEventListener === "function") {
    document.removeEventListener("submit", handleDocumentSubmit);
  }
  if (typeof document.addEventListener === "function") {
    document.addEventListener("submit", handleDocumentSubmit);
  }
}
attachDraftListeners();
