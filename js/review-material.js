function splitSubclauses(clause) {
  const lines = String(clause.text || "").split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length <= 2) return [];
  const parentTitle = lines[0];
  const outlineGroups = buildOutlineSubclauseGroups(lines);
  const groups = outlineGroups.groups.length ? outlineGroups.groups : buildRegexSubclauseGroups(lines);
  const intro = outlineGroups.groups.length ? outlineGroups.intro : groups.intro || [];
  if (!groups.length) return [];
  const baseSubclauses = groups.map((group, index) => ({
    id: `${clause.id}::sub-${index + 1}`,
    stableId: `${clause.stableId || clause.id}::sub-${index + 1}`,
    parentId: clause.id,
    parentStableId: clause.stableId || clause.id,
    contractId: clause.contractId,
    number: index + 1,
    title: group.title,
    text: group.lines.join("\n"),
    type: clause.type,
    riskLevel: clause.riskLevel,
    outlineLevel: group.outlineLevel,
    outlineStyle: group.outlineStyle,
  }));
  const ordered = renumberSubclauses(clause, applySubclauseOrder(clause, applySubclauseMoves(clause, baseSubclauses)));
  ordered.parentTitle = parentTitle;
  ordered.parentIntro = intro;
  return ordered;
}

function buildOutlineSubclauseGroups(lines) {
  if (typeof collectOutlineMarkers !== "function") return { groups: [], intro: [] };
  const markers = collectOutlineMarkers(lines);
  if (markers.length < 2) return { groups: [], intro: [] };
  const parentMarker = markers.find((marker) => marker.index === 0);
  const parentLevel = parentMarker ? parentMarker.level : Math.min(...markers.map((marker) => marker.level)) - 1;
  const childMarkers = markers.filter((marker) => marker.index > 0 && marker.level > parentLevel);
  if (!childMarkers.length) return { groups: [], intro: [] };
  const groups = childMarkers.map((marker, position) => {
    const next = childMarkers[position + 1];
    return {
      title: extractSubclauseTitle(marker.raw),
      lines: lines.slice(marker.index, next ? next.index : lines.length),
      outlineLevel: marker.level,
      outlineStyle: marker.style,
    };
  });
  return {
    groups,
    intro: lines.slice(1, childMarkers[0].index),
  };
}

function buildRegexSubclauseGroups(lines) {
  const groups = [];
  const intro = [];
  let current = null;
  lines.slice(1).forEach((line) => {
    if (isSubclauseHeading(line)) {
      if (current) groups.push(current);
      current = { title: extractSubclauseTitle(line), lines: [line] };
      return;
    }
    if (current) current.lines.push(line);
    else intro.push(line);
  });
  if (current) groups.push(current);
  groups.intro = intro;
  return groups;
}

function isSubclauseHeading(line) {
  return /^([0-9]+(?:\.[0-9]+)+|（[一二三四五六七八九十百零〇两0-9]+）|\([0-9]+\)|[0-9]+[、.])\s*/.test(String(line || "").trim());
}

function extractSubclauseTitle(line) {
  const text = String(line || "").trim();
  {
    const marker = parseOutlineMarker(text);
    if (marker) {
      if (!isExplicitSubclauseTitle(marker.body)) return "";
      return marker.title;
    }
  }
  const match = text.match(/^([0-9]+(?:\.[0-9]+)+|（[一二三四五六七八九十百零〇两0-9]+）|\([0-9]+\)|[0-9]+[、.])\s*(.*)$/);
  if (!match) return "";
  const body = (match[2] || "").trim();
  if (!isExplicitSubclauseTitle(body)) return "";
  return `${match[1]} ${body}`.trim();
}

