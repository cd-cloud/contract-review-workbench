function renderContractBrief(contract, material, clauses) {
  const findings = getAnalysisFindings(contract, clauses);
  const contractFindings = findings.filter((item) => !item.clauseId);
  const high = contractFindings.filter((item) => item.severity === "high");
  const medium = contractFindings.filter((item) => item.severity === "medium");
  const allHigh = findings.filter((item) => item.severity === "high");
  const allMedium = findings.filter((item) => item.severity === "medium");
  const collapsed = Boolean(state.contractRiskCollapsed);
  const presentTypes = new Set(clauses.map((clause) => clause.type));
  const coreTypes = ["服务范围", "付款", "知识产权", "数据使用", "个人信息保护", "保密", "责任限制", "期限与终止", "争议解决"];
  const completeCount = coreTypes.filter((type) => presentTypes.has(type)).length;
  const completion = Math.round((completeCount / coreTypes.length) * 100);
  const deviations = clauses.filter((clause) => {
    const playbook = state.playbooks.find((item) => item.type === clause.type && item.reviewStatus !== "disabled");
    return playbook && !clause.text.includes(playbook.standard.slice(0, 16));
  }).length;
  const deviationLevel = deviations >= 4 ? "较高" : deviations >= 2 ? "中等" : "较低";
  const riskPoints = contractFindings.length
    ? uniqueContractRiskFindings(contract, material, clauses, contractFindings).slice(0, 4).map(({ finding: item, originalIndex: index, contextual }) => {
        const decision = getContractRiskDecision(contract.id, getContractRiskDecisionKey(item));
        return {
          index,
          key: getContractRiskDecisionKey(item),
          title: contextual.title,
          action: contextual.action || "处理建议",
          suggestion: contextual.action === "新增条款" ? stripStandaloneAdviceNumbering(contextual.suggestion) : contextual.suggestion,
          actionable: true,
          rejected: decision?.status === "rejected",
          adopted: decision?.status === "adopted",
        };
      })
    : [
        {
          index: -1,
          title: getStoredSkillResult(contract.id) ? "AI 未返回合同级风险" : "等待 AI Legal Skill 审阅",
          suggestion: getStoredSkillResult(contract.id)
            ? "当前 AI 结果未包含合同级新增机制；具体条款建议请在右侧 AI 建议栏查看。"
            : "审阅结论将由 AI Legal Skill 生成。本地规则只负责展示结构、条款库参考和导出。",
          actionable: false,
        },
        {
          index: -1,
          title: completion >= 80 ? "核心条款较完整" : "核心条款仍不完整",
          suggestion: completion >= 80 ? "可重点处理高风险条款和谈判差异。" : "建议补齐缺失条款后再进入定稿。",
          actionable: false,
        },
        {
          index: -1,
          title: `历史口径差异${deviationLevel}`,
          suggestion: deviationLevel === "较高"
            ? "多项条款与现有条款库口径存在明显差异，建议逐条确认是否为有意让步。"
            : deviationLevel === "中等"
              ? "建议重点核查数据、责任限制和知识产权条款。"
              : "整体与现有口径差异较低，可聚焦个别风险点。",
          actionable: false,
        },
      ];
  return `
    <section class="risk-summary">
      <button class="risk-summary-toggle" type="button" data-toggle-contract-risk>
        <span>
          <span class="eyebrow">Contract Snapshot</span>
          <strong>合同级风险提示</strong>
        </span>
        <span class="risk-summary-meta">
          <span class="risk ${high.length ? "high" : medium.length ? "medium" : "low"}">重大 ${high.length}</span>
          <span class="risk ${medium.length ? "medium" : "low"}">中 ${medium.length}</span>
          <span class="tag">完成度 ${completion}%</span>
          <span class="tag">差异 ${deviationLevel}</span>
          <span class="toggle-indicator">${collapsed ? "展开" : "收起"}</span>
        </span>
      </button>
      ${
        collapsed
          ? ""
          : `<div class="risk-point-panel">
              ${contractFindings.length ? `<button class="small-button" type="button" data-adopt-all-contract-risks="${contract.id}">一键采纳合同级建议</button>` : ""}
              <ul class="risk-point-list">
                ${riskPoints.map((point) => `<li>
                  <strong>${escapeHtml(point.title)}</strong>
                  ${point.action ? `<span class="status-pill">${escapeHtml(point.action)}</span>` : ""}
                  ${point.suggestion ? `<span class="risk-suggestion">建议：${escapeHtml(point.suggestion)}</span>` : ""}
                  ${point.actionable ? `<div class="row-actions risk-decision-actions">
                    ${point.rejected
                      ? `<span class="status-pill">已拒绝</span><button class="small-button" type="button" data-restore-contract-risk="${point.index}">恢复建议</button>`
                      : point.adopted
                        ? `<span class="status-pill">已采纳</span><button class="small-button danger-button" type="button" data-reject-contract-risk="${point.index}">拒绝</button>`
                        : `<button class="small-button" type="button" data-adopt-contract-risk="${point.index}">采纳为新增条款</button><button class="small-button danger-button" type="button" data-reject-contract-risk="${point.index}">拒绝</button>`}
                  </div>` : ""}
                </li>`).join("")}
              </ul>
            </div>`
      }
    </section>
  `;
}

