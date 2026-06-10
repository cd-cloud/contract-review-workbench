/**
 * Layer 6-A: DOCX-related pure function tests
 * Tests js/word-docx.js pure functions:
 *   detectMaterialKind, buildVersionPayload, materialKindLabel, escapeXml
 */

const { loadScript, test, testAsync, summary, assert } = require("./test-helper");

loadScript("js/utils.js");
loadScript("js/review-redline.js");
loadScript("lib/docx-shared.js");
global.getAnalysisFindings = () => [];
loadScript("js/word-docx.js");

console.log("\n=== test-docx-pure.js ===\n");
const asyncTests = [];

// --- detectMaterialKind ---
test("detectMaterialKind detects version text", () => {
  assert.strictEqual(detectMaterialKind("这是普通合同文本"), "version");
  assert.strictEqual(detectMaterialKind("第一条 定义\n为本合同之目的"), "version");
});

test("detectMaterialKind detects comments/email", () => {
  assert.strictEqual(detectMaterialKind("发件人：张三\n主题：合同反馈"), "comments");
  assert.strictEqual(detectMaterialKind("请法务确认以下修改建议"), "comments");
  assert.strictEqual(detectMaterialKind("From: legal@company.com\nTo: business@company.com"), "comments");
});

test("detectMaterialKind detects redline", () => {
  assert.strictEqual(detectMaterialKind("[-删除-]{+新增+}"), "redline");
  assert.strictEqual(detectMaterialKind("+ 新增行\n- 删除行"), "redline");
  assert.strictEqual(detectMaterialKind("这是修订稿"), "redline");
});

test("detectMaterialKind handles empty text", () => {
  assert.strictEqual(detectMaterialKind(""), "empty");
  assert.strictEqual(detectMaterialKind("   "), "empty");
});

// --- materialKindLabel ---
test("materialKindLabel returns correct labels", () => {
  assert.strictEqual(materialKindLabel("version"), "普通版本文本");
  assert.strictEqual(materialKindLabel("redline"), "疑似红线/修订稿");
  assert.strictEqual(materialKindLabel("prepared"), "拟发送版本");
  assert.strictEqual(materialKindLabel("comments"), "邮件 / 修改建议");
  assert.strictEqual(materialKindLabel("empty"), "无文本");
  assert.strictEqual(materialKindLabel("unknown"), "普通版本文本");
});

// --- buildVersionPayload ---
test("buildVersionPayload handles plain text", () => {
  const payload = buildVersionPayload("第一条 定义\n正文内容");
  assert.strictEqual(payload.materialKind, "version");
  assert.strictEqual(payload.versionText, "第一条 定义\n正文内容");
  assert.strictEqual(payload.acceptedText, "第一条 定义\n正文内容");
  assert.strictEqual(payload.rejectedText, "");
  assert.strictEqual(payload.hasRevisions, false);
});

test("buildVersionPayload handles redline text", () => {
  const text = "原[-旧-]{+新+}文";
  const payload = buildVersionPayload(text);
  assert.strictEqual(payload.materialKind, "redline");
  // acceptRedlineText removes [-x-] and keeps {+x+}
  assert.strictEqual(payload.acceptedText, "原新文");
  // rejectRedlineText keeps [-x-] and removes {+x+}
  assert.strictEqual(payload.rejectedText, "原旧文");
  assert.strictEqual(payload.hasRevisions, true);
});

test("buildVersionPayload uses uploadResult when provided", () => {
  const uploadResult = {
    kind: "comments",
    displayText: "邮件内容",
    acceptedText: "邮件内容",
    rejectedText: "",
    revisionText: "邮件内容",
    commentsText: "这是批注",
    paragraphs: ["邮件内容"],
    sourceType: "text",
    fileName: "email.txt",
    hasRevisions: false,
    hasComments: true,
  };
  const payload = buildVersionPayload("ignored", uploadResult);
  assert.strictEqual(payload.materialKind, "comments");
  assert.strictEqual(payload.commentsText, "这是批注");
  assert.strictEqual(payload.hasComments, true);
  assert.strictEqual(payload.fileName, "email.txt");
});

asyncTests.push(testAsync("parseDocxOnBackend returns parsed backend result when API succeeds", async () => {
  const originalFetch = global.legalWorkbenchFetch;
  global.legalWorkbenchFetch = async () => ({
    ok: true,
    json: async () => ({
      ok: true,
      text: "后端正文",
      acceptedText: "后端正文",
      rejectedText: "",
      revisionText: "后端正文",
      commentsText: "",
      paragraphs: ["后端正文"],
      hasRevisions: false,
    }),
  });
  const result = await parseDocxOnBackend("test.docx", new Uint8Array([1, 2, 3]).buffer);
  assert.ok(result);
  assert.strictEqual(result.acceptedText, "后端正文");
  global.legalWorkbenchFetch = originalFetch;
}));

asyncTests.push(testAsync("readUploadedFile falls back to browser parser when backend parser is unavailable", async () => {
  const originalBackendParser = parseDocxOnBackend;
  const originalBrowserParser = parseDocxBuffer;
  parseDocxOnBackend = async () => null;
  parseDocxBuffer = async () => ({
    plainText: "浏览器正文",
    acceptedText: "浏览器正文",
    rejectedText: "",
    revisionText: "浏览器正文",
    commentsText: "",
    paragraphs: ["浏览器正文"],
    hasRevisions: false,
  });
  const file = {
    name: "test.docx",
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  };
  const result = await readUploadedFile(file);
  assert.strictEqual(result.sourceType, "docx");
  assert.strictEqual(result.acceptedText, "浏览器正文");
  parseDocxOnBackend = originalBackendParser;
  parseDocxBuffer = originalBrowserParser;
}));

// --- escapeXml ---
test("escapeXml escapes XML entities", () => {
  assert.strictEqual(escapeXml("<tag>"), "&lt;tag&gt;");
  assert.strictEqual(escapeXml('"quoted"'), "&quot;quoted&quot;");
  assert.strictEqual(escapeXml("'single'"), "&apos;single&apos;");
  assert.strictEqual(escapeXml("a & b"), "a &amp; b");
});

test("escapeXml strips illegal XML control characters", () => {
  assert.strictEqual(escapeXml("text\x00with\x01nulls"), "textwithnulls");
  assert.strictEqual(escapeXml("text\x0Bwith\x0Ccontrols"), "textwithcontrols");
});

test("escapeXml escapes carriage returns", () => {
  assert.strictEqual(escapeXml("line1\rline2"), "line1&#13;line2");
});

test("escapeXml handles null/undefined", () => {
  // escapeXml uses `String(value ?? "")` which coerces null/undefined to empty string
  assert.strictEqual(escapeXml(null), "");
  assert.strictEqual(escapeXml(undefined), "");
});

Promise.all(asyncTests).then(() => summary());
