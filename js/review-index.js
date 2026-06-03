function buildClauseIndexGroups(contract, material, selectedClause, currentClauses) {
  const groups = { history: [], related: [], playbook: [], recommendations: [] };
  const currentText = getEditedClauseText(material.sourceKey, selectedClause);
  const updates = (state.updates || []).filter((item) => item.contractId === contract.id && item.id !== state.activeUpdateId && item.versionText);

  updates.forEach((update) => {
    const historyText =
      update.materialKind === "redline" && (state.reviewMode || "clean") === "clean"
        ? update.rejectedText || rejectRedlineText(update.versionText)
        : update.acceptedText || update.versionText;
    const clauses = splitVersionClauses(historyText, `${contract.id}:${update.id}`);
    const matched = findHistoricalClauseMatch(selectedClause, clauses, currentText);
    if (matched) {
      const change = summarizeHistoricalClauseChange(matched.text, currentText);
      groups.history.push({
        title: `本条款历史版本｜${update.type} ${update.createdAt}`,
        body: matched.text.slice(0, 420),
        meta: `${materialKindLabel(update.materialKind)}｜${matched.title}\n变化摘要：${change}\nAI分析：该版本可用于追踪本条款在谈判过程中的变化，建议重点比较义务范围、例外条件、责任后果和是否出现新增让步。`,
      });
    }
  });

  const referenceInfo = buildClauseReferenceInfo(selectedClause, currentClauses);
  groups.related = [
    ...referenceInfo.outgoing.map((item) => ({
      title: `当前条款引用｜${item.reference} ${item.clause?.title || ""}`,
      body: item.clause?.text?.slice(0, 420) || "未找到对应条款。",
      meta: item.clause
        ? "关系：当前条款明确引用该条款。\nAI建议：修改当前条款时，应同步检查被引用条款是否仍能支撑当前权利义务。"
        : "关系：疑似失效引用。\nAI建议：发送前应修正编号或补回被引用条款。",
    })),
    ...referenceInfo.incoming.map((item) => ({
      title: `被其他条款引用｜${item.clause.title}`,
      body: item.clause.text.slice(0, 420),
      meta: `关系：该条款引用了当前条款（${item.reference}）。\nAI建议：当前条款修改可能影响其适用前提、例外范围或责任边界。`,
    })),
    ...findTightlyRelatedClauses(selectedClause, currentClauses)
      .filter((clause) => !referenceInfo.incoming.some((item) => item.clause.id === clause.id) && !referenceInfo.outgoing.some((item) => item.clause?.id === clause.id))
      .map((clause) => ({
        title: `本合同关联条款｜${clause.title}`,
        body: clause.text.slice(0, 420),
        meta: `${inferRelationshipReason(selectedClause, clause)}\nAI建议：修改当前条款时，应同步检查该关联条款是否需要调整定义、引用范围、例外事项、终止后义务或违约后果。`,
      })),
  ];

  const playbooks = state.playbooks.filter((item) => item.type === selectedClause.type && item.reviewStatus !== "disabled");
  groups.playbook = [
    ...playbooks.flatMap((item) =>
      [
        {
          title: `同类条款口径｜标准版本`,
          body: item.standard,
          meta: `${item.type}｜${item.ourRole}｜标准口径\nAI分析：该口径可作为当前条款的基准版本，用于判断当前版本是否偏离公司过往立场。`,
        },
        {
          title: `同类条款口径｜备选版本`,
          body: item.fallback,
          meta: `让步口径｜${item.negotiation}\nAI建议：如对方强势或交易推进优先，可考虑以备选版本作为让步方案，但应保留核心底线。`,
        },
        item.forbidden
          ? {
              title: `同类条款口径｜禁用版本`,
              body: item.forbidden,
              meta: "禁用口径\nAI建议：如当前合同出现类似表达，应优先删除、替换或记录管理层接受原因。",
            }
          : null,
      ].filter(Boolean)
    ),
    ...buildHistoricalPracticeReferences(contract, selectedClause, currentText),
  ];
  groups.recommendations = buildKnowledgeRecommendations(contract, selectedClause, playbooks);

  return groups;
}

