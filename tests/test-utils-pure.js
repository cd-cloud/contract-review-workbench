/**
 * Layer 3-A: Pure utility function tests
 * Tests js/utils.js: escapeHtml, riskLabel, numberToChinese, normalizeClauseTypeLabel
 */

const { loadScript, test, summary, assert } = require("./test-helper");

// clauseTypes is used by normalizeClauseTypeLabel but defined in state.js with const,
// which doesn't leak to global in indirect eval. Define it manually here.
global.clauseTypes = [
  "服务范围", "交付与验收", "付款", "知识产权", "数据使用",
  "个人信息保护", "保密", "陈述与保证", "合规承诺",
  "违约责任", "责任限制", "赔偿", "期限与终止", "争议解决", "通知", "其他",
];
loadScript("js/utils.js");

console.log("\n=== test-utils-pure.js ===\n");

// --- escapeHtml ---
test("escapeHtml escapes basic HTML entities", () => {
  assert.strictEqual(escapeHtml("<div>"), "&lt;div&gt;");
  assert.strictEqual(escapeHtml('"quoted"'), "&quot;quoted&quot;");
  assert.strictEqual(escapeHtml("'single'"), "&#039;single&#039;");
});

test("escapeHtml escapes backtick and braces", () => {
  assert.strictEqual(escapeHtml("`code`"), "&#96;code&#96;");
  assert.strictEqual(escapeHtml("{obj}"), "&#123;obj&#125;");
});

test("escapeHtml escapes backslash", () => {
  assert.strictEqual(escapeHtml("path\\file"), "path&#92;file");
});

test("escapeHtml handles null/undefined", () => {
  // `String(value ?? "")` coerces null/undefined to empty string
  assert.strictEqual(escapeHtml(null), "");
  assert.strictEqual(escapeHtml(undefined), "");
  assert.strictEqual(escapeHtml(""), "");
});

test("escapeHtml handles complex injection attempt", () => {
  // Note: \` in template literal is escaped backtick, not backslash + backtick
  const malicious = `<script>alert("xss")</script>'\`{}`;
  const expected = "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;&#039;&#96;&#123;&#125;";
  assert.strictEqual(escapeHtml(malicious), expected);
});

// --- riskLabel ---
test("riskLabel maps severity levels correctly", () => {
  assert.strictEqual(riskLabel("high"), "高");
  assert.strictEqual(riskLabel("medium"), "中");
  assert.strictEqual(riskLabel("low"), "低");
  assert.strictEqual(riskLabel("unknown"), "低");
  assert.strictEqual(riskLabel(""), "低");
});

// --- numberToChinese ---
test("numberToChinese handles 0-10", () => {
  assert.strictEqual(numberToChinese(0), "零");
  assert.strictEqual(numberToChinese(1), "一");
  assert.strictEqual(numberToChinese(5), "五");
  assert.strictEqual(numberToChinese(10), "十");
});

test("numberToChinese handles 11-19", () => {
  assert.strictEqual(numberToChinese(11), "十一");
  assert.strictEqual(numberToChinese(15), "十五");
  assert.strictEqual(numberToChinese(19), "十九");
});

test("numberToChinese handles 20-99", () => {
  assert.strictEqual(numberToChinese(20), "二十");
  assert.strictEqual(numberToChinese(21), "二十一");
  assert.strictEqual(numberToChinese(35), "三十五");
  assert.strictEqual(numberToChinese(99), "九十九");
});

test("numberToChinese guards invalid input", () => {
  assert.strictEqual(numberToChinese(-1), "");
  assert.strictEqual(numberToChinese(NaN), "");
  assert.strictEqual(numberToChinese(Infinity), "");
  assert.strictEqual(numberToChinese("abc"), "");
});

// --- normalizeClauseTypeLabel ---
test("normalizeClauseTypeLabel maps English to Chinese", () => {
  assert.strictEqual(normalizeClauseTypeLabel("service_scope"), "服务范围");
  assert.strictEqual(normalizeClauseTypeLabel("intellectual_property"), "知识产权");
  assert.strictEqual(normalizeClauseTypeLabel("fees_payment"), "付款");
  assert.strictEqual(normalizeClauseTypeLabel("confidentiality"), "保密");
});

test("normalizeClauseTypeLabel handles short forms", () => {
  assert.strictEqual(normalizeClauseTypeLabel("ip"), "知识产权");
  assert.strictEqual(normalizeClauseTypeLabel("confidentiality"), "保密");
  assert.strictEqual(normalizeClauseTypeLabel("payment"), "付款");
});

test("normalizeClauseTypeLabel handles Chinese input", () => {
  assert.strictEqual(normalizeClauseTypeLabel("服务范围"), "服务范围");
  assert.strictEqual(normalizeClauseTypeLabel("付款条件"), "付款");
});

test("normalizeClauseTypeLabel defaults to 其他", () => {
  assert.strictEqual(normalizeClauseTypeLabel(""), "其他");
  assert.strictEqual(normalizeClauseTypeLabel("something_random"), "其他");
});

test("normalizeClauseTypeLabel handles recitals", () => {
  assert.strictEqual(normalizeClauseTypeLabel("background"), "鉴于条款");
  assert.strictEqual(normalizeClauseTypeLabel("recitals"), "鉴于条款");
});

summary();
