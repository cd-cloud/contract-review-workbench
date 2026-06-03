const { execFile } = require("child_process");
const path = require("path");
const { getProviderStatus } = require("../scripts/ai-runner-lib");
const { parseRunnerJson } = require("./utils");

const PROVIDER_STATUS = getProviderStatus();
const RUNNER = process.env.SUGGESTION_ACTION_RUNNER_SCRIPT || (PROVIDER_STATUS.mode === "openai-compatible" ? "scripts/ai-suggestion-runner.js" : "scripts/codex-suggestion-runner.js");
const ALLOW_FALLBACK = process.env.SUGGESTION_ACTION_ALLOW_FALLBACK === "1";

function runSuggestionAction(request) {
  return runCodexSuggestionAction(request).catch((error) => {
    if (!ALLOW_FALLBACK) {
      throw new Error(`AI 建议动作执行失败：${error.message || String(error)}`);
    }
    return {
      ok: true,
      source: "backend-fallback",
      fallbackReason: error.message || String(error),
      fallbackWarning: "当前结果由本地兜底生成，未经过 AI 后端复核。",
      ...buildFallbackSuggestionAction(request),
    };
  });
}

function runCodexSuggestionAction(request) {
  return new Promise((resolve, reject) => {
    const runnerPath = path.resolve(process.cwd(), RUNNER);
    const child = execFile(process.execPath, [runnerPath], { maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${error.message}\n${stderr || ""}`.trim()));
        return;
      }
      try {
        resolve({
          ok: true,
          source: path.basename(RUNNER),
          ...parseRunnerJson(stdout),
        });
      } catch (parseError) {
        reject(parseError);
      }
    });
    child.stdin.write(JSON.stringify(request, null, 2));
    child.stdin.end();
  });
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
        comment: `拒绝AI建议：${fix || suggestion.title || "未填写原因"}`,
        rejectionReason: fix || suggestion.issue || suggestion.title || "用户拒绝该建议。",
        knowledgeNote: "该建议被用户拒绝，后续同类合同应谨慎复用。",
      }),
    };
  }
  if (["comment_only", "business_confirmed"].includes(userAction)) {
    return {
      action: emptyAction({
        status: userAction,
        targetClauseId: targetClause.id || request.targetClauseId || "",
        actionType: "comment_only",
        comment: `${userAction === "business_confirmed" ? "业务确认" : "仅作批注"}：${fix || suggestion.issue || ""}`,
        knowledgeNote: "该建议未直接改写合同，仅形成批注或业务确认记录。",
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
          title: suggestion.title || "新增条款",
          type: suggestion.clauseType || targetClause.type || "其他",
          text: fix,
          position: "after",
          targetClauseId: targetClause.id || request.targetClauseId || "",
        },
        comment: `采纳AI新增建议：${suggestion.issue || suggestion.title || ""}`,
        knowledgeNote: "该新增建议已作为候选条款插入。",
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
      comment: `采纳AI${actionType === "delete_clause" ? "删除" : "修改"}建议：${fix}`,
      knowledgeNote: "该建议已转化为条款动作。",
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
  if (/^(第[一二三四五六七八九十百零〇两0-9]+条|[一二三四五六七八九十百零〇两]+[、.．]|[0-9]+[、.．])/.test(clean)) return clean;
  return `${originalText}\n\n【AI修改建议】${clean}`;
}

module.exports = { runSuggestionAction, buildFallbackSuggestionAction, emptyAction, normalizeActionType, buildEditedText };