function buildClauseReferenceInfo(selectedClause, currentClauses) {
  const selectedNumber = selectedClause.originalNumber || selectedClause.number || parseClauseNumberFromText(selectedClause.title) || parseClauseNumberFromText(selectedClause.text);
  const selectedReference = selectedNumber ? `第${numberToChinese(selectedNumber)}条` : "";
  const byNumber = new Map(
    currentClauses
      .map((clause) => [clause.originalNumber || clause.number || parseClauseNumberFromText(clause.title) || parseClauseNumberFromText(clause.text), clause])
      .filter(([number]) => Number(number) > 0)
  );
  const outgoing = findClauseReferences(selectedClause.text).map((reference) => {
    const number = parseClauseNumberFromText(reference);
    return { reference, clause: byNumber.get(number) || null };
  });
  const incoming = selectedReference
    ? currentClauses
        .filter((clause) => clause.id !== selectedClause.id && clause.id !== selectedClause.parentId)
        .filter((clause) => findClauseReferences(clause.text).includes(selectedReference))
        .map((clause) => ({ reference: selectedReference, clause }))
    : [];
  return {
    outgoing,
    incoming,
    invalid: outgoing.filter((item) => !item.clause).map((item) => item.reference),
  };
}

function summarizeHistoricalClauseChange(oldText, newText) {
  const oldSource = normalizeTextForDiff(oldText);
  const newSource = normalizeTextForDiff(newText);
  if (!oldSource || !newSource) return "缺少可比较文本";
  if (oldSource === newSource) return "基本一致";
  const tags = [];
  if (newSource.length > oldSource.length * 1.18) tags.push("当前版本明显扩充");
  if (newSource.length < oldSource.length * 0.82) tags.push("当前版本明显删减");
  [
    ["责任", /赔偿|责任|上限|免责/],
    ["数据/个人信息", /数据|个人信息|隐私|训练|模型/],
    ["终止", /终止|解除|期限|到期/],
    ["付款", /付款|费用|发票|账期/],
    ["知识产权", /知识产权|成果|软件|算法|模型/],
  ].forEach(([label, pattern]) => {
    const oldHas = pattern.test(oldSource);
    const newHas = pattern.test(newSource);
    if (!oldHas && newHas) tags.push(`新增${label}相关表达`);
    if (oldHas && !newHas) tags.push(`删除${label}相关表达`);
  });
  if (/不得|禁止|书面同意|仅限|除外/.test(newSource) && !/不得|禁止|书面同意|仅限|除外/.test(oldSource)) tags.push("当前版本限制更明确");
  if (!/不得|禁止|书面同意|仅限|除外/.test(newSource) && /不得|禁止|书面同意|仅限|除外/.test(oldSource)) tags.push("当前版本限制被弱化");
  return tags.slice(0, 4).join("；") || "存在文字变化，建议查看红线差异";
}

function normalizeTextForDiff(text) {
  return String(text || "").replace(/\s+/g, "");
}

function buildKnowledgeRecommendations(contract, selectedClause, playbooks) {
  const recommendations = [];
  playbooks.forEach((item) => {
    if (item.standard) {
      recommendations.push({
        title: `推荐标准口径｜可信度 ${item.confidenceScore || inferPlaybookConfidence(item) || 0}`,
        body: item.standard,
        meta: `${item.type}｜${item.ourRole}\n推荐理由：该口径来自终稿沉淀，可作为当前条款的优先基准。`,
      });
    }
    (item.variants || []).slice(0, 2).forEach((variant) => {
      recommendations.push({
        title: `候选让步版本｜${variant.contractName || "历史终稿"}`,
        body: variant.text,
        meta: `${variant.note || "候选口径"}\n推荐理由：当前条款谈判空间较大时，可作为备选方案，但需确认是否适用本交易。`,
      });
    });
    (item.knowledgeSignals || []).slice(0, 2).forEach((signal) => {
      recommendations.push({
        title: `AI反馈信号｜${signal.status}`,
        body: signal.note || signal.title,
        meta: `${signal.actionType || ""}\n推荐理由：该反馈反映历史上 AI 建议被采纳/拒绝的处理结果，可帮助判断是否沿用。`,
      });
    });
  });
  const counterparty = state.counterparties.find((item) => item.id === contract.counterpartyId);
  if (counterparty?.notes) {
    recommendations.push({
      title: `相对方偏好｜${counterparty.name}`,
      body: counterparty.notes,
      meta: "推荐理由：同一相对方的历史关注点应优先作为谈判策略输入。",
    });
  }
  getActiveRiskRules(selectedClause.type).slice(0, 3).forEach((rule) => {
    recommendations.push({
      title: `风险规则｜${rule.title}`,
      body: rule.suggestion,
      meta: `${rule.severity}｜${rule.source || "规则库"}\n推荐理由：该规则可用于快速判断当前条款是否存在高频风险。`,
    });
  });
  return recommendations;
}

