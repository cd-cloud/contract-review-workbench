/**
 * Tests for js/app-contract-actions.js pure functions
 */

const { loadScript, test, summary, assert } = require("./test-helper");

// Mock dependencies before loading
function uid(prefix) {
  return `${prefix}-test-001`;
}
global.uid = uid;
global.today = () => "2026-05-29";
global.getContractUpdates = () => [];
global.saveState = () => {};

// Mock state for setActiveContract
global.state = {
  contracts: [],
  clauses: [],
  updates: [],
  activeContractId: null,
  activeClauseId: null,
  activeUpdateId: null,
};

// Load contract-parser for classifyContract dependency
loadScript("lib/contract-parsing.js");
loadScript("js/contract-parser.js");
loadScript("js/store.js");
// Load the module under test
loadScript("js/app-contract-actions.js");
loadScript("js/app-contract-actions-overrides.js");

console.log("\n=== test-app-contract-actions.js ===\n");

// --- isLikelyDocumentControlLine ---
test("isLikelyDocumentControlLine detects confidentiality labels", () => {
  assert.strictEqual(isLikelyDocumentControlLine("严格保密"), true);
  assert.strictEqual(isLikelyDocumentControlLine("Confidential"), true);
  assert.strictEqual(isLikelyDocumentControlLine("Draft"), true);
  assert.strictEqual(isLikelyDocumentControlLine("草稿版"), true);
});

test("isLikelyDocumentControlLine detects distribution restrictions", () => {
  assert.strictEqual(isLikelyDocumentControlLine("仅供内部使用"), true);
  assert.strictEqual(isLikelyDocumentControlLine("不得外传"), true);
  assert.strictEqual(isLikelyDocumentControlLine("未经书面同意不得披露"), true);
});

test("isLikelyDocumentControlLine allows normal text", () => {
  assert.strictEqual(isLikelyDocumentControlLine("第一章 总则"), false);
  assert.strictEqual(isLikelyDocumentControlLine("合同双方"), false);
  assert.strictEqual(isLikelyDocumentControlLine(""), false);
});

// --- cleanupExtractedValue ---
test("cleanupExtractedValue strips abbreviations and punctuation", () => {
  assert.strictEqual(cleanupExtractedValue("以下简称甲方：星河智能"), "星河智能");
  assert.strictEqual(cleanupExtractedValue('"Quoted Company"'), "Quoted Company");
  assert.strictEqual(cleanupExtractedValue("甲方；乙方"), "甲方");
});

test("cleanupExtractedValue handles empty input", () => {
  assert.strictEqual(cleanupExtractedValue(""), "");
  assert.strictEqual(cleanupExtractedValue(null), "");
});

// --- extractPartyName ---
test("extractPartyName extracts party after label", () => {
  assert.strictEqual(extractPartyName("甲方：星河智能科技有限公司\n乙方：蓝海数据股份有限公司", "甲方"), "星河智能科技有限公司");
  assert.strictEqual(extractPartyName("披露方：甲方公司", "披露方"), "甲方公司");
});

test("extractPartyName returns empty when not found", () => {
  assert.strictEqual(extractPartyName("无标签文本", "甲方"), "");
});

// --- extractCompanyNames ---
test("extractCompanyNames finds Chinese company names", () => {
  const names = extractCompanyNames("甲方：星河智能科技有限公司；乙方：蓝海数据股份有限公司");
  assert.ok(names.includes("星河智能科技有限公司"));
  assert.ok(names.includes("蓝海数据股份有限公司"));
});

test("extractCompanyNames deduplicates", () => {
  const names = extractCompanyNames("甲方公司、甲方公司、乙方公司、丙方企业");
  assert.strictEqual(names.length, 3);
});

// --- inferContractName ---
test("inferContractName extracts title from first lines", () => {
  const lines = ["技术服务合同", "甲方：甲公司", "乙方：乙公司"];
  assert.strictEqual(inferContractName(lines), "技术服务合同");
});

test("inferContractName falls back to first line", () => {
  const lines = ["无名文件", "第二行"];
  assert.strictEqual(inferContractName(lines), "无名文件");
});

// --- inferContractParties ---
test("inferContractParties extracts roles and counterparty", () => {
  const lines = ["甲方：星河智能科技有限公司", "乙方：蓝海数据股份有限公司"];
  const parties = inferContractParties(lines);
  assert.strictEqual(parties.partyA, "星河智能科技有限公司");
  assert.strictEqual(parties.partyB, "蓝海数据股份有限公司");
  assert.strictEqual(parties.counterparty, "蓝海数据股份有限公司");
});

