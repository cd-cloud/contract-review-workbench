let currentViewName = "dashboard";

const views = {
  dashboard: document.querySelector("#dashboard-view"),
  contracts: document.querySelector("#contracts-view"),
  review: document.querySelector("#review-view"),
  drafting: document.querySelector("#drafting-view"),
  playbooks: document.querySelector("#playbooks-view"),
  counterparties: document.querySelector("#counterparties-view"),
};

function setView(name) {
  if (typeof TimerRegistry !== "undefined") TimerRegistry.clearAll();
  currentViewName = name;
  document.body.classList.toggle("review-nav-collapsed", name === "review");
  if (name === "review") {
    document.body.classList.remove("sidebar-expanded");
  } else {
    document.body.classList.remove("review-nav-collapsed", "sidebar-expanded");
  }
  const navToggleButton = document.querySelector("[data-toggle-sidebar]");
  if (navToggleButton) navToggleButton.setAttribute("aria-expanded", document.body.classList.contains("sidebar-expanded") ? "true" : "false");
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === name);
  });
  Object.entries(views).forEach(([key, view]) => {
    view.classList.toggle("active", key === name);
  });
  const viewMeta = {
    dashboard: ["总览", "查看待反馈、审阅中合同和最近工作进展。"],
    contracts: ["合同库", "按相对方、合同类型、状态和期限快速找到合同。"],
    review: ["审阅台", "围绕当前版本进行风险判断、条款修改和发送前复核。"],
    drafting: ["起草台", "调用历史合同、条款库和相对方画像生成初稿。"],
    playbooks: ["条款库", "维护终稿沉淀的条款口径、适用场景和谈判底线。"],
    counterparties: ["相对方", "沉淀相对方历史做法、偏好、让步和风险画像。"],
  };
  const [title, subtitle] = viewMeta[name] || viewMeta.dashboard;
  document.querySelector("#view-title").textContent = title;
  const subtitleNode = document.querySelector("#view-subtitle");
  if (subtitleNode) subtitleNode.textContent = subtitle;
  if (typeof persistBackendAuxState === "function") {
    persistBackendAuxState({ currentViewName }).catch(() => {});
  }
  render();
}

function render() {
  const topProgressButton = document.querySelector("#top-progress-button");
  if (topProgressButton) {
    topProgressButton.disabled = !state.activeContractId;
    topProgressButton.title = state.activeContractId ? "给当前打开的合同追加材料或进展" : "请先打开一份合同";
  }
  renderCurrentView();
}

function getCurrentViewName() {
  return currentViewName || document.querySelector(".view.active")?.id?.replace("-view", "") || "dashboard";
}

function renderCurrentView() {
  const currentView = getCurrentViewName();
  if (currentView === "dashboard") renderDashboard();
  else if (currentView === "contracts") renderContracts();
  else if (currentView === "review") renderReview();
  else if (currentView === "drafting") renderDrafting();
  else if (currentView === "playbooks") renderPlaybooks();
  else if (currentView === "counterparties") renderCounterparties();
  else renderDashboard();
}

function toggleTreeNodeExpansion(nodeId) {
  if (!nodeId) return;
  state.expandedTreeNodes = state.expandedTreeNodes || {};
  state.expandedTreeNodes[nodeId] = !state.expandedTreeNodes[nodeId];
  if (typeof persistBackendAuxState === "function") {
    persistBackendAuxState({
      expandedTreeNodes: state.expandedTreeNodes,
    }).catch(() => {});
  }
  saveState();
  renderReview();
}

function focusWorkbenchClause(clauseId) {
  if (!clauseId) return;
  state.activeWorkbenchClauseId = clauseId;
  if (typeof persistBackendAuxState === "function") {
    persistBackendAuxState({
      activeWorkbenchClauseId: state.activeWorkbenchClauseId,
      activeSubclauseId: state.activeSubclauseId,
    }).catch(() => {});
  }
  saveState();
  renderReview();
  scrollToWorkbenchClause(clauseId);
}

function focusWorkbenchSubclause(parentClauseId, subclauseId) {
  if (!subclauseId) return;
  state.expandedTreeNodes = state.expandedTreeNodes || {};
  const parentId = parentClauseId || String(subclauseId).split("::sub-")[0];
  if (parentId) {
    state.expandedTreeNodes[parentId] = true;
    state.activeWorkbenchClauseId = parentId;
  }
  state.activeSubclauseId = subclauseId;
  if (typeof persistBackendAuxState === "function") {
    persistBackendAuxState({
      expandedTreeNodes: state.expandedTreeNodes,
      activeWorkbenchClauseId: state.activeWorkbenchClauseId,
      activeSubclauseId: state.activeSubclauseId,
    }).catch(() => {});
  }
  saveState();
  renderReview();
  scrollToSubclause(subclauseId);
}
