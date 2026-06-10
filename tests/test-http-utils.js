/**
 * Tests for server/http-utils.js
 */

const assert = require("assert");
const { Readable } = require("stream");
const {
  safeJsonStringify,
  sendJson,
  sendStaticFile,
  readJson,
  getCorsHeaders,
  isAuthorizedApiRequest,
  getApiToken,
  getSessionCookieHeader,
  isPathInsideRoot,
} = require("../server/http-utils");
const path = require("path");

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

async function testAsync(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    process.stdout.write(`  ✓ ${name}\n`);
  } catch (error) {
    failedTests.push({ name, error });
    process.stdout.write(`  ✗ ${name}\n`);
    process.stdout.write(`    ${error.message}\n`);
  }
}

function summary() {
  const failed = totalTests - passedTests;
  process.stdout.write(`\n${passedTests}/${totalTests} passed${failed ? `, ${failed} failed` : ""}\n`);
  if (failed) {
    failedTests.forEach(({ name, error }) => {
      process.stdout.write(`  ✗ ${name}: ${error.message}\n`);
    });
    process.exit(1);
  }
}

console.log("\n=== test-http-utils.js ===\n");

(async () => {
  // --- safeJsonStringify ---
  test("safeJsonStringify serializes plain object", () => {
    const obj = { a: 1, b: "two" };
    const result = safeJsonStringify(obj);
    assert.strictEqual(result, '{"a":1,"b":"two"}');
  });

  test("safeJsonStringify handles circular reference", () => {
    const obj = { a: 1 };
    obj.self = obj;
    const result = safeJsonStringify(obj);
    assert.ok(result.includes('"[Circular]"'));
  });

  test("safeJsonStringify handles nested circular refs", () => {
    const a = {};
    const b = { a };
    a.b = b;
    const result = safeJsonStringify(a);
    assert.ok(result.includes('"[Circular]"'));
  });

  test("safeJsonStringify handles null", () => {
    assert.strictEqual(safeJsonStringify(null), "null");
  });

  test("safeJsonStringify handles undefined", () => {
    assert.strictEqual(safeJsonStringify(undefined), undefined);
  });

  // --- getCorsHeaders ---
  test("getCorsHeaders returns empty for unknown origin", () => {
    const headers = getCorsHeaders({ headers: { origin: "https://evil.com" } });
    assert.deepStrictEqual(headers, {});
  });

  test("getCorsHeaders returns headers for allowed origin", () => {
    const PORT = Number(process.env.LEGAL_WORKBENCH_PORT || 8787);
    const headers = getCorsHeaders({ headers: { origin: `http://127.0.0.1:${PORT}` } });
    assert.strictEqual(headers["Access-Control-Allow-Origin"], `http://127.0.0.1:${PORT}`);
    assert.ok(headers["Access-Control-Allow-Methods"]);
    assert.ok(headers["Vary"]);
  });

  test("getCorsHeaders returns empty for missing origin", () => {
    const headers = getCorsHeaders({ headers: {} });
    assert.deepStrictEqual(headers, {});
  });

  test("isPathInsideRoot accepts nested child path", () => {
    const root = path.resolve(__dirname, "..");
    const child = path.join(root, "js", "api-client.js");
    assert.strictEqual(isPathInsideRoot(root, child), true);
  });

  test("isPathInsideRoot rejects same-prefix sibling path", () => {
    const root = path.resolve("C:\\temp\\root");
    const sibling = path.resolve("C:\\temp\\root-evil\\secret.txt");
    assert.strictEqual(isPathInsideRoot(root, sibling), false);
  });

  // --- isAuthorizedApiRequest ---
  test("isAuthorizedApiRequest returns true with correct token", () => {
    const token = getApiToken();
    assert.strictEqual(isAuthorizedApiRequest({ headers: { "x-legal-workbench-token": token } }), true);
  });

  test("isAuthorizedApiRequest returns false with wrong token", () => {
    assert.strictEqual(isAuthorizedApiRequest({ headers: { "x-legal-workbench-token": "wrong" } }), false);
  });

  test("isAuthorizedApiRequest returns false with missing token", () => {
    assert.strictEqual(isAuthorizedApiRequest({ headers: {} }), false);
  });

  test("isAuthorizedApiRequest returns true with correct session cookie", () => {
    assert.strictEqual(isAuthorizedApiRequest({ headers: { cookie: getSessionCookieHeader() } }), true);
  });

  test("isAuthorizedApiRequest returns false with wrong session cookie", () => {
    assert.strictEqual(isAuthorizedApiRequest({ headers: { cookie: "legal_workbench_session=wrong" } }), false);
  });

  // --- sendJson ---
  test("sendJson sets correct status and headers for allowed origin", () => {
    let capturedStatus;
    let capturedHeaders;
    let capturedBody;
    const mockRes = {
      writeHead(status, headers) {
        capturedStatus = status;
        capturedHeaders = headers;
      },
      end(body) {
        capturedBody = body;
      },
    };
    const PORT = Number(process.env.LEGAL_WORKBENCH_PORT || 8787);
    sendJson(mockRes, 201, { ok: true }, { headers: { origin: `http://127.0.0.1:${PORT}` } });
    assert.strictEqual(capturedStatus, 201);
    assert.strictEqual(capturedHeaders["Content-Type"], "application/json; charset=utf-8");
    assert.strictEqual(capturedHeaders["Access-Control-Allow-Origin"], `http://127.0.0.1:${PORT}`);
    assert.strictEqual(capturedBody, '{"ok":true}');
  });

  test("sendJson omits CORS for disallowed origin", () => {
    let capturedHeaders;
    const mockRes = {
      writeHead(status, headers) { capturedHeaders = headers; },
      end() {},
    };
    sendJson(mockRes, 200, { ok: true }, { headers: { origin: "https://evil.com" } });
    assert.strictEqual(capturedHeaders["Access-Control-Allow-Origin"], undefined);
  });

  test("sendJson serializes circular payload safely", () => {
    let capturedBody;
    const mockRes = {
      writeHead() {},
      end(body) { capturedBody = body; },
    };
    const obj = { a: 1 };
    obj.self = obj;
    sendJson(mockRes, 200, obj);
    assert.ok(capturedBody.includes('"[Circular]"'));
  });

  test("sendStaticFile blocks traversal via same-prefix path", () => {
    let capturedStatus;
    let capturedBody;
    const mockRes = {
      writeHead(status) { capturedStatus = status; },
      end(body) { capturedBody = body; },
    };
    sendStaticFile(mockRes, path.resolve("C:\\Users\\x1462\\Documents\\New project\\contract-review-workbench-evil\\secret.txt"));
    assert.strictEqual(capturedStatus, 403);
    assert.ok(String(capturedBody).includes("Forbidden"));
  });

  // --- readJson ---
  await testAsync("readJson parses normal JSON body", async () => {
    const mockReq = Readable.from([Buffer.from('{"foo":"bar"}')]);
    const result = await readJson(mockReq);
    assert.deepStrictEqual(result, { foo: "bar" });
  });

  await testAsync("readJson returns {} for empty body", async () => {
    const mockReq = Readable.from([]);
    const result = await readJson(mockReq);
    assert.deepStrictEqual(result, {});
  });

  await testAsync("readJson rejects invalid JSON", async () => {
    const mockReq = Readable.from([Buffer.from('not json')]);
    let threw = false;
    try {
      await readJson(mockReq);
    } catch (error) {
      threw = true;
      assert.ok(error instanceof SyntaxError);
    }
    assert.ok(threw, "Expected rejection for invalid JSON");
  });

  await testAsync("readJson rejects body > 150MB", async () => {
    let destroyed = false;
    const mockReq = Readable.from([Buffer.alloc(151 * 1024 * 1024, "x")]);
    mockReq.destroy = () => { destroyed = true; };
    let threw = false;
    try {
      await readJson(mockReq);
    } catch (error) {
      threw = true;
      assert.ok(error.message.includes("too large"));
    }
    assert.ok(threw, "Expected rejection for oversized body");
    assert.ok(destroyed, "Expected req.destroy() to be called");
  });

  summary();
})();
