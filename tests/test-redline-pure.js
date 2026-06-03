/**
 * Layer 5-A: Redline / diff algorithm pure function tests
 * Tests js/review-redline.js pure functions:
 *   acceptRedlineText, rejectRedlineText, stripHtmlForText
 */

const { loadScript, test, summary, assert } = require("./test-helper");

loadScript("js/utils.js");
loadScript("js/review-redline.js");

console.log("\n=== test-redline-pure.js ===\n");

// --- acceptRedlineText ---
test("acceptRedlineText accepts inline insertions", () => {
  assert.strictEqual(acceptRedlineText("{+新增文本+}"), "新增文本");
  assert.strictEqual(acceptRedlineText("原{+新增+}文"), "原新增文");
});

test("acceptRedlineText removes deletions", () => {
  assert.strictEqual(acceptRedlineText("[-删除文本-]"), "");
  assert.strictEqual(acceptRedlineText("原[-删除-]文"), "原文");
});

test("acceptRedlineText handles combined changes", () => {
  // Accept removes deletions, keeps insertions
  assert.strictEqual(
    acceptRedlineText("原[-旧-]{+新+}文"),
    "原新文"
  );
});

test("acceptRedlineText handles line-level additions", () => {
  assert.strictEqual(acceptRedlineText("+ 新增行"), "新增行");
  assert.strictEqual(acceptRedlineText("  + 新增行"), "新增行");
});

test("acceptRedlineText handles line-level deletions", () => {
  assert.strictEqual(
    acceptRedlineText("保留行\n- 删除行"),
    "保留行"
  );
});

test("acceptRedlineText preserves unchanged text", () => {
  assert.strictEqual(acceptRedlineText("纯文本无修改"), "纯文本无修改");
});

// --- rejectRedlineText ---
test("rejectRedlineText rejects inline insertions", () => {
  assert.strictEqual(rejectRedlineText("{+新增文本+}"), "");
  assert.strictEqual(rejectRedlineText("原{+新增+}文"), "原文");
});

test("rejectRedlineText keeps deletions", () => {
  assert.strictEqual(rejectRedlineText("[-删除文本-]"), "删除文本");
  assert.strictEqual(rejectRedlineText("原[-删除-]文"), "原删除文");
});

test("rejectRedlineText handles combined changes", () => {
  // Reject keeps deletions, removes insertions
  assert.strictEqual(
    rejectRedlineText("原[-旧-]{+新+}文"),
    "原旧文"
  );
});

test("rejectRedlineText handles line-level additions", () => {
  assert.strictEqual(
    rejectRedlineText("保留行\n+ 新增行"),
    "保留行"
  );
});

test("rejectRedlineText handles line-level deletions", () => {
  assert.strictEqual(rejectRedlineText("- 删除行"), "删除行");
});

test("rejectRedlineText preserves unchanged text", () => {
  assert.strictEqual(rejectRedlineText("纯文本无修改"), "纯文本无修改");
});

// --- stripHtmlForText ---
test("stripHtmlForText strips HTML tags", () => {
  assert.strictEqual(stripHtmlForText("<p>文本</p>"), "文本");
});

test("stripHtmlForText converts redline deleted spans", () => {
  assert.strictEqual(
    stripHtmlForText('<span class="redline-deleted">删除</span>'),
    "【删除：删除】"
  );
});

test("stripHtmlForText converts redline inserted spans", () => {
  assert.strictEqual(
    stripHtmlForText('<span class="redline-inserted">新增</span>'),
    "【新增：新增】"
  );
});

test("stripHtmlForText converts br tags", () => {
  assert.strictEqual(stripHtmlForText("第一<br />第二"), "第一\n第二");
});

summary();
