function getSubclauseMoveList() {
  state.subclauseMoves = state.subclauseMoves || [];
  return state.subclauseMoves;
}

function applySubclauseMoves(parentClause, subclauses) {
  const moves = getSubclauseMoveList();
  const parentId = parentClause.id;
  const removedStableIds = new Set(moves.filter((move) => move.fromParentId === parentId && move.toParentId !== parentId).map((move) => move.stableId));
  let result = subclauses.filter((subclause) => !removedStableIds.has(subclause.stableId));
  moves
    .filter((move) => move.toParentId === parentId && move.fromParentId !== parentId)
    .forEach((move) => {
      const movedSubclause = {
        ...clone(move.snapshot),
        id: move.id,
        stableId: move.stableId,
        parentId,
        parentStableId: parentClause.stableId || parentClause.id,
        contractId: parentClause.contractId,
        moved: true,
      };
      const existingIndex = result.findIndex((subclause) => subclause.stableId === movedSubclause.stableId);
      if (existingIndex >= 0) result.splice(existingIndex, 1);
      const targetIndex = result.findIndex((subclause) => subclause.stableId === move.targetStableId || subclause.id === move.targetSubclauseId);
      result.splice(targetIndex >= 0 ? targetIndex : result.length, 0, movedSubclause);
    });
  return result.map((subclause, index) => ({ ...subclause, number: index + 1 }));
}

function renumberSubclauses(parentClause, subclauses) {
  const parentNumber = Number(parentClause.number || parentClause.originalNumber);
  const levelCounters = new Map();
  const prefixMap = new Map();
  return subclauses.map((subclause) => {
    const level = Number.isFinite(subclause.outlineLevel) ? subclause.outlineLevel : 1;
    const ordinal = (levelCounters.get(level) || 0) + 1;
    levelCounters.set(level, ordinal);
    [...levelCounters.keys()].forEach((key) => {
      if (key > level) levelCounters.delete(key);
    });
    const traceOriginalText = subclause.traceOriginalText || subclause.text;
    const rewritten = rewriteLeadingSubclauseMarker(subclause, ordinal, parentNumber, prefixMap);
    const text = rewriteSubclauseBodyReferences(rewritten.text);
    return {
      ...subclause,
      title: extractSubclauseTitle(text),
      text,
      traceOriginalText: text !== traceOriginalText ? traceOriginalText : subclause.traceOriginalText,
    };
  });
}

function rewriteLeadingSubclauseMarker(subclause, ordinal, parentNumber, prefixMap) {
  const text = String(subclause.text || "");
  const style = String(subclause.outlineStyle || "");
  const decimalMatch = text.match(/^(\d+(?:\.\d+)+)(\s*)/);
  if (decimalMatch) {
    const oldPrefix = decimalMatch[1];
    const parts = oldPrefix.split(".");
    let nextPrefix;
    if (Number.isFinite(parentNumber) && parentNumber > 0 && parts.length === 2) {
      nextPrefix = Number(parts[0]) === parentNumber ? `${parentNumber}.${ordinal}` : oldPrefix;
    } else if (parts.length === 2) {
      nextPrefix = `${parts[0]}.${ordinal}`;
    } else {
      const oldParentPrefix = parts.slice(0, -1).join(".");
      const mappedParentPrefix = prefixMap.get(oldParentPrefix);
      nextPrefix = mappedParentPrefix ? `${mappedParentPrefix}.${ordinal}` : `${parts.slice(0, -1).join(".")}.${ordinal}`;
    }
    prefixMap.set(oldPrefix, nextPrefix);
    registerSubclauseReferenceChange(text, nextPrefix);
    return { text: text.replace(/^(\d+(?:\.\d+)+)(\s*)/, `${nextPrefix}$2`) };
  }
  if (style === "arabic" || /^[0-9]{1,2}[、．.]\s*/.test(text)) {
    return { text: text.replace(/^([0-9]{1,2})([、．.]\s*)/, `${ordinal}$2`) };
  }
  if (style === "num-paren" || /^[（(][0-9]{1,2}[）)]\s*/.test(text)) {
    return { text: text.replace(/^([（(])([0-9]{1,2})([）)]\s*)/, `$1${ordinal}$3`) };
  }
  if (style === "cn-comma" || /^[一二三四五六七八九十百零〇两]+[、．.]\s*/.test(text)) {
    const cnOrdinal = ordinal === 0 ? "零" : numberToChinese(ordinal);
    return { text: text.replace(/^([一二三四五六七八九十百零〇两]+)([、．.]\s*)/, `${cnOrdinal}$2`) };
  }
  if (style === "cn-paren" || /^[（(][一二三四五六七八九十百零〇两]+[）)]\s*/.test(text)) {
    const cnOrdinal = ordinal === 0 ? "零" : numberToChinese(ordinal);
    return { text: text.replace(/^([（(])([一二三四五六七八九十百零〇两]+)([）)]\s*)/, `$1${cnOrdinal}$3`) };
  }
  return { text };
}