test("inferContractParties handles missing labels", () => {
  const lines = ["普通合同文本"];
  const parties = inferContractParties(lines);
  assert.strictEqual(parties.counterparty, "");
});

// --- inferContractPurpose ---
test("inferContractPurpose recognizes NDA", () => {
  const purpose = inferContractPurpose("保密协议", "本保密协议由双方签署", "保密协议");
  assert.ok(purpose.includes("保密义务"));
});

test("inferContractPurpose recognizes SaaS", () => {
  const purpose = inferContractPurpose("SaaS 服务合同", "采购 SaaS 平台服务", "SaaS 服务合同");
  assert.ok(purpose.includes("SaaS") || purpose.includes("技术服务"));
});

test("inferContractPurpose provides fallback", () => {
  const purpose = inferContractPurpose("", "普通文本", "");
  assert.ok(purpose.includes("本合同") || purpose.includes("待确认"));
});

// --- buildInferredBackground ---
test("buildInferredBackground includes type and counterparty", () => {
  const bg = buildInferredBackground("技术服务合同", "采购 SaaS", { counterparty: "乙公司" }, ["鉴于双方合作"]);
  assert.ok(bg.includes("技术服务合同"));
  assert.ok(bg.includes("乙公司"));
});

test("buildInferredBackground prompts for background when no clues", () => {
  const bg = buildInferredBackground("", "", { counterparty: "" }, []);
  assert.ok(bg.includes("请补充"));
});

// --- inferNewReviewFields ---
test("inferNewReviewFields extracts basic info from contract text", () => {
  const text = `技术服务合同\n甲方：星河智能科技有限公司\n乙方：蓝海数据股份有限公司\n鉴于双方就 SaaS 平台服务达成合作意向`;
  const result = inferNewReviewFields(text);
  assert.ok(result.name.includes("技术服务合同") || result.name.includes("SaaS"));
  assert.ok(result.counterparty.includes("蓝海") || result.counterparty.includes("星河"));
  assert.ok(result.type === "技术服务合同" || result.type === "SaaS 服务合同");
});

test("inferNewReviewFields handles minimal text", () => {
  const result = inferNewReviewFields("简短文本");
  assert.ok(result.name);
  assert.ok(result.type);
});

// --- setActiveContract ---
test("setActiveContract updates state correctly", () => {
  global.state = {
    contracts: [],
    clauses: [{ id: "c1", contractId: "contract-1" }],
    updates: [{ id: "u1", contractId: "contract-1", type: "初稿上传" }],
    activeContractId: null,
    activeClauseId: null,
    activeUpdateId: null,
  };
  global.getContractUpdates = (contractId) => global.state.updates.filter((u) => u.contractId === contractId);
  setActiveContract("contract-1");
  assert.strictEqual(state.activeContractId, "contract-1");
  assert.strictEqual(state.activeClauseId, "c1");
  assert.strictEqual(state.activeUpdateId, "u1");
});

// --- ensureInitialUpdate ---
test("ensureInitialUpdate creates initial update when missing", () => {
  const targetState = {
    updates: [],
  };
  const contract = {
    id: "contract-1",
    text: "合同文本",
    cleanText: "合同文本",
    createdAt: "2026-05-29",
  };
  ensureInitialUpdate(targetState, contract);
  assert.strictEqual(targetState.updates.length, 1);
  assert.strictEqual(targetState.updates[0].type, "初稿上传");
});

test("ensureInitialUpdate skips when already exists", () => {
  const targetState = {
    updates: [{ contractId: "contract-1", type: "初稿上传" }],
  };
  const contract = { id: "contract-1" };
  ensureInitialUpdate(targetState, contract);
  assert.strictEqual(targetState.updates.length, 1);
});

// --- fillIfEmpty ---
test("fillIfEmpty fills empty input", () => {
  const input = { value: "", tagName: "INPUT" };
  global.document = {
    querySelector: () => input,
  };
  fillIfEmpty("#test", "filled value");
  assert.strictEqual(input.value, "filled value");
});

test("fillIfEmpty skips non-empty input", () => {
  const input = { value: "existing" };
  global.document = {
    querySelector: () => input,
  };
  fillIfEmpty("#test", "new value");
  assert.strictEqual(input.value, "existing");
});

summary();
