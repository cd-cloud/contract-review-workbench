const { createAiAdapter } = require("./base-adapter");

const adapter = createAiAdapter({
  name: "Visual QA runner",
  envRunnerScript: "VISUAL_QA_RUNNER_SCRIPT",
  envAllowFallback: "VISUAL_QA_ALLOW_FALLBACK",
  defaultOpenAiRunner: "scripts/ai-visual-qa-runner.js",
  defaultCodexRunner: "scripts/ai-visual-qa-runner.js",
  promptVersion: "agent-b-visual-v1",
  skillPath: "legal-work-orchestrator",
  downstreamSkill: "legal-contract-orchestrator",
  fallbackSource: "visual-qa-fallback",
  getExtraRunnerConfig: (providerStatus) => {
    const isCodexCustom = providerStatus.mode === "codex-cli" && providerStatus.codexUsesCustomProvider;
    return {
      timeoutMs: isCodexCustom ? 45 * 1000 : 120 * 1000,
      preferFastFallback: isCodexCustom,
    };
  },
  getExtraStaticStatus: (runnerConfig) => ({
    timeoutMs: runnerConfig.timeoutMs,
    preferFastFallback: runnerConfig.preferFastFallback,
    codexConfiguredProvider: runnerConfig.providerStatus.codexConfiguredProvider || "",
    codexUsesCustomProvider: Boolean(runnerConfig.providerStatus.codexUsesCustomProvider),
    providerBaseUrl: runnerConfig.providerStatus.codexProviderBaseUrl || "",
  }),
});

function runVisualQa(request) {
  return adapter.runWithFallback(request, adapter.runConfiguredCommand, buildFallbackVisualQa);
}

function buildFallbackVisualQa(request = {}) {
  const localChecks = Array.isArray(request.localChecks) ? request.localChecks : [];
  const high = localChecks.filter((item) => item.severity === "high");
  const medium = localChecks.filter((item) => item.severity === "medium");
  const status = high.length ? "blocked" : medium.length ? "needs_attention" : "pass";
  return {
    visualQa: {
      status,
      summary: high.length || medium.length
        ? `本地兜底共识别到 ${high.length} 个高风险、${medium.length} 个中风险的展示或交付问题；当前无法使用 Agent B 模型检查。`
        : "当前无法使用 Agent B 模型检查，本地兜底未发现明显的阻断级展示或编号问题。",
      displayIssues: [],
      structureIssues: localChecks.filter((item) => ["numbering", "subclause-numbering"].includes(item.type)).map(toIssue),
      suggestionPlacementIssues: [],
      numberingIssues: localChecks.filter((item) => ["numbering", "reference", "subclause-numbering"].includes(item.type)).map(toIssue),
      autoFixes: [],
      blockingExportIssues: high.map(toIssue),
      manualReviewItems: medium.map(toIssue),
    },
  };
}

function toIssue(item = {}) {
  return {
    severity: ["high", "medium", "low"].includes(item.severity) ? item.severity : "low",
    type: item.type || "local-check",
    targetId: item.clauseId || "",
    title: item.title || "待复核事项",
    detail: item.detail || "",
    recommendation: item.recommendation || "发送前请人工复核。",
  };
}

module.exports = {
  runVisualQa,
  getRunnerStatus: adapter.getRunnerStatus,
  buildFallbackVisualQa,
  toIssue,
  _resetRunnerStatusForTesting: adapter._resetRunnerStatusForTesting,
};