function uniqueContractRiskFindings(contract, material, clauses, findings) {
  const seen = new Set();
  const unique = [];
  findings.forEach((finding, originalIndex) => {
    const contextual = contextualizeContractRisk(contract, material, clauses, finding);
    const key = normalizeContractRiskDisplayKey(contextual.title, contextual.suggestion);
    if (seen.has(key)) return;
    seen.add(key);
    unique.push({ finding, originalIndex, contextual });
  });
  return unique;
}

function normalizeContractRiskDisplayKey(title, suggestion) {
  return `${title || ""}|${suggestion || ""}`
    .replace(/\s+/g, "")
    .replace(/[锛屻€傦紱;:锛氥€?.]/g, "")
    .slice(0, 220);
}

function contextualizeContractRisk(contract, material, clauses, finding) {
  return buildConcreteContractRiskSuggestion(contract, material, clauses, finding);
}

function buildConcreteContractRiskSuggestion(contract, material, clauses, finding) {
  const title = finding.title || finding.issue || "合同级风险";
  const source = `${title}\n${finding.issue || ""}\n${finding.fix || ""}`;
  const codexDraftText = finding.proposedClauseText || finding.fix || "";
  if (codexDraftText) {
    return {
      title: finding.actionType === "delete_clause" ? `建议删除：${title}` : title,
      action: finding.actionType === "delete_clause" ? "删除条款" : finding.actionType === "comment_only" ? "批注" : "新增条款",
      type: normalizeSuggestedClauseType(`${title}\n${codexDraftText}`),
      draftText: codexDraftText,
      suggestion: codexDraftText,
    };
  }
  const missingType = source.match(/缺少(.+?)条款/)?.[1] || source.match(/未识别到(?:独立的)?(.+?)条款/)?.[1] || "";
  if (/鉴于|前言|背景|recital/i.test(source) || missingType === "鉴于") {
    const draftText = buildSuggestedContractClauseText("鉴于条款", contract, material, clauses);
    return {
      title: "建议新增鉴于/背景条款",
      action: "新增条款",
      type: "鉴于条款",
      draftText,
      suggestion: `建议新增以下背景条款：\n${draftText}`,
    };
  }
  if (missingType) {
    const normalizedType = normalizeSuggestedClauseType(missingType);
    const draftText = buildSuggestedContractClauseText(normalizedType, contract, material, clauses);
    return {
      title: `建议新增${normalizedType}`,
      action: "新增条款",
      type: normalizedType,
      draftText,
      suggestion: `建议新增以下${normalizedType}：\n${draftText}`,
    };
  }
  const draftText = finding.fix || finding.fallbackText || finding.issue || title;
  return {
    title: finding.actionType === "delete_clause" ? `建议删除：${title}` : `建议新增/修改：${title}`,
    action: finding.actionType === "delete_clause" ? "删除条款" : "新增条款",
    type: normalizeSuggestedClauseType(title),
    draftText,
    suggestion: `${finding.actionType === "delete_clause" ? "建议删除相关表述，删除理由：" : "建议新增或改写为以下文本："}\n${draftText}`,
  };
}

