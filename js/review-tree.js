function buildClauseTree(clauses, sourceKey) {
  const hasChapters = clauses.some((clause) => clause.chapterTitle);
  if (!hasChapters) return clauses.map((clause) => ({ kind: "clause", clause }));
  const nodes = [];
  const chapterMap = new Map();
  clauses.forEach((clause) => {
    const chapterTitle = clause.chapterTitle || "";
    if (!chapterTitle) {
      nodes.push({ kind: "clause", clause });
      return;
    }
    if (!chapterMap.has(chapterTitle)) {
      const chapter = {
        kind: "chapter",
        id: `${sourceKey}:chapter:${chapterMap.size + 1}`,
        title: chapterTitle,
        clauses: [],
      };
      chapterMap.set(chapterTitle, chapter);
      nodes.push(chapter);
    }
    chapterMap.get(chapterTitle).clauses.push(clause);
  });
  return nodes.flatMap((node) => shouldFlattenDuplicateChapter(node) ? node.clauses.map((clause) => ({ kind: "clause", clause: { ...clause, chapterTitle: "" } })) : [node]);
}

function shouldFlattenDuplicateChapter(node) {
  if (node.kind !== "chapter" || node.clauses.length !== 1) return false;
  const only = node.clauses[0];
  const chapterTitle = normalizeTreeTitle(node.title);
  const clauseTitle = normalizeTreeTitle(only.title);
  const firstLine = normalizeTreeTitle(String(only.text || "").split(/\n/).find(Boolean) || "");
  return Boolean(chapterTitle && (chapterTitle === clauseTitle || chapterTitle === firstLine));
}

function normalizeTreeTitle(text) {
  return String(text || "")
    .replace(new RegExp("^\\u7b2c[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u96f6\u3007\u4e240-9]+[\\u7ae0\\u8282\\u6761\\u6b3e\\u90e8\\u5206]\\s*"), "")
    .replace(new RegExp("^[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u96f6\u3007\u4e240-9]+[\\u3001.\\uff0e]\\s*"), "")
    .replace(/[\uFF1A:\u3002\uFF1B;\uFF0C,\s]/g, "")
    .trim();
}

function renderClauseTreeNode(contract, material, node, clauses, selectedClause) {
  if (node.kind === "chapter") return renderChapterCard(contract, material, node, clauses, selectedClause);
  return renderInlineClauseCard(contract, material, node.clause, clauses, selectedClause?.id === node.clause.id);
}

function renderChapterCard(contract, material, chapter, clauses, selectedClause) {
  const expanded = isTreeNodeExpanded(chapter.id);
  const childRisks = chapter.clauses.map((clause) => getClauseRiskSummary(contract, clause));
  const severity = childRisks.some((item) => item.severity === "high") ? "high" : childRisks.some((item) => item.severity === "medium") ? "medium" : "low";
  return `
    <article class="chapter-card ${expanded ? "expanded" : ""}">
      <div class="tree-card-header">
        <button class="tree-toggle-button" type="button" data-toggle-tree-node="${chapter.id}" aria-expanded="${expanded}">
          ${expanded ? "收起" : "展开"}
        </button>
        <div class="tree-card-title">
          <div class="chips">
            <span class="tag">章节</span>
            <span class="risk ${escapeHtml(severity)}">风险${riskLabel(severity)}</span>
            <span class="status-pill">${chapter.clauses.length} 条</span>
          </div>
          <h4>${escapeHtml(chapter.title)}</h4>
        </div>
      </div>
      ${
        expanded
          ? `<div class="tree-children">
              ${chapter.clauses.map((clause) => renderInlineClauseCard(contract, material, clause, clauses, selectedClause?.id === clause.id)).join("")}
            </div>`
          : ""
      }
    </article>
  `;
}

function renderSubclauseStack(contract, material, clause, subclauses, selectedSubclause) {
  const tree = buildSubclauseTree(subclauses);
  return `
    ${(subclauses.parentIntro || []).length ? `<div class="parent-clause-intro">${escapeHtml(subclauses.parentIntro.join("\n")).replaceAll("\n", "<br />")}</div>` : ""}
    <div class="subclause-stack">
      ${tree.map((node) => renderSubclauseTreeNode(contract, material, clause, node, subclauses, selectedSubclause)).join("")}
    </div>
  `;
}

function buildSubclauseTree(subclauses) {
  const roots = [];
  const stack = [];
  subclauses.forEach((subclause) => {
    const level = getSubclauseLevel(subclause);
    const node = { subclause, children: [], level };
    while (stack.length && stack.at(-1).level >= level) stack.pop();
    if (stack.length) stack.at(-1).children.push(node);
    else roots.push(node);
    stack.push(node);
  });
  return roots;
}

function getSubclauseLevel(subclause) {
  if (Number.isFinite(subclause.outlineLevel)) return subclause.outlineLevel;
  const number = String(subclause.text || "").trim().match(/^(\d+(?:\.\d+)+)/)?.[1];
  if (number) return number.split(".").length;
  return 2;
}

function renderSubclauseTreeNode(contract, material, parentClause, node, subclauses, selectedSubclause) {
  return renderSubclauseCard(contract, material, parentClause, node.subclause, subclauses, selectedSubclause?.id === node.subclause.id, node.children);
}