function findHistoricalClauseMatch(selectedClause, historyClauses, currentText) {
  if (isSelectedSubclause(selectedClause)) {
    return findHistoricalSubclauseMatch(selectedClause, historyClauses);
  }
  const selectedNumber = parseClauseNumberFromText(selectedClause.title) || parseClauseNumberFromText(selectedClause.text);
  if (selectedNumber) {
    const numbered = historyClauses.find((clause) => (clause.originalNumber || parseClauseNumberFromText(clause.title) || parseClauseNumberFromText(clause.text)) === selectedNumber);
    if (numbered) return numbered;
  }
  const sameTitle = historyClauses.find((clause) => normalizeClauseTitle(clause.title) === normalizeClauseTitle(selectedClause.title));
  if (sameTitle) return sameTitle;
  return historyClauses.find((clause) => clause.type === selectedClause.type && hasSharedKeywords(clause.text, currentText));
}

function findHistoricalSubclauseMatch(selectedClause, historyClauses) {
  const selectedPrefix = getLeadingSubclauseNumber(selectedClause.text);
  const selectedParentNumber = selectedPrefix ? Number(selectedPrefix.split(".")[0]) : null;
  const selectedSubIndex = getSelectedSubclauseIndex(selectedClause);
  const likelyParents = selectedParentNumber
    ? historyClauses.filter((clause) => (clause.originalNumber || parseClauseNumberFromText(clause.title) || parseClauseNumberFromText(clause.text)) === selectedParentNumber)
    : historyClauses;

  for (const parent of likelyParents) {
    const subclauses = splitSubclauses(parent);
    const exactByNumber = selectedPrefix ? subclauses.find((subclause) => getLeadingSubclauseNumber(subclause.text) === selectedPrefix) : null;
    if (exactByNumber) return withHistoricalSubclauseTitle(parent, exactByNumber);
    const exactByIndex = selectedSubIndex ? subclauses[selectedSubIndex - 1] : null;
    if (exactByIndex) return withHistoricalSubclauseTitle(parent, exactByIndex);
  }

  if (selectedPrefix) {
    for (const parent of historyClauses) {
      const subclause = splitSubclauses(parent).find((item) => getLeadingSubclauseNumber(item.text) === selectedPrefix);
      if (subclause) return withHistoricalSubclauseTitle(parent, subclause);
    }
  }

  const selectedTitle = normalizeClauseTitle(selectedClause.title);
  if (selectedTitle) {
    for (const parent of historyClauses) {
      const subclause = splitSubclauses(parent).find((item) => normalizeClauseTitle(item.title) === selectedTitle);
      if (subclause) return withHistoricalSubclauseTitle(parent, subclause);
    }
  }
  return null;
}

function withHistoricalSubclauseTitle(parent, subclause) {
  return {
    ...subclause,
    title: subclause.title || `${parent.title}｜${getLeadingSubclauseNumber(subclause.text) || "小条款"}`,
    parentTitle: parent.title,
  };
}

