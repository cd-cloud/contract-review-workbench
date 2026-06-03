/**
 * Tests for js/counterparties.js pure functions
 */

const { loadScript, test, summary, assert } = require("./test-helper");

global.escapeHtml = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
global.riskLabel = (l) => ({ high: "高", medium: "中", low: "低" }[l] || "低");
global.referenceItem = (t) => t;
global.state = { contracts: [], negotiations: [], aiSuggestionFeedback: [] };

loadScript("js/counterparties.js");

console.log("\n=== test-counterparties-pure.js ===\n");

// --- buildCounterpartyProfile ---
test("buildCounterpartyProfile builds profile with basic info", () => {
  const counterparty = { id: "cp1", name: "甲方", type: "企业", industry: "IT", importance: "高", notes: "重要客户", riskLevel: "medium" };
  const profile = buildCounterpartyProfile(counterparty, [], []);
  assert.strictEqual(profile.disputedClauses, "暂无稳定记录");
  assert.ok(profile.preference.includes("历史偏好数据仍较少"));
  assert.strictEqual(profile.contractTimeline, "暂无历史合同时间线");
  assert.ok(profile.negotiationDuration.includes("谈判轮次正常"));
});

test("buildCounterpartyProfile extracts disputed clauses from negotiations", () => {
  const counterparty = { id: "cp2", name: "乙方", type: "企业", industry: "金融", importance: "中", notes: "", riskLevel: "low" };
  const negotiations = [
    { counterpartyPosition: "责任上限", ourResponse: "同意", reason: "风险可控", finalResult: "接受", concession: "" },
    { counterpartyPosition: "数据使用", ourResponse: "拒绝", reason: "合规", finalResult: "拒绝", concession: "" },
  ];
  const profile = buildCounterpartyProfile(counterparty, [], negotiations);
  assert.ok(profile.disputedClauses.includes("责任限制/赔偿"));
  assert.ok(profile.disputedClauses.includes("数据使用/模型训练/个人信息"));
  assert.ok(profile.preference.includes("责任限制/赔偿"));
  assert.ok(profile.preference.includes("数据使用/模型训练/个人信息"));
});

test("buildCounterpartyProfile handles empty inputs", () => {
  const counterparty = { id: "cp3", name: "丙方", type: "", industry: "", importance: "", notes: "", riskLevel: "low" };
  const profile = buildCounterpartyProfile(counterparty, [], []);
  assert.strictEqual(profile.disputedClauses, "暂无稳定记录");
  assert.strictEqual(profile.acceptablePositions, "暂无明确可接受口径，可从公司平衡版条款开始。");
  assert.strictEqual(profile.rejectedPositions, "暂无明确拒绝口径。");
  assert.strictEqual(profile.contractTimeline, "暂无历史合同时间线");
  assert.strictEqual(profile.concessionRecord, "暂无明确让步记录");
});

test("buildCounterpartyProfile reflects contract timeline and risk", () => {
  const counterparty = { id: "cp4", name: "丁方", type: "企业", industry: "制造", importance: "低", notes: "", riskLevel: "high" };
  const contracts = [
    { id: "c1", name: "合同A", counterpartyId: "cp4", createdAt: "2026-01-01", status: "签署", riskLevel: "high" },
    { id: "c2", name: "合同B", counterpartyId: "cp4", createdAt: "2026-06-01", status: "审阅中", riskLevel: "medium" },
  ];
  const profile = buildCounterpartyProfile(counterparty, contracts, []);
  assert.ok(profile.contractTimeline.includes("2026-01-01 合同A（签署）"));
  assert.ok(profile.contractTimeline.includes("2026-06-01 合同B（审阅中）"));
  assert.ok(profile.riskPreference.includes("偏审慎"));
  assert.ok(profile.nextMove.includes("该相对方存在高风险合同记录"));
});

test("buildCounterpartyProfile extracts accepted and rejected positions", () => {
  const counterparty = { id: "cp5", name: "戊方", type: "企业", industry: "医疗", importance: "高", notes: "", riskLevel: "low" };
  const negotiations = [
    { counterpartyPosition: "苛刻条款", ourResponse: "可接受", reason: "合理", finalResult: "同意", concession: "部分让步" },
    { counterpartyPosition: "不合理要求", ourResponse: "拒绝", reason: "风险高", finalResult: "拒绝", concession: "" },
  ];
  const profile = buildCounterpartyProfile(counterparty, [], negotiations);
  assert.ok(profile.acceptablePositions.includes("可接受"));
  assert.ok(profile.rejectedPositions.includes("不合理要求"));
  assert.ok(profile.negotiationDuration.includes("谈判轮次正常"));
  assert.ok(profile.concessionRecord.includes("历史让步 1 次"));
});

summary();
