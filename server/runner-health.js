function nowIso() {
  return new Date().toISOString();
}

function inferStaticReady(baseStatus = {}) {
  if (!baseStatus.configured) return false;
  if (baseStatus.runnerScriptExists === false) return false;
  const mode = baseStatus.providerMode || baseStatus.mode || "";
  if (mode === "codex-cli" && baseStatus.codexRunnable === false) return false;
  if (mode === "openai-compatible") {
    const provider = String(baseStatus.provider || "").toLowerCase();
    const apiReady = provider === "kimi" || provider === "moonshot"
      ? baseStatus.apiKeyConfigured !== false
      : baseStatus.apiKeyConfigured !== false && baseStatus.baseUrlConfigured !== false;
    if (!apiReady) return false;
  }
  return true;
}

function buildHealthSummary(label, baseStatus, state) {
  const staticReady = inferStaticReady(baseStatus);
  if (!baseStatus.configured) return `${label} is not configured.`;
  if (!staticReady) return `${label} is configured but not currently ready to run.`;
  if (state.lastRunState === "running") return `${label} is running now.`;
  if (state.lastRunState === "succeeded") return `${label} last completed successfully at ${state.lastSuccessAt}.`;
  if (state.lastRunState === "fallback") return `${label} last request fell back at ${state.lastFinishedAt}.`;
  if (state.lastRunState === "failed") return `${label} last request failed at ${state.lastFailureAt}.`;
  return `${label} is configured; no live request has run yet in this process.`;
}

function createRunnerHealthTracker(label, getBaseStatus) {
  const state = {
    lastRunState: "never-run",
    lastStartedAt: null,
    lastFinishedAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastDurationMs: null,
    lastError: "",
    lastSource: "",
    lastFallbackReason: "",
    lastUsedFallback: false,
    activeRuns: 0,
  };

  function startRun() {
    state.activeRuns += 1;
    state.lastRunState = "running";
    state.lastStartedAt = nowIso();
    state.lastError = "";
    state.lastFallbackReason = "";
  }

  function finishRun(nextState, meta = {}) {
    state.activeRuns = Math.max(0, state.activeRuns - 1);
    state.lastRunState = state.activeRuns > 0 ? "running" : nextState;
    state.lastFinishedAt = nowIso();
    state.lastDurationMs = Number.isFinite(Number(meta.durationMs)) ? Number(meta.durationMs) : state.lastDurationMs;
    state.lastSource = meta.source || state.lastSource || "";
    state.lastUsedFallback = Boolean(meta.usedFallback);
    if (nextState === "succeeded") state.lastSuccessAt = state.lastFinishedAt;
    if (nextState === "failed" || nextState === "fallback") state.lastFailureAt = state.lastFinishedAt;
    state.lastError = meta.error || "";
    state.lastFallbackReason = meta.fallbackReason || "";
  }

  return {
    getStatus() {
      const baseStatus = getBaseStatus();
      const staticReady = inferStaticReady(baseStatus);
      return {
        ...baseStatus,
        ready: staticReady && (state.lastRunState === "never-run" || state.lastRunState === "succeeded"),
        staticReady,
        healthy: state.lastRunState === "succeeded",
        degraded: state.lastRunState === "fallback",
        lastRunState: state.lastRunState,
        lastStartedAt: state.lastStartedAt,
        lastFinishedAt: state.lastFinishedAt,
        lastSuccessAt: state.lastSuccessAt,
        lastFailureAt: state.lastFailureAt,
        lastDurationMs: state.lastDurationMs,
        lastError: state.lastError,
        lastSource: state.lastSource,
        lastFallbackReason: state.lastFallbackReason,
        lastUsedFallback: state.lastUsedFallback,
        activeRuns: state.activeRuns,
        summary: buildHealthSummary(label, baseStatus, state),
      };
    },
    startRun,
    markSuccess(meta = {}) {
      finishRun("succeeded", { ...meta, usedFallback: false });
    },
    markFallback(meta = {}) {
      finishRun("fallback", { ...meta, usedFallback: true });
    },
    markFailure(meta = {}) {
      finishRun("failed", { ...meta, usedFallback: false });
    },
    resetForTesting() {
      state.lastRunState = "never-run";
      state.lastStartedAt = null;
      state.lastFinishedAt = null;
      state.lastSuccessAt = null;
      state.lastFailureAt = null;
      state.lastDurationMs = null;
      state.lastError = "";
      state.lastSource = "";
      state.lastFallbackReason = "";
      state.lastUsedFallback = false;
      state.activeRuns = 0;
    },
  };
}

module.exports = { createRunnerHealthTracker, inferStaticReady };
