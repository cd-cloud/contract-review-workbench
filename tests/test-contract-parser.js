/**
 * Layer 3-B: Contract parser tests
 * Tests js/contract-parser.js pure functions
 */

const { loadScript, test, summary, assert } = require("./test-helper");

// Mock uid before loading contract-parser
function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}
global.uid = uid;

// Load contract-parsing lib first (provides isChapterHeading, etc.)
loadScript("lib/contract-parsing.js");
// Load contract-parser
loadScript("js/contract-parser.js");

console.log("\n=== test-contract-parser.js ===\n");

// --- classifyContract ---
test("classifyContract recognizes SaaS contracts", () => {
  assert.strictEqual(classifyContract("甲方采购乙方SaaS服务及API调用"), "SaaS 服务合同");
  assert.strictEqual(classifyContract("软件即服务平台订阅"), "SaaS 服务合同");
});

test("classifyContract recognizes data contracts", () => {
  assert.strictEqual(classifyContract("数据集采购与提供"), "数据采购合同");
  assert.strictEqual(classifyContract("样本数据标注服务"), "数据采购合同");
});

test("classifyContract recognizes tech service contracts", () => {
  assert.strictEqual(classifyContract("技术开发与实施部署"), "技术服务合同");
  assert.strictEqual(classifyContract("系统运维与接口开发"), "技术服务合同");
});

test("classifyContract recognizes NDA", () => {
  assert.strictEqual(classifyContract("保密协议与保密义务"), "保密协议");
  assert.strictEqual(classifyContract("NDA保密义务"), "保密协议");
});

test("classifyContract defaults to 其他合同", () => {
  assert.strictEqual(classifyContract("一些无关内容"), "其他合同");
});

// --- classifyClause (contract-parser version) ---
test("classifyClause recognizes major clause types", () => {
  assert.strictEqual(classifyClause("乙方向甲方提供SaaS服务", "服务范围"), "服务范围");
  assert.strictEqual(classifyClause("甲方支付服务费用", "付款"), "付款");
  assert.strictEqual(classifyClause("知识产权归乙方所有", "知识产权"), "知识产权");
  assert.strictEqual(classifyClause("双方承担保密义务", "保密"), "保密");
  assert.strictEqual(classifyClause("争议提交仲裁", "争议解决"), "争议解决");
});

test("classifyClause recognizes party info", () => {
  assert.strictEqual(classifyClause("甲方：北京科技有限公司\n乙方：上海云服务股份有限公司", ""), "当事人信息");
});

test("classifyClause recognizes recitals", () => {
  // classifyClause signature: (text, title = "")
  assert.strictEqual(classifyClause("甲方拟采购乙方服务", "鉴于"), "鉴于条款");
  assert.strictEqual(classifyClause("", "鉴于条款"), "鉴于条款");
});

test("classifyClause defaults to 其他", () => {
  assert.strictEqual(classifyClause("一些无关内容", ""), "其他");
});

// --- parseOutlineMarker ---
test("parseOutlineMarker recognizes chapter markers", () => {
  const marker = parseOutlineMarker("第一章 总则");
  assert.strictEqual(marker.style, "chapter");
  assert.strictEqual(marker.marker, "第一章");
  assert.strictEqual(marker.body, "总则");
});

test("parseOutlineMarker recognizes article markers", () => {
  const marker = parseOutlineMarker("第一条 定义与解释");
  assert.strictEqual(marker.style, "article");
  assert.strictEqual(marker.marker, "第一条");
  assert.strictEqual(marker.body, "定义与解释");
});

test("parseOutlineMarker recognizes Chinese comma markers", () => {
  const marker = parseOutlineMarker("一、服务范围");
  assert.strictEqual(marker.style, "cn-comma");
  assert.strictEqual(marker.marker, "一");
  assert.strictEqual(marker.body, "服务范围");
});

test("parseOutlineMarker recognizes decimal markers", () => {
  const marker = parseOutlineMarker("1.1 服务范围");
  assert.strictEqual(marker.style, "decimal-2");
  assert.strictEqual(marker.marker, "1.1");
  assert.strictEqual(marker.body, "服务范围");
});

test("parseOutlineMarker recognizes Arabic markers", () => {
  const marker = parseOutlineMarker("1. 定义");
  assert.strictEqual(marker.style, "arabic");
  assert.strictEqual(marker.marker, "1");
  assert.strictEqual(marker.body, "定义");
});

test("parseOutlineMarker recognizes Chinese paren markers", () => {
  const marker = parseOutlineMarker("（一）服务范围");
  assert.strictEqual(marker.style, "cn-paren");
  assert.strictEqual(marker.marker, "一");
  assert.strictEqual(marker.body, "服务范围");
});

