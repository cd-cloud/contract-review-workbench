function handleNavClick(event) {
  const nav = event.target.closest(".nav-item");
  if (nav) setView(nav.dataset.view);

  const viewTarget = event.target.closest("[data-view-target]");
  if (viewTarget) setView(viewTarget.dataset.viewTarget);

  const sidebarToggle = event.target.closest("[data-toggle-sidebar]");
  if (sidebarToggle) {
    document.body.classList.toggle("sidebar-expanded");
    sidebarToggle.setAttribute("aria-expanded", document.body.classList.contains("sidebar-expanded") ? "true" : "false");
    return true;
  }

  if (event.target.closest("[data-toggle-audit-logs]")) {
    Store.mutate("toggle-audit-logs", (draft) => {
      draft.auditLogsCollapsed = draft.auditLogsCollapsed === false;
    });
    renderDashboard();
    return true;
  }
  return false;
}

function handleContractNavClick(event) {
  const openContract = event.target.closest("[data-open-contract]");
  if (openContract) {
    const contractId = openContract.dataset.openContract;
    setActiveContract(contractId);
    Store.mutate("open-contract", () => {}, { audit: false });
    scheduleAutomaticCodexReview(contractId, "draft-to-review");
    setView("review");
  }

  const openClause = event.target.closest("[data-open-clause]");
  if (openClause) {
    const [contractId, clauseId] = openClause.dataset.openClause.split(":");
    Store.mutate("open-clause", (draft) => {
      draft.activeContractId = contractId;
      draft.activeClauseId = clauseId;
      draft.activeUpdateId = null;
    });
    setView("review");
  }

  const openUpdate = event.target.closest("[data-open-update]");
  if (openUpdate) {
    Store.mutate("open-update", (draft) => {
      if (openUpdate.dataset.updateContract) draft.activeContractId = openUpdate.dataset.updateContract;
      draft.activeUpdateId = openUpdate.dataset.openUpdate;
    });
    setView("review");
  }
  return false;
}