function getSubclauseReferenceMap() {
  state.subclauseReferenceMap = state.subclauseReferenceMap || {};
  return state.subclauseReferenceMap;
}

function registerSubclauseReferenceChange(text, nextPrefix) {
  const oldPrefix = String(text || "").trim().match(/^(\d+(?:\.\d+)+)\s*/)?.[1];
  if (!oldPrefix) return;
  const map = getSubclauseReferenceMap();
  if (oldPrefix === nextPrefix) delete map[oldPrefix];
  else map[oldPrefix] = nextPrefix;
}

function rewriteSubclauseReferences(text) {
  const map = getSubclauseReferenceMap();
  const keys = Object.keys(map).sort((a, b) => b.length - a.length);
  if (!keys.length) return text;
  const pattern = new RegExp(`(^|[^0-9.])(${keys.map(escapeRegex).join("|")})(?![0-9.])`, "g");
  return String(text || "").replace(pattern, (match, prefix, oldNumber) => `${prefix}${map[oldNumber] || oldNumber}`);
}

function rewriteSubclauseBodyReferences(text) {
  const source = String(text || "");
  const match = source.match(/^(\d+(?:\.\d+)+)(\s*)/);
  if (!match) return rewriteSubclauseReferences(source);
  return `${match[1]}${match[2]}${rewriteSubclauseReferences(source.slice(match[0].length))}`;
}

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isNumberedClauseTitle(title = "") {
  return /^(第[一二三四五六七八九十百零〇两0-9]+条|[0-9]+(?:\.[0-9]+)*[.、]?\s+)/.test(String(title).trim());
}

function getInsertedClauses(sourceKey) {
  state.insertedClauses = state.insertedClauses || {};
  state.insertedClauses[sourceKey] = state.insertedClauses[sourceKey] || [];
  return state.insertedClauses[sourceKey];
}

function getClauseOrder(sourceKey) {
  state.clauseOrder = state.clauseOrder || {};
  state.clauseOrder[sourceKey] = state.clauseOrder[sourceKey] || [];
  return state.clauseOrder[sourceKey];
}

function getSubclauseOrderKey(parentClause) {
  return parentClause.id;
}

function getSubclauseOrder(parentClause) {
  state.subclauseOrder = state.subclauseOrder || {};
  const key = getSubclauseOrderKey(parentClause);
  state.subclauseOrder[key] = state.subclauseOrder[key] || [];
  return state.subclauseOrder[key];
}

function applySubclauseOrder(parentClause, subclauses) {
  const order = getSubclauseOrder(parentClause);
  if (!order.length) return subclauses;
  const rank = new Map(order.map((stableId, index) => [stableId, index]));
  return subclauses
    .slice()
    .sort((a, b) => {
      const aRank = rank.has(a.stableId) ? rank.get(a.stableId) : Number.MAX_SAFE_INTEGER;
      const bRank = rank.has(b.stableId) ? rank.get(b.stableId) : Number.MAX_SAFE_INTEGER;
      if (aRank !== bRank) return aRank - bRank;
      return subclauses.indexOf(a) - subclauses.indexOf(b);
    });
}

