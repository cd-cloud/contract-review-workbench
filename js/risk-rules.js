function getActiveRiskRules(type = "", sourceState = null) {
  const ruleState = sourceState || (typeof state !== "undefined" ? state : null) || (typeof seedData !== "undefined" ? seedData : {});
  return (ruleState.riskRules || []).filter((rule) => rule.status !== "disabled" && (!type || rule.type === type));
}

function evaluateRiskRules(contract, clauses, sourceState = null) {
  const findings = [];
  getActiveRiskRules("", sourceState).forEach((rule) => {
    clauses
      .filter((clause) => !rule.type || clause.type === rule.type)
      .forEach((clause) => {
        if (!riskRuleMatches(rule, clause, contract)) return;
        findings.push({
          id: uid("rule-finding"),
          contractId: contract.id,
          clauseId: clause.id,
          title: rule.title,
          severity: rule.severity || "medium",
          actionType: rule.actionType || "revise_clause",
          issue: rule.issue,
          consequence: rule.consequence || "该风险可能影响履约、谈判或后续争议处理。",
          fix: rule.suggestion,
          negotiation: rule.negotiation || "",
          sourceRuleId: rule.id,
          needsBusiness: rule.severity !== "low",
          needsManagement: rule.severity === "high",
          status: "待处理",
        });
      });
  });
  return dedupeRuleFindings(findings);
}

function riskRuleMatches(rule, clause, contract) {
  const source = `${contract.type || ""}\n${contract.businessBackground || ""}\n${clause.title || ""}\n${clause.text || ""}`;
  const pattern = safeRuleRegex(rule.pattern);
  const missing = safeRuleRegex(rule.missingPattern);
  if (pattern && !pattern.test(source)) return false;
  if (missing && missing.test(source)) return false;
  return true;
}

function safeRuleRegex(pattern) {
  if (!pattern) return null;
  try {
    return new RegExp(pattern, "i");
  } catch (error) {
    return null;
  }
}

function dedupeRuleFindings(findings) {
  const seen = new Set();
  return findings.filter((finding) => {
    const key = `${finding.clauseId}|${finding.title}|${finding.fix}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function toggleRiskRuleStatus(ruleId, status) {
  const rule = (state.riskRules || []).find((item) => item.id === ruleId);
  if (!rule) return false;
  rule.status = status;
  rule.updatedAt = today();
  recordAudit("更新风险规则状态", { clauseTitle: rule.title, note: status === "active" ? "启用" : "禁用" });
  saveState();
  renderPlaybooks();
  return true;
}
