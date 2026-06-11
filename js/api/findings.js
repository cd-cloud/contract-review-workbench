function getStoredSkillFindings(contract, clauses = []) {
  const result = getStoredSkillResult(contract.id);
  if (!result?.clauseAnalyses?.length && !result?.contractLevelRisks?.length) return [];
  const sourceKey = inferFindingSourceKey(clauses, contract.id);
  const byId = new Map(clauses.map((clause) => [clause.id, clause]));
  clauses.forEach((clause) => {
    if (clause.stableId) byId.set(clause.stableId, clause);
  });
  const byTitle = new Map(clauses.map((clause) => [normalizeClauseTitle(clause.title), clause]));
  const matchedClauseIds = new Set();
  const clauseFindings = (result.clauseAnalyses || []).map((item) => {
    const placement = resolveSkillClausePlacement(item, clauses, byId, byTitle);
    const clause = placement.clause;
    if (clause?.id) matchedClauseIds.add(clause.id);
    return {
      id: buildSkillFindingStableId(contract.id, item, "clause"),
      contractId: contract.id,
      sourceKey,
      clauseId: clause?.id || item.clauseId || null,
      originalClauseId: item.clauseId || item.targetClauseId || "",
      placementMethod: placement.method,
      placementConfidence: placement.confidence,
      placementWarning: placement.relocated ? `建议已从 ${placement.originalClauseId || "未指定条款"} 重新匹配到 ${clause?.title || clause?.id || "当前条款"}` : "",
      title: item.title || item.issue || "Skill 条款风险",
      severity: normalizeSeverity(item.severity),
      actionType: normalizeClauseActionType(item.actionType, item),
      issue: item.issue || item.summary || "",
      consequence: item.consequence || "",
      fix: item.replacementText || item.proposedRevision || item.fix || item.suggestion || item.commentText || "",
      fallbackText: item.fallbackText || item.replacementText || "",
      negotiation: item.negotiationPosition || item.negotiation || "",
      needsBusiness: Boolean(item.businessDecision),
      targetText: item.targetText || "",
      commentText: item.commentText || "",
      adoptionNote: item.adoptionNote || "",
      negotiationBottomLine: item.negotiationBottomLine || "",
      acceptableFallback: item.acceptableFallback || item.fallbackText || "",
      linkedClauseIds: item.linkedClauseIds || [],
      qualityScore: item.qualityScore ?? null,
      needsManagement: normalizeSeverity(item.severity) === "high",
      status: "待处理",
    };
  });
  const contractFindings = (result.contractLevelRisks || []).map((item) => {
    const placement = resolveContractRiskTargetPlacement(item, clauses, byId, byTitle);
    const targetClause = placement.clause;
    const isTargetedAddClause = targetClause && item.actionType !== "comment_only";
    return {
      id: buildSkillFindingStableId(contract.id, item, isTargetedAddClause ? "contract-routed" : "contract"),
      contractId: contract.id,
      sourceKey,
      clauseId: targetClause?.id || null,
      originalClauseId: (item.linkedClauseIds || [])[0] || item.targetClauseId || "",
      placementMethod: placement.method,
      placementConfidence: placement.confidence,
      placementWarning: placement.relocated ? `合同级建议已重新归入 ${targetClause?.title || targetClause?.id || "当前条款"}` : "",
      title: item.title || item.issue || "Skill 合同级风险",
      severity: normalizeSeverity(item.severity),
      actionType: isTargetedAddClause ? "add_clause" : item.actionType === "comment_only" ? "comment_only" : "add_clause",
      issue: item.issue || item.summary || "",
      consequence: item.consequence || "",
      fix: item.proposedClauseText || item.fix || item.suggestion || item.proposedRevision || "",
      negotiation: item.negotiation || "",
      proposedClauseText: item.proposedClauseText || "",
      targetInsertPosition: item.targetInsertPosition || "",
      adoptionNote: item.adoptionNote || "",
      negotiationBottomLine: item.negotiationBottomLine || "",
      acceptableFallback: item.acceptableFallback || "",
      linkedClauseIds: item.linkedClauseIds || [],
      qualityScore: item.qualityScore ?? null,
      needsBusiness: true,
      needsManagement: normalizeSeverity(item.severity) === "high",
      status: "待处理",
      routedFromContractRisk: Boolean(targetClause),
    };
  });
  return dedupeSkillFindings([...contractFindings, ...clauseFindings]);
}

