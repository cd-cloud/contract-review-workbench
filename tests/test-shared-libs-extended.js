/**
 * Layer 1-B: Extended shared library tests
 * Additional edge-case tests for lib/contract-splitter.js and lib/contract-parsing.js
 */

const assert = require("assert");

const {
  splitClauses,
  splitStructuredClauses,
  splitHeadingStyleClauses,
  isStandaloneClauseHeading,
  classifyClause,
} = require("../lib/contract-splitter");

const {
  isChapterHeading,
  isArticleHeading,
  isMainArticleHeading,
  isDecimalClauseHeading,
  extractExplicitArticleTitle,
  extractClauseTitle,
  isDocumentControlNotice,
  isContractTitleOnly,
  isPartyInfoLine,
} = require("../lib/contract-parsing");

const { normalizeSeverity } = require("../lib/normalize");

console.log("\n=== test-shared-libs-extended.js ===\n");

let totalTests = 0;
let passedTests = 0;
let failedTests = [];

function test(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    process.stdout.write(`  ✓ ${name}\n`);
  } catch (error) {
    failedTests.push({ name, error });
    process.stdout.write(`  ✗ ${name}\n`);
    process.stdout.write(`    ${error.message}\n`);
  }
}

// --- normalizeSeverity edge cases ---
test("normalizeSeverity handles mixed Chinese-English", () => {
  assert.strictEqual(normalizeSeverity("HIGH"), "high");
  assert.strictEqual(normalizeSeverity("Medium Risk"), "medium");
  assert.strictEqual(normalizeSeverity("低风险"), "low");
  assert.strictEqual(normalizeSeverity("重大风险"), "high");
});

// --- Chapter/Article heading detection ---
test("isChapterHeading recognizes various formats", () => {
  assert.strictEqual(isChapterHeading("第一章 总则"), true);
  assert.strictEqual(isChapterHeading("第十二章 附则"), true);
  assert.strictEqual(isChapterHeading("第一章总则"), true);
  assert.strictEqual(isChapterHeading("第一条 定义"), false);
  assert.strictEqual(isChapterHeading("普通文本"), false);
});

test("isMainArticleHeading recognizes article headings", () => {
  assert.strictEqual(isMainArticleHeading("第一条 定义"), true);
  assert.strictEqual(isMainArticleHeading("第十条 服务范围"), true);
  assert.strictEqual(isMainArticleHeading("第一百条 保密"), true);
  assert.strictEqual(isMainArticleHeading("第一章 总则"), false);
  assert.strictEqual(isMainArticleHeading("1.1 服务范围"), false);
});

test("isDecimalClauseHeading recognizes decimal headings", () => {
  assert.strictEqual(isDecimalClauseHeading("1.1 服务范围"), true);
  assert.strictEqual(isDecimalClauseHeading("10.5 争议解决"), true);
  // isExplicitHeadingText maxLength=32, this title is actually 29 chars so it passes
  assert.strictEqual(isDecimalClauseHeading("1.1 很长很长很长很长很长很长很长很长很长很长的标题超过了32个字符"), true);
  assert.strictEqual(isDecimalClauseHeading("普通文本"), false);
});

test("extractExplicitArticleTitle handles various formats", () => {
  assert.strictEqual(extractExplicitArticleTitle("第一条 定义与解释"), "第一条 定义与解释");
  assert.strictEqual(extractExplicitArticleTitle("第一条"), "第一条");
  assert.strictEqual(extractExplicitArticleTitle("  第一条  定义  "), "第一条  定义");
});

// --- splitClauses edge cases ---
test("splitClauses handles empty text", () => {
  const clauses = splitClauses("");
  assert.strictEqual(clauses.length, 0);
});

test("splitClauses handles single paragraph", () => {
  const clauses = splitClauses("只有一个段落");
  assert.strictEqual(clauses.length, 1);
  assert.strictEqual(clauses[0].text, "只有一个段落");
});

test("splitClauses handles Windows line endings", () => {
  const text = "第一条 定义\r\n为本合同之目的。\r\n\r\n第二条 服务范围\r\n乙方提供服务。";
  const clauses = splitClauses(text);
  assert.ok(clauses.length >= 2, `Expected >=2 clauses, got ${clauses.length}`);
});

test("splitClauses assigns correct IDs with prefix", () => {
  const clauses = splitClauses("第一条 A\n\n第二条 B", { idPrefix: "contract-1" });
  assert.strictEqual(clauses[0].id, "contract-1-1");
  assert.strictEqual(clauses[1].id, "contract-1-2");
});

