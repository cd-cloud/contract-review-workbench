function normalizePlaybook(item) {
  return {
    status: "standard",
    applicability: item.contractTypes?.join("、") || "",
    baseline: item.standard || "",
    version: 1,
    sourceContractIds: [],
    sourceClauseIds: [],
    sourceOccurrences: [],
    variants: [],
    knowledgeSignals: [],
    keywords: [],
    confidenceScore: 0,
    reviewStatus: "active",
    approvalStatus: "approved",
    nextReviewAt: item.nextReviewAt || "",
    lastReviewedAt: item.updatedAt || today(),
    ...item,
    contractTypes: item.contractTypes || [],
    usageCount: item.usageCount || 0,
    sourceOccurrences: item.sourceOccurrences || [],
    variants: item.variants || [],
    knowledgeSignals: item.knowledgeSignals || [],
    keywords: item.keywords || inferKnowledgeKeywords(item),
    confidenceScore: item.confidenceScore || inferPlaybookConfidence(item),
  };
}

function getEligibleFinalMaterial(contract) {
  const updates = getContractUpdates(contract.id);
  return updates
    .slice()
    .reverse()
    .find((update) => update.knowledgeEligible && update.materialKind !== "comments" && (update.acceptedText || update.versionText));
}

function depositFinalClausesToPlaybook(contract) {
  const finalMaterial = getEligibleFinalMaterial(contract);
  if (!finalMaterial) return { added: 0, updated: 0, skipped: 0 };
  const text = finalMaterial.acceptedText || finalMaterial.versionText;
  const clauses = splitClauses(text, contract.id).filter((clause) => clause.type && clause.type !== "其他");
  let added = 0;
  let updated = 0;
  let skipped = 0;

  clauses.forEach((clause) => {
    const existing = state.playbooks.find((item) => item.type === clause.type && item.ourRole === contract.ourRole);
    const sourceClauseId = `${contract.id}:${finalMaterial.id}:${clause.number}`;
    const occurrence = buildKnowledgeOccurrence(contract, finalMaterial, clause, sourceClauseId);
    if (existing) {
      existing.sourceContractIds = [...new Set([...(existing.sourceContractIds || []), contract.id])];
      existing.sourceClauseIds = [...new Set([...(existing.sourceClauseIds || []), sourceClauseId])];
      existing.sourceOccurrences = upsertKnowledgeOccurrence(existing.sourceOccurrences || [], occurrence);
      existing.usageCount = (existing.usageCount || 0) + 1;
      existing.lastReviewedAt = existing.lastReviewedAt || today();
      existing.applicability = existing.applicability || `${contract.type}｜${contract.ourRole}`;
      if (!existing.standard || existing.status === "fallback") {
        existing.standard = clause.text;
      } else if (normalizeText(existing.standard) !== normalizeText(clause.text)) {
        existing.variants = addKnowledgeVariant(existing, clause, occurrence);
        existing.reviewStatus = "pending_review";
        existing.approvalStatus = "pending_review";
        existing.version = (existing.version || 1) + 1;
      }
      existing.keywords = inferKnowledgeKeywords(existing);
      existing.knowledgeSignals = buildPlaybookKnowledgeSignals(existing);
      existing.confidenceScore = inferPlaybookConfidence(existing);
      updated += 1;
    } else {
      state.playbooks.unshift(
        normalizePlaybook({
          id: uid("pb"),
          type: clause.type,
          contractTypes: [contract.type],
          ourRole: contract.ourRole || "未识别",
          standard: clause.text,
          fallback: "可结合交易重要性、客户议价能力和业务推进优先级适度放宽，但不得突破谈判底线。",
          forbidden: "不得删除核心义务主体、适用条件、违约后果或监管合规要求。",
          negotiation: "以终稿口径作为标准版本；如偏离，应记录偏离原因和审批结论。",
          usageCount: 1,
          status: "standard",
          applicability: `${contract.type}｜${contract.ourRole || "未识别"}`,
          baseline: clause.text,
          version: 1,
          sourceContractIds: [contract.id],
          sourceClauseIds: [sourceClauseId],
          sourceOccurrences: [occurrence],
          variants: [],
          knowledgeSignals: [],
          keywords: inferKnowledgeKeywords({ ...clause, contractTypes: [contract.type], ourRole: contract.ourRole }),
          reviewStatus: "pending_review",
          approvalStatus: "pending_review",
          lastReviewedAt: "",
          nextReviewAt: addDays(today(), 30),
          createdAt: today(),
        })
      );
      state.playbooks[0].knowledgeSignals = buildPlaybookKnowledgeSignals(state.playbooks[0]);
      state.playbooks[0].confidenceScore = inferPlaybookConfidence(state.playbooks[0]);
      added += 1;
    }
  });

  if (!clauses.length) skipped += 1;
  return { added, updated, skipped };
}

