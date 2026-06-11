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

/* ─────────────── Version comparison visualization ─────────────── */

function buildClauseLevelComparisonHtml(previousText, currentText) {
  const previousClauses = splitClauses(previousText, "comparison-prev");
  const currentClauses = splitClauses(currentText, "comparison-curr");

  const prevByTitle = new Map();
  previousClauses.forEach((c) => {
    const key = normalizeClauseTitle(c.title);
    if (key) prevByTitle.set(key, c);
  });

  const comparisons = [];
  const seenPrevKeys = new Set();

  currentClauses.forEach((curr) => {
    const key = normalizeClauseTitle(curr.title);
    const prev = key ? prevByTitle.get(key) : null;
    if (prev) seenPrevKeys.add(key);
    if (!prev) {
      comparisons.push({ type: "added", curr, prev: null });
    } else if (prev.text !== curr.text) {
      comparisons.push({ type: "modified", curr, prev });
    } else {
      comparisons.push({ type: "unchanged", curr, prev });
    }
  });

  previousClauses.forEach((prev) => {
    const key = normalizeClauseTitle(prev.title);
    if (key && !seenPrevKeys.has(key)) {
      comparisons.push({ type: "deleted", curr: null, prev });
    }
  });

  const stats = {
    added: comparisons.filter((c) => c.type === "added").length,
    deleted: comparisons.filter((c) => c.type === "deleted").length,
    modified: comparisons.filter((c) => c.type === "modified").length,
    unchanged: comparisons.filter((c) => c.type === "unchanged").length,
  };

  return {
    stats,
    html: `
      <div class="version-comparison">
        <div class="comparison-toolbar">
          <span class="comparison-stat added">新增 ${stats.added}</span>
          <span class="comparison-stat deleted">删除 ${stats.deleted}</span>
          <span class="comparison-stat modified">修改 ${stats.modified}</span>
          <span class="comparison-stat unchanged">未变 ${stats.unchanged}</span>
        </div>
        <div class="comparison-clause-list">
          ${comparisons.map((c) => renderComparisonClauseCard(c)).join("")}
        </div>
      </div>
    `,
  };
}

function renderComparisonClauseCard(comparison) {
  const { type, curr, prev } = comparison;
  const labelMap = {
    added: { label: "新增", className: "comparison-added", icon: "＋" },
    deleted: { label: "删除", className: "comparison-deleted", icon: "－" },
    modified: { label: "修改", className: "comparison-modified", icon: "≈" },
    unchanged: { label: "未变", className: "comparison-unchanged", icon: "＝" },
  };
  const meta = labelMap[type];
  const title = curr?.title || prev?.title || "未命名条款";

  let bodyHtml = "";
  if (type === "added") {
    bodyHtml = `<div class="comparison-body added">${escapeHtml(curr.text).replaceAll("\n", "<br />")}</div>`;
  } else if (type === "deleted") {
    bodyHtml = `<div class="comparison-body deleted">${escapeHtml(prev.text).replaceAll("\n", "<br />")}</div>`;
  } else if (type === "modified") {
    bodyHtml = `<div class="comparison-body modified">${buildInlineDiffHtml(prev.text, curr.text, "redline-deleted", "redline-inserted")}</div>`;
  } else {
    bodyHtml = `<div class="comparison-body unchanged">${escapeHtml(curr.text).replaceAll("\n", "<br />")}</div>`;
  }

  return `
    <article class="comparison-card ${meta.className}" data-comparison-type="${type}">
      <div class="comparison-card-header">
        <span class="comparison-badge ${meta.className}">${meta.icon} ${meta.label}</span>
        <h4 class="comparison-title">${escapeHtml(title)}</h4>
      </div>
      ${bodyHtml}
    </article>
  `;
}
