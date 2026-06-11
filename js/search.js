/**
 * Global full-text search (FTS5) UI and API client.
 */

(function () {
  const searchInput = document.querySelector("#global-search-input");
  const searchDropdown = document.querySelector("#global-search-dropdown");
  if (!searchInput || !searchDropdown) return;

  // searchTimer managed by TimerRegistry
  let searchAbort = null;
  const SEARCH_DEBOUNCE_MS = 250;
  const MIN_QUERY_LEN = 1;

  if (typeof searchInput.removeEventListener === "function") {
    searchInput.removeEventListener("input", handleSearchInput);
    searchInput.removeEventListener("focus", handleSearchFocus);
    searchInput.removeEventListener("keydown", handleSearchKeydown);
  }
  if (typeof document.removeEventListener === "function") {
    document.removeEventListener("click", handleDocumentClick);
  }
  searchInput.addEventListener("input", handleSearchInput);
  searchInput.addEventListener("focus", handleSearchFocus);
  searchInput.addEventListener("keydown", handleSearchKeydown);
  document.addEventListener("click", handleDocumentClick);

  function handleSearchInput() {
    const query = searchInput.value.trim();
    TimerRegistry.clear("search");
    if (searchAbort) searchAbort.abort();

    if (query.length < MIN_QUERY_LEN) {
      closeDropdown();
      return;
    }

    TimerRegistry.set("search", setTimeout(() => runSearch(query), SEARCH_DEBOUNCE_MS));
  }

  function handleSearchFocus() {
    const query = searchInput.value.trim();
    if (query.length >= MIN_QUERY_LEN) {
      runSearch(query);
    }
  }

  function handleSearchKeydown(e) {
    if (e.key === "Escape") {
      closeDropdown();
      searchInput.blur();
    }
  }

  function handleDocumentClick(e) {
    if (!searchInput.contains(e.target) && !searchDropdown.contains(e.target)) {
      closeDropdown();
    }
  }

  function closeDropdown() {
    searchDropdown.innerHTML = "";
    searchDropdown.classList.remove("open");
  }

  function openDropdown(html) {
    searchDropdown.innerHTML = html;
    searchDropdown.classList.add("open");
  }

  async function runSearch(query) {
    try {
      const controller = new AbortController();
      searchAbort = controller;

      const res = await legalWorkbenchFetch(
        `/api/search?q=${encodeURIComponent(query)}&limit=30`,
        { signal: controller.signal }
      );
      if (!res.ok) throw new Error("Search failed");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);

      renderResults(query, data.results || []);
    } catch (err) {
      if (err.name === "AbortError") return;
      openDropdown(`<div class="search-empty">搜索失败：${escapeHtml(err.message)}</div>`);
    }
  }

  function renderResults(query, results) {
    if (!results.length) {
      openDropdown(`<div class="search-empty">未找到与 "${escapeHtml(query)}" 相关的结果</div>`);
      return;
    }

    const grouped = results.reduce((acc, r) => {
      acc[r.entityType] = acc[r.entityType] || [];
      acc[r.entityType].push(r);
      return acc;
    }, {});

    const typeLabels = {
      contract: "📄 合同",
      clause: "📋 条款",
      finding: "⚠️ 审阅发现",
      playbook: "📚 条款库",
      counterparty: "🏢 相对方",
      risk_rule: "🛡️ 风险规则",
    };

    const typeOrder = ["contract", "clause", "finding", "playbook", "counterparty", "risk_rule"];

    let html = "";
    for (const type of typeOrder) {
      const items = grouped[type];
      if (!items || !items.length) continue;
      html += `<div class="search-group">`;
      html += `<div class="search-group-label">${typeLabels[type] || type} <span class="search-count">${items.length}</span></div>`;
      for (const item of items.slice(0, 8)) {
        html += renderResultItem(item);
      }
      if (items.length > 8) {
        html += `<div class="search-more">还有 ${items.length - 8} 条结果…</div>`;
      }
      html += `</div>`;
    }

    html += `<div class="search-footer">共 ${results.length} 条结果</div>`;
    openDropdown(html);

    // Bind click handlers
    searchDropdown.querySelectorAll("[data-search-action]").forEach((el) => {
      el.addEventListener("click", handleResultClick);
    });
  }

  function renderResultItem(item) {
    const extra = item.extra || {};
    let subtitle = "";
    let action = "";

    switch (item.entityType) {
      case "contract":
        subtitle = [extra.counterpartyName, extra.status, extra.riskLevel].filter(Boolean).join(" · ");
        action = `data-search-action="open-contract" data-contract-id="${escapeHtml(item.entityId)}"`;
        break;
      case "clause":
        subtitle = [extra.type, extra.hierarchyLevel].filter(Boolean).join(" · ");
        action = `data-search-action="open-clause" data-clause-id="${escapeHtml(item.entityId)}" data-contract-id="${escapeHtml(item.contractId)}"`;
        break;
      case "finding":
        subtitle = [extra.severity, extra.actionType].filter(Boolean).join(" · ");
        action = `data-search-action="open-finding" data-finding-id="${escapeHtml(item.entityId)}" data-contract-id="${escapeHtml(item.contractId)}"`;
        break;
      case "playbook":
        subtitle = [extra.ourRole, `使用 ${extra.usageCount || 0} 次`].filter(Boolean).join(" · ");
        action = `data-search-action="open-playbook" data-playbook-id="${escapeHtml(item.entityId)}"`;
        break;
      case "counterparty":
        subtitle = [extra.importance, extra.riskLevel].filter(Boolean).join(" · ");
        action = `data-search-action="open-counterparty" data-counterparty-id="${escapeHtml(item.entityId)}"`;
        break;
      case "risk_rule":
        subtitle = [extra.severity, extra.status].filter(Boolean).join(" · ");
        action = `data-search-action="open-risk-rule" data-rule-id="${escapeHtml(item.entityId)}"`;
        break;
    }

    const preview = truncateHtml(item.content || "", 80);
    const title = escapeHtml(item.title || "未命名");

    return `
      <div class="search-item" ${action} role="button" tabindex="0">
        <div class="search-item-title">${highlightQuery(title, searchInput.value.trim())}</div>
        ${subtitle ? `<div class="search-item-subtitle">${escapeHtml(subtitle)}</div>` : ""}
        ${preview ? `<div class="search-item-preview">${highlightQuery(preview, searchInput.value.trim())}</div>` : ""}
      </div>
    `;
  }

  function handleResultClick(e) {
    const el = e.currentTarget;
    const action = el.dataset.searchAction;
    closeDropdown();

    switch (action) {
      case "open-contract": {
        const contractId = el.dataset.contractId;
        if (contractId) {
          Store.setActiveContract(contractId);
          setView("review");
        }
        break;
      }
      case "open-clause": {
        const clauseId = el.dataset.clauseId;
        const contractId = el.dataset.contractId;
        if (contractId) {
          Store.setActiveContract(contractId);
          state.activeClauseId = clauseId;
          saveState(state, { localOnly: true });
          setView("review");
          if (clauseId) focusWorkbenchClause(clauseId);
        }
        break;
      }
      case "open-finding": {
        const contractId = el.dataset.contractId;
        if (contractId) {
          Store.setActiveContract(contractId);
          setView("review");
        }
        break;
      }
      case "open-playbook": {
        const playbookId = el.dataset.playbookId;
        if (playbookId) {
          state.activePlaybookId = playbookId;
          setView("playbooks");
        }
        break;
      }
      case "open-counterparty": {
        const counterpartyId = el.dataset.counterpartyId;
        if (counterpartyId) {
          state.activeCounterpartyId = counterpartyId;
          setView("counterparties");
        }
        break;
      }
      case "open-risk-rule": {
        setView("review");
        break;
      }
    }
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  function truncateHtml(text, maxLen) {
    const t = String(text || "").replace(/\s+/g, " ").trim();
    return t.length > maxLen ? t.slice(0, maxLen) + "…" : t;
  }

  function highlightQuery(text, query) {
    if (!query) return escapeHtml(text);
    const parts = query.split(/\s+/).filter(Boolean);
    if (!parts.length) return escapeHtml(text);
    const pattern = new RegExp(`(${parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
    return escapeHtml(text).replace(pattern, '<mark class="search-highlight">$1</mark>');
  }
})();
