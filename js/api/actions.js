function relocateSkillFindingInResult(contractId, response, fix = {}) {
  const toClauseId = fix.toClauseId || fix.targetId;
  if (!toClauseId) return false;
  const clauseItem = findRawSkillFindingItem(contractId, response.clauseAnalyses || [], fix, "clause");
  if (clauseItem) {
    clauseItem.previousClauseId = clauseItem.clauseId || clauseItem.targetClauseId || "";
    clauseItem.clauseId = toClauseId;
    clauseItem.targetClauseId = toClauseId;
    clauseItem.placementAdjustedByAgentB = true;
    return true;
  }
  const contractItem = findRawSkillFindingItem(contractId, response.contractLevelRisks || [], fix, "contract")
    || findRawSkillFindingItem(contractId, response.contractLevelRisks || [], fix, "contract-routed");
  if (contractItem) {
    contractItem.previousLinkedClauseIds = contractItem.linkedClauseIds || [];
    contractItem.linkedClauseIds = [toClauseId];
    contractItem.targetClauseId = toClauseId;
    contractItem.placementAdjustedByAgentB = true;
    return true;
  }
  return false;
}

function dedupeSkillFindingInResult(contractId, response, fix = {}) {
  const removedClause = removeRawSkillFindingItem(contractId, response.clauseAnalyses || [], fix, "clause");
  const removedContract = removeRawSkillFindingItem(contractId, response.contractLevelRisks || [], fix, "contract")
    || removeRawSkillFindingItem(contractId, response.contractLevelRisks || [], fix, "contract-routed");
  return removedClause + removedContract;
}

function findRawSkillFindingItem(contractId, items, fix, scope) {
  return items.find((item) => rawSkillFindingMatchesFix(contractId, item, fix, scope))
    || findBestRawSkillFindingItem(items, fix)
    || null;
}

function removeRawSkillFindingItem(contractId, items, fix, scope) {
  const index = items.findIndex((item) => rawSkillFindingMatchesFix(contractId, item, fix, scope));
  if (index < 0) return 0;
  items.splice(index, 1);
  return 1;
}

function rawSkillFindingMatchesFix(contractId, item, fix, scope) {
  if (!item) return false;
  const stableId = buildSkillFindingStableId(contractId, item, scope);
  if (fix.findingId && fix.findingId === stableId) return true;
  if (fix.fromClauseId && [item.clauseId, item.targetClauseId, ...(item.linkedClauseIds || [])].includes(fix.fromClauseId)) {
    const fixText = normalizeText([fix.title, fix.description, fix.targetId].filter(Boolean).join("|"));
    const itemText = normalizeText([item.title, item.issue, item.proposedRevision, item.proposedClauseText, item.fix, item.suggestion].filter(Boolean).join("|"));
    return !fixText || jaccard(tokenize(fixText), tokenize(itemText)) >= 0.08;
  }
  return false;
}

function findBestRawSkillFindingItem(items = [], fix = {}) {
  const fixText = normalizeText([fix.title, fix.description, fix.targetId].filter(Boolean).join("|"));
  if (!fixText) return null;
  let best = null;
  let bestScore = 0;
  items.forEach((item) => {
    const itemText = normalizeText([item.title, item.issue, item.proposedRevision, item.proposedClauseText, item.fix, item.suggestion].filter(Boolean).join("|"));
    const score = jaccard(tokenize(fixText), tokenize(itemText));
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  });
  return bestScore >= 0.12 ? best : null;
}