function buildHistoricalPracticeReferences(contract, selectedClause, currentText) {
  const references = [];
  state.contracts
    .filter((item) => item.id !== contract.id)
    .forEach((item) => {
      const clauses = state.clauses.filter((clause) => clause.contractId === item.id && clause.type === selectedClause.type);
      clauses.slice(0, 2).forEach((clause) => {
        references.push({
          title: `同类合同历史做法｜${item.name}`,
          body: clause.text.slice(0, 420),
          meta: `${item.type}｜${item.counterpartyName}\nAI分析：该表达来自同类合同，可用于比较当前条款在义务范围、责任后果和例外设置上的差异。\nAI建议：如当前版本明显偏离，应记录偏离原因或业务审批结论。`,
        });
      });
    });

  state.contracts
    .filter((item) => item.id !== contract.id && item.counterpartyId === contract.counterpartyId)
    .forEach((item) => {
      state.clauses
        .filter((clause) => clause.contractId === item.id && clause.type === selectedClause.type)
        .slice(0, 2)
        .forEach((clause) => {
          references.push({
            title: `同一相对方历史做法｜${item.name}`,
            body: clause.text.slice(0, 420),
            meta: `${item.counterpartyName}\nAI分析：该表达体现同一相对方过往可接受口径。\nAI建议：谈判时可优先引用该历史口径，要求对方说明本次偏离原因。`,
          });
        });
    });

  const accepted = state.updates
    .filter((update) => update.knowledgeEligible && update.contractId !== contract.id)
    .flatMap((update) => splitClauses(update.acceptedText || update.versionText || "", update.contractId).filter((clause) => clause.type === selectedClause.type));
  accepted.slice(0, 3).forEach((clause) => {
    references.push({
      title: "被接受的历史表达",
      body: clause.text.slice(0, 420),
      meta: "来源：历史终稿\nAI分析：该表达已经在历史交易中被接受，可作为当前谈判的优先口径。",
    });
  });

  const rejected = state.updates
    .filter((update) => update.rejectedText)
    .flatMap((update) => splitClauses(update.rejectedText || "", update.contractId).filter((clause) => clause.type === selectedClause.type));
  rejected.slice(0, 3).forEach((clause) => {
    references.push({
      title: "被拒绝或被替换的历史表达",
      body: clause.text.slice(0, 420),
      meta: "来源：红线稿拒绝修订版本\nAI分析：该表达曾被后续版本替换，使用前应确认当时被拒绝的商业或法律原因。",
    });
  });

  const actionReasons = Object.values(state.clauseActions || {})
    .filter((action) => action.comment && action.editedText)
    .slice(0, 3);
  actionReasons.forEach((action) => {
    references.push({
      title: "偏离历史口径的原因记录",
      body: action.comment,
      meta: `当前条款关键词匹配度：${hasSharedKeywords(action.editedText || "", currentText) ? "较高" : "待复核"}\nAI建议：如沿用该偏离，应在本次审阅结论中继续保留理由。`,
    });
  });

  return references;
}

function renderClauseIndexTabs(groups) {
  return `
    <div class="reader-tabs" role="tablist" aria-label="条款索引">
      <button class="reader-tab active" type="button" data-index-tab="history">本条款历史版本</button>
      <button class="reader-tab" type="button" data-index-tab="related">本合同关联条款</button>
      <button class="reader-tab" type="button" data-index-tab="playbook">同类条款口径</button>
      <button class="reader-tab" type="button" data-index-tab="recommendations">知识推荐</button>
    </div>
    <section class="reader-pane active" data-index-pane="history">
      <div class="reference-list">${groups.history.map(referenceItem).join("") || `<div class="empty">暂无本条款历史版本</div>`}</div>
    </section>
    <section class="reader-pane" data-index-pane="related">
      <div class="reference-list">${groups.related.map(referenceItem).join("") || `<div class="empty">暂无明确引用、被引用或定义关系</div>`}</div>
    </section>
    <section class="reader-pane" data-index-pane="playbook">
      <div class="reference-list">${groups.playbook.map(referenceItem).join("") || `<div class="empty">暂无同类条款库口径</div>`}</div>
    </section>
    <section class="reader-pane" data-index-pane="recommendations">
      <div class="reference-list">${groups.recommendations.map(referenceItem).join("") || `<div class="empty">暂无可推荐知识</div>`}</div>
    </section>
  `;
}