function applyInsertedClauses(sourceKey, baseClauses) {
  const inserted = getInsertedClauses(sourceKey);
  let clauses = baseClauses.map((clause) => ({ ...clause, inserted: false }));
  inserted
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .forEach((item) => {
      const targetIndex = clauses.findIndex((clause) => clause.stableId === item.targetStableId || clause.id === item.targetClauseId || clause.originalNumber === item.targetOriginalNumber);
      const insertAt =
        item.position === "end" || targetIndex < 0
          ? clauses.length
          : item.position === "before"
            ? targetIndex
            : targetIndex + 1;
      clauses.splice(insertAt, 0, {
        id: item.id,
        stableId: item.id,
        contractId: sourceKey,
        number: 0,
        originalNumber: null,
        title: item.title,
        text: item.text,
        type: item.type,
        keyClause: true,
        riskLevel: "low",
        deviates: false,
        sourceKind: "inserted",
        inserted: true,
        comment: item.comment,
      });
      recordInsertionAudit(sourceKey, item, insertAt);
    });
  return clauses;
}

function applyClauseOrder(sourceKey, clauses) {
  const order = getClauseOrder(sourceKey);
  if (!order.length) return clauses;
  const rank = new Map(order.map((stableId, index) => [stableId, index]));
  return clauses
    .slice()
    .sort((a, b) => {
      const aRank = rank.has(a.stableId) ? rank.get(a.stableId) : Number.MAX_SAFE_INTEGER;
      const bRank = rank.has(b.stableId) ? rank.get(b.stableId) : Number.MAX_SAFE_INTEGER;
      if (aRank !== bRank) return aRank - bRank;
      return clauses.indexOf(a) - clauses.indexOf(b);
    });
}

function renumberClausesWithReferenceMap(clauses, sourceKey) {
  const actions = getClauseActions(sourceKey);
  const hasStructuralChanges =
    getInsertedClauses(sourceKey).length > 0 ||
    getClauseOrder(sourceKey).length > 0 ||
    clauses.some((clause) => actions[`${sourceKey}:${clause.stableId}`]?.deleted);
  if (!hasStructuralChanges) {
    setClauseNumberingMap(sourceKey, new Map());
    return clauses.map((clause) => ({
      ...clause,
      number: clause.unnumbered ? 0 : clause.originalNumber || clause.number,
    }));
  }
  const numberMap = new Map();
  let effectiveNumber = 0;
  clauses.forEach((clause) => {
    const deleted = actions[`${sourceKey}:${clause.stableId}`]?.deleted;
    if (!deleted && !clause.unnumbered) effectiveNumber += 1;
    if (clause.originalNumber && !deleted) numberMap.set(clause.originalNumber, effectiveNumber);
  });
  setClauseNumberingMap(sourceKey, numberMap);
  let displayNumber = 0;
  return clauses.map((clause) => {
    const deleted = actions[`${sourceKey}:${clause.stableId}`]?.deleted;
    if (!deleted && !clause.unnumbered) displayNumber += 1;
    const number = clause.unnumbered ? 0 : deleted ? clause.originalNumber || clause.number || displayNumber + 1 : displayNumber;
    if (clause.inserted && !clause.unnumbered) {
      return normalizeInsertedClauseNumbering({ ...clause, number }, number, numberMap);
    }
    if (deleted) {
      return {
        ...clause,
        number,
      };
    }
    return {
      ...clause,
      number,
      title: clause.unnumbered ? clause.title : rewriteClauseTitleNumber(clause.title, number),
      text: clause.unnumbered ? clause.text : rewriteClauseReferences(rewriteClauseTitleNumber(clause.text, number), numberMap),
    };
  });
}

