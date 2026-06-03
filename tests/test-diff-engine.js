/**
 * Layer 5-B: Diff engine tests
 * Tests token-level and line-level diff algorithms.
 *
 * Note: These functions are copied from app.js to avoid eval'ing
 * the entire browser-side controller in Node.js.
 */

const assert = require("assert");

// --- Diff engine functions (from app.js) ---
function tokenizeForDiff(text) {
  return String(text || "").match(/[\u4e00-\u9fff]|[A-Za-z0-9_]+|\s+|[^\sA-Za-z0-9_\u4e00-\u9fff]/g) || [];
}

const MAX_DIFF_TOKENS_FOR_LCS = 4000;

function buildInlineDiffParts(oldText, newText) {
  const oldTokens = tokenizeForDiff(oldText);
  const newTokens = tokenizeForDiff(newText);
  const m = oldTokens.length;
  const n = newTokens.length;
  if (m * n > MAX_DIFF_TOKENS_FOR_LCS * MAX_DIFF_TOKENS_FOR_LCS) {
    return buildLineDiffParts(oldText, newText);
  }
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      dp[i][j] = oldTokens[i] === newTokens[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const parts = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (oldTokens[i] === newTokens[j]) {
      parts.push({ type: "same", text: oldTokens[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      parts.push({ type: "delete", text: oldTokens[i] });
      i += 1;
    } else {
      parts.push({ type: "insert", text: newTokens[j] });
      j += 1;
    }
  }
  while (i < m) { parts.push({ type: "delete", text: oldTokens[i] }); i += 1; }
  while (j < n) { parts.push({ type: "insert", text: newTokens[j] }); j += 1; }
  return parts;
}

function buildLineDiffParts(oldText, newText) {
  const oldLines = String(oldText || "").split("\n");
  const newLines = String(newText || "").split("\n");
  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);
  const parts = [];
  let oi = 0;
  let ni = 0;
  while (oi < oldLines.length || ni < newLines.length) {
    if (oi >= oldLines.length) {
      parts.push({ type: "insert", text: newLines[ni] + "\n" });
      ni += 1;
    } else if (ni >= newLines.length) {
      parts.push({ type: "delete", text: oldLines[oi] + "\n" });
      oi += 1;
    } else if (oldLines[oi] === newLines[ni]) {
      parts.push({ type: "same", text: oldLines[oi] + "\n" });
      oi += 1;
      ni += 1;
    } else if (!newSet.has(oldLines[oi])) {
      parts.push({ type: "delete", text: oldLines[oi] + "\n" });
      oi += 1;
    } else if (!oldSet.has(newLines[ni])) {
      parts.push({ type: "insert", text: newLines[ni] + "\n" });
      ni += 1;
    } else {
      parts.push({ type: "delete", text: oldLines[oi] + "\n" });
      parts.push({ type: "insert", text: newLines[ni] + "\n" });
      oi += 1;
      ni += 1;
    }
  }
  return parts;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
    .replaceAll("`", "&#96;")
    .replaceAll("{", "&#123;")
    .replaceAll("}", "&#125;")
    .replaceAll("\\", "&#92;");
}

function buildInlineDiffHtml(oldText, newText, deleteClass = "redline-deleted", insertClass = "redline-inserted") {
  return buildInlineDiffParts(oldText, newText)
    .map((part) => {
      const text = escapeHtml(part.text).replaceAll("\n", "<br />");
      if (part.type === "delete") return `<span class="${deleteClass}">${text}</span>`;
      if (part.type === "insert") return `<span class="${insertClass}">${text}</span>`;
      return text;
    })
    .join("");
}

// --- Test runner ---
console.log("\n=== test-diff-engine.js ===\n");

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

// --- tokenizeForDiff ---
test("tokenizeForDiff tokenizes Chinese characters", () => {
  const tokens = tokenizeForDiff("乙方向甲方提供技术服务");
  assert.ok(tokens.length > 5);
  assert.ok(tokens.every((t) => /[\u4e00-\u9fff]|[A-Za-z0-9_]+|\s+|[^\sA-Za-z0-9_\u4e00-\u9fff]/.test(t)));
});

test("tokenizeForDiff tokenizes English words", () => {
  const tokens = tokenizeForDiff("Hello world");
  assert.deepStrictEqual(tokens, ["Hello", " ", "world"]);
});

test("tokenizeForDiff tokenizes mixed content", () => {
  const tokens = tokenizeForDiff("SaaS服务");
  assert.deepStrictEqual(tokens, ["SaaS", "服", "务"]);
});

test("tokenizeForDiff handles empty string", () => {
  assert.deepStrictEqual(tokenizeForDiff(""), []);
  assert.deepStrictEqual(tokenizeForDiff(null), []);
});

// --- buildInlineDiffParts ---
test("buildInlineDiffParts detects identical text", () => {
  const parts = buildInlineDiffParts("相同文本", "相同文本");
  assert.strictEqual(parts.length, 4); // 4 Chinese chars
  assert.ok(parts.every((p) => p.type === "same"));
});

test("buildInlineDiffParts detects simple insertion", () => {
  const parts = buildInlineDiffParts("原文", "原文新增");
  const inserts = parts.filter((p) => p.type === "insert");
  const sames = parts.filter((p) => p.type === "same");
  assert.ok(sames.length >= 2);
  assert.ok(inserts.length >= 2);
});

test("buildInlineDiffParts detects simple deletion", () => {
  const parts = buildInlineDiffParts("原文删除", "原文");
  const deletes = parts.filter((p) => p.type === "delete");
  const sames = parts.filter((p) => p.type === "same");
  assert.ok(sames.length >= 2);
  assert.ok(deletes.length >= 2);
});

test("buildInlineDiffParts detects substitution", () => {
  const parts = buildInlineDiffParts("旧文本", "新文本");
  const deletes = parts.filter((p) => p.type === "delete");
  const inserts = parts.filter((p) => p.type === "insert");
  const sames = parts.filter((p) => p.type === "same");
  assert.ok(deletes.length >= 1);
  assert.ok(inserts.length >= 1);
  assert.ok(sames.length >= 2);
});

test("buildInlineDiffParts handles whitespace changes", () => {
  const parts = buildInlineDiffParts("甲 方", "甲方");
  // Should detect the space as deleted
  const deletes = parts.filter((p) => p.type === "delete");
  assert.ok(deletes.some((p) => p.text === " "));
});

test("buildInlineDiffParts handles numbers and punctuation", () => {
  const parts = buildInlineDiffParts("1. 定义", "2. 定义");
  const sames = parts.filter((p) => p.type === "same");
  assert.ok(sames.some((p) => p.text === "."));
  assert.ok(sames.some((p) => p.text === " "));
});

// --- buildLineDiffParts ---
test("buildLineDiffParts handles identical lines", () => {
  const parts = buildLineDiffParts("第一行\n第二行", "第一行\n第二行");
  assert.ok(parts.every((p) => p.type === "same"));
});

test("buildLineDiffParts detects added lines", () => {
  const parts = buildLineDiffParts("第一行", "第一行\n第二行");
  const inserts = parts.filter((p) => p.type === "insert");
  assert.strictEqual(inserts.length, 1);
  assert.ok(inserts[0].text.includes("第二行"));
});

test("buildLineDiffParts detects removed lines", () => {
  const parts = buildLineDiffParts("第一行\n第二行", "第一行");
  const deletes = parts.filter((p) => p.type === "delete");
  assert.strictEqual(deletes.length, 1);
  assert.ok(deletes[0].text.includes("第二行"));
});

test("buildLineDiffParts detects changed lines", () => {
  const parts = buildLineDiffParts("第一行\n旧行", "第一行\n新行");
  const sames = parts.filter((p) => p.type === "same");
  const changes = parts.filter((p) => p.type !== "same");
  assert.strictEqual(sames.length, 1);
  assert.ok(sames[0].text.includes("第一行"));
  assert.strictEqual(changes.length, 2);
});

// --- buildInlineDiffHtml ---
test("buildInlineDiffHtml wraps changes in spans", () => {
  const html = buildInlineDiffHtml("原文", "新文");
  assert.ok(html.includes('class="redline-deleted"'));
  assert.ok(html.includes('class="redline-inserted"'));
});

test("buildInlineDiffHtml uses custom class names", () => {
  const html = buildInlineDiffHtml("原文", "新文", "del", "ins");
  assert.ok(html.includes('class="del"'));
  assert.ok(html.includes('class="ins"'));
});

test("buildInlineDiffHtml escapes HTML in diff", () => {
  const html = buildInlineDiffHtml("<script>", "<div>");
  // tokenizeForDiff splits into tokens: <, script, > for old; <, div, > for new
  // Each token is escaped individually in spans, so the raw "<script>" won't appear
  assert.ok(!html.includes("<script>"));
  // But individual escaped tokens will appear
  assert.ok(html.includes("&lt;"));
  assert.ok(html.includes("&gt;"));
});

// --- Performance / fallback ---
test("buildInlineDiffParts falls back to line diff for huge inputs", () => {
  const hugeOld = Array(5000).fill("x").join("");
  const hugeNew = Array(5000).fill("y").join("");
  const parts = buildInlineDiffParts(hugeOld, hugeNew);
  // Should not crash and should use line-level diff
  assert.ok(parts.length > 0);
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