function normalizeClauseTitle(title) {
  return String(title || "").replace(/^第[一二三四五六七八九十百0-9]+条\s*/, "").trim();
}

function isSelectedSubclause(clause) {
  return String(clause?.id || "").includes("::sub-") || Boolean(clause?.parentId) || /^\s*\d+(?:\.\d+)+/.test(String(clause?.text || ""));
}

function getLeadingSubclauseNumber(text) {
  return String(text || "").trim().match(/^(\d+(?:\.\d+)+)\b/)?.[1] || "";
}

function parseClauseNumberFromText(text) {
  const source = String(text || "").trim();
  const decimal = source.match(/^(\d+)(?:\.\d+)+\b/);
  if (decimal) return Number(decimal[1]);
  const article = source.match(/^第([一二三四五六七八九十百零〇两0-9]+)条/);
  if (!article) return null;
  if (/^\d+$/.test(article[1])) return Number(article[1]);
  return chineseNumberToArabic(article[1]);
}

function getSelectedSubclauseIndex(clause) {
  const fromStableId = String(clause?.stableId || "").match(/::sub-(\d+)$/)?.[1];
  if (fromStableId) return Number(fromStableId);
  const fromId = String(clause?.id || "").match(/::sub-(\d+)$/)?.[1];
  if (fromId) return Number(fromId);
  const prefix = getLeadingSubclauseNumber(clause?.text);
  return prefix ? Number(prefix.split(".").at(-1)) : null;
}

function chineseNumberToArabic(text) {
  const source = String(text || "");
  if (/^\d+$/.test(source)) return Number(source);
  const digits = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (source === "十") return 10;
  if (source.includes("百")) {
    const [hundredsText, restText = ""] = source.split("百");
    return (digits[hundredsText] || 1) * 100 + chineseNumberToArabic(restText || "零");
  }
  if (source.includes("十")) {
    const [tensText, onesText = ""] = source.split("十");
    return (tensText ? digits[tensText] || 0 : 1) * 10 + (onesText ? digits[onesText] || 0 : 0);
  }
  return digits[source] ?? null;
}

function hasSharedKeywords(a, b) {
  const keywords = ["数据", "模型", "个人信息", "付款", "验收", "知识产权", "保密", "赔偿", "责任", "终止", "争议", "通知"];
  return keywords.some((keyword) => a.includes(keyword) && b.includes(keyword));
}

function findClauseReferences(text) {
  const matches = text.match(/第[一二三四五六七八九十百0-9]+条/g) || [];
  return [...new Set(matches)];
}

function findTightlyRelatedClauses(selectedClause, currentClauses) {
  const selectedRefs = findClauseReferences(selectedClause.text);
  const definitionParent = isDefinitionParentClause(selectedClause);
  const definitionSubclause = isDefinitionSubclause(selectedClause);
  const definedTerms = definitionParent ? [] : extractDefinedTerms(selectedClause.text).filter((term) => shouldUseDefinitionTerm(term, selectedClause, currentClauses));
  return currentClauses.filter((clause) => {
    if (clause.id === selectedClause.id) return false;
    if (definitionSubclause && clause.id === selectedClause.parentId) return false;
    const clauseRef = `第${numberToChinese(clause.number)}条`;
    const selectedRef = `第${numberToChinese(selectedClause.number)}条`;
    const explicitForward = selectedRefs.includes(clauseRef) || selectedClause.text.includes(clause.title);
    const explicitBackward = findClauseReferences(clause.text).includes(selectedRef) || clause.text.includes(selectedClause.title);
    const definitionLink = definedTerms.some((term) => term.length >= 2 && clause.text.includes(term));
    return explicitForward || explicitBackward || definitionLink;
  });
}

function isDefinitionParentClause(clause) {
  const title = normalizeClauseTitle(clause.title);
  if (clause.id?.includes("::sub-")) return false;
  return /^(定义|释义|术语|解释)$/.test(title) || /定义|释义|术语/.test(title);
}

