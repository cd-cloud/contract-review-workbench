/**
 * Tests for browser-side API core helpers.
 */

const { loadScript, test, summary, assert } = require("./test-helper");

global.state = {
  activeUpdateId: "u1",
  playbooks: [],
  updates: [],
};
global.splitVersionClauses = () => [];
global.splitSubclauses = () => [];
global.classifyClause = () => "其他";

loadScript("lib/normalize.js");
loadScript("js/utils.js");
loadScript("js/api/core.js");
loadScript("js/api/segmentation.js");
loadScript("js/api/findings.js");

console.log("\n=== test-api-core-pure.js ===\n");

test("normalizeLegalSkillResult keeps structured AI suggestions", () => {
  const result = normalizeLegalSkillResult({
    ok: true,
    response: {
      contractSummary: { contractType: "技术服务合同", riskLevel: "high" },
      clauseSegmentation: [
        { stableId: "s1", order: 2, title: "付款", text: "第二条 付款。甲方验收后付款。", type: "付款" },
        { stableId: "s0", order: 1, title: "服务", text: "第一条 服务。乙方提供开发服务。", type: "服务范围" },
      ],
      contractLevelRisks: [
        {
          severity: "high",
          actionType: "add_clause",
          title: "缺少验收条款",
          issue: "合同未约定验收标准。",
          suggestion: "补充验收标准和异议期限。",
          proposedClauseText: "双方应明确验收标准、验收期限和异议处理机制。",
          qualityScore: 88.6,
        },
      ],
      clauseAnalyses: [
        {
          clauseId: "clause-2",
          severity: "medium",
          actionType: "revise_clause",
          issue: "付款触发条件不清。",
          proposedRevision: "甲方应在验收合格并收到合法有效发票后十个工作日内付款。",
          qualityScore: "77",
        },
      ],
      missingFacts: ["验收负责人"],
      businessSummary: "存在付款和验收风险。",
    },
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.response.clauseSegmentation.length, 2);
  assert.strictEqual(result.response.clauseSegmentation[0].stableId, "s0");
  assert.strictEqual(result.response.contractLevelRisks.length, 1);
  assert.strictEqual(result.response.contractLevelRisks[0].qualityScore, 89);
  assert.strictEqual(result.response.clauseAnalyses.length, 1);
  assert.strictEqual(result.response.clauseAnalyses[0].actionType, "revise_clause");
  assert.deepStrictEqual(result.response.missingFacts, ["验收负责人"]);
});

test("normalizeLegalSkillResult filters empty and generic advice", () => {
  const result = normalizeLegalSkillResult({
    response: {
      contractLevelRisks: [
        { actionType: "add_clause", title: "空建议" },
        { actionType: "comment_only", title: "未识别到显著风险", issue: "建议结合交易背景复核。" },
      ],
      clauseAnalyses: [
        { clauseId: "c1", actionType: "revise_clause", issue: "缺少修改文本" },
        { clauseId: "c2", actionType: "comment_only", issue: "" },
      ],
    },
  });

  assert.strictEqual(result.response.contractLevelRisks.length, 0);
  assert.strictEqual(result.response.clauseAnalyses.length, 0);
});

test("buildLegalSkillRequest uses material source key instead of active update guess", () => {
  global.state = {
    activeUpdateId: "stale-active",
    playbooks: [],
    updates: [{ id: "u-real", contractId: "c1", type: "draft" }],
  };
  global.getWorkbenchMaterial = () => ({
    id: "u-real",
    materialId: "u-real",
    sourceKey: "c1:u-real",
    text: "material body",
  });
  const request = buildLegalSkillRequest({ id: "c1", text: "" }, "", "", {});
  assert.strictEqual(request.source_key, "c1:u-real");
  assert.strictEqual(request.material_id, "u-real");
  assert.strictEqual(request.contract_text, "material body");
  delete global.getWorkbenchMaterial;
});

test("buildIncrementalPayload marks first sync as incremental", () => {
  global.clone = (value) => JSON.parse(JSON.stringify(value));
  const payload = buildIncrementalPayload({
    contracts: [{ id: "c1", text: "x".repeat(250), cleanText: "x".repeat(250) }],
    updates: [{ id: "u1", contractId: "c1", versionText: "y".repeat(250) }],
  }, null);
  assert.strictEqual(payload.syncMode, "incremental");
  assert.strictEqual(payload.contracts[0].text, "");
  assert.strictEqual(payload.updates[0].versionText, "");
});

summary();