function isExplicitSubclauseTitle(text) {
  const body = String(text || "").trim();
  if (!body) return false;
  if (body.length > 24) return false;
  if (/^["“”‘’「」《》（(]/.test(body)) return false;
  if (/[。；;，,、]$/.test(body)) return false;
  if (/(是指|指，|指,|应当|应就|应以|应向|不得|可以|有权|同意|确认|构成|不会|违反|包括|如下|除外|前提是|为免疑义|任何一方|接收方|提供方|违约方|守约方|控制|企业|公司)/.test(body)) return false;
  return true;
}

function getContractUpdates(contractId) {
  return (state.updates || [])
    .filter((item) => item.contractId === contractId)
    .sort((a, b) => `${a.createdAt}-${a.id}`.localeCompare(`${b.createdAt}-${b.id}`));
}

function getActiveMaterial(contract) {
  const update = (state.updates || []).find((item) => item.id === state.activeUpdateId && item.contractId === contract.id);
  if (!update?.versionText) return null;
  return {
    id: update.id,
    title: `${update.type}｜${materialKindLabel(update.materialKind)}`,
    kind: update.materialKind,
    text: update.versionText,
    acceptedText: update.acceptedText,
    rejectedText: update.rejectedText,
    revisionText: update.revisionText,
    commentsText: update.commentsText,
    paragraphs: update.paragraphs || [],
    sourceType: update.sourceType || "text",
    fileName: update.fileName || "",
    knowledgeEligible: update.knowledgeEligible,
  };
}

function getLatestFeedbackDeadline(contractId) {
  const updates = getContractUpdates(contractId);
  return updates.at(-1)?.feedbackDeadline || "";
}

function hasFinalVersion(contractId) {
  return getContractUpdates(contractId).some((item) => item.type === "终稿");
}

function isDeadlineUrgent(deadline) {
  const diffDays = getDeadlineDeltaDays(deadline);
  return diffDays >= 0 && diffDays <= 1;
}

function getDeadlineDeltaDays(deadline) {
  if (!deadline) return Number.POSITIVE_INFINITY;
  const todayDate = new Date();
  const todayOnly = new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate());
  const deadlineDate = new Date(`${deadline}T00:00:00`);
  return Math.ceil((deadlineDate - todayOnly) / 86400000);
}

function getWorkbenchMaterial(contract) {
  const activeMaterial = getActiveMaterial(contract);
  const mode = state.reviewMode || "clean";
  const text = getDisplayTextForMode(contract, activeMaterial, mode);
  const sourceKey = `${contract.id}:${state.activeUpdateId || "current"}`;
  return {
    sourceKey,
    title: `${mode === "revision" ? "修订模式" : "清洁模式"}｜${activeMaterial?.title || "当前主版本"}`,
    kind: activeMaterial?.kind || "version",
    knowledgeEligible: Boolean(activeMaterial?.knowledgeEligible),
    text,
    mode,
  };
}

function getStructureWorkbenchMaterial(contract) {
  const activeMaterial = getActiveMaterial(contract);
  const text = getDisplayTextForMode(contract, activeMaterial, "clean");
  const sourceKey = `${contract.id}:${state.activeUpdateId || "current"}`;
  return {
    sourceKey,
    title: `结构概览｜${activeMaterial?.title || "当前主版本"}`,
    kind: activeMaterial?.kind || "version",
    knowledgeEligible: Boolean(activeMaterial?.knowledgeEligible),
    text,
    mode: "structure",
  };
}

function canUseRevisionMode(contract) {
  const updates = getContractUpdates(contract.id);
  return updates.length > 1 || updates.some((item) => item.materialKind === "redline") || Boolean(contract.redlineText);
}

function getDisplayTextForMode(contract, activeMaterial, mode) {
  const currentText = activeMaterial?.acceptedText || activeMaterial?.text || contract.cleanText || contract.text || "";
  if (mode !== "revision") {
    if (activeMaterial?.kind === "redline") return normalizeWordTextArtifacts(activeMaterial.acceptedText || acceptRedlineText(activeMaterial.text || ""));
    return normalizeWordTextArtifacts(currentText);
  }
  if (activeMaterial?.kind === "redline") return normalizeWordTextArtifacts(activeMaterial.revisionText || activeMaterial.text || currentText);
  if (activeMaterial?.kind === "prepared") return normalizeWordTextArtifacts(activeMaterial.revisionText || buildReadableComparisonText(activeMaterial.rejectedText || getPreviousVersionText(contract), currentText));
  const previousText = getPreviousVersionText(contract, activeMaterial?.id);
  return normalizeWordTextArtifacts(previousText ? buildReadableComparisonText(previousText, currentText) : currentText);
}

function normalizeWordTextArtifacts(text) {
  return String(text || "")
    .replace(/（([0-9一二三四五六七八九十]+)�+/g, "（$1）")
    .replace(/\(([0-9a-zA-Z]+)�+/g, "($1)")
    .replace(/([0-9一二三四五六七八九十]+)���/g, "$1）");
}

function getPreviousVersionText(contract) {
  const updates = getContractUpdates(contract.id);
  const activeIndex = updates.findIndex((item) => item.id === state.activeUpdateId);
  const previous = activeIndex > 0 ? updates[activeIndex - 1] : updates.at(-2);
  return previous?.acceptedText || (previous?.materialKind === "redline" ? acceptRedlineText(previous.versionText) : previous?.versionText) || "";
}

const clauseSplitCache = new Map();
const MAX_CLAUSE_SPLIT_CACHE = 16;

function splitVersionClauses(text, sourceKey) {
  const cacheKey = `${sourceKey}||${String(text).slice(0, 200)}||${text.length}`;
  if (clauseSplitCache.has(cacheKey)) {
    const result = clauseSplitCache.get(cacheKey);
    clauseSplitCache.delete(cacheKey);
    clauseSplitCache.set(cacheKey, result);
    return result;
  }
  const parsedClauses = getAiClauseSegmentationForSource(text, sourceKey) || splitClauses(text, sourceKey);
  const baseClauses = parsedClauses.map((clause, index) => {
    const numbered = isNumberedClauseTitle(clause.title);
    const originalNumber = numbered ? parseClauseTitleNumber(clause.title) : null;
    const originalNumberText = numbered ? parseClauseTitleNumberText(clause.title) : "";
    return {
      ...clause,
      stableId: clause.aiStableId || `base-${index + 1}`,
      originalNumber,
      originalNumberText,
      number: originalNumber || clause.number,
      unnumbered: !numbered,
      inserted: false,
    };
  });
  const clauses = applyClauseOrder(sourceKey, applyInsertedClauses(sourceKey, baseClauses));
  const renumbered = renumberClausesWithReferenceMap(clauses, sourceKey);
  const result = renumbered.map((clause) => ({
    ...clause,
    id: `${sourceKey}:${clause.stableId}`,
  }));
  if (clauseSplitCache.size >= MAX_CLAUSE_SPLIT_CACHE) {
    const firstKey = clauseSplitCache.keys().next().value;
    clauseSplitCache.delete(firstKey);
  }
  clauseSplitCache.set(cacheKey, result);
  return result;
}

function getClauseActions(sourceKey) {
  state.clauseActions = state.clauseActions || {};
  state.clauseActions[sourceKey] = state.clauseActions[sourceKey] || {};
  return state.clauseActions[sourceKey];
}

function getEditedClauseText(sourceKey, clause) {
  const action = getClauseActions(sourceKey)[clause.id];
  const editedTitle = getEditedClauseTitle(sourceKey, clause);
  if (!action?.editedText && !clause.id.includes("::sub-")) {
    const subclauses = splitSubclauses(clause);
    if (subclauses.length >= 2) {
      const subActions = getClauseActions(sourceKey);
      const hasSubActions = subclauses.some((subclause) => subActions[subclause.id]?.deleted || subActions[subclause.id]?.editedText || subActions[subclause.id]?.comment);
      if (hasSubActions) return composeClauseTextFromSubclauses(sourceKey, clause, subclauses);
    }
  }
  const text = applyEditedTitleToClauseText(action?.editedText ?? clause.text, clause.title, editedTitle);
  if (clause.id.includes("::sub-")) return rewriteSubclauseBodyReferences(text);
  return normalizeClauseTextNumbering(sourceKey, clause, rewriteSubclauseReferences(text));
}

function getEditedClauseTitle(sourceKey, clause) {
  const action = getClauseActions(sourceKey)[clause.id];
  return action?.editedTitle ?? clause.title ?? "";
}

function applyEditedTitleToClauseText(text, originalTitle, editedTitle) {
  const source = String(text || "");
  const nextTitle = String(editedTitle || "").trim();
  if (!nextTitle) return source;
  const oldTitle = String(originalTitle || "").trim();
  const lines = source.split(/\n/);
  const first = String(lines[0] || "").trim();
  if (oldTitle && normalizeEditableClauseTitleLine(first) === normalizeEditableClauseTitleLine(oldTitle)) {
    return [nextTitle, ...lines.slice(1)].join("\n");
  }
  if (normalizeEditableClauseTitleLine(first) === normalizeEditableClauseTitleLine(nextTitle)) return source;
  return [nextTitle, source].filter(Boolean).join("\n");
}

function composeEditableClauseText(title, body) {
  return [String(title || "").trim(), String(body || "").trim()].filter(Boolean).join("\n");
}

function normalizeEditableClauseTitleLine(value) {
  return String(value || "").replace(/\s+/g, "").replace(/[：:。；;，,、]$/u, "");
}

function composeClauseTextFromSubclauses(sourceKey, parentClause, subclauses = splitSubclauses(parentClause)) {
  const actions = getClauseActions(sourceKey);
  const parts = [parentClause.title, ...(subclauses.parentIntro || [])];
  subclauses.forEach((subclause) => {
    const action = actions[subclause.id] || {};
    if (action.deleted) return;
    parts.push(rewriteSubclauseBodyReferences(action.editedText || subclause.text));
  });
  return parts.filter(Boolean).join("\n");
}

function buildSubclauseRedlineDraft(sourceKey, subclauses) {
  const actions = getClauseActions(sourceKey);
  return subclauses
    .map((subclause) => {
      const action = actions[subclause.id] || {};
      if (action.deleted) return `[删除]\n${subclause.text}`;
      if (action.editedText && action.editedText !== subclause.text) return `[原文]\n${subclause.text}\n[修改为]\n${action.editedText}`;
      if (action.comment) return `${subclause.text}\n[批注] ${action.comment}`;
      return subclause.text;
    })
    .join("\n\n");
}
