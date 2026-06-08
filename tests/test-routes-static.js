/**
 * Tests for server/routes/static.js
 */

const assert = require("assert");
const { handleStatic } = require("../server/routes/static");
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

console.log("\n=== test-routes-static.js ===\n");

function mockRes() {
  return {
    status: null,
    headers: null,
    body: null,
    writeHead(s, h) { this.status = s; this.headers = h; },
    end(b) { this.body = b; },
  };
}

function makeUrl(pathname) {
  return new URL(pathname, "http://127.0.0.1:8787");
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

(async () => {
  test("handleStatic routes / to index.html", async () => {
    const res = mockRes();
    const handled = handleStatic({ method: "GET" }, res, makeUrl("/"));
    assert.strictEqual(handled, true);
    await wait(100);
    assert.strictEqual(res.status, 200);
  });

  test("handleStatic routes /index.html", async () => {
    const res = mockRes();
    const handled = handleStatic({ method: "GET" }, res, makeUrl("/index.html"));
    assert.strictEqual(handled, true);
    await wait(100);
    assert.strictEqual(res.status, 200);
  });

  test("handleStatic returns 204 for favicon.ico", () => {
    const res = mockRes();
    const handled = handleStatic({ method: "GET" }, res, makeUrl("/favicon.ico"));
    assert.strictEqual(handled, true);
    assert.strictEqual(res.status, 204);
  });

  test("handleStatic serves runtime-config.js without exposing token", () => {
    const res = mockRes();
    const handled = handleStatic({ method: "GET", headers: { host: "127.0.0.1:8787" } }, res, makeUrl("/js/runtime-config.js"));
    assert.strictEqual(handled, true);
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.includes("LEGAL_WORKBENCH_CONFIG"));
    assert.ok(res.body.includes("LEGAL_WORKBENCH_BACKEND_ORIGIN"));
    assert.ok(res.body.includes("http://127.0.0.1:8787"));
    assert.ok(!res.body.includes("LEGAL_WORKBENCH_API_TOKEN"));
    assert.ok(res.headers["Set-Cookie"]);
  });

  test("handleStatic serves /app.js", async () => {
    const res = mockRes();
    const handled = handleStatic({ method: "GET" }, res, makeUrl("/app.js"));
    assert.strictEqual(handled, true);
    await wait(100);
    assert.strictEqual(res.status, 200);
  });

  test("handleStatic serves /lib/ files", async () => {
    const res = mockRes();
    const handled = handleStatic({ method: "GET" }, res, makeUrl("/lib/normalize.js"));
    assert.strictEqual(handled, true);
    await wait(100);
    assert.strictEqual(res.status, 200);
  });

  test("handleStatic does not handle POST requests", () => {
    const res = mockRes();
    const handled = handleStatic({ method: "POST" }, res, makeUrl("/app.js"));
    assert.strictEqual(handled, false);
    assert.strictEqual(res.status, null);
  });

  test("handleStatic does not handle unknown paths", () => {
    const res = mockRes();
    const handled = handleStatic({ method: "GET" }, res, makeUrl("/unknown"));
    assert.strictEqual(handled, false);
    assert.strictEqual(res.status, null);
  });

  summary();
})();
