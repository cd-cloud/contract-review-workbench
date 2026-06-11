function contractRow(contract) {
  const deadline = getLatestFeedbackDeadline(contract.id);
  const deadlineClass = isDeadlineUrgent(deadline) ? "risk high" : "status-pill";
  const updateCount = getContractUpdates(contract.id).length;
  const final = hasFinalVersion(contract.id);
  return `
    <div class="contract-row contract-card" data-contract-card="${escapeHtml(contract.id)}">
      <div>
        <h3>${escapeHtml(contract.name)}</h3>
        <p class="contract-row-summary">${escapeHtml(contract.purpose || contract.businessBackground || "未填写合同背景")}</p>
        <div class="meta-line">
          <span class="tag">${escapeHtml(contract.type)}</span>
          <span class="risk ${escapeHtml(contract.riskLevel)}">风险${riskLabel(contract.riskLevel)}</span>
          <span>${escapeHtml(contract.counterpartyName)}</span>
          <span class="status-pill">${final ? "已有终稿" : "审阅中"}</span>
          <span class="status-pill">${updateCount} 个版本</span>
          ${deadline ? `<span class="${deadlineClass}">反馈期限 ${escapeHtml(deadline)}</span>` : ""}
        </div>
      </div>
      <div class="row-actions">
        <button class="small-button open-contract-button" data-open-contract="${escapeHtml(contract.id)}">打开</button>
        <button class="small-button" data-open-progress="${escapeHtml(contract.id)}">进度更新</button>
        <button class="small-button danger-button" data-delete-contract="${escapeHtml(contract.id)}">删除</button>
      </div>
    </div>
  `;
}

function renderContracts() {
  views.contracts.innerHTML = `
    <div class="filters contract-library-toolbar">
      <input id="contract-search" placeholder="搜索合同、相对方、类型" />
      <select id="contract-type-filter">
        <option value="">全部类型</option>
        ${[...new Set(state.contracts.map((contract) => contract.type))]
          .map((type) => `<option>${escapeHtml(type)}</option>`)
          .join("")}
      </select>
      <select id="contract-status-filter">
        <option value="">全部状态</option>
        <option value="reviewing">审核中</option>
        <option value="final">已有终稿</option>
        <option value="deadline">有反馈期限</option>
      </select>
      <button class="primary-button" data-open-upload>新建审阅</button>
    </div>
    <div class="contract-list" id="contract-list">
      ${state.contracts.map(contractRow).join("") || `<div class="empty">暂无合同</div>`}
    </div>
  `;
}

function filterContracts() {
  const keyword = document.querySelector("#contract-search")?.value.trim() || "";
  const type = document.querySelector("#contract-type-filter")?.value || "";
  const status = document.querySelector("#contract-status-filter")?.value || "";
  const list = state.contracts.filter((contract) => {
    const matchesKeyword = !keyword || `${contract.name}${contract.counterpartyName}${contract.type}${contract.purpose}${contract.businessBackground}`.includes(keyword);
    const matchesType = !type || contract.type === type;
    const matchesStatus =
      !status ||
      (status === "reviewing" && !hasFinalVersion(contract.id)) ||
      (status === "final" && hasFinalVersion(contract.id)) ||
      (status === "deadline" && Boolean(getLatestFeedbackDeadline(contract.id)));
    return matchesKeyword && matchesType && matchesStatus;
  });
  const listNode = document.querySelector("#contract-list");
  if (listNode) listNode.innerHTML = list.map(contractRow).join("") || `<div class="empty">没有匹配的合同</div>`;
}