function buildKnowledgeOccurrence(contract, finalMaterial, clause, sourceClauseId) {
  return {
    id: sourceClauseId,
    contractId: contract.id,
    updateId: finalMaterial.id,
    clauseNumber: clause.number,
    clauseTitle: clause.title,
    clauseType: clause.type,
    contractName: contract.name,
    counterpartyName: contract.counterpartyName || "",
    contractType: contract.type || "",
    ourRole: contract.ourRole || "",
    text: clause.text,
    depositedAt: today(),
  };
}

function upsertKnowledgeOccurrence(list, occurrence) {
  const next = (list || []).filter((item) => item.id !== occurrence.id);
  next.unshift(occurrence);
  return next.slice(0, 30);
}

function addKnowledgeVariant(playbook, clause, occurrence) {
  const variant = {
    id: uid("pbv"),
    text: clause.text,
    sourceOccurrenceId: occurrence.id,
    contractName: occurrence.contractName,
    counterpartyName: occurrence.counterpartyName,
    createdAt: today(),
    status: "candidate",
    note: "来自终稿的新候选口径，需复核后决定是否提升为标准版本。",
  };
  const variants = (playbook.variants || []).filter((item) => normalizeText(item.text) !== normalizeText(variant.text));
  variants.unshift(variant);
  return variants.slice(0, 12);
}

function buildPlaybookKnowledgeSignals(playbook) {
  const source = `${playbook.type}${playbook.standard}${playbook.fallback}${playbook.negotiation}`;
  return (state.aiSuggestionFeedback || [])
    .filter((item) => `${item.title}${item.note}${item.actionType}`.includes(playbook.type) || source.includes(item.title || ""))
    .slice(0, 8)
    .map((item) => ({
      id: item.id,
      status: item.status,
      actionType: item.actionType,
      title: item.title,
      note: item.note,
      createdAt: item.createdAt,
    }));
}

function inferKnowledgeKeywords(item = {}) {
  const source = `${item.type || ""}\n${item.standard || item.text || ""}\n${item.fallback || ""}\n${item.negotiation || ""}`;
  const candidates = ["数据", "模型训练", "个人信息", "保密", "知识产权", "责任上限", "违约", "争议解决", "股权", "创始人", "回购", "优先权", "交付", "验收", "付款", "通知"];
  return candidates.filter((keyword) => source.includes(keyword)).slice(0, 8);
}

function inferPlaybookConfidence(item = {}) {
  const occurrenceCount = (item.sourceOccurrences || []).length || (item.sourceClauseIds || []).length || 0;
  const signalCount = (item.knowledgeSignals || []).length;
  const reviewed = item.reviewStatus === "active" ? 25 : item.reviewStatus === "pending_review" ? 8 : 0;
  const score = Math.min(100, occurrenceCount * 18 + signalCount * 6 + reviewed);
  return Math.max(score, item.standard ? 20 : 0);
}

