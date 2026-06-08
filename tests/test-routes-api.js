/**
 * Tests for server/routes/api.js
 */

const assert = require("assert");
const { handleApi } = require("../server/routes/api");
const { getApiToken } = require("../server/http-utils");

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

console.log("\n=== test-routes-api.js ===\n");

const API_TOKEN = getApiToken();

function mockRes() {
  return {
    status: null,
    headers: null,
    body: null,
    ended: false,
    writeHead(s, h) { this.status = s; this.headers = h; },
    end(b) { this.body = b; this.ended = true; },
  };
}

function makeUrl(pathname) {
  return new URL(pathname, "http://127.0.0.1:8787");
}

function mockReqWithBody(bodyObj, method = "POST") {
  const body = Buffer.from(JSON.stringify(bodyObj));
  return {
    method,
    headers: { "x-legal-workbench-token": API_TOKEN },
    on(event, handler) {
      if (event === "data") handler(body);
      if (event === "end") handler();
    },
  };
}

function authedReq(method = "GET") {
  return { method, headers: { "x-legal-workbench-token": API_TOKEN } };
}

(async () => {
  await testAsync("handleApi rejects unauthorized requests", async () => {
    const res = mockRes();
    const req = { method: "GET", headers: {} };
    const handled = await handleApi(req, res, makeUrl("/api/health"));
    assert.strictEqual(handled, true);
    assert.strictEqual(res.status, 401);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.error, "Unauthorized");
  });

  await testAsync("handleApi handles OPTIONS without auth", async () => {
    const res = mockRes();
    const req = { method: "OPTIONS", headers: { origin: "http://127.0.0.1:8787" } };
    const handled = await handleApi(req, res, makeUrl("/api/health"));
    assert.strictEqual(handled, true);
    assert.strictEqual(res.status, 204);
  });

  await testAsync("handleApi handles GET /api/health", async () => {
    const res = mockRes();
    const handled = await handleApi(authedReq("GET"), res, makeUrl("/api/health"));
    assert.strictEqual(handled, true);
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.ok, true);
    assert.ok(body.service);
    assert.ok(body.port);
  });

  await testAsync("handleApi handles GET /api/legal-review/runner-status", async () => {
    const res = mockRes();
    const handled = await handleApi(authedReq("GET"), res, makeUrl("/api/legal-review/runner-status"));
    assert.strictEqual(handled, true);
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.ok, true);
    assert.ok(body.runner);
    assert.ok(body.runners.visualQa);
    assert.strictEqual(typeof body.runners.visualQa.lastRunState, "string");
  });

  await testAsync("handleApi handles GET /api/db", async () => {
    const res = mockRes();
    const handled = await handleApi(authedReq("GET"), res, makeUrl("/api/db"));
    assert.strictEqual(handled, true);
    assert.strictEqual(res.status, 200);
  });

  await testAsync("handleApi handles POST /api/db/sync", async () => {
    const res = mockRes();
    const req = mockReqWithBody({ contracts: [] });
    const handled = await handleApi(req, res, makeUrl("/api/db/sync"));
    assert.strictEqual(handled, true);
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.ok, true);
  });

  await testAsync("handleApi handles POST /api/files", async () => {
    const res = mockRes();
    const req = mockReqWithBody({ name: "test.txt", content: "hello" });
    const handled = await handleApi(req, res, makeUrl("/api/files"));
    assert.strictEqual(handled, true);
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.ok, true);
    assert.ok(body.file);
  });

  await testAsync("handleApi handles POST /api/docx/parse with invalid base64", async () => {
    const res = mockRes();
    const req = mockReqWithBody({ name: "test.docx", contentBase64: "invalid!!!" });
    const handled = await handleApi(req, res, makeUrl("/api/docx/parse"));
    assert.strictEqual(handled, true);
    assert.ok(res.status === 200 || res.status === 500);
  });

  await testAsync("handleApi returns false for unknown route", async () => {
    const res = mockRes();
    const handled = await handleApi(authedReq("GET"), res, makeUrl("/api/unknown"));
    assert.strictEqual(handled, false);
    assert.strictEqual(res.status, null);
  });

  await testAsync("handleApi returns false for non-api path", async () => {
    const res = mockRes();
    const handled = await handleApi(authedReq("GET"), res, makeUrl("/js/app.js"));
    assert.strictEqual(handled, false);
    assert.strictEqual(res.status, null);
  });

  await testAsync("handleApi cancels a queued job", async () => {
    const { createAnalysisJob, _clearAllJobsForTesting } = require("../server/jobs");
    _clearAllJobsForTesting();
    const job = createAnalysisJob({ text: "cancel-test" });
    const res = mockRes();
    const req = authedReq("POST");
    const handled = await handleApi(req, res, makeUrl(`/api/legal-review/jobs/${encodeURIComponent(job.id)}/cancel`));
    assert.strictEqual(handled, true);
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.job.status, "cancelled");
  });

  await testAsync("handleApi cancel returns 404 for unknown job", async () => {
    const res = mockRes();
    const req = authedReq("POST");
    const handled = await handleApi(req, res, makeUrl("/api/legal-review/jobs/nonexistent/cancel"));
    assert.strictEqual(handled, true);
    assert.strictEqual(res.status, 404);
  });

  summary();
})();
