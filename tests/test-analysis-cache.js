/**
 * Tests for server/analysis-cache.js
 */

const assert = require("assert");
const { AnalysisCache, globalCache } = require("../server/analysis-cache");

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
  if (failed) process.exit(1);
}

console.log("\n=== test-analysis-cache.js ===\n");

// --- basic get/set ---
test("get returns null for unknown request", () => {
  const cache = new AnalysisCache();
  const result = cache.get({ contract_text: "unknown" });
  assert.strictEqual(result, null);
});

test("set and get round-trip", () => {
  const cache = new AnalysisCache();
  const request = { contract_text: "甲方乙方" };
  const expected = { ok: true, data: "review" };
  cache.set(request, expected);
  const hit = cache.get(request);
  assert.ok(hit);
  assert.deepStrictEqual(hit.result, expected);
  assert.strictEqual(hit.hits, 2);
});

test("get returns cached result with hits count", () => {
  const cache = new AnalysisCache();
  const request = { contract_text: "服务合同" };
  cache.set(request, { score: 80 });
  const first = cache.get(request);
  assert.strictEqual(first.hits, 2);
  const second = cache.get(request);
  assert.strictEqual(second.hits, 3);
});

// --- deduplication by hash ---
test("same text with different whitespace hits cache", () => {
  const cache = new AnalysisCache();
  cache.set({ contract_text: "  甲方乙方  " }, { data: 1 });
  const hit = cache.get({ contract_text: "甲方乙方" });
  assert.ok(hit);
  assert.deepStrictEqual(hit.result, { data: 1 });
});

test("different text misses cache", () => {
  const cache = new AnalysisCache();
  cache.set({ contract_text: "合同A" }, { data: 1 });
  const miss = cache.get({ contract_text: "合同B" });
  assert.strictEqual(miss, null);
});

// --- TTL eviction ---
test("expired entries are evicted on get", () => {
  const cache = new AnalysisCache({ ttlMs: 1 });
  cache.set({ contract_text: "expire" }, { data: 1 });
  // Force expiration
  const entry = cache.map.values().next().value;
  entry.createdAt = Date.now() - 100;
  const miss = cache.get({ contract_text: "expire" });
  assert.strictEqual(miss, null);
  assert.strictEqual(cache.stats().size, 0);
});

test("expired entries are evicted on set", () => {
  const cache = new AnalysisCache({ maxEntries: 2, ttlMs: 1 });
  cache.set({ contract_text: "a" }, { data: 1 });
  const entry = cache.map.values().next().value;
  entry.createdAt = Date.now() - 100;
  cache.set({ contract_text: "b" }, { data: 2 });
  assert.strictEqual(cache.stats().size, 1);
});

// --- LRU eviction ---
test("oldest entries evicted when maxEntries exceeded", () => {
  const cache = new AnalysisCache({ maxEntries: 2, ttlMs: 999999 });
  cache.set({ contract_text: "a" }, { data: 1 });
  cache.set({ contract_text: "b" }, { data: 2 });
  cache.set({ contract_text: "c" }, { data: 3 });
  assert.strictEqual(cache.stats().size, 2);
  assert.strictEqual(cache.get({ contract_text: "a" }), null);
  assert.ok(cache.get({ contract_text: "b" }));
  assert.ok(cache.get({ contract_text: "c" }));
});

test("touch updates LRU order", () => {
  const cache = new AnalysisCache({ maxEntries: 2, ttlMs: 999999 });
  cache.set({ contract_text: "a" }, { data: 1 });
  cache.set({ contract_text: "b" }, { data: 2 });
  // Touch a so it becomes most-recently-used
  cache.get({ contract_text: "a" });
  cache.set({ contract_text: "c" }, { data: 3 });
  assert.ok(cache.get({ contract_text: "a" }));
  assert.strictEqual(cache.get({ contract_text: "b" }), null);
  assert.ok(cache.get({ contract_text: "c" }));
});

// --- invalidate ---
test("invalidate removes specific entry", () => {
  const cache = new AnalysisCache();
  cache.set({ contract_text: "x" }, { data: 1 });
  cache.invalidate({ contract_text: "x" });
  assert.strictEqual(cache.get({ contract_text: "x" }), null);
});

// --- clear ---
test("clear removes all entries", () => {
  const cache = new AnalysisCache();
  cache.set({ contract_text: "x" }, { data: 1 });
  cache.set({ contract_text: "y" }, { data: 2 });
  cache.clear();
  assert.strictEqual(cache.stats().size, 0);
});

// --- stats ---
test("stats returns correct size and limits", () => {
  const cache = new AnalysisCache({ maxEntries: 50, ttlMs: 60000 });
  cache.set({ contract_text: "s" }, { data: 1 });
  const stats = cache.stats();
  assert.strictEqual(stats.size, 1);
  assert.strictEqual(stats.maxEntries, 50);
  assert.strictEqual(stats.ttlMs, 60000);
});

// --- globalCache ---
test("globalCache is a singleton AnalysisCache", () => {
  assert.ok(globalCache instanceof AnalysisCache);
});

// --- contract options in key ---
test("different contract_type produces different cache keys", () => {
  const cache = new AnalysisCache();
  cache.set({ contract_text: "same", contract_type: "A" }, { data: "A" });
  const miss = cache.get({ contract_text: "same", contract_type: "B" });
  assert.strictEqual(miss, null);
});

test("same contract options produce same cache key", () => {
  const cache = new AnalysisCache();
  cache.set({ contract_text: "same", contract_type: "A", represented_party: "甲方" }, { data: 1 });
  const hit = cache.get({ contract_text: "same", contract_type: "A", represented_party: "甲方" });
  assert.ok(hit);
});

test("different jurisdiction produces different cache keys", () => {
  const cache = new AnalysisCache();
  cache.set({ contract_text: "same", contract_type: "A", jurisdiction: "中国大陆" }, { data: "cn" });
  const miss = cache.get({ contract_text: "same", contract_type: "A", jurisdiction: "香港" });
  assert.strictEqual(miss, null);
});

test("different extra requirements produce different cache keys", () => {
  const cache = new AnalysisCache();
  cache.set({ contract_text: "same", drafting_requirements: "更保护甲方" }, { data: "a" });
  const miss = cache.get({ contract_text: "same", drafting_requirements: "更平衡" });
  assert.strictEqual(miss, null);
});

test("different prompt version produces different cache keys", () => {
  const cache = new AnalysisCache();
  cache.set({ contract_text: "same", prompt_version: "v1" }, { data: "v1" });
  const miss = cache.get({ contract_text: "same", prompt_version: "v2" });
  assert.strictEqual(miss, null);
});

summary();
