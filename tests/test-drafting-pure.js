/**
 * Tests for js/drafting.js pure functions
 */

const { loadScript, test, summary, assert } = require("./test-helper");

global.escapeHtml = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
global.numberToChinese = (n) => String(n);
global.state = { contracts: [], playbooks: [], currentDraft: null };

loadScript("js/drafting.js");

console.log("\n=== test-drafting-pure.js ===\n");

// --- renderDraftOutput ---
test("renderDraftOutput returns HTML when no draft", () => {
  global.state.currentDraft = null;
  const html = renderDraftOutput();
  assert.ok(html.includes("填写左侧信息后生成初稿"));
});

test("renderDraftOutput returns HTML with draft content", () => {
  global.state.currentDraft = { title: "测试初稿", summary: "摘要", text: "条款内容", sources: ["来源1"], openItems: ["待确认1"] };
  const html = renderDraftOutput();
  assert.ok(html.includes("测试初稿"));
  assert.ok(html.includes("条款内容"));
  assert.ok(html.includes("来源1"));
  assert.ok(html.includes("待确认1"));
  global.state.currentDraft = null;
});

// --- generateDraftContract ---
test("generateDraftContract generates clauses from matching playbooks", () => {
  global.state.playbooks = [
    { reviewStatus: "active", contractTypes: ["SaaS 服务合同"], ourRole: "服务提供方", type: "保密条款", standard: "标准保密文本" },
    { reviewStatus: "active", contractTypes: ["SaaS 服务合同"], ourRole: "服务提供方", type: "知识产权", standard: "标准知识产权文本" },
  ];
  const draft = generateDraftContract({ type: "SaaS 服务合同", background: "背景", role: "服务提供方", counterparty: "甲方" });
  assert.ok(draft.text.includes("保密条款"));
  assert.ok(draft.text.includes("标准保密文本"));
  assert.ok(draft.text.includes("知识产权"));
  assert.ok(draft.text.includes("标准知识产权文本"));
  global.state.playbooks = [];
});

test("generateDraftContract falls back to hardcoded text when no playbooks", () => {
  global.state.playbooks = [];
  const draft = generateDraftContract({ type: "未知类型", background: "", role: "", counterparty: "" });
  assert.ok(draft.text.includes("第一条 服务内容"));
  assert.ok(draft.text.includes("第二条 费用与付款"));
  assert.ok(draft.text.includes("第三条 保密"));
  assert.ok(draft.text.includes("第四条 知识产权"));
  assert.ok(draft.text.includes("第五条 争议解决"));
});

test("generateDraftContract includes sources from matching contracts and playbooks", () => {
  global.state.contracts = [
    { id: "c1", name: "历史合同A", type: "SaaS 服务合同", counterpartyName: "甲方" },
    { id: "c2", name: "历史合同B", type: "其他", counterpartyName: "甲方" },
  ];
  global.state.playbooks = [
    { reviewStatus: "active", contractTypes: ["SaaS 服务合同"], ourRole: "服务提供方", type: "保密条款", standard: "标准文本" },
  ];
  const draft = generateDraftContract({ type: "SaaS 服务合同", background: "背景", role: "服务提供方", counterparty: "甲方" });
  assert.ok(draft.sources.some((s) => s.includes("历史合同A")));
  assert.ok(draft.sources.some((s) => s.includes("历史合同B")));
  assert.ok(draft.sources.some((s) => s.includes("条款库")));
  global.state.contracts = [];
  global.state.playbooks = [];
});

test("generateDraftContract produces correct title and summary", () => {
  global.state.playbooks = [];
  const draft = generateDraftContract({ type: "采购合同", background: "采购背景", role: "采购方", counterparty: "乙方" });
  assert.strictEqual(draft.title, "采购合同初稿");
  assert.ok(draft.summary.includes("采购方"));
  assert.ok(draft.summary.includes("乙方"));
  assert.ok(draft.text.includes("采购背景"));
  assert.ok(draft.text.includes("采购方"));
});

summary();