test("parseOutlineMarker recognizes num paren markers", () => {
  const marker = parseOutlineMarker("(1) 服务范围");
  assert.strictEqual(marker.style, "num-paren");
  assert.strictEqual(marker.marker, "1");
  assert.strictEqual(marker.body, "服务范围");
});

test("parseOutlineMarker returns null for plain text", () => {
  assert.strictEqual(parseOutlineMarker("普通文本"), null);
  assert.strictEqual(parseOutlineMarker(""), null);
});

// --- outlineStyleBaseLevel ---
test("outlineStyleBaseLevel returns correct levels", () => {
  assert.strictEqual(outlineStyleBaseLevel("chapter"), 0);
  assert.strictEqual(outlineStyleBaseLevel("article"), 1);
  assert.strictEqual(outlineStyleBaseLevel("cn-comma"), 2);
  assert.strictEqual(outlineStyleBaseLevel("arabic"), 3);
  assert.strictEqual(outlineStyleBaseLevel("decimal-2"), 5);
  assert.strictEqual(outlineStyleBaseLevel("decimal-3"), 6);
  assert.strictEqual(outlineStyleBaseLevel("cn-paren"), 7);
  assert.strictEqual(outlineStyleBaseLevel("num-paren"), 8);
});

// --- isExplicitOutlineTitle ---
test("isExplicitOutlineTitle accepts short titles", () => {
  assert.strictEqual(isExplicitOutlineTitle("定义"), true);
  assert.strictEqual(isExplicitOutlineTitle("服务范围"), true);
});

test("isExplicitOutlineTitle rejects long text", () => {
  assert.strictEqual(isExplicitOutlineTitle("a".repeat(29)), false);
});

test("isExplicitOutlineTitle rejects text with sentence-ending punctuation", () => {
  assert.strictEqual(isExplicitOutlineTitle("服务范围。"), false);
  assert.strictEqual(isExplicitOutlineTitle("服务范围，"), false);
});

test("isExplicitOutlineTitle rejects text starting with quotes", () => {
  assert.strictEqual(isExplicitOutlineTitle('"服务范围"'), false);
});

// --- splitClauses ---
test("splitClauses handles Chinese article structure", () => {
  const text = `第一条 定义
为本合同之目的。

第二条 服务范围
乙方提供服务。`;
  const clauses = splitClauses(text, "c1");
  assert.ok(clauses.length >= 2);
  assert.ok(clauses[0].title.includes("定义"));
  assert.ok(clauses[1].title.includes("服务范围"));
});

test("splitClauses assigns contractId", () => {
  const clauses = splitClauses("第一条 定义\n正文", "test-contract");
  assert.strictEqual(clauses[0].contractId, "test-contract");
});

test("splitClauses handles empty text", () => {
  const clauses = splitClauses("", "c1");
  assert.strictEqual(clauses.length, 0);
});

// --- splitStructuredClauses ---
test("splitStructuredClauses handles chapter + article structure", () => {
  const text = `第一章 总则
第一条 定义
正文。

第二章 服务
第二条 范围
正文。`;
  const chunks = splitStructuredClauses(text);
  assert.ok(chunks.length >= 2);
  assert.ok(chunks.some((c) => c.chapterTitle));
});

// --- splitHeadingStyleClauses ---
test("splitHeadingStyleClauses requires at least 3 headings", () => {
  const text = `定义\n正文\n服务范围\n正文`;
  const chunks = splitHeadingStyleClauses(text);
  assert.strictEqual(chunks.length, 0);
});

test("splitHeadingStyleClauses splits heading-style text", () => {
  const text = `定义\n为本合同之目的。\n\n服务范围\n乙方提供服务。\n\n付款\n甲方付款。\n\n保密\n双方保密。\n\n争议解决\n提交仲裁。`;
  const chunks = splitHeadingStyleClauses(text);
  // Need >= 3 standalone headings for this fallback to trigger
  assert.ok(chunks.length >= 3, `Expected >=3 chunks, got ${chunks.length}`);
});

// --- isStandaloneClauseHeading ---
test("isStandaloneClauseHeading filters party info", () => {
  assert.strictEqual(isStandaloneClauseHeading("甲方：公司", 1, []), false);
  assert.strictEqual(isStandaloneClauseHeading("联系人：张三", 1, []), false);
});

test("isStandaloneClauseHeading recognizes valid headings", () => {
  assert.strictEqual(isStandaloneClauseHeading("定义", 1, []), true);
  assert.strictEqual(isStandaloneClauseHeading("保密义务", 1, []), true);
});

summary();
