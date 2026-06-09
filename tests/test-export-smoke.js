const { loadScript, test, summary, assert } = require("./test-helper");

global.state = {
  reviewMode: "clean",
  activeContractId: "contract-demo",
  activeUpdateId: null,
  activeWorkbenchClauseId: null,
  activeSubclauseId: null,
  contracts: [
    {
      id: "contract-demo",
      name: "示例 SaaS 服务协议",
      type: "SaaS 服务合同",
      ourRole: "服务提供方",
      counterpartyName: "测试客户有限公司",
      cleanText: "第一条 服务内容\n乙方向甲方提供 SaaS 服务。\n\n第二条 付款\n甲方在三十日内付款。",
      text: "第一条 服务内容\n乙方向甲方提供 SaaS 服务。\n\n第二条 付款\n甲方在三十日内付款。",
      redlineText: "",
      commentsText: "",
      riskLevel: "medium",
      purpose: "采购智能客服 SaaS 服务",
      businessBackground: "用于导出 smoke 测试。",
      updatedAt: "2026-06-09",
      createdAt: "2026-06-09",
    },
  ],
  updates: [],
  clauses: [],
  findings: [],
  playbooks: [],
  clauseActions: {},
  insertedClauses: {},
  clauseOrder: {},
  subclauseOrder: {},
  subclauseMoves: [],
  insertionAudits: {},
  subclauseReferenceMap: {},
  reviewChecks: {},
  legalSkillResults: {
    "contract-demo": {
      response: {
        businessSummary: "Mock business summary",
      },
    },
  },
};

global.module = { exports: {} };
global.exports = global.module.exports;

global.uid = (() => {
  let counter = 0;
  return (prefix) => `${prefix}-${++counter}`;
})();
global.today = () => "2026-06-09";
global.recordAudit = () => {};
global.saveState = () => {};
global.getAnalysisFindings = () => [];
global.findClauseReferences = () => [];
global.parseClauseNumber = () => null;
global.getAiClauseSegmentationForSource = () => null;
global.normalizeClauseTitle = (value) => String(value || "").replace(/\s+/g, "").toLowerCase();
global.getStoredSkillResult = (contractId) => global.state.legalSkillResults?.[contractId]?.response || {};

loadScript("js/utils.js");
loadScript("lib/normalize.js");
loadScript("lib/contract-parsing.js");
loadScript("js/contract-parser.js");
loadScript("js/diff-engine.js");
loadScript("js/review-redline.js");
loadScript("js/review-numbering.js");
loadScript("js/review-material.js");
loadScript("js/review-checks.js");
loadScript("js/contract-lifecycle.js");
loadScript("js/word-docx.js");

console.log("\n=== test-export-smoke.js ===\n");

test("createPreparedSendingVersion builds generated update from edited clauses", () => {
  const contract = state.contracts[0];
  const material = getWorkbenchMaterial(contract);
  const clauses = splitVersionClauses(material.text, material.sourceKey);
  state.clauseActions[material.sourceKey] = {
    [clauses[0].id]: {
      editedText: "第一条 服务内容\n乙方向甲方提供智能客服 SaaS 服务及 API 支持。",
      comment: "补充服务范围",
    },
  };

  const prepared = createPreparedSendingVersion(contract);
  assert.strictEqual(prepared.update.type, "拟发送版本");
  assert.ok(prepared.text.includes("智能客服 SaaS 服务及 API 支持"));
  assert.ok(state.updates.some((item) => item.id === prepared.update.id));
});

test("buildDocxRedlinePackage returns a zip-like docx payload", () => {
  const docx = buildDocxRedlinePackage(state.contracts[0]);
  assert.ok(docx instanceof Uint8Array);
  assert.ok(docx.length > 0);
  assert.strictEqual(String.fromCharCode(docx[0], docx[1]), "PK");
});

test("buildDeliveryPackageZip returns a zip payload with bundled deliverables", () => {
  const zip = buildDeliveryPackageZip(state.contracts[0]);
  assert.ok(zip instanceof Uint8Array);
  assert.ok(zip.length > 0);
  assert.strictEqual(String.fromCharCode(zip[0], zip[1]), "PK");
});

summary();