function isDefinitionSubclause(clause) {
  if (!clause.id?.includes("::sub-")) return false;
  return extractDefinedTerms(clause.text).length > 0;
}

function shouldUseDefinitionTerm(term, selectedClause, currentClauses) {
  const normalized = String(term || "").trim();
  if (normalized.length < 2 || normalized.length > 20) return false;
  const matchedClauses = currentClauses.filter((clause) => clause.id !== selectedClause.id && clause.id !== selectedClause.parentId && String(clause.text || "").includes(normalized));
  const totalOccurrences = matchedClauses.reduce((sum, clause) => sum + countOccurrences(clause.text, normalized), 0);
  return matchedClauses.length <= 4 && totalOccurrences <= 8;
}

function countOccurrences(text, term) {
  if (!term) return 0;
  return String(text || "").split(term).length - 1;
}

function extractDefinedTerms(text) {
  const terms = [];
  const quoteMatches = text.match(/[“"「『](.{2,20}?)[”"」』]/g) || [];
  quoteMatches.forEach((match) => terms.push(match.replace(/[“”"「」『』]/g, "")));
  const meansMatches = [...text.matchAll(/(.{2,16}?)(?:是指|指|定义为)/g)];
  meansMatches.forEach((match) => terms.push(match[1].replace(/[，。；：\s]/g, "")));
  return [...new Set(terms)].filter(Boolean);
}

function inferRelationshipReason(selectedClause, relatedClause) {
  const selectedRef = `第${numberToChinese(selectedClause.number)}条`;
  const relatedRef = `第${numberToChinese(relatedClause.number)}条`;
  if (selectedClause.text.includes(relatedRef) || selectedClause.text.includes(relatedClause.title)) return "当前条款明确引用该条款，修改时需同步检查引用范围和法律效果。";
  if (relatedClause.text.includes(selectedRef) || relatedClause.text.includes(selectedClause.title)) return "该条款明确引用当前条款，当前条款修改可能影响其适用前提或责任边界。";
  return "该条款与当前条款存在定义或概念承接关系，建议联动检查用语一致性和例外范围。";
}

function buildFocusedClauseAnalysisRequirements(contract, clause, clauses, userRequest = "") {
  const related = buildClauseReferenceInfo(clause, clauses);
  const relatedSummary = [
    ...related.outgoing.map((item) => `当前条款引用 ${item.reference}：${item.clause?.title || "未找到"}`),
    ...related.incoming.map((item) => `被 ${item.clause.title} 引用`),
  ].join("\n");
  return [
    "请只对下列目标条款做条款级 AI/Legal Skill 深度分析，不要泛泛分析整份合同。",
    `目标 clauseId 必须原样返回为：${clause.id}`,
    `目标条款类型：${clause.type || "未识别"}`,
    `目标条款标题：${clause.title || "无标题条款"}`,
    "目标条款正文：",
    clause.text,
    "",
    userRequest ? `用户本次具体要求：${userRequest}` : "用户本次具体要求：从我方立场生成可落地修改建议。",
    "",
    "输出要求：",
    "1. response.clauseAnalyses 只返回针对该 clauseId 的建议，clauseId 必须匹配目标 ID。",
    "2. 必须给出可直接采纳进合同的 proposedRevision 或 replacementText，不要只说原则。",
    "3. 如果用户要求更有利于甲方，先判断我方是否为甲方；如不确定，必须说明假设并给出甲方友好版本。",
    "4. 必须写清 negotiationBottomLine、acceptableFallback、businessDecision、linkedClauseIds、qualityScore。",
    "5. 如建议影响其他条款，应在 linkedClauseIds 填入对应条款 ID，并说明联动原因。",
    relatedSummary ? `本条款关系上下文：\n${relatedSummary}` : "本条款关系上下文：未识别到显式引用关系。",
    `合同类型：${contract.type || "待识别"}；我方角色：${contract.ourRole || "待识别"}；相对方：${contract.counterpartyName || "待识别"}。`,
    contract.businessBackground ? `交易背景：${contract.businessBackground}` : "",
  ].filter(Boolean).join("\n");
}
