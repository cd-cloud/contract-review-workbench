function renderDashboard() {
  const reviewingContracts = state.contracts.filter((contract) => !hasFinalVersion(contract.id)).length;
  const taskFilters = getTaskFilters();
  const feedbackContracts = getFeedbackTasks(taskFilters);
  const urgentTasks = feedbackContracts.filter((item) => getDeadlineDeltaDays(item.deadline) <= 1);
  const activeContract = state.contracts.find((contract) => contract.id === state.activeContractId) || state.contracts[0];
  const latestUpdates = getRecentUpdates(5);
  views.dashboard.innerHTML = `
    <section class="command-center">
      <div class="command-card command-card-main">
        <p class="eyebrow">Today</p>
        <h3>今日处理重点</h3>
        <p>${urgentTasks.length ? `有 ${urgentTasks.length} 份合同临近或已过反馈期限。` : feedbackContracts.length ? `共有 ${feedbackContracts.length} 份合同等待反馈安排。` : "暂无临期反馈事项，可以继续处理审阅中合同或维护条款库。"}</p>
        <div class="row-actions">
          <button class="primary-button" type="button" data-view-target="contracts">进入合同库</button>
          <button class="ghost-button" type="button" data-open-active-progress ${state.activeContractId ? "" : "disabled"}>更新当前合同</button>
        </div>
      </div>
      <div class="command-card">
        <p class="eyebrow">Active Matter</p>
        <h3>${activeContract ? escapeHtml(activeContract.name) : "暂无当前合同"}</h3>
        <p>${activeContract ? `${escapeHtml(activeContract.counterpartyName)}｜${escapeHtml(activeContract.workflowStatus || activeContract.status || "审阅中")}` : "新建审阅后会在这里显示当前工作对象。"}</p>
        ${activeContract ? `<button class="small-button open-contract-button" type="button" data-open-contract="${activeContract.id}">打开审阅台</button>` : `<button class="small-button" type="button" data-open-upload>新建审阅</button>`}
      </div>
    </section>
    <div class="grid stats-grid">
      ${statCard("合同总数", state.contracts.length, "全部合同案卷")}
      ${statCard("审核中的合同", reviewingContracts, "未上传终稿")}
      ${statCard("待反馈", feedbackContracts.length, urgentTasks.length ? `${urgentTasks.length} 个临期/逾期` : "按反馈期限排序")}
      ${statCard("条款口径", state.playbooks.length, "终稿沉淀")}
    </div>
    <div class="dashboard-grid">
      <div class="panel">
        <h3 class="section-title">待反馈合同</h3>
        <div class="filters compact-filters">
          <input id="task-owner-filter" placeholder="按业务负责人筛选" value="${escapeHtml(taskFilters.owner)}" />
          <select id="task-counterparty-filter">
            <option value="">全部相对方</option>
            ${state.counterparties.map((item) => `<option value="${escapeHtml(item.id)}" ${taskFilters.counterpartyId === item.id ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}
          </select>
        </div>
        <div class="contract-list" id="feedback-task-list">
          ${
            feedbackContracts.length
              ? feedbackContracts.slice(0, 6).map((item) => contractTaskRow(item.contract, item.deadline)).join("")
              : `<div class="empty">暂无待反馈合同</div>`
          }
        </div>
      </div>
      <div class="panel">
        <h3 class="section-title">最近进展</h3>
        <div class="contract-list">
          ${latestUpdates.length ? latestUpdates.map(recentUpdateRow).join("") : `<div class="empty">暂无版本或进展记录</div>`}
        </div>
      </div>
    </div>
    <div class="panel" style="margin-top:16px">
      <div class="section-header-row">
        <h3 class="section-title">本地运行诊断</h3>
        <button class="small-button" type="button" data-refresh-runner-status>刷新运行状态</button>
      </div>
      ${renderRunnerDiagnostics()}
    </div>
    <div class="panel" style="margin-top:16px">
      <h3 class="section-title">全局检索</h3>
      <div class="filters">
        <input id="global-search" placeholder="搜索合同、相对方、版本记录、条款、条款库" />
      </div>
      <div class="contract-list" id="global-search-results">
        <div class="empty">输入关键词后展示匹配结果</div>
      </div>
    </div>
    <div class="panel audit-panel" style="margin-top:16px">
      <button class="audit-toggle" type="button" data-toggle-audit-logs>
        <span>
          <span class="eyebrow">Audit</span>
          <strong>审计日志</strong>
        </span>
        <span class="risk-summary-meta">
          <span class="tag">${(state.auditLogs || []).length} 条</span>
          <span class="toggle-indicator">${state.auditLogsCollapsed === false ? "收起" : "展开"}</span>
        </span>
      </button>
      ${
        state.auditLogsCollapsed === false
          ? `<div class="contract-list audit-list">${renderAuditRows()}</div>`
          : ""
      }
    </div>
  `;
}

function renderRunnerDiagnostics() {
  const legal = state.runnerStatus || {};
  const runners = state.runnerStatuses || {};
  const items = [
    { label: "Agent A", status: legal },
    { label: "Intake", status: runners.intake || null },
    { label: "Suggestion", status: runners.suggestion || null },
    { label: "Visual QA", status: runners.visualQa || null },
  ];
  return `
    <div class="contract-list">
      ${items.map((item) => runnerDiagnosticRow(item.label, item.status)).join("")}
    </div>
  `;
}

function runnerDiagnosticRow(label, status) {
  if (!status) {
    return `
      <div class="contract-row">
        <div>
          <strong>${escapeHtml(label)}</strong>
          <p>暂无状态数据</p>
        </div>
        <span class="status-pill">待刷新</span>
      </div>
    `;
  }
  const stateLabel = status.lastRunState || (status.ready ? "succeeded" : "pending");
  const tone = stateLabel === "failed" ? "high" : stateLabel === "fallback" || status.ready === false ? "medium" : "low";
  const summary = status.summary || status.error || "未提供摘要";
  const meta = [
    status.provider ? `provider=${status.provider}` : "",
    status.model ? `model=${status.model}` : "",
    status.launcherMode ? `mode=${status.launcherMode}` : "",
    status.promptVersion ? `prompt=${status.promptVersion}` : "",
    status.downstreamSkill ? `skill=${status.downstreamSkill}` : "",
  ].filter(Boolean).join(" | ");
  const detail = status.lastFallbackReason || status.fallbackReason || "";
  return `
    <div class="contract-row">
      <div>
        <strong>${escapeHtml(label)}</strong>
        <p>${escapeHtml(summary)}</p>
        ${meta ? `<span class="muted">${escapeHtml(meta)}</span>` : ""}
        ${detail ? `<p class="muted">${escapeHtml(detail)}</p>` : ""}
      </div>
      <span class="risk ${tone}">${escapeHtml(stateLabel)}</span>
    </div>
  `;
}

function filterGlobalSearch() {
  const keyword = document.querySelector("#global-search")?.value.trim() || "";
  const listNode = document.querySelector("#global-search-results");
  if (!listNode) return;
  if (!keyword) {
    listNode.innerHTML = `<div class="empty">输入关键词后展示匹配结果</div>`;
    return;
  }
  const results = buildGlobalSearchResults(keyword).slice(0, 30);
  listNode.innerHTML = results.length
    ? results.map(globalSearchRow).join("")
    : `<div class="empty">没有匹配结果</div>`;
}

function buildGlobalSearchResults(keyword) {
  const results = [];
  state.contracts.forEach((contract) => {
    const contractText = `${contract.name}${contract.type}${contract.purpose}${contract.counterpartyName}${contract.text}`;
    if (contractText.includes(keyword)) {
      results.push({ kind: "合同", title: contract.name, body: `${contract.counterpartyName}｜${contract.type}`, contractId: contract.id });
    }
  });
  state.counterparties.forEach((counterparty) => {
    const text = `${counterparty.name}${counterparty.type}${counterparty.industry}${counterparty.notes}`;
    if (text.includes(keyword)) {
      const contract = state.contracts.find((item) => item.counterpartyId === counterparty.id);
      results.push({ kind: "相对方", title: counterparty.name, body: `${counterparty.industry || ""}｜${counterparty.notes || ""}`, contractId: contract?.id });
    }
  });
  (state.updates || []).forEach((update) => {
    const text = `${update.type}${update.note}${update.versionText}${update.commentsText}`;
    if (text.includes(keyword)) {
      const contract = state.contracts.find((item) => item.id === update.contractId);
      results.push({ kind: "版本记录", title: `${contract?.name || "合同"}｜${update.type}`, body: update.note || update.createdAt, contractId: update.contractId, updateId: update.id });
    }
  });
  state.clauses.forEach((clause) => {
    const text = `${clause.title}${clause.type}${clause.text}`;
    if (text.includes(keyword)) {
      const contract = state.contracts.find((item) => item.id === clause.contractId);
      results.push({ kind: "条款", title: clause.title, body: `${contract?.name || ""}｜${clause.type}`, contractId: clause.contractId, clauseId: clause.id });
    }
  });
  state.playbooks.forEach((playbook) => {
    const text = `${playbook.type}${playbook.standard}${playbook.fallback}${playbook.forbidden}${playbook.negotiation}`;
    if (text.includes(keyword)) {
      results.push({ kind: "条款库", title: playbook.type, body: playbook.standard, view: "playbooks" });
    }
  });
  Object.entries(state.legalSkillResults || {}).forEach(([contractId, result]) => {
    const contract = state.contracts.find((item) => item.id === contractId);
    const text = JSON.stringify(result?.response || {});
    if (text.includes(keyword)) {
      results.push({ kind: "AI分析", title: contract?.name || "合同分析结果", body: "匹配 Legal Skill 风险、建议或摘要", contractId });
    }
  });
  (state.aiSuggestionFeedback || []).forEach((item) => {
    const contract = state.contracts.find((contractItem) => contractItem.id === item.contractId);
    const text = `${item.scope}${item.status}${item.actionType}${item.title}${item.note}${contract?.name || ""}`;
    if (text.includes(keyword)) {
      results.push({ kind: "AI反馈", title: item.title || item.status, body: `${contract?.name || ""}｜${item.status}｜${item.actionType}`, contractId: item.contractId, clauseId: item.clauseId });
    }
  });
  return results;
}

function globalSearchRow(item) {
  const target = item.clauseId
    ? `data-open-clause="${item.contractId}:${item.clauseId}"`
    : item.contractId
      ? `data-open-contract="${item.contractId}"`
      : `data-view-target="${item.view || "dashboard"}"`;
  return `
    <button class="contract-row" ${target} type="button">
      <div>
        <strong>${escapeHtml(item.kind)}｜${escapeHtml(item.title)}</strong>
        <p>${escapeHtml(item.body || "")}</p>
      </div>
      <span class="status-pill">打开</span>
    </button>
  `;
}

function renderAuditRows() {
  const logs = (state.auditLogs || []).slice(0, 8);
  if (!logs.length) return `<div class="empty">暂无审计记录</div>`;
  return logs
    .map(
      (log) => `
      <div class="contract-row">
        <div>
          <strong>${escapeHtml(log.action)}</strong>
          <p>${escapeHtml(describeAudit(log))}</p>
        </div>
        <span class="muted">${escapeHtml((log.createdAt || "").slice(0, 16).replace("T", " "))}</span>
      </div>`
    )
    .join("");
}

function getRecentUpdates(limit = 5) {
  return (state.updates || [])
    .map((update) => ({
      update,
      contract: state.contracts.find((contract) => contract.id === update.contractId),
    }))
    .filter((item) => item.contract)
    .sort((a, b) => String(b.update.generatedAt || b.update.createdAt || "").localeCompare(String(a.update.generatedAt || a.update.createdAt || "")))
    .slice(0, limit);
}

function recentUpdateRow({ update, contract }) {
  return `
    <button class="contract-row compact-row" type="button" data-open-update="${update.id}" data-update-contract="${contract.id}">
      <div>
        <strong>${escapeHtml(update.type)}｜${escapeHtml(contract.name)}</strong>
        <p>${escapeHtml(update.note || update.fileName || "版本已更新")}</p>
      </div>
      <span class="status-pill">${escapeHtml(update.createdAt || "")}</span>
    </button>
  `;
}

function describeAudit(log) {
  const details = log.details || {};
  return [details.contractName, details.clauseTitle, details.note].filter(Boolean).join("｜") || "本地用户操作";
}

function getTaskFilters() {
  return state.taskFilters || { owner: "", counterpartyId: "" };
}

function getFeedbackTasks(filters = {}) {
  return state.contracts
    .map((contract) => ({ contract, deadline: getLatestFeedbackDeadline(contract.id) }))
    .filter((item) => item.deadline && !["定稿", "签署"].includes(item.contract.workflowStatus))
    .filter((item) => !filters.owner || (item.contract.owner || "").includes(filters.owner))
    .filter((item) => !filters.counterpartyId || item.contract.counterpartyId === filters.counterpartyId)
    .sort((a, b) => a.deadline.localeCompare(b.deadline));
}

function contractTaskRow(contract, deadline) {
  const overdue = getDeadlineDeltaDays(deadline) < 0;
  const urgent = isDeadlineUrgent(deadline);
  return `
    <button class="contract-row" data-open-contract="${contract.id}" type="button">
      <div>
        <strong>${escapeHtml(contract.name)}</strong>
        <p>${escapeHtml(contract.counterpartyName)}｜${escapeHtml(contract.workflowStatus || contract.status || "初审")}｜负责人：${escapeHtml(contract.owner || "未填写")}</p>
      </div>
      <span class="${overdue ? "risk high" : urgent ? "risk medium" : "status-pill"}">${overdue ? "逾期" : urgent ? "临期" : "待反馈"} ${escapeHtml(deadline)}</span>
    </button>
  `;
}

function filterFeedbackTasks() {
  const filters = getTaskFilters();
  const listNode = document.querySelector("#feedback-task-list");
  if (!listNode) return;
  const tasks = getFeedbackTasks(filters);
  listNode.innerHTML = tasks.length ? tasks.map((item) => contractTaskRow(item.contract, item.deadline)).join("") : `<div class="empty">暂无待反馈合同</div>`;
}

function statCard(label, value, detail = "") {
  return `<div class="card stat-card"><span class="muted">${label}</span><div class="stat-number">${value}</div><small>${escapeHtml(detail)}</small></div>`;
}