function dedupeSkillFindings(findings = []) {
  const grouped = new Map();
  findings.forEach((finding) => {
    const key = buildSkillFindingDedupKey(finding);
    const previous = grouped.get(key);
    if (!previous || skillFindingPlacementScore(finding) > skillFindingPlacementScore(previous)) grouped.set(key, finding);
  });
  return [...grouped.values()];
}

function buildSkillFindingStableId(contractId, item = {}, scope = "clause") {
  const source = [
    contractId,
    scope,
    item.id,
    item.clauseId,
    item.targetClauseId,
    item.title,
    item.issue,
    item.proposedRevision,
    item.replacementText,
    item.proposedClauseText,
    item.fix,
    item.suggestion,
    item.targetInsertPosition,
  ]
    .filter(Boolean)
    .join("|");
  return `skill-finding-${hashStableText(normalizeText(source).slice(0, 800))}`;
}

function hashStableText(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function skillFindingPlacementScore(finding = {}) {
  let score = 0;
  if (finding.clauseId) score += 50;
  if (finding.routedFromContractRisk) score += 20;
  if (finding.targetInsertPosition) score += 8;
  if ((finding.linkedClauseIds || []).length) score += 8;
  score += riskRank(finding.severity || "low");
  score += Math.min(Number(finding.qualityScore) || 0, 100) / 100;
  return score;
}

function normalizeClauseActionType(value, item = {}) {
  const explicit = String(value || "");
  if (["replace_clause", "revise_clause", "delete_clause", "comment_only"].includes(explicit)) return explicit;
  const source = `${item.title || ""}\n${item.issue || ""}\n${item.proposedRevision || item.fix || item.suggestion || ""}`;
  if (/删除|删去|移除|不建议保留/.test(source)) return "delete_clause";
  if (/替换为|修改为|改为|全文替换/.test(source)) return "replace_clause";
  if (!String(item.proposedRevision || item.fix || item.suggestion || "").trim()) return "comment_only";
  return "revise_clause";
}

function matchSkillClause(item, clauses, byId, byTitle) {
  return resolveSkillClausePlacement(item, clauses, byId, byTitle).clause;
}

function resolveSkillClausePlacement(item, clauses, byId, byTitle) {
  if (!item || !clauses.length) return emptyClausePlacement();
  const direct = byId.get(item.clauseId) || byId.get(item.targetClauseId);
  const numbered = matchClauseByExplicitNumber(item, clauses);
  if (numbered && (!direct || numbered.id !== direct.id)) {
    return buildClausePlacement(numbered, "explicit-number", 0.98, item, direct);
  }

  const title = item.title || item.clauseTitle || "";
  const titleMatch = byTitle.get(normalizeClauseTitle(title));
  const best = findBestSkillClause(item, clauses);
  if (direct) {
    const directScore = scoreSkillClausePlacement(item, direct);
    const bestIsDifferent = best.clause && best.clause.id !== direct.id;
    if (bestIsDifferent && best.score >= 0.62 && best.score >= directScore + 0.18) {
      return buildClausePlacement(best.clause, "semantic-reroute", best.score, item, direct);
    }
    return buildClausePlacement(direct, "agent-id-verified", Math.max(directScore, best.clause?.id === direct.id ? best.score : 0.45), item);
  }
  if (numbered) return buildClausePlacement(numbered, "explicit-number", 0.98, item);
  if (titleMatch) return buildClausePlacement(titleMatch, "title", Math.max(0.72, scoreSkillClausePlacement(item, titleMatch)), item);
  if (best.clause && best.score >= 0.38) return buildClausePlacement(best.clause, "semantic", best.score, item);
  return emptyClausePlacement();
}

function emptyClausePlacement() {
  return { clause: null, method: "unmatched", confidence: 0, relocated: false, originalClauseId: "" };
}

function buildClausePlacement(clause, method, confidence, item = {}, originalClause = null) {
  return {
    clause,
    method,
    confidence: Number(Math.max(0, Math.min(1, confidence || 0)).toFixed(2)),
    relocated: Boolean(originalClause && clause && originalClause.id !== clause.id),
    originalClauseId: originalClause?.id || item.clauseId || item.targetClauseId || "",
  };
}

function findBestSkillClause(item, clauses) {
  let best = { clause: null, score: 0 };
  clauses.forEach((clause) => {
    const score = scoreSkillClausePlacement(item, clause);
    if (score > best.score) best = { clause, score };
  });
  return best;
}

function scoreSkillClausePlacement(item, clause) {
  if (!item || !clause) return 0;
  const source = buildSkillPlacementText(item);
  const title = item.title || item.clauseTitle || "";
  let score = clauseMatchScore(source, title, item.clauseType, clause);
  const targetText = normalizeText(item.targetText || "");
  const clauseText = normalizeText(`${clause.title || ""}\n${clause.text || ""}`);
  if (targetText && clauseText.includes(targetText.slice(0, Math.min(targetText.length, 160)))) score += 0.72;
  if (source.includes(clause.id) || (clause.stableId && source.includes(clause.stableId))) score += 0.15;
  const explicitNumbers = extractClauseNumberRefs(source);
  const clauseNumbers = getClauseNumberRefs(clause);
  if (explicitNumbers.length && clauseNumbers.some((number) => explicitNumbers.includes(number))) score += 0.55;
  if (explicitNumbers.length && !clauseNumbers.some((number) => explicitNumbers.includes(number))) score -= 0.25;
  const normalizedTitle = normalizeClauseTitle(clause.title);
  if (normalizedTitle && normalizeText(source).includes(normalizedTitle)) score += 0.25;
  if (clause.chapterTitle && normalizeText(source).includes(normalizeText(clause.chapterTitle))) score += 0.12;
  score += scoreDocumentRegionContext(source, clause);
  if (item.clauseType && clause.type && String(item.clauseType).includes(clause.type)) score += 0.1;
  return Math.max(0, Math.min(1, score));
}

function buildSkillPlacementText(item = {}) {
  return [
    item.clauseId,
    item.targetClauseId,
    item.clauseTitle,
    item.title,
    item.targetText,
    item.issue,
    item.summary,
    item.proposedRevision,
    item.replacementText,
    item.proposedClauseText,
    item.fix,
    item.suggestion,
    item.commentText,
    item.targetInsertPosition,
    ...(item.linkedClauseIds || []),
  ]
    .filter(Boolean)
    .join("\n");
}

function matchClauseByExplicitNumber(item, clauses) {
  const source = [
    item.clauseId,
    item.targetClauseId,
    item.clauseTitle,
    item.title,
    item.targetText,
    item.issue,
    item.summary,
    item.proposedRevision,
    item.replacementText,
    item.proposedClauseText,
    item.fix,
    item.suggestion,
    item.commentText,
    item.targetInsertPosition,
    ...(item.linkedClauseIds || []),
  ].filter(Boolean).join("\n");
  const numbers = extractClauseNumberRefs(source);
  if (!numbers.length) return null;
  const candidates = clauses.filter((clause) => getClauseNumberRefs(clause).some((number) => numbers.includes(number)));
  if (candidates.length <= 1) return candidates[0] || null;
  const ranked = candidates
    .map((clause) => ({ clause, score: scoreNumberedClauseContext(source, clause) + scoreSkillClausePlacement(item, clause) }))
    .sort((a, b) => b.score - a.score);
  if (!ranked.length || ranked[0].score < 0.12) return null;
  if (ranked[1] && ranked[0].score - ranked[1].score < 0.12) return null;
  return ranked[0].clause;
}

function matchContractRiskTargetClause(item, clauses, byId, byTitle) {
  return resolveContractRiskTargetPlacement(item, clauses, byId, byTitle).clause;
}

function resolveContractRiskTargetPlacement(item, clauses, byId, byTitle) {
  if (!item || !clauses.length) return emptyClausePlacement();
  const linked = (item.linkedClauseIds || [])
    .map((id) => byId.get(id))
    .find(Boolean);
  const targetText = buildContractRiskTargetText(item);
  const numbered = matchClauseByExplicitNumber({ ...item, targetText }, clauses);
  if (numbered && (!linked || numbered.id !== linked.id)) {
    return buildClausePlacement(numbered, "explicit-number", 0.98, item, linked);
  }

  const directTitle = byTitle.get(normalizeClauseTitle(item.targetInsertPosition || item.title || ""));
  const suggestedType = normalizeSuggestedClauseType(`${item.title || ""}\n${item.issue || ""}\n${item.suggestion || ""}\n${item.proposedClauseText || ""}`);
  const best = findBestContractRiskTarget(targetText, suggestedType, clauses);
  if (linked) {
    const linkedScore = contractRiskTargetScore(targetText, suggestedType, linked);
    if (best.clause && best.clause.id !== linked.id && best.score >= 0.62 && best.score >= linkedScore + 0.18) {
      return buildClausePlacement(best.clause, "semantic-reroute", best.score, item, linked);
    }
    return buildClausePlacement(linked, "agent-linked-id-verified", Math.max(linkedScore, best.clause?.id === linked.id ? best.score : 0.45), item);
  }
  if (numbered) return buildClausePlacement(numbered, "explicit-number", 0.98, item);
  if (directTitle) return buildClausePlacement(directTitle, "title", Math.max(0.72, contractRiskTargetScore(targetText, suggestedType, directTitle)), item);
  if (best.clause && best.score >= 0.55) return buildClausePlacement(best.clause, "semantic", best.score, item);
  return emptyClausePlacement();
}

function buildContractRiskTargetText(item = {}) {
  return [
    item.targetInsertPosition,
    item.targetClauseId,
    item.title,
    item.issue,
    item.suggestion,
    item.proposedClauseText,
    item.proposedRevision,
    item.replacementText,
    item.businessRationale,
    ...(item.linkedClauseIds || []),
  ]
    .filter(Boolean)
    .join("\n");
}

function findBestContractRiskTarget(targetText, suggestedType, clauses) {
  let best = { clause: null, score: 0 };
  clauses.forEach((clause) => {
    const score = contractRiskTargetScore(targetText, suggestedType, clause);
    if (score > best.score) best = { clause, score };
  });
  return best;
}

function contractRiskTargetScore(targetText, suggestedType, clause) {
  const source = String(targetText || "");
  let score = 0;
  if (!source.trim()) return 0;
  if (source.includes(clause.id) || (clause.stableId && source.includes(clause.stableId))) score += 1;
  const explicitNumbers = extractClauseNumberRefs(source);
  const clauseNumbers = [
    clause.originalNumberText,
    clause.number,
    extractLeadingDecimalNumber(clause.title),
    extractLeadingDecimalNumber(clause.text),
  ].filter(Boolean).map(normalizeNumberRef);
  if (clauseNumbers.some((number) => explicitNumbers.includes(number))) score += 1.2;
  const number = clause.originalNumber || clause.number || parseClauseNumberFromText(clause.title) || parseClauseNumberFromText(clause.text);
  if (number && source.includes(`第${numberToChinese(number)}条`)) score += 0.85;
  if (number && source.includes(`第${number}条`)) score += 0.85;
  const normalizedTitle = normalizeClauseTitle(clause.title);
  if (normalizedTitle && source.includes(normalizedTitle)) score += 0.75;
  if (clause.chapterTitle && source.includes(clause.chapterTitle)) score += 0.48;
  score += scoreDocumentRegionContext(source, clause);
  if (suggestedType && suggestedType !== "其他" && clause.type === suggestedType) score += 0.46;
  if (clause.type && source.includes(clause.type)) score += 0.42;
  score += clauseMatchScore(source, itemTitleFromTargetText(source), suggestedType, clause) * 0.35;
  return score;
}

function scoreNumberedClauseContext(source, clause) {
  let score = 0;
  const normalizedSource = normalizeText(source);
  const normalizedTitle = normalizeClauseTitle(clause.title);
  const normalizedChapter = normalizeText(clause.chapterTitle || "");
  if (normalizedTitle && normalizedSource.includes(normalizedTitle)) score += 0.55;
  if (normalizedChapter && normalizedSource.includes(normalizedChapter)) score += 0.48;
  score += clauseMatchScore(source, "", "", clause) * 0.35;
  score += scoreDocumentRegionContext(source, clause);
  return score;
}

function scoreDocumentRegionContext(source, clause) {
  const sourceRegion = inferDocumentRegion(source);
  const clauseRegion = inferDocumentRegion(`${clause.chapterTitle || ""}\n${clause.title || ""}\n${String(clause.text || "").slice(0, 260)}`);
  if (!sourceRegion || !clauseRegion) return 0;
  return sourceRegion === clauseRegion ? 0.5 : -0.65;
}

function inferDocumentRegion(text) {
  const source = String(text || "");
  if (/(附件|附录|附表|appendix|schedule|exhibit|sow|statement\s+of\s+work)/i.test(source)) return "attachment";
  if (/(正文|主合同|协议正文|合同正文|main\s+agreement)/i.test(source)) return "body";
  return "";
}

function itemTitleFromTargetText(text) {
  return String(text || "").split(/\n/).find(Boolean) || "";
}

function buildSkillFindingDedupKey(finding = {}) {
  const addClause = finding.actionType === "add_clause";
  const source = [
    finding.actionType,
    finding.title,
    finding.issue,
    finding.fix || finding.proposedClauseText,
    addClause ? "" : finding.targetInsertPosition,
  ]
    .filter(Boolean)
    .join("|");
  return normalizeText(source)
    .replace(/第[一二三四五六七八九十百零〇两0-9]+条/g, "")
    .replace(/\b\d+(?:\.\d+)+\b/g, "")
    .slice(0, 260);
}

function clauseMatchScore(itemText, itemTitle, itemType, clause) {
  const titleA = tokenize(normalizeClauseTitle(itemTitle));
  const titleB = tokenize(normalizeClauseTitle(clause.title));
  const textA = tokenize(itemText);
  const textB = tokenize(`${clause.title}\n${clause.text}`);
  const titleScore = jaccard(titleA, titleB);
  const textScore = jaccard(textA, textB);
  const typeScore = itemType && clause.type && String(itemType).includes(clause.type) ? 0.25 : 0;
  return titleScore * 0.5 + textScore * 0.35 + typeScore;
}

function tokenize(text) {
  const cleaned = String(text || "")
    .toLowerCase()
    .replace(/[^\u4e00-\u9fa5a-z0-9]+/g, " ")
    .trim();
  const zh = cleaned.match(/[\u4e00-\u9fa5]{2}/g) || [];
  const words = cleaned.split(/\s+/).filter((word) => word.length >= 2);
  return new Set([...zh, ...words]);
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  a.forEach((item) => {
    if (b.has(item)) intersection += 1;
  });
  return intersection / (a.size + b.size - intersection);
}

function getAnalysisFindings(contract, clauses = []) {
  const stored = getStoredSkillFindings(contract, clauses);
  if (stored.length) return stored;
  const sourceKey = inferFindingSourceKey(clauses, contract.id);
  const persisted = (state.findings || []).filter((finding) => finding.contractId === contract.id && (!sourceKey || !finding.sourceKey || finding.sourceKey === sourceKey));
  return persisted.length ? dedupeSkillFindings(persisted) : [];
}

function applyLegalSkillResult(contract, result, clauses = []) {
  result = normalizeLegalSkillResult(result);
  state.legalSkillResults = state.legalSkillResults || {};
  state.legalSkillResults[contract.id] = {
    ...result,
    appliedAt: new Date().toISOString(),
  };
  const summary = result.response?.contractSummary || {};
  contract.type = summary.contractType || summary.contract_type || contract.type;
  contract.purpose = summary.purpose || contract.purpose;
  contract.riskLevel = normalizeSeverity(summary.riskLevel || contract.riskLevel);
  const findings = getStoredSkillFindings(contract, clauses);
  state.findings = (state.findings || []).filter((finding) => finding.contractId !== contract.id);
  if (findings.length) {
    state.findings.push(...findings);
  }
  clearAnalysisStatus(contract.id);
  contract.updatedAt = today();
  scheduleVisualQa(contract.id, "legal-review-applied", { delay: 500, force: true });
}

function applyFocusedClauseSkillResult(contract, clauseId, result) {
  result = normalizeLegalSkillResult(result);
  state.legalSkillResults = state.legalSkillResults || {};
  const previous = state.legalSkillResults[contract.id]?.response || {
    contractSummary: {},
    clauseSegmentation: [],
    contractLevelRisks: [],
    clauseAnalyses: [],
    missingFacts: [],
    businessSummary: "",
  };
  const incoming = result.response?.clauseAnalyses || [];
  state.legalSkillResults[contract.id] = {
    ...(state.legalSkillResults[contract.id] || {}),
    ...result,
    response: {
      contractSummary: {
        ...previous.contractSummary,
        ...(result.response?.contractSummary || {}),
      },
      contractLevelRisks: previous.contractLevelRisks || [],
      clauseSegmentation: (previous.clauseSegmentation || []).length ? previous.clauseSegmentation : result.response?.clauseSegmentation || [],
      clauseAnalyses: [
        ...(previous.clauseAnalyses || []).filter((item) => item.clauseId !== clauseId && item.targetClauseId !== clauseId),
        ...incoming.map((item) => ({ ...item, clauseId: item.clauseId || clauseId })),
      ],
      missingFacts: [...new Set([...(previous.missingFacts || []), ...(result.response?.missingFacts || [])])],
      businessSummary: result.response?.businessSummary || previous.businessSummary || "",
    },
    focusedClauseId: clauseId,
    appliedAt: new Date().toISOString(),
  };
  state.findings = (state.findings || []).filter((finding) => finding.contractId !== contract.id || finding.clauseId !== clauseId);
  const focusedFindings = getStoredSkillFindings(contract, [{ id: clauseId }]).filter((finding) => finding.clauseId === clauseId);
  if (focusedFindings.length) state.findings.push(...focusedFindings);
  contract.updatedAt = today();
}

function getClauseNumberRefs(clause = {}) {
  return [
    clause.originalNumberText,
    clause.number,
    clause.originalNumber,
    parseArticleNumberRef(clause.title),
    parseArticleNumberRef(clause.text),
    extractLeadingDecimalNumber(clause.title),
    extractLeadingDecimalNumber(clause.text),
  ].filter(Boolean).map(normalizeNumberRef);
}

function extractClauseNumberRefs(text) {
  const source = String(text || "");
  const decimalRefs = source.match(/\b\d+(?:\.\d+)+\b/g) || [];
  const articleRefs = [...source.matchAll(/第\s*([一二三四五六七八九十百零〇两0-9]+)\s*条/g)]
    .map((match) => parseChineseOrArabicNumber(match[1]))
    .filter(Boolean);
  const plainArticleRefs = [...source.matchAll(/(?:^|[^\d.])(\d+)\s*条/g)]
    .map((match) => match[1])
    .filter(Boolean);
  return [...new Set([...decimalRefs, ...articleRefs, ...plainArticleRefs].map(normalizeNumberRef).filter(Boolean))];
}

function parseArticleNumberRef(text) {
  const match = String(text || "").trim().match(/^第\s*([一二三四五六七八九十百零〇两0-9]+)\s*条/);
  return match ? parseChineseOrArabicNumber(match[1]) : "";
}

function parseChineseOrArabicNumber(value) {
  const source = String(value || "").replace(/\s+/g, "");
  if (!source) return "";
  if (/^\d+$/.test(source)) return source;
  const digits = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (source === "十") return "10";
  if (source.includes("百")) {
    const [hundredsText, restText = ""] = source.split("百");
    const rest = restText ? Number(parseChineseOrArabicNumber(restText)) : 0;
    return String((digits[hundredsText] || 1) * 100 + rest);
  }
  if (source.includes("十")) {
    const [tensText, onesText = ""] = source.split("十");
    return String((tensText ? digits[tensText] || 0 : 1) * 10 + (onesText ? digits[onesText] || 0 : 0));
  }
  return digits[source] === undefined ? "" : String(digits[source]);
}

function normalizeNumberRef(value) {
  const text = String(value || "").replace(/\s+/g, "");
  const decimal = text.match(/\d+(?:\.\d+)*/)?.[0] || "";
  return decimal.replace(/\.$/, "");
}
