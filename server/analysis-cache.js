/**
 * Analysis cache: LRU + TTL deduplication for legal review results.
 * Keys are SHA-256 hashes of normalized contract text + analysis options.
 */

const crypto = require("crypto");

const config = require("./config");
const MAX_CACHE_ENTRIES = config.cacheMaxEntries;
const CACHE_TTL_MS = config.cacheTtlMs;
const MAX_CACHE_BYTES = Number(process.env.LEGAL_WORKBENCH_CACHE_MAX_BYTES || 100 * 1024 * 1024);

function estimateSize(value) {
  try {
    return JSON.stringify(value).length * 2; // rough UTF-16 byte estimate
  } catch {
    return 1024 * 1024; // fallback 1MB
  }
}

class AnalysisCache {
  constructor({ maxEntries = MAX_CACHE_ENTRIES, ttlMs = CACHE_TTL_MS, maxBytes = MAX_CACHE_BYTES } = {}) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
    this.maxBytes = maxBytes;
    this.map = new Map(); // hash -> { result, createdAt, hits, sizeBytes }
    this.accessOrder = []; // LRU list of hashes
    this.currentBytes = 0;
  }

  _makeKey(request) {
    // Normalize request to stable string for hashing
    const norm = {
      text: String(request.contract_text || request.text || "").trim(),
      type: request.contract_type || "",
      typeCategory: request.contract_type_category || "",
      jurisdiction: request.jurisdiction || "",
      party: request.represented_party || "",
      counterparty: request.counterparty || "",
      background: request.business_background || "",
      extraRequirements: request.drafting_requirements || request.extraRequirements || "",
      previousText: request.previous_text || "",
      clauses: Array.isArray(request.clauses)
        ? request.clauses.map((clause) => ({
          id: clause?.id || "",
          stableId: clause?.stableId || "",
          number: clause?.number || "",
          title: clause?.title || "",
          type: clause?.type || "",
          text: clause?.text || "",
        }))
        : [],
      provider: request.provider || request.model_provider || "",
      model: request.model || request.model_name || "",
      promptVersion: request.prompt_version || request.promptVersion || "",
      skill: request.skill || "",
      downstreamSkill: request.downstream_skill || request.downstreamSkill || "",
    };
    const payload = JSON.stringify(norm);
    return crypto.createHash("sha256").update(payload).digest("hex");
  }

  _touch(key) {
    const idx = this.accessOrder.indexOf(key);
    if (idx >= 0) this.accessOrder.splice(idx, 1);
    this.accessOrder.push(key);
  }

  _evictIfNeeded() {
    const now = Date.now();
    // Evict expired entries first
    for (const [key, entry] of this.map.entries()) {
      if (now - entry.createdAt > this.ttlMs) {
        this.currentBytes -= entry.sizeBytes || 0;
        this.map.delete(key);
        const idx = this.accessOrder.indexOf(key);
        if (idx >= 0) this.accessOrder.splice(idx, 1);
      }
    }
    // Evict oldest if still over byte or entry limit
    while (this.accessOrder.length && (this.map.size > this.maxEntries || this.currentBytes > this.maxBytes)) {
      const oldest = this.accessOrder.shift();
      const entry = this.map.get(oldest);
      if (entry) {
        this.currentBytes -= entry.sizeBytes || 0;
        this.map.delete(oldest);
      }
    }
  }

  get(request) {
    const key = this._makeKey(request);
    const entry = this.map.get(key);
    if (!entry) return null;
    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.currentBytes -= entry.sizeBytes || 0;
      this.map.delete(key);
      const idx = this.accessOrder.indexOf(key);
      if (idx >= 0) this.accessOrder.splice(idx, 1);
      return null;
    }
    entry.hits += 1;
    this._touch(key);
    return { result: entry.result, hits: entry.hits, cachedAt: entry.createdAt };
  }

  set(request, result) {
    const key = this._makeKey(request);
    const sizeBytes = estimateSize(result);
    this._evictIfNeeded();
    // If key already exists, update in place
    if (this.map.has(key)) {
      const entry = this.map.get(key);
      this.currentBytes -= entry.sizeBytes || 0;
      entry.result = result;
      entry.createdAt = Date.now();
      entry.hits += 1;
      entry.sizeBytes = sizeBytes;
      this.currentBytes += sizeBytes;
      this._touch(key);
      return;
    }
    // Evict if at capacity
    if ((this.map.size >= this.maxEntries || this.currentBytes + sizeBytes > this.maxBytes) && this.accessOrder.length) {
      const oldest = this.accessOrder.shift();
      const oldEntry = this.map.get(oldest);
      if (oldEntry) this.currentBytes -= oldEntry.sizeBytes || 0;
      this.map.delete(oldest);
    }
    this.map.set(key, { result, createdAt: Date.now(), hits: 1, sizeBytes });
    this.currentBytes += sizeBytes;
    this.accessOrder.push(key);
  }

  invalidate(request) {
    const key = this._makeKey(request);
    const entry = this.map.get(key);
    if (entry) this.currentBytes -= entry.sizeBytes || 0;
    this.map.delete(key);
    const idx = this.accessOrder.indexOf(key);
    if (idx >= 0) this.accessOrder.splice(idx, 1);
  }

  clear() {
    this.map.clear();
    this.accessOrder.length = 0;
    this.currentBytes = 0;
  }

  stats() {
    return {
      size: this.map.size,
      maxEntries: this.maxEntries,
      ttlMs: this.ttlMs,
      maxBytes: this.maxBytes,
      currentBytes: this.currentBytes,
    };
  }
}

// Singleton instance used by the server
const globalCache = new AnalysisCache();

module.exports = {
  AnalysisCache,
  globalCache,
};