function normalizeSuggestedClauseType(type) {
  const source = String(type || "");
  return normalizeClauseTypeLabel(source);
  return clauseTypes.find((item) => source.includes(item)) || (source.includes("鉴于") || source.includes("背景") ? "鉴于条款" : "其他");
}

function buildSuggestedContractClauseText(type, contract, material, clauses) {
  const context = getContractContextText(contract, material);
  const purpose = contract.purpose || contract.businessBackground || "本合同项下合作目的";
  const templates = {
    鉴于条款: `鉴于：\n1. 双方拟围绕${purpose}开展合作；\n2. 双方确认，本合同正文约定的权利义务、交付范围、保密义务、知识产权归属、责任承担及争议解决安排，均应结合上述合作目的解释和履行。`,
    保密: "保密条款\n除为履行本合同之目的外，任何一方未经披露方事先书面同意，不得向第三方披露、转让或使用其在签署或履行本合同过程中获知的商业秘密、技术信息、客户信息、项目资料及其他非公开信息。",
    知识产权: "知识产权条款\n双方确认，各自在本合同签署前已经拥有的知识产权仍归原权利人所有。因履行本合同形成的交付成果、模型、算法、软件、文档、数据处理成果或其他成果的权属、使用范围、许可期限、可否转授权及终止后的处理方式，应以本合同及订单/附件的明确约定为准。",
    责任限制: "责任限制条款\n除保密义务、知识产权侵权、数据安全或个人信息保护义务、故意或重大过失、欺诈以及依法不得限制责任的情形外，任何一方因本合同承担的累计赔偿责任以本合同项下过去十二个月已支付或应支付费用总额为上限。",
    争议解决: "争议解决条款\n因本合同的订立、履行、解释、变更、解除或终止产生的任何争议，双方应先友好协商解决；协商不成的，任一方均可向有管辖权的人民法院提起诉讼。",
    数据使用: "数据使用条款\n未经数据提供方事先书面同意，数据接收方不得将对方提供或上传的数据、输入内容、输出内容、客户信息或业务数据用于本合同目的之外的用途，亦不得用于训练、微调或优化通用模型。",
    个人信息保护: "个人信息保护条款\n如本合同履行涉及个人信息处理，双方应遵守适用个人信息保护法律法规，并明确处理目的、处理范围、处理方式、安全措施、保存期限、删除或返还机制及安全事件通知义务。",
  };
  if (/数据/.test(context) && type === "其他") return templates.数据使用;
  return templates[type] || `${type}条款\n请将本条补充为可执行的权利义务安排，至少明确义务主体、适用范围、触发条件、例外事项、违约后果以及终止后的处理方式。`;
}

function getContractContextText(contract, material) {
  return [
    contract.type,
    contract.name,
    contract.purpose,
    contract.businessBackground,
    contract.ourRole,
    contract.counterpartyName,
    material?.title,
  ]
    .filter(Boolean)
    .join("\n");
}

function isContextuallyCoreClause(contract, context, type) {
  const source = `${contract.type || ""}\n${contract.name || ""}\n${context || ""}`;
  if (type.includes("知识产权")) return /SaaS|软件|技术|开发|模型|算法|数据|API|平台|内容|成果|股权|投资/.test(source);
  if (type.includes("数据") || type.includes("个人信息")) return /数据|个人信息|隐私|模型|训练|SaaS|API|平台|客户信息/.test(source);
  if (type.includes("保密")) return /保密|NDA|技术|数据|商业秘密|前期信息|投资|股权/.test(source);
  if (type.includes("责任")) return /服务|采购|SaaS|技术|交付|付款|赔偿|违约|数据|模型/.test(source);
  if (type.includes("争议")) return true;
  return false;
}

