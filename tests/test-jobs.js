/**
 * Tests for server/jobs.js
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

process.env.LEGAL_WORKBENCH_DATA_DIR = path.join(__dirname, ".tmp-test-jobs");
fs.rmSync(process.env.LEGAL_WORKBENCH_DATA_DIR, { recursive: true, force: true });

const { createAnalysisJob, cancelJob, summarizeJob, getJob, _clearAllJobsForTesting } = require("../server/jobs");
const { globalCache } = require("../server/analysis-cache");
const legalSkillAdapter = require("../server/legal-skill-adapter");
const store = require("../server/store");

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
  const summaryResult = summarizeJob(job, false);
  assert.strictEqual(summaryResult.id, "job-123");
  assert.strictEqual(summaryResult.status, "queued");
  assert.strictEqual(summaryResult.phase, "test");
  assert.strictEqual(summaryResult.result, undefined);
  assert.strictEqual(summaryResult.completedAt, null);
  assert.strictEqual(summaryResult.costMeta, undefined);
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
  const summaryResult = summarizeJob(job, true);
  assert.deepStrictEqual(summaryResult.result, { data: "value" });
  assert.strictEqual(summaryResult.completedAt, "2026-01-01T00:01:00Z");
  assert.deepStrictEqual(summaryResult.costMeta, { model: "test" });
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
  const summaryResult = summarizeJob(job);
  assert.strictEqual(summaryResult.completedAt, null);
});

test("getJob returns undefined for unknown id", () => {
  const result = getJob("nonexistent-job-id");
  assert.strictEqual(result, undefined);
});

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

test("cancelJob transitions running job to cancelled", () => {
  _clearAllJobsForTesting();
  globalCache.clear();
  const job = createAnalysisJob({ text: "cancel-me" });
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
  const job = createAnalysisJob({ contract_text: "abort-test" });
  job.status = "running";
  assert.strictEqual(job.__controller.signal.aborted, false);
  cancelJob(job.id);
  assert.strictEqual(job.__controller.signal.aborted, true);
});

test("cancelJob terminates attached child process", () => {
  _clearAllJobsForTesting();
  globalCache.clear();
  let killed = [];
  const job = createAnalysisJob({ contract_text: "child-kill-test" });
  job.status = "running";
  job.__child = {
    killed: false,
    kill(signal) {
      killed.push(signal);
      if (signal === "SIGKILL") this.killed = true;
    },
  };
  cancelJob(job.id);
  assert.ok(killed.includes("SIGTERM"));
});

(async function runAsyncTests() {
  await testAsync("createAnalysisJob hits cache for identical request", async () => {
    _clearAllJobsForTesting();
    globalCache.clear();
    const request = { contract_text: "cache-hit-test", contract_type: "test" };
    globalCache.set(request, { ok: true, cached: true, __costMeta: { cacheHit: true } });

    const job = createAnalysisJob(request);
    await new Promise((resolve) => setTimeout(resolve, 600));
    const updated = getJob(job.id);
    assert.strictEqual(updated.status, "completed");
    assert.deepStrictEqual(updated.result, { ok: true, cached: true, __costMeta: { cacheHit: true } });
    assert.strictEqual(updated.costMeta.cacheHit, true);
  });

  await testAsync("createAnalysisJob attaches diff when previous_text differs", async () => {
    _clearAllJobsForTesting();
    globalCache.clear();
    const request = {
      contract_text: "新文本",
      previous_text: "旧文本",
      contract_type: "test",
    };
    const job = createAnalysisJob(request);
    await new Promise((resolve) => setTimeout(resolve, 600));
    const updated = getJob(job.id);
    assert.ok(updated.result);
    assert.ok(updated.result.diffReview);
    assert.strictEqual(updated.result.diffReview.changed, true);
  });

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

  await testAsync("createAnalysisJob eventually completes even with no runner", async () => {
    _clearAllJobsForTesting();
    globalCache.clear();
    const job = createAnalysisJob({ contract_text: "retry-test" });
    await new Promise((resolve) => setTimeout(resolve, 600));
    const updated = getJob(job.id);
    assert.ok(["completed", "failed"].includes(updated.status));
  });

  await testAsync("createAnalysisJob queues jobs beyond concurrency limit instead of throwing 429", async () => {
    _clearAllJobsForTesting();
    globalCache.clear();
    const originalAnalyzeLegalReview = legalSkillAdapter.analyzeLegalReview;
    legalSkillAdapter.analyzeLegalReview = async (request) => {
      await new Promise((resolve) => setTimeout(resolve, 80));
      return { ok: true, source: "mock-job-runner", request, response: { contractSummary: {}, clauseSegmentation: [], contractLevelRisks: [], clauseAnalyses: [], missingFacts: [], businessSummary: "" } };
    };

    try {
      const job1 = createAnalysisJob({ contract_text: "queue-a" });
      const job2 = createAnalysisJob({ contract_text: "queue-b" });
      const job3 = createAnalysisJob({ contract_text: "queue-c" });
      assert.strictEqual(summarizeJob(job3).positionInQueue, 2);

      await new Promise((resolve) => setTimeout(resolve, 20));
      const current1 = getJob(job1.id);
      const current2 = getJob(job2.id);
      const current3 = getJob(job3.id);
      assert.strictEqual(current1.status, "running");
      assert.strictEqual(current2.status, "running");
      assert.strictEqual(current3.status, "queued");
      assert.strictEqual(summarizeJob(current3).positionInQueue, 0);

      await new Promise((resolve) => setTimeout(resolve, 180));
      const final3 = getJob(job3.id);
      assert.strictEqual(final3.status, "completed");
    } finally {
      legalSkillAdapter.analyzeLegalReview = originalAnalyzeLegalReview;
    }
  });

  await testAsync("restoreJobsFromDb fails persisted jobs whose large request text was stripped", async () => {
    _clearAllJobsForTesting();
    globalCache.clear();
    store.saveAnalysisJob({
      id: "job-persist-queued",
      status: "queued",
      phase: "已进入 Codex 分析队列",
      request: { contract_text: "persist queued" },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    store.saveAnalysisJob({
      id: "job-persist-running",
      status: "running",
      phase: "Codex Skill 正在审阅合同",
      request: { contract_text: "persist running" },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    delete require.cache[require.resolve("../server/jobs")];
    const reloadedJobs = require("../server/jobs");
    reloadedJobs.restoreJobsFromDb();
    const queued = reloadedJobs.getJob("job-persist-queued");
    const running = reloadedJobs.getJob("job-persist-running");
    assert.strictEqual(queued, undefined);
    assert.strictEqual(running, undefined);
    const persisted = store.listAnalysisJobs(["failed"]);
    assert.ok(persisted.some((job) => job.id === "job-persist-queued" && /without contract text/.test(job.error)));
    assert.ok(persisted.some((job) => job.id === "job-persist-running" && /without contract text/.test(job.error)));
    reloadedJobs._clearAllJobsForTesting();
  });

  summary();
})();