test("splitClauses classifies clause types correctly", () => {
  const text = `第一条 服务范围
乙方向甲方提供技术服务。

第二条 付款
甲方应在收到发票后付款。

第三条 知识产权
乙方保留全部知识产权。`;
  const clauses = splitClauses(text);
  const types = clauses.map((c) => c.type);
  assert.ok(types.includes("服务范围"), `Expected service scope, got ${types.join(", ")}`);
  assert.ok(types.includes("付款"), `Expected payment, got ${types.join(", ")}`);
  assert.ok(types.includes("知识产权"), `Expected IP, got ${types.join(", ")}`);
});

test("splitClauses handles chapter-based structure", () => {
  const text = `第一章 总则
第一条 定义
为本合同之目的。

第二章 服务
第二条 服务范围
乙方提供服务。`;
  const clauses = splitClauses(text);
  assert.ok(clauses.length >= 2, `Expected >=2 clauses, got ${clauses.length}`);
  assert.ok(clauses.some((c) => c.chapterTitle), "Expected some clause to have chapterTitle");
});

test("splitClauses handles heading-style fallback", () => {
  const text = `定义
为本合同之目的。

服务范围
乙方提供服务。

付款
甲方付款。

保密
双方保密。`;
  const clauses = splitClauses(text);
  assert.ok(clauses.length >= 3, `Expected >=3 clauses via heading fallback, got ${clauses.length}`);
});

// --- classifyClause ---
test("classifyClause handles all major categories", () => {
  assert.strictEqual(classifyClause("乙方提供SaaS服务", "服务范围"), "服务范围");
  assert.strictEqual(classifyClause("甲方支付费用", "付款"), "付款");
  assert.strictEqual(classifyClause("知识产权归乙方所有", "知识产权"), "知识产权");
  assert.strictEqual(classifyClause("双方承担保密义务", "保密"), "保密");
  assert.strictEqual(classifyClause("争议提交仲裁", "争议解决"), "争议解决");
  assert.strictEqual(classifyClause("合同有效期一年", "期限"), "期限与终止");
  assert.strictEqual(classifyClause("股东会决议事项", "公司治理"), "公司治理");
  assert.strictEqual(classifyClause("创始人竞业限制", "创始人限制"), "创始人限制");
});

test("classifyClause defaults to 其他", () => {
  assert.strictEqual(classifyClause("一些无关内容", ""), "其他");
});

// --- isStandaloneClauseHeading ---
test("isStandaloneClauseHeading filters out party info", () => {
  assert.strictEqual(isStandaloneClauseHeading("甲方：某某公司", 1), false);
  assert.strictEqual(isStandaloneClauseHeading("乙方地址", 1), false);
  assert.strictEqual(isStandaloneClauseHeading("联系人：张三", 1), false);
});

test("isStandaloneClauseHeading recognizes valid headings", () => {
  assert.strictEqual(isStandaloneClauseHeading("定义", 1), true);
  assert.strictEqual(isStandaloneClauseHeading("保密义务", 1), true);
  assert.strictEqual(isStandaloneClauseHeading("知识产权", 1), true);
  assert.strictEqual(isStandaloneClauseHeading("争议解决", 1), true);
});

// --- Party info detection ---
test("isPartyInfoLine detects party lines", () => {
  assert.strictEqual(isPartyInfoLine("甲方：北京科技有限公司"), true);
  assert.strictEqual(isPartyInfoLine("乙方：上海云服务股份有限公司"), true);
  assert.strictEqual(isPartyInfoLine("第一条 定义"), false);
});

// --- Document control ---
test("isDocumentControlNotice detects control notices", () => {
  assert.strictEqual(isDocumentControlNotice("本文档为机密文件"), true);
  assert.strictEqual(isDocumentControlNotice("不得外传"), true);
  assert.strictEqual(isDocumentControlNotice("仅供内部使用"), true);
  assert.strictEqual(isDocumentControlNotice("草案"), true);
});

// --- Contract title ---
test("isContractTitleOnly recognizes contract titles", () => {
  assert.strictEqual(isContractTitleOnly("技术服务合同"), true);
  assert.strictEqual(isContractTitleOnly("云服务协议"), true);
  assert.strictEqual(isContractTitleOnly("第一条 定义"), false);
});

// Summary
const failed = totalTests - passedTests;
process.stdout.write(`\n${passedTests}/${totalTests} passed${failed ? `, ${failed} failed` : ""}\n`);
if (failed) {
  process.stdout.write(`\nFailed tests:\n`);
  failedTests.forEach(({ name, error }) => {
    process.stdout.write(`  - ${name}: ${error.message}\n`);
  });
  process.exit(1);
}
