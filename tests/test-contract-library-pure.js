/**
 * Tests for js/contract-library.js pure functions
 */

const { loadScript, test, summary, assert } = require("./test-helper");

global.escapeHtml = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
global.riskLabel = (l) => ({ high: "高", medium: "中", low: "低" }[l] || "低");
global.getLatestFeedbackDeadline = () => "";
global.isDeadlineUrgent = () => false;
global.getContractUpdates = () => [];
global.hasFinalVersion = () => false;
global.state = { contracts: [] };

loadScript("js/contract-library.js");

console.log("\n=== test-contract-library-pure.js ===\n");

// --- contractRow ---
test("contractRow returns HTML string with contract name", () => {
  const contract = { id: "c1", name: "测试合同", type: "技术服务", riskLevel: "medium", counterpartyName: "甲方公司", purpose: "测试目的" };
  const html = contractRow(contract);
  assert.ok(html.includes("测试合同"));
});

test("contractRow includes risk label", () => {
  const contract = { id: "c2", name: "风险合同", type: "保密协议", riskLevel: "high", counterpartyName: "乙方公司", businessBackground: "背景" };
  const html = contractRow(contract);
  assert.ok(html.includes("风险高"));
});

test("contractRow includes counterparty", () => {
  const contract = { id: "c3", name: "合同C", type: "采购", riskLevel: "low", counterpartyName: "丙方公司", purpose: "" };
  const html = contractRow(contract);
  assert.ok(html.includes("丙方公司"));
});

test("contractRow includes status pills and version count", () => {
  global.getContractUpdates = () => [{ id: "u1" }, { id: "u2" }];
  global.hasFinalVersion = () => true;
  const contract = { id: "c4", name: "合同D", type: "服务", riskLevel: "medium", counterpartyName: "丁方" };
  const html = contractRow(contract);
  assert.ok(html.includes("已有终稿"));
  assert.ok(html.includes("2 个版本"));
  global.getContractUpdates = () => [];
  global.hasFinalVersion = () => false;
});

test("contractRow escapes HTML in contract name and purpose", () => {
  const contract = { id: "c5", name: "<script>", type: "测试", riskLevel: "low", counterpartyName: "测试方", purpose: "<b>目的</b>" };
  const html = contractRow(contract);
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;b&gt;目的&lt;/b&gt;"));
});

summary();
