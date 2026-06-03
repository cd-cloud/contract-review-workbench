/**
 * Layer 1: Shared library unit tests
 * Tests lib/contract-parsing.js, lib/contract-splitter.js, lib/normalize.js
 */

const assert = require("assert");

// --- Test lib/normalize.js ---
const { normalizeSeverity } = require("../lib/normalize");
assert.strictEqual(normalizeSeverity("high"), "high", "normalizeSeverity high");
assert.strictEqual(normalizeSeverity("高"), "high", "normalizeSeverity 高");
assert.strictEqual(normalizeSeverity("medium"), "medium", "normalizeSeverity medium");
assert.strictEqual(normalizeSeverity("中"), "medium", "normalizeSeverity 中");
assert.strictEqual(normalizeSeverity("low"), "low", "normalizeSeverity low");
assert.strictEqual(normalizeSeverity(""), "low", "normalizeSeverity empty");
assert.strictEqual(normalizeSeverity("重大风险"), "high", "normalizeSeverity 重大");
console.log("  ✓ lib/normalize.js");

// --- Test lib/contract-parsing.js ---
const {
  isChapterHeading,
  isArticleHeading,
  isMainArticleHeading,
  isDecimalClauseHeading,
  extractExplicitArticleTitle,
  isExplicitHeadingLine,
  isExplicitHeadingText,
  extractClauseTitle,
  isDocumentControlNotice,
  isContractTitleOnly,
  isPartyInfoChunk,
  isPartyInfoLine,
} = require("../lib/contract-parsing");

assert.strictEqual(isChapterHeading("第一章 总则"), true, "isChapterHeading");
assert.strictEqual(isChapterHeading("第一条 定义"), false, "isChapterHeading not article");
assert.strictEqual(isArticleHeading("第一条 定义"), true, "isArticleHeading");
assert.strictEqual(isMainArticleHeading("第一条 定义"), true, "isMainArticleHeading");
assert.strictEqual(isDecimalClauseHeading("1.1 服务范围"), true, "isDecimalClauseHeading");
assert.strictEqual(isDecimalClauseHeading("这是一段普通正文"), false, "isDecimalClauseHeading plain text");
assert.strictEqual(extractExplicitArticleTitle("第一条 定义与解释"), "第一条 定义与解释", "extractExplicitArticleTitle");
assert.strictEqual(isExplicitHeadingLine("第一条"), true, "isExplicitHeadingLine");
assert.strictEqual(isExplicitHeadingText("服务范围"), true, "isExplicitHeadingText");
assert.strictEqual(extractClauseTitle("第一条 定义\n本合同中...", 0), "第一条 定义", "extractClauseTitle");
assert.strictEqual(isDocumentControlNotice("本文档为机密文件"), true, "isDocumentControlNotice");
assert.strictEqual(isContractTitleOnly("技术服务合同"), true, "isContractTitleOnly");
assert.strictEqual(isPartyInfoLine("甲方：某某公司"), true, "isPartyInfoLine");
assert.strictEqual(isPartyInfoChunk("甲方：某某公司\n乙方：另一公司"), true, "isPartyInfoChunk");
console.log("  ✓ lib/contract-parsing.js");

// --- Test lib/contract-splitter.js ---
const {
  splitClauses,
  splitStructuredClauses,
  splitHeadingStyleClauses,
  isStandaloneClauseHeading,
  classifyClause,
} = require("../lib/contract-splitter");

const sampleContract = `第一章 总则
第一条 定义
为本合同之目的，下列术语应具有以下含义。

第二条 服务范围
乙方应向甲方提供技术服务。

第三条 付款
甲方应在收到发票后30日内付款。

第四条 保密
双方应对本合同内容保密。
`;

const clauses = splitClauses(sampleContract);
assert.strictEqual(clauses.length >= 3, true, `splitClauses should yield >=3 clauses, got ${clauses.length}`);
assert.strictEqual(clauses[0].id, "clause-1", "splitClauses id format");
assert.strictEqual(clauses[0].number, 1, "splitClauses number");
assert.strictEqual(typeof clauses[0].title, "string", "splitClauses title");
assert.strictEqual(typeof clauses[0].text, "string", "splitClauses text");
assert.strictEqual(clauses[0].hierarchyLevel, "article", "splitClauses first clause is article");

// Verify classifyClause rules from merged set
assert.strictEqual(classifyClause("乙方提供服务", "服务范围"), "服务范围", "classifyClause service");
assert.strictEqual(classifyClause("甲方付款", "付款"), "付款", "classifyClause payment");
assert.strictEqual(classifyClause("双方保密", "保密义务"), "保密", "classifyClause confidentiality");
assert.strictEqual(classifyClause("股东会决议", "公司治理"), "公司治理", "classifyClause corporate governance");
assert.strictEqual(classifyClause("出资认缴", "出资"), "出资与股权", "classifyClause equity");

// Verify standalone heading detection
assert.strictEqual(isStandaloneClauseHeading("付款", 1), true, "isStandaloneClauseHeading");
assert.strictEqual(isStandaloneClauseHeading("甲方：公司", 1), false, "isStandaloneClauseHeading party");

// Verify splitStructuredClauses
const structured = splitStructuredClauses(sampleContract);
assert.strictEqual(structured.length >= 2, true, `splitStructuredClauses should yield >=2, got ${structured.length}`);

// Verify splitHeadingStyleClauses
const headingStyle = splitHeadingStyleClauses("付款\n甲方支付\n\n交付\n乙方交付\n\n验收\n甲方验收\n\n期限\n一年");
assert.strictEqual(headingStyle.length >= 2, true, `splitHeadingStyleClauses should yield >=2, got ${headingStyle.length}`);

console.log("  ✓ lib/contract-splitter.js");

console.log("\nLayer 1: All shared library tests passed.");