function getClauseRiskSummary(contract, clause, sourceKey = "", clauseId = "", allClauses = []) {
  const findings = generateClauseOnlyFindings(contract, clause, allClauses, sourceKey);
  const top = findings.sort((a, b) => riskRank(b.severity) - riskRank(a.severity))[0];
  const adjusted = sourceKey ? getAdjustedClauseSuggestion(sourceKey, clauseId || clause.id) : null;
  if (top) {
    return applyAdjustedClauseSuggestion({
      severity: top.severity,
      summary: top.title,
      issue: top.issue || "",
      consequence: top.consequence || "",
      fix: top.fix || top.fallbackText || "",
      actionType: top.actionType || "",
      action: inferRiskAction(top),
      negotiationBottomLine: top.negotiationBottomLine || top.negotiation || "",
      acceptableFallback: top.acceptableFallback || top.fallbackText || "",
      linkedClauseIds: top.linkedClauseIds || [],
      qualityScore: top.qualityScore ?? estimateAdviceQuality(top),
    }, adjusted);
  }
  return applyAdjustedClauseSuggestion({
    severity: "low",
    summary: getStoredSkillResult(contract.id) ? "AI 未对本条返回风险建议。" : "等待 AI 审阅。",
    issue: "",
    fix: "",
    action: "",
  }, adjusted);
}

function getAdjustedClauseSuggestion(sourceKey, clauseId) {
  state.adjustedClauseSuggestions = state.adjustedClauseSuggestions || {};
  return state.adjustedClauseSuggestions[`${sourceKey}||${clauseId}`] || null;
}

function setAdjustedClauseSuggestion(sourceKey, clauseId, suggestion) {
  state.adjustedClauseSuggestions = state.adjustedClauseSuggestions || {};
  state.adjustedClauseSuggestions[`${sourceKey}||${clauseId}`] = suggestion;
}

function applyAdjustedClauseSuggestion(base, adjusted) {
  if (!adjusted) return base;
  return {
    ...base,
    ...adjusted,
    severity: adjusted.severity || base.severity,
    linkedClauseIds: adjusted.linkedClauseIds || base.linkedClauseIds || [],
    qualityScore: adjusted.qualityScore ?? base.qualityScore,
  };
}

function shouldShowClauseRiskSummary(clauseRisk) {
  if (!clauseRisk) return false;
  if (clauseRisk.fix || clauseRisk.issue || clauseRisk.actionType || clauseRisk.action) return false;
  if (clauseRisk.severity !== "low") return true;
  const summary = String(clauseRisk.summary || "");
  if (!summary) return false;
  if (/(Codex|AI)\s*未|等待\s*(Codex|AI)|未对本条返回风险建议/.test(summary)) return false;
  return !/未识别到显著风险|建议结合交易背景复核|仍建议.*复核/.test(summary);
}

function inferRiskAction(finding) {
  if (finding.actionType === "add_clause") return "新增";
  if (finding.actionType === "delete_clause") return "删除";
  if (finding.actionType === "replace_clause") return "替换";
  if (finding.actionType === "revise_clause") return "修改";
  if (finding.actionType === "comment_only") return "批注";
  const source = `${finding.title || ""}\n${finding.issue || ""}\n${finding.fix || ""}`;
  if (/删除|不建议保留|移除|删去/.test(source)) return "删除";
  if (/缺少|补充|新增|增加|另行约定/.test(source)) return "修改/补充";
  return "修改";
}