function renderPlaybooks() {
  const types = [...new Set(state.playbooks.map((item) => item.type))];
  const roles = [...new Set(state.playbooks.map((item) => item.ourRole))];
  const stats = getKnowledgeStats();
  views.playbooks.innerHTML = `
    <div class="panel" style="margin-bottom:14px">
      <p class="eyebrow">Knowledge Rule</p>
      <h3 class="section-title">条款库只索引终稿</h3>
      <p class="muted">新建审阅中的初稿、进度更新中的过程稿、邮件、修改建议和谈判反馈只能作为审阅材料或进度记录；只有用户标记为终稿的合同版本可以进入条款库反向索引。</p>
    </div>
    <div class="grid stats-grid" style="margin-bottom:14px">
      ${statCard("有效口径", stats.active, "可被审阅/起草调用")}
      ${statCard("待复核", stats.pending, "新候选或变体口径")}
      ${statCard("来源终稿", stats.sources, "反向索引合同数")}
      ${statCard("AI反馈", stats.feedback, "采纳/拒绝闭环")}
    </div>
    ${renderKnowledgeReviewQueue()}
    ${renderRiskRuleLibrary()}
    <div class="filters">
      <input id="playbook-search" placeholder="搜索条款、关键词、谈判说明" />
      <select id="playbook-type-filter">
        <option value="">全部类别</option>
        ${types.map((type) => `<option>${escapeHtml(type)}</option>`).join("")}
      </select>
      <select id="playbook-role-filter">
        <option value="">全部我方角色</option>
        ${roles.map((role) => `<option>${escapeHtml(role)}</option>`).join("")}
      </select>
      <select id="playbook-review-filter">
        <option value="">全部治理状态</option>
        <option value="active">已生效</option>
        <option value="pending_review">待复核</option>
        <option value="disabled">已禁用</option>
      </select>
    </div>
    <div class="playbook-grid" id="playbook-list">
      ${renderPlaybookCards(state.playbooks)}
    </div>
  `;
}

function renderKnowledgeReviewQueue() {
  const pendingPlaybooks = state.playbooks.filter((item) => item.reviewStatus === "pending_review");
  const pendingVariants = state.playbooks.flatMap((item) => (item.variants || []).filter((variant) => variant.status === "candidate").map((variant) => ({ playbook: item, variant })));
  const feedback = (state.aiSuggestionFeedback || []).slice(0, 5);
  const items = [
    ...pendingPlaybooks.map((item) => ({
      title: `${item.type}｜${item.ourRole}`,
      body: item.standard,
      meta: `待复核标准口径｜来源 ${item.sourceOccurrences?.length || item.sourceClauseIds?.length || 0} 个终稿`,
      action: `<button class="small-button" data-playbook-review="${escapeHtml(item.id)}:active">复核通过</button><button class="small-button" data-playbook-review="${escapeHtml(item.id)}:disabled">禁用</button>`,
    })),
    ...pendingVariants.map(({ playbook, variant }) => ({
      title: `候选变体｜${playbook.type}`,
      body: variant.text,
      meta: `${variant.contractName || ""}｜${variant.note || ""}`,
      action: `<button class="small-button" type="button" data-playbook-promote-variant="${escapeHtml(playbook.id)}:${escapeHtml(variant.id)}">提升为标准口径</button>`,
    })),
    ...feedback.map((item) => ({
      title: `AI反馈｜${item.status}`,
      body: item.note || item.title,
      meta: `${item.scope}｜${item.actionType}`,
      action: "",
    })),
  ].slice(0, 8);
  return `
    <div class="panel" style="margin-bottom:14px">
      <h3 class="section-title">待复核知识队列</h3>
      <div class="reference-list">
        ${
          items.length
            ? items
                .map(
                  (item) => `
                  <div class="reference-item">
                    <div><strong>${escapeHtml(item.title)}</strong></div>
                    <p>${escapeHtml(item.body || "")}</p>
                    <div class="muted">${escapeHtml(item.meta || "")}</div>
                    ${item.action ? `<div class="row-actions">${item.action}</div>` : ""}
                  </div>`
                )
                .join("")
            : `<div class="empty">暂无待复核知识。新的终稿变体、AI采纳/拒绝反馈会进入这里。</div>`
        }
      </div>
    </div>
  `;
}

