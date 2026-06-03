/**
 * Tests for server/jobs.js
 */

const assert = require("assert");
const { createAnalysisJob, cancelJob, summarizeJob, getJob, _clearAllJobsForTesting } = require("../server/jobs");
const { globalCache } = require("../server/analysis-cache");

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
  if (failed) process.exit(1);
}

// Enable fallback so async jobs complete quickly in test environment
process.env.LEGAL_SKILL_ALLOW_FALLBACK = "1";
// Reduce retry delay in tests
process.env.LEGAL_WORKBENCH_MAX_RETRIES = "0";

console.log("\n=== test-jobs.js ===\n");

// --- summarizeJob ---
test("summarizeJob returns correct fields without result", () => {
  const job = {
    id: "job-123",
    status: "queued",
    phase: "test",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:01Z",
    completedAt: null,
    error: null,
    result: { data: "secret" },
    costMeta: null,
  };
  const summary = summarizeJob(job, false);
  assert.strictEqual(summary.id, "job-123");
  assert.strictEqual(summary.status, "queued");
  assert.strictEqual(summary.phase, "test");
  assert.strictEqual(summary.result, undefined);
  assert.strictEqual(summary.completedAt, null);
  assert.strictEqual(summary.costMeta, undefined);
});

test("summarizeJob includes result when requested", () => {
  const job = {
    id: "job-123",
    status: "completed",
    phase: "done",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:01Z",
    completedAt: "2026-01-01T00:01:00Z",
    error: null,
    result: { data: "value" },
    costMeta: { model: "test" },
  };
  const summary = summarizeJob(job, true);
  assert.deepStrictEqual(summary.result, { data: "value" });
  assert.strictEqual(summary.completedAt, "2026-01-01T00:01:00Z");
  assert.deepStrictEqual(summary.costMeta, { model: "test" });
});

test("summarizeJob handles missing completedAt", () => {
  const job = {
    id: "job-123",
    status: "running",
    phase: "working",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:01Z",
    error: null,
    result: null,
    costMeta: null,
  };
  const summary = summarizeJob(job);
  assert.strictEqual(summary.completedAt, null);
});

// --- getJob ---
test("getJob returns undefined for unknown id", () => {
  const result = getJob("nonexistent-job-id");
  assert.strictEqual(result, undefined);
});

// --- createAnalysisJob ---
test("createAnalysisJob returns job with correct initial state", () => {
  _clearAllJobsForTesting();
  globalCache.clear();
  const job = createAnalysisJob({ text: "test" });
  assert.ok(job.id.startsWith("job-"));
  assert.strictEqual(job.status, "queued");
  assert.strictEqual(job.phase, "已进入 Codex 分析队列");
  assert.ok(job.createdAt);
  assert.ok(job.updatedAt);
  assert.strictEqual(job.result, null);
  assert.strictEqual(job.error, null);
  assert.ok(job.__controller instanceof AbortController);
});

test("createAnalysisJob stores job retrievable by getJob", () => {
  _clearAllJobsForTesting();
  globalCache.clear();
  const job = createAnalysisJob({ text: "test2" });
  const retrieved = getJob(job.id);
  assert.ok(retrieved);
  assert.strictEqual(retrieved.id, job.id);
  assert.strictEqual(retrieved.status, "queued");
});

test("createAnalysisJob generates unique ids", () => {
  _clearAllJobsForTesting();
  globalCache.clear();
  const job1 = createAnalysisJob({ text: "a" });
  const job2 = createAnalysisJob({ text: "b" });
  assert.notStrictEqual(job1.id, job2.id);
});

// --- cancelJob ---
test("cancelJob transitions running job to cancelled", () => {
  _clearAllJobsForTesting();
  globalCache.clear();
  const job = createAnalysisJob({ text: "cancel-me" });
  // Force status to running for test
  job.status = "running";
  const cancelled = cancelJob(job.id);
  assert.ok(cancelled);
  assert.strictEqual(cancelled.status, "cancelled");
  assert.strictEqual(cancelled.__aborted, true);
});

test("cancelJob returns null for unknown job", () => {
  const result = cancelJob("nonexistent-job-id");
  assert.strictEqual(result, null);
});

test("cancelJob no-op for already completed job", () => {
  _clearAllJobsForTesting();
  globalCache.clear();
  const job = createAnalysisJob({ text: "done" });
  job.status = "completed";
  const result = cancelJob(job.id);
  assert.strictEqual(result.status, "completed");
});

test("cancelJob aborts the AbortController", () => {
  _clearAllJobsForTesting();
  globalCache.clear();
  const job = createAnalysisJob({ text: "abort-test" });
  job.status = "running";
  assert.strictEqual(job.__controller.signal.aborted, false);
  cancelJob(job.id);
  assert.strictEqual(job.__controller.signal.aborted, true);
});

// Run async tests serially to avoid _clearAllJobsForTesting race conditions
(async function runAsyncTests() {
  // --- cache integration ---
  await testAsync("createAnalysisJob hits cache for identical request", async () => {
    _clearAllJobsForTesting();
    globalCache.clear();
    const request = { contract_text: "cache-hit-test", contract_type: "test" };
    globalCache.set(request, { ok: true, cached: true, __costMeta: { cacheHit: true } });

    const job = createAnalysisJob(request);
    // Wait for setImmediate
    await new Promise((resolve) => setTimeout(resolve, 600));
    const updated = getJob(job.id);
    assert.strictEqual(updated.status, "completed");
    assert.deepStrictEqual(updated.result, { ok: true, cached: true, __costMeta: { cacheHit: true } });
    assert.strictEqual(updated.costMeta.cacheHit, true);
  });

  // --- diff integration ---
  await testAsync("createAnalysisJob attaches diff when previous_text differs", async () => {
    _clearAllJobsForTesting();
    globalCache.clear();
    const request = {
      contract_text: "新文本",
      previous_text: "旧文本",
      contract_type: "test",
    };
    // Fallback path will run because no runner is configured in test
    const job = createAnalysisJob(request);
    await new Promise((resolve) => setTimeout(resolve, 600));
    const updated = getJob(job.id);
    // In fallback path, result should still contain diffReview
    assert.ok(updated.result);
    assert.ok(updated.result.diffReview);
    assert.strictEqual(updated.result.diffReview.changed, true);
  });

  // --- cost metadata ---
  await testAsync("createAnalysisJob includes costMeta in fallback mode", async () => {
    _clearAllJobsForTesting();
    globalCache.clear();
    const job = createAnalysisJob({ contract_text: "cost-test" });
    await new Promise((resolve) => setTimeout(resolve, 600));
    const updated = getJob(job.id);
    assert.ok(updated.costMeta);
    assert.ok(updated.costMeta.source.startsWith("local-bridge-fallback"));
    assert.strictEqual(updated.costMeta.estimatedCostCny, 0);
  });

  // --- retry integration (observed via fallback path) ---
  await testAsync("createAnalysisJob eventually completes even with no runner", async () => {
    _clearAllJobsForTesting();
    globalCache.clear();
    const job = createAnalysisJob({ contract_text: "retry-test" });
    await new Promise((resolve) => setTimeout(resolve, 600));
    const updated = getJob(job.id);
    // With no runner and fallback disabled, job fails after retries
    // With fallback enabled (in dev), job completes
    assert.ok(["completed", "failed"].includes(updated.status));
  });

  summary();
})();