function setClauseNumberingMap(sourceKey, numberMap) {
  state.clauseNumberMaps = state.clauseNumberMaps || {};
  state.clauseNumberMaps[sourceKey] = Object.fromEntries([...numberMap.entries()].map(([from, to]) => [String(from), to]));
}

function getClauseNumberingMap(sourceKey) {
  const raw = state.clauseNumberMaps?.[sourceKey] || {};
  return new Map(Object.entries(raw).map(([from, to]) => [Number(from), Number(to)]));
}

function normalizeClauseTextNumbering(sourceKey, clause, text) {
  if (!clause || clause.unnumbered) return text;
  const number = Number(clause.number);
  if (!Number.isFinite(number) || number <= 0) return text;
  return rewriteClauseReferences(rewriteClauseTitleNumber(text, number), getClauseNumberingMap(sourceKey));
}

function rewriteClauseReferences(text, numberMap) {
  return String(text || "").replace(/第([一二三四五六七八九十百零〇两0-9]+)条/g, (match, raw) => {
    const oldNumber = parseClauseNumber(raw);
    const newNumber = numberMap.get(oldNumber);
    if (!newNumber || oldNumber === newNumber) return match;
    return `第${numberToChinese(newNumber)}条`;
  });
}

function rewriteClauseTitleNumber(text, number) {
  const source = String(text || "");
  if (/^第[一二三四五六七八九十百零〇两0-9]+条/.test(source)) {
    return source.replace(/^第[一二三四五六七八九十百零〇两0-9]+条/, `第${numberToChinese(number)}条`);
  }
  if (/^[0-9]+[.、]\s+/.test(source)) {
    return source.replace(/^[0-9]+([.、]\s+)/, `${number}$1`);
  }
  return source;
}

function normalizeInsertedClauseNumbering(clause, number, numberMap) {
  const semanticTitle = getInsertedClauseSemanticTitle(clause);
  const numberedTitle = `第${numberToChinese(number)}条 ${semanticTitle}`;
  return {
    ...clause,
    number,
    title: numberedTitle,
    text: rewriteClauseReferences(ensureInsertedClauseBodyHasHeading(clause.text, numberedTitle, semanticTitle), numberMap),
  };
}

function getInsertedClauseSemanticTitle(clause) {
  const explicit = cleanInsertedClauseTitle(clause.title);
  if (explicit) return explicit;
  const fromBody = extractInsertedClauseTitleFromBody(clause.text);
  if (fromBody) return fromBody;
  const type = cleanInsertedClauseTitle(clause.type);
  if (type) return type.endsWith("条款") ? type : `${type}条款`;
  return "补充安排";
}

function cleanInsertedClauseTitle(title) {
  let text = String(title || "").trim();
  if (!text) return "";
  text = text
    .replace(/^第[\u4e00-\u9fa50-9]+条[：:、.\s]*/u, "")
    .replace(/^[0-9]+(?:\.[0-9]+)*[.、\s]+/u, "")
    .replace(/^(建议)?新增(条款|约定|安排)?[：:、.\s]*/u, "")
    .replace(/^补充(条款|约定|安排)?[：:、.\s]*/u, "")
    .trim();
  if (!text || /^(新增条款|建议新增条款)$/u.test(text)) return "";
  return text;
}

function extractInsertedClauseTitleFromBody(body) {
  const lines = String(body || "")
    .split(/\r?\n/)
    .map((line) => cleanInsertedClauseTitle(line))
    .filter(Boolean);
  if (!lines.length) return "";
  const first = lines[0];
  if (first.length <= 36 && !/[。；;]/u.test(first)) return first;
  const prefix = first.split(/[：:，,。；;]/u)[0]?.trim();
  return prefix && prefix.length >= 2 && prefix.length <= 24 ? prefix : "";
}

