const { createAiAdapter } = require("./base-adapter");

const adapter = createAiAdapter({
  name: "AI suggestion action runner",
  envRunnerScript: "SUGGESTION_ACTION_RUNNER_SCRIPT",
  envAllowFallback: "SUGGESTION_ACTION_ALLOW_FALLBACK",
  defaultOpenAiRunner: "scripts/ai-suggestion-runner.js",
  defaultCodexRunner: "scripts/codex-suggestion-runner.js",
  promptVersion: "agent-suggestion-v1",
  skillPath: "legal-work-orchestrator",
  downstreamSkill: "legal-contract-orchestrator",
});

function runSuggestionAction(request) {
  return adapter.runWithFallback(request, adapter.runConfiguredCommand, buildFallbackSuggestionAction);
}

function buildFallbackSuggestionAction(request = {}) {
  const suggestion = request.suggestion || {};
  const userAction = request.userAction || "adopt";
  const actionType = normalizeActionType(suggestion.actionType || suggestion.action || "");
  const targetClause = request.targetClause || {};
  const fix = suggestion.fix || suggestion.proposedClauseText || suggestion.proposedRevision || suggestion.issue || "";

  if (userAction === "reject") {
    return {
      action: emptyAction({
        status: "rejected",
        targetClauseId: targetClause.id || request.targetClauseId || "",
        actionType: "none",
        comment: `拒绝 AI 建议：${fix || suggestion.title || "未提供具体原因"}`,
        rejectionReason: fix || suggestion.issue || suggestion.title || "用户已拒绝该 AI 建议。",
        knowledgeNote: "该建议已被拒绝，后续复用时应谨慎人工复核。",
      }),
    };
  }

  if (["comment_only", "business_confirmed"].includes(userAction)) {
    return {
      action: emptyAction({
        status: userAction,
        targetClauseId: targetClause.id || request.targetClauseId || "",
        actionType: "comment_only",
        comment: `${userAction === "business_confirmed" ? "业务已确认" : "仅保留批注"}：${fix || suggestion.issue || ""}`,
        knowledgeNote: "该建议未直接改写合同文本，仅保留说明或确认结果。",
      }),
    };
  }

  if (actionType === "add_clause") {
    return {
      action: emptyAction({
        status: userAction === "adjust" ? "adjusted" : "adopted",
        targetClauseId: targetClause.id || request.targetClauseId || "",
        matchConfidence: 60,
        actionType,
        insertedClause: {
          title: suggestion.title || "New clause",
          type: suggestion.clauseType || targetClause.type || "other",
          text: fix,
          position: "after",
          targetClauseId: targetClause.id || request.targetClauseId || "",
        },
        comment: `采纳 AI 新增条款建议：${suggestion.issue || suggestion.title || ""}`,
        knowledgeNote: "该建议已转换为候选新增条款。",
      }),
    };
  }

  return {
    action: emptyAction({
      status: userAction === "adjust" ? "adjusted" : "adopted",
      targetClauseId: targetClause.id || request.targetClauseId || "",
      matchConfidence: 60,
      actionType,
      editedText: actionType === "delete_clause" ? "" : buildEditedText(targetClause.text || "", fix),
      comment: `采纳 AI ${actionType === "delete_clause" ? "删除" : "修改"}建议：${fix}`,
      knowledgeNote: "该建议已转换为条款动作。",
    }),
  };
}

function emptyAction(overrides = {}) {
  return {
    status: "adopted",
    targetClauseId: "",
    matchConfidence: 0,
    actionType: "none",
    editedText: "",
    insertedClause: { title: "", type: "", text: "", position: "none", targetClauseId: "" },
    comment: "",
    rejectionReason: "",
    knowledgeNote: "",
    ...overrides,
  };
}

function normalizeActionType(value) {
  if (value === "新增") return "add_clause";
  if (value === "删除") return "delete_clause";
  if (["add_clause", "replace_clause", "revise_clause", "delete_clause", "comment_only"].includes(value)) return value;
  return "revise_clause";
}

function buildEditedText(originalText, fix) {
  const clean = String(fix || "").trim();
  if (!clean) return originalText;
  const replacement = clean.match(/^建议修改为[:：]\s*\n?([\s\S]+)$/)?.[1]?.trim();
  if (replacement) return replacement;
  if (/^(第[一二三四五六七八九十百零〇两0-9]+条|[0-9]+[.、)]|\d+(?:\.\d+)+)/.test(clean)) return clean;
  return `${originalText}\n\n【AI修改建议】${clean}`;
}

module.exports = {
  runSuggestionAction,
  getRunnerStatus: adapter.getRunnerStatus,
  buildFallbackSuggestionAction,
  emptyAction,
  normalizeActionType,
  buildEditedText,
  _resetRunnerStatusForTesting: adapter._resetRunnerStatusForTesting,
};
