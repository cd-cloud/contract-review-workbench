const assert = require("assert");
const { buildFallbackSuggestionAction, emptyAction, normalizeActionType, buildEditedText } = require("../server/suggestion-action-adapter");

// emptyAction returns default shape
const defaultAction = emptyAction();
assert.strictEqual(defaultAction.status, "adopted");
assert.strictEqual(defaultAction.targetClauseId, "");
assert.strictEqual(defaultAction.matchConfidence, 0);
assert.strictEqual(defaultAction.actionType, "none");
assert.strictEqual(defaultAction.editedText, "");
assert.deepStrictEqual(defaultAction.insertedClause, {
  title: "",
  type: "",
  text: "",
  position: "none",
  targetClauseId: "",
});
assert.strictEqual(defaultAction.comment, "");
assert.strictEqual(defaultAction.rejectionReason, "");
assert.strictEqual(defaultAction.knowledgeNote, "");

// emptyAction with overrides merges correctly
const overridden = emptyAction({ status: "rejected", comment: "test" });
assert.strictEqual(overridden.status, "rejected");
assert.strictEqual(overridden.comment, "test");
assert.strictEqual(overridden.targetClauseId, "");

// normalizeActionType normalizes various inputs
assert.strictEqual(normalizeActionType("新增"), "add_clause");
assert.strictEqual(normalizeActionType("删除"), "delete_clause");
assert.strictEqual(normalizeActionType("add_clause"), "add_clause");
assert.strictEqual(normalizeActionType("replace_clause"), "replace_clause");
assert.strictEqual(normalizeActionType("revise_clause"), "revise_clause");
assert.strictEqual(normalizeActionType("delete_clause"), "delete_clause");
assert.strictEqual(normalizeActionType("comment_only"), "comment_only");
assert.strictEqual(normalizeActionType("unknown"), "revise_clause");
assert.strictEqual(normalizeActionType(""), "revise_clause");
assert.strictEqual(normalizeActionType(null), "revise_clause");

// buildEditedText strips prefix "建议修改为："
assert.strictEqual(buildEditedText("original", "建议修改为：new text"), "new text");
assert.strictEqual(buildEditedText("original", "建议修改为:new text"), "new text");
assert.strictEqual(buildEditedText("original", "建议修改为：\nnew text"), "new text");

// buildEditedText handles empty/reject-like fix
assert.strictEqual(buildEditedText("original", ""), "original");
assert.strictEqual(buildEditedText("original", null), "original");
assert.strictEqual(buildEditedText("original", undefined), "original");

// buildEditedText preserves clause-like prefix
assert.strictEqual(buildEditedText("original", "第一条 内容"), "第一条 内容");
assert.strictEqual(buildEditedText("original", "1. 内容"), "1. 内容");

// buildEditedText appends otherwise
assert.strictEqual(buildEditedText("original", "simple fix"), "original\n\n【AI修改建议】simple fix");

// buildFallbackSuggestionAction builds action from request — reject
const rejectReq = {
  userAction: "reject",
  suggestion: { issue: "issue text", title: "title text" },
  targetClause: { id: "c1", text: "original" },
};
const rejectRes = buildFallbackSuggestionAction(rejectReq);
assert.strictEqual(rejectRes.action.status, "rejected");
assert.strictEqual(rejectRes.action.actionType, "none");
assert.strictEqual(rejectRes.action.targetClauseId, "c1");
assert.strictEqual(rejectRes.action.rejectionReason, "issue text");
assert.ok(rejectRes.action.comment.includes("拒绝AI建议"));

// buildFallbackSuggestionAction — adopt revise
const adoptReq = {
  userAction: "adopt",
  suggestion: { actionType: "replace_clause", fix: "new text" },
  targetClause: { id: "c1", text: "original" },
};
const adoptRes = buildFallbackSuggestionAction(adoptReq);
assert.strictEqual(adoptRes.action.status, "adopted");
assert.strictEqual(adoptRes.action.actionType, "replace_clause");
assert.strictEqual(adoptRes.action.editedText, "original\n\n【AI修改建议】new text");
assert.strictEqual(adoptRes.action.matchConfidence, 60);

// buildFallbackSuggestionAction — add_clause
const addReq = {
  userAction: "adopt",
  suggestion: { actionType: "add_clause", title: "New Clause", fix: "added text" },
  targetClause: { id: "c1", type: "obligation" },
};
const addRes = buildFallbackSuggestionAction(addReq);
assert.strictEqual(addRes.action.status, "adopted");
assert.strictEqual(addRes.action.actionType, "add_clause");
assert.deepStrictEqual(addRes.action.insertedClause, {
  title: "New Clause",
  type: "obligation",
  text: "added text",
  position: "after",
  targetClauseId: "c1",
});

// buildFallbackSuggestionAction — comment_only
const commentReq = {
  userAction: "comment_only",
  suggestion: { fix: "note" },
  targetClause: { id: "c1" },
};
const commentRes = buildFallbackSuggestionAction(commentReq);
assert.strictEqual(commentRes.action.status, "comment_only");
assert.strictEqual(commentRes.action.actionType, "comment_only");
assert.strictEqual(commentRes.action.comment, "仅作批注：note");

// buildFallbackSuggestionAction — business_confirmed
const confirmReq = {
  userAction: "business_confirmed",
  suggestion: { fix: "confirmed" },
  targetClause: { id: "c1" },
};
const confirmRes = buildFallbackSuggestionAction(confirmReq);
assert.strictEqual(confirmRes.action.status, "business_confirmed");
assert.strictEqual(confirmRes.action.comment, "业务确认：confirmed");

// buildFallbackSuggestionAction — adjust
const adjustReq = {
  userAction: "adjust",
  suggestion: { actionType: "replace_clause", fix: "adjusted text" },
  targetClause: { id: "c1", text: "original" },
};
const adjustRes = buildFallbackSuggestionAction(adjustReq);
assert.strictEqual(adjustRes.action.status, "adjusted");
assert.strictEqual(adjustRes.action.actionType, "replace_clause");

// buildFallbackSuggestionAction — delete_clause
const deleteReq = {
  userAction: "adopt",
  suggestion: { actionType: "delete_clause" },
  targetClause: { id: "c1", text: "original" },
};
const deleteRes = buildFallbackSuggestionAction(deleteReq);
assert.strictEqual(deleteRes.action.status, "adopted");
assert.strictEqual(deleteRes.action.actionType, "delete_clause");
assert.strictEqual(deleteRes.action.editedText, "");

console.log("test-suggestion-action-pure passed (5 tests)");
