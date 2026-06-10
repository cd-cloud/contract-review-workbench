function buildAutomaticReviewChecks(contract, material, clauses) {
  const checks = [];
  const numberedClauses = clauses.filter((clause) => !clause.unnumbered && Number(clause.number) > 0);
  const clauseNumbers = new Set(numberedClauses.map((clause) => Number(clause.number)));
  const duplicateNumbers = findDuplicates(numberedClauses.map((clause) => Number(clause.number)).filter(Boolean));
  duplicateNumbers.forEach((number) => {
    checks.push({
      severity: "high",
      type: "numbering",
      title: `条款编号重复：第${numberToChinese(number)}条`,
      detail: "同一合同版本中出现重复条款编号，发送前应调整条款顺序或编号。",
    });
  });

  clauses.forEach((clause) => {
    findClauseReferences(clause.text).forEach((reference) => {
      const number = parseClauseNumber(reference.replace(/^第|条$/g, ""));
      if (number && !clauseNumbers.has(number)) {
        checks.push({
          severity: "medium",
          type: "reference",
          clauseId: clause.id,
          title: `${clause.title} 引用了不存在的${reference}`,
          detail: "请确认该引用是否因新增、删除或移动条款后未同步调整。",
        });
      }
    });
    {
      const subclauses = splitSubclauses(clause);
      const duplicateSubNumbers = findDuplicates(
        subclauses
          .map((subclause) => String(subclause.text || "").trim().match(/^(\d+(?:\.\d+)+)/)?.[1])
          .filter(Boolean)
      );
      duplicateSubNumbers.forEach((number) => {
        checks.push({
          severity: "medium",
          type: "subclause-numbering",
          clauseId: clause.id,
          title: `${clause.title} 内小条款编号重复：${number}`,
          detail: "小条款移动或新增后需要统一复核层级编号。",
        });
      });
    }
  });

  const presentTypes = new Set(clauses.map((clause) => clause.type));
  ["保密", "知识产权", "责任限制", "争议解决"].forEach((type) => {
    if (!presentTypes.has(type)) {
      checks.push({
        severity: "medium",
        type: "core-clause",
        title: `缺少${type}条款`,
        detail: "该类条款通常需要结合交易背景确认是否补充。",
      });
    }
  });

  const highFindings = getAnalysisFindings(contract, clauses).filter((finding) => finding.severity === "high");
  highFindings.slice(0, 5).forEach((finding) => {
    checks.push({
      severity: "high",
      type: "risk",
      clauseId: finding.clauseId || null,
      title: `高风险仍需复核：${finding.title}`,
      detail: finding.suggestion || finding.summary || "建议发送前确认该风险是否已经通过修订解决。",
    });
  });

  return dedupeChecks(checks);
}

function summarizeAutomaticReviewChecks(checks) {
  if (!checks.length) return "自动核查未发现明显编号、引用或核心条款问题。";
  const high = checks.filter((check) => check.severity === "high").length;
  const medium = checks.filter((check) => check.severity === "medium").length;
  const top = checks.slice(0, 4).map((check) => check.title).join("；");
  return `自动核查发现高风险 ${high} 项、中风险 ${medium} 项。重点：${top}`;
}

function storeAutomaticReviewChecks(contractId, updateId, checks) {
  state.reviewChecks = state.reviewChecks || {};
  state.reviewChecks[contractId] = {
    updateId,
    checks,
    checkedAt: new Date().toISOString(),
  };
  if (typeof persistBackendAuxState === "function") {
    persistBackendAuxState({
      reviewChecks: state.reviewChecks,
    }).catch(() => {});
  }
}

function findDuplicates(values) {
  const seen = new Set();
  const duplicates = new Set();
  values.forEach((value) => {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  });
  return [...duplicates];
}

function dedupeChecks(checks) {
  const seen = new Set();
  return checks.filter((check) => {
    const key = `${check.type}:${check.clauseId || ""}:${check.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