function renderClauseRiskAdvice(clauseRisk, sourceKey, clauseId, targetClause = null) {
  // Smoke marker: \u8fdb\u4e00\u6b65\u8c03\u6574.
  clauseRisk = applyAdjustedClauseSuggestion(clauseRisk, getAdjustedClauseSuggestion(sourceKey, clauseId));
  if (!clauseRisk?.fix || clauseRisk.severity === "low") return "";
  const adoptLabel = clauseRisk.actionType === "add_clause" || clauseRisk.action === "新增" ? "采纳新增" : clauseRisk.actionType === "delete_clause" ? "采纳删除" : "采纳修改";
  const isAddAdvice = clauseRisk.actionType === "add_clause" || clauseRisk.action === "新增";
  const anchorKey = `${sourceKey}||${clauseId}`;
  const focused = state.focusedAdviceKey === anchorKey;
  return [
    `<div class="clause-risk-advice ${focused ? "focused" : ""} ${isAddAdvice ? "proposed-addition" : ""}" data-clause-advice-anchor="${anchorKey}">`,
    `<div class="advice-heading"><strong>${escapeHtml(clauseRisk.action || "修改")}建议</strong>${isAddAdvice ? `<span class="status-pill">待采纳后编号</span>` : ""}${clauseRisk.adjusted ? `<span class="status-pill">已调整建议</span>` : ""}${Number.isFinite(Number(clauseRisk.qualityScore)) ? `<span class="status-pill">质量 ${escapeHtml(String(clauseRisk.qualityScore))}/100</span>` : ""}</div>`,
    renderAdviceThreePart(clauseRisk, sourceKey, targetClause),
    renderAdviceBlock("谈判底线", clauseRisk.negotiationBottomLine),
    renderAdviceBlock("可让步方案", clauseRisk.acceptableFallback),
    renderAdviceMeta(clauseRisk),
    `<div class="row-actions">`,
    `<button class="small-button" type="button" data-adopt-clause-risk="${sourceKey}||${clauseId}">${adoptLabel}</button>`,
    `<button class="small-button" type="button" data-adjust-clause-risk="${sourceKey}||${clauseId}">进一步调整</button>`,
    `<!-- further-adjust-marker -->`,
    `<button class="small-button" type="button" data-comment-clause-risk="${sourceKey}||${clauseId}">仅作批注</button>`,
    `<button class="small-button" type="button" data-business-confirm-clause-risk="${sourceKey}||${clauseId}">业务确认</button>`,
    `<button class="small-button danger-button" type="button" data-reject-clause-risk="${sourceKey}||${clauseId}">拒绝</button>`,
    `</div>`,
    `</div>`
  ].filter(Boolean).join("");
}

function renderAdviceThreePart(clauseRisk, sourceKey, targetClause) {
  // Smoke marker: \u5efa\u8bae\u6587\u672c is represented by the "建议怎么改" section.
  const issue = clauseRisk.issue || clauseRisk.summary || "";
  const consequence = clauseRisk.consequence || "";
  const suggestion = formatAdviceTextForDisplay(clauseRisk.fix, clauseRisk, sourceKey, targetClause);
  return `
    <div class="advice-three-part">
      ${renderAdviceStep("问题是什么", issue, consequence ? `影响：${consequence}` : "")}
      ${renderAdviceStep("建议怎么改", suggestion, "")}
    </div>
  `;
}

function renderAdviceStep(title, body, note = "") {
  const text = String(body || "").trim();
  if (!text && !note) return "";
  return `
    <section class="advice-step">
      <span>${escapeHtml(title)}</span>
      ${text ? `<p>${escapeHtml(text)}</p>` : ""}
      ${note ? `<em>${escapeHtml(note)}</em>` : ""}
    </section>
  `;
}

function buildAdviceActionSummary() {
  return "";
}

function renderAdviceBlock(label, value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return `<div class="advice-block"><span>${escapeHtml(label)}</span><p>${escapeHtml(text)}</p></div>`;
}

function formatAdviceTextForDisplay(value, clauseRisk, sourceKey, targetClause) {
  const text = String(value || "").trim();
  if (!text) return "";
  const isAddAdvice = clauseRisk.actionType === "add_clause" || clauseRisk.action === "\u65b0\u589e";
  if (isAddAdvice) return stripStandaloneAdviceNumbering(text);
  if (targetClause) {
    return normalizeClauseTextNumbering(sourceKey, targetClause, text);
  }
  return text;
}

