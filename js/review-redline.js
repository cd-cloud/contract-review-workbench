function renderClauseBodyWithTrace(clause, action = {}, mode = state.reviewMode || "clean") {
  const original = escapeHtml(clause.text).replaceAll("\n", "<br />");
  const comment = action.comment ? `<div class="comment-card"><strong>批注：</strong>${escapeHtml(action.comment).replaceAll("\n", "<br />")}</div>` : "";
  const deleteClass = mode === "revision" ? "reviewer-deleted" : "redline-deleted";
  const insertClass = mode === "revision" ? "reviewer-inserted" : "redline-inserted";
  const autoTraceOriginal = clause.traceOriginalText && clause.traceOriginalText !== clause.text ? clause.traceOriginalText : "";
  if (clause.inserted) {
    const insertedComment = clause.comment && !action.comment ? `<div class="comment-card"><strong>批注：</strong>${escapeHtml(clause.comment).replaceAll("\n", "<br />")}</div>` : "";
    return `<div class="${insertClass}">${original}</div>${comment || insertedComment}`;
  }
  if (action.deleted) {
    return `<div class="${deleteClass}">${original}</div>${comment}`;
  }
  if (action.editedText && action.editedText !== clause.text) {
    const effectiveEditedText = normalizeClauseTextNumbering(clause.contractId || "", clause, action.editedText);
    return `<div>${buildInlineDiffHtml(clause.text, effectiveEditedText, deleteClass, insertClass)}</div>${comment}`;
  }
  if (autoTraceOriginal) {
    return `<div>${buildInlineDiffHtml(autoTraceOriginal, clause.text, "reviewer-deleted", "reviewer-inserted")}</div>${comment}`;
  }
  return `${original}${comment}`;
}

const _redlineDraftCache = new Map();
const MAX_REDLINE_CACHE = 5;

function buildRedlineDraft(sourceKey, clauses) {
  const actions = getClauseActions(sourceKey);
  const clausesKey = clauses.map((c) => `${c.id}:${c.text?.length || 0}`).join("|");
  const actionKey = Object.keys(actions).sort().map((id) => {
    const a = actions[id];
    return `${id}:${a.deleted ? 1 : 0}:${a.editedText?.length || 0}:${a.comment?.length || 0}`;
  }).join("|");
  const cacheKey = `${sourceKey}::${clausesKey}::${actionKey}`;
  const cached = _redlineDraftCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const result = clauses
    .map((clause) => {
      const action = actions[clause.id] || {};
      const original = clause.text;
      const effectiveText = getEditedClauseText(sourceKey, clause);
      const edited = action.editedText;
      const comment = action.comment ? `\n[批注] ${action.comment}` : "";
      if (action.deleted) return `[删除]\n${original}${comment}`;
      if (edited && effectiveText !== original) return `[原文]\n${original}\n[修改为]\n${effectiveText}${comment}`;
      if (effectiveText !== original) return `[原文]\n${original}\n[修改为]\n${effectiveText}${comment}`;
      if (comment) return `${original}${comment}`;
      return original;
    })
    .join("\n\n");
  if (_redlineDraftCache.size >= MAX_REDLINE_CACHE) {
    const first = _redlineDraftCache.keys().next().value;
    _redlineDraftCache.delete(first);
  }
  _redlineDraftCache.set(cacheKey, result);
  return result;
}

function acceptRedlineText(text) {
  return String(text || "")
    .replace(/\[-[\s\S]*?-\]/g, "")
    .replace(/\{\+([\s\S]*?)\+\}/g, "$1")
    .split(/\n/)
    .filter((line) => !/^\s*-/.test(line))
    .map((line) => line.replace(/^\s*\+\s?/, ""))
    .join("\n");
}

function rejectRedlineText(text) {
  return String(text || "")
    .replace(/\[-([\s\S]*?)-\]/g, "$1")
    .replace(/\{\+[\s\S]*?\+\}/g, "")
    .split(/\n/)
    .filter((line) => !/^\s*\+/.test(line))
    .map((line) => line.replace(/^\s*-\s?/, ""))
    .join("\n");
}

function buildReadableComparisonText(previousText, currentText) {
  const currentClauses = splitClauses(currentText, "current-comparison");
  const previousClauses = splitClauses(previousText, "previous-comparison");
  return currentClauses
    .map((clause) => {
      const previous = previousClauses.find((item) => normalizeClauseTitle(item.title) === normalizeClauseTitle(clause.title)) || previousClauses.find((item) => item.type === clause.type);
      if (!previous) return clause.text;
      return `${clause.title}\n${stripHtmlForText(buildInlineDiffHtml(previous.text, clause.text))}`;
    })
    .join("\n\n");
}

function stripHtmlForText(html) {
  return String(html)
    .replace(/<span class="redline-deleted">([\s\S]*?)<\/span>/g, "【删除：$1】")
    .replace(/<span class="redline-inserted">([\s\S]*?)<\/span>/g, "【新增：$1】")
    .replace(/<br \/>/g, "\n")
    .replace(/<[^>]+>/g, "");
}