function renderRiskRuleLibrary() {
  const rules = state.riskRules || [];
  return `
    <div class="panel" style="margin-bottom:14px">
      <h3 class="section-title">风险规则库</h3>
      <div class="reference-list">
        ${rules
          .map(
            (rule) => `
            <div class="reference-item">
              <div class="chips">
                <span class="tag">${escapeHtml(rule.type)}</span>
                <span class="risk ${escapeHtml(rule.severity || "medium")}">风险${riskLabel(rule.severity || "medium")}</span>
                <span class="status-pill">${rule.status === "disabled" ? "已禁用" : "已启用"}</span>
              </div>
              <strong>${escapeHtml(rule.title)}</strong>
              <p>${escapeHtml(rule.issue)}</p>
              <p><strong>建议：</strong>${escapeHtml(rule.suggestion)}</p>
              <div class="row-actions">
                <button class="small-button" type="button" data-risk-rule-status="${escapeHtml(rule.id)}:${rule.status === "disabled" ? "active" : "disabled"}">${rule.status === "disabled" ? "启用" : "禁用"}</button>
              </div>
            </div>`
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderPlaybookCards(items) {
  if (!items.length) return `<div class="empty">没有匹配的条款口径</div>`;
  return items
    .map((item) => {
      const knowledgeSignals = buildPlaybookKnowledgeSignals(item);
      const confidenceScore = inferPlaybookConfidence(item);
      const occurrences = getCleanClauseOccurrences(item);
      return `
      <article class="playbook-card">
        <div class="chips">
          <span class="tag">${escapeHtml(item.type)}</span>
          <span class="status-pill">${playbookStatusLabel(item.status)}</span>
          <span class="${item.reviewStatus === "disabled" ? "risk high" : item.reviewStatus === "pending_review" ? "risk medium" : "status-pill"}">${playbookReviewStatusLabel(item.reviewStatus)}</span>
          <span class="status-pill">使用 ${item.usageCount} 次</span>
          <span class="status-pill">可信度 ${confidenceScore || 0}</span>
        </div>
        <h4>${escapeHtml(item.type)}｜${escapeHtml(item.ourRole)}</h4>
        ${
          item.keywords?.length
            ? `<div class="chips">${item.keywords.map((keyword) => `<span class="tag">${escapeHtml(keyword)}</span>`).join("")}</div>`
            : ""
        }
        <p><strong>适用场景：</strong>${escapeHtml(item.applicability || item.contractTypes.join("、") || "未记录")}</p>
        <p><strong>标准版本：</strong>${escapeHtml(item.standard)}</p>
        <p><strong>备选版本：</strong>${escapeHtml(item.fallback)}</p>
        <p><strong>禁用版本：</strong>${escapeHtml(item.forbidden)}</p>
        <p><strong>谈判底线：</strong>${escapeHtml(item.negotiation)}</p>
        <p><strong>版本/复核：</strong>v${escapeHtml(item.version || 1)}｜${playbookReviewStatusLabel(item.reviewStatus)}｜上次 ${escapeHtml(item.lastReviewedAt || "未复核")}｜下次 ${escapeHtml(item.nextReviewAt || "未设置")}</p>
        <div class="row-actions">
          <button class="small-button" data-playbook-review="${escapeHtml(item.id)}:active">标记已复核</button>
          <button class="small-button" data-playbook-review="${escapeHtml(item.id)}:pending_review">待复核</button>
          <button class="small-button" data-playbook-review="${escapeHtml(item.id)}:disabled">禁用</button>
        </div>
        ${renderKnowledgeVariants(item)}
        ${renderKnowledgeSignals(item)}
        <div class="reference-list">
          <strong>终稿反向索引</strong>
          ${
            occurrences.length
              ? occurrences
                  .map(
                    (occurrence) => `
                    <div class="reference-item">
                      <div><strong>${escapeHtml(occurrence.contractName)}</strong></div>
                      <div class="muted">${escapeHtml(occurrence.clauseTitle)}｜第 ${occurrence.number} 条｜${escapeHtml(occurrence.counterpartyName)}</div>
                      <button class="small-button" data-open-clause="${escapeHtml(occurrence.contractId)}:${escapeHtml(occurrence.clauseId)}">打开位置</button>
                    </div>`
                  )
                  .join("")
              : `<div class="empty">暂无来自终稿的出现位置</div>`
          }
        </div>
      </article>`;
    })
    .join("");
}

function getKnowledgeStats() {
  const active = state.playbooks.filter((item) => item.reviewStatus === "active").length;
  const pending = state.playbooks.filter((item) => item.reviewStatus === "pending_review").length;
  const sources = new Set(state.playbooks.flatMap((item) => item.sourceContractIds || [])).size;
  const feedback = (state.aiSuggestionFeedback || []).length;
  return { active, pending, sources, feedback };
}

function renderKnowledgeVariants(item) {
  const variants = item.variants || [];
  if (!variants.length) return "";
  return `
    <div class="reference-list">
      <strong>候选变体</strong>
      ${variants
        .slice(0, 4)
        .map(
          (variant) => `
          <div class="reference-item">
            <div><strong>${escapeHtml(variant.contractName || "终稿候选")}</strong><span class="status-pill">${escapeHtml(variant.status || "candidate")}</span></div>
            <p>${escapeHtml(variant.text)}</p>
            <div class="muted">${escapeHtml(variant.note || "")}</div>
            <button class="small-button" type="button" data-playbook-promote-variant="${escapeHtml(item.id)}:${escapeHtml(variant.id)}">提升为标准口径</button>
          </div>`
        )
        .join("")}
    </div>
  `;
}

function renderKnowledgeSignals(item) {
  const signals = item.knowledgeSignals || [];
  if (!signals.length) return "";
  return `
    <div class="reference-list">
      <strong>AI建议反馈</strong>
      ${signals
        .slice(0, 4)
        .map(
          (signal) => `
          <div class="reference-item">
            <div><strong>${escapeHtml(signal.title || "AI反馈")}</strong><span class="status-pill">${escapeHtml(signal.status || "")}</span></div>
            <p>${escapeHtml(signal.note || "")}</p>
          </div>`
        )
        .join("")}
    </div>
  `;
}

function playbookStatusLabel(status) {
  return {
    standard: "标准版本",
    fallback: "备选版本",
    forbidden: "禁用版本",
  }[status] || "标准版本";
}

function playbookReviewStatusLabel(status) {
  return {
    active: "已生效",
    pending_review: "待复核",
    disabled: "已禁用",
  }[status] || "已生效";
}

function getCleanClauseOccurrences(playbook) {
  const stored = (playbook.sourceOccurrences || []).map((occurrence) => ({
    contractId: occurrence.contractId,
    clauseId: occurrence.id,
    contractName: occurrence.contractName,
    counterpartyName: occurrence.counterpartyName,
    clauseTitle: occurrence.clauseTitle,
    number: occurrence.clauseNumber,
  }));
  const legacy = state.clauses
    .filter((clause) => clause.sourceKind === "clean" && clause.type === playbook.type)
    .map((clause) => {
      const contract = state.contracts.find((item) => item.id === clause.contractId);
      return {
        contractId: clause.contractId,
        clauseId: clause.id,
        contractName: contract?.name || "未命名合同",
        counterpartyName: contract?.counterpartyName || "未识别相对方",
        clauseTitle: clause.title,
        number: clause.number,
      };
    });
  return [...stored, ...legacy].slice(0, 12);
}