function ensureInsertedClauseBodyHasHeading(body, numberedTitle, semanticTitle) {
  const source = String(body || "").trim();
  if (!source) return numberedTitle;
  if (/^第[\u4e00-\u9fa50-9]+条/u.test(source)) {
    return mergeInsertedHeadingWithBody(numberedTitle, semanticTitle, source.replace(/^第[\u4e00-\u9fa50-9]+条[：:、.\s]*/u, ""));
  }
  if (/^[0-9]+(?:\.[0-9]+)*[.、\s]+/u.test(source)) {
    return mergeInsertedHeadingWithBody(numberedTitle, semanticTitle, source.replace(/^[0-9]+(?:\.[0-9]+)*[.、\s]+/u, ""));
  }
  const lines = source.split(/\r?\n/);
  const firstLineTitle = cleanInsertedClauseTitle(lines[0]);
  if (firstLineTitle && normalizeTextForNumbering(firstLineTitle) === normalizeTextForNumbering(semanticTitle)) {
    return [numberedTitle, ...lines.slice(1)].join("\n").trim();
  }
  if (!firstLineTitle && /^(新增|建议新增|补充)/u.test(String(lines[0] || "").trim())) {
    return [numberedTitle, ...lines.slice(1)].join("\n").trim();
  }
  return `${numberedTitle}\n${source}`;
}

function mergeInsertedHeadingWithBody(numberedTitle, semanticTitle, body) {
  const lines = String(body || "").trim().split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return numberedTitle;
  const firstLineTitle = cleanInsertedClauseTitle(lines[0]);
  if (firstLineTitle && normalizeTextForNumbering(firstLineTitle) === normalizeTextForNumbering(semanticTitle)) {
    return [numberedTitle, ...lines.slice(1)].join("\n").trim();
  }
  return [numberedTitle, ...lines].join("\n").trim();
}

function normalizeTextForNumbering(text) {
  return String(text || "").replace(/\s+/g, "");
}

function parseClauseTitleNumber(title = "") {
  const text = String(title).trim();
  const raw = text.match(/^第([一二三四五六七八九十百零〇两0-9]+)条/)?.[1];
  if (raw) return parseClauseNumber(raw);
  const numeric = text.match(/^([0-9]+)(?:\.[0-9]+)*[.、]?\s+/)?.[1];
  return numeric ? Number(numeric) : 0;
}

function parseClauseTitleNumberText(title = "") {
  return String(title).trim().match(/^(第[一二三四五六七八九十百零〇两0-9]+条|[0-9]+(?:\.[0-9]+)*[.、]?)/)?.[1] || "";
}

function parseClauseNumber(raw) {
  if (/^\d+$/.test(raw)) return Number(raw);
  const map = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  if (raw === "十") return 10;
  if (raw.includes("百")) {
    const [hundredsText, restText = ""] = raw.split("百");
    const rest = restText ? parseClauseNumber(restText) : 0;
    return (map[hundredsText] || 1) * 100 + rest;
  }
  if (raw.startsWith("十")) return 10 + (map[raw.slice(1)] || 0);
  if (raw.includes("十")) {
    const [ten, one] = raw.split("十");
    return (map[ten] || 1) * 10 + (map[one] || 0);
  }
  return map[raw] || 0;
}

function recordInsertionAudit(sourceKey, item, insertAt) {
  state.insertionAudits = state.insertionAudits || {};
  state.insertionAudits[sourceKey] = state.insertionAudits[sourceKey] || [];
  const exists = state.insertionAudits[sourceKey].some((audit) => audit.id === item.id);
  if (exists) return;
  state.insertionAudits[sourceKey].push({
    id: item.id,
    message: `已在${insertAt === 0 ? "开头" : `第${numberToChinese(insertAt)}条后`}/附近新增条款，系统已将插入位置之后的条款引用自动顺延一位；请复核交叉引用是否符合交易意图。`,
    createdAt: today(),
  });
}