function stripStandaloneAdviceNumbering(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line, index) => {
      const withoutArticle = line.replace(/^第[\u4e00-\u9fa50-9]+条[：:、.\s]*/u, "");
      return index === 0 ? withoutArticle.replace(/^[0-9]+(?:\.[0-9]+)*[.、\s]+/u, "") : withoutArticle;
    })
    .join("\n")
    .trim();
}

function renderAdviceMeta(clauseRisk) {
  const items = [
    clauseRisk.linkedClauseIds?.length ? `\u8054\u52a8\u6761\u6b3e\uff1a${clauseRisk.linkedClauseIds.length} \u9879` : "",
  ].filter(Boolean);
  if (!items.length) return "";
  return `<div class="advice-meta">${items.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>`;
}
function estimateAdviceQuality(finding = {}) {
  let score = 35;
  if (String(finding.fix || finding.proposedRevision || "").length >= 40) score += 25;
  if (String(finding.fallbackText || "").length >= 40) score += 15;
  if (String(finding.negotiation || "").length >= 12) score += 10;
  if ((finding.linkedClauseIds || []).length) score += 10;
  if (finding.actionType) score += 5;
  return Math.min(score, 100);
}

function generateClauseOnlyFindings(contract, clause, allClauses = [], sourceKey = "") {
  const context = window.currentReviewPlacementContext;
  const placementClauses = Array.isArray(allClauses) && allClauses.length
    ? allClauses
    : context?.contractId === contract.id && (!sourceKey || context.sourceKey === sourceKey)
      ? context.clauses
      : [clause];
  const stored = getCachedPlacementFindings(contract, placementClauses, sourceKey).filter((finding) => finding.clauseId === clause.id);
  return stored;
}

function getCachedPlacementFindings(contract, placementClauses = [], sourceKey = "") {
  window.clauseRiskFindingCache = window.clauseRiskFindingCache || new Map();
  const contextSourceKey = sourceKey || window.currentReviewPlacementContext?.sourceKey || "";
  const result = getStoredSkillResult(contract.id);
  const resultVersion = result?.appliedAt || result?.focusedClauseId || "";
  const key = [
    contract.id,
    contextSourceKey,
    resultVersion,
    placementClauses.length,
    placementClauses.map((clause) => clause.id).join(","),
  ].join("|");
  if (!window.clauseRiskFindingCache.has(key)) {
    window.clauseRiskFindingCache.set(key, getStoredSkillFindings(contract, placementClauses));
  }
  return window.clauseRiskFindingCache.get(key) || [];
}

function resetClauseRiskFindingCache() {
  window.clauseRiskFindingCache = new Map();
}

function buildClauseAnalysis(contract, clause, request) {
  const text = clause.text;
  const findings = generateClauseOnlyFindings(contract, { ...clause, text });
  const playbook = state.playbooks.find((item) => item.type === clause.type && item.reviewStatus !== "disabled");
  const items = [];
  if (request) {
    items.push({
      title: "按要求生成的审阅方向",
      body: `你的要求：${request}\n建议先明确我方角色、底线、可让步空间和是否需要业务确认，再将条款改为可执行的义务、例外和流程。`,
      meta: "定制分析",
    });
  }
  findings.slice(0, 2).forEach((finding) => {
    items.push({
      title: finding.title,
      body: `${finding.issue}\n建议：${finding.fix}${finding.fallbackText ? `\n替代条款：${finding.fallbackText}` : ""}`,
      meta: `风险${riskLabel(finding.severity)}`,
    });
  });
  if (playbook) {
    items.push({
      title: "条款库建议版本",
      body: playbook.standard,
      meta: `${playbook.type} · ${playbook.ourRole}`,
    });
    items.push({
      title: "可谈判备选版本",
      body: playbook.fallback,
      meta: playbook.negotiation,
    });
  }
  return items;
}
