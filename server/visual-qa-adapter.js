const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const { getProviderStatus } = require("../scripts/ai-runner-lib");
const { parseRunnerJson } = require("./utils");
const { createRunnerHealthTracker } = require("./runner-health");

function getRunnerConfig() {
  const providerStatus = getProviderStatus();
  const isCodexCustom = providerStatus.mode === "codex-cli" && providerStatus.codexUsesCustomProvider;
  return {
    providerStatus,
    runner: process.env.VISUAL_QA_RUNNER_SCRIPT || "scripts/ai-visual-qa-runner.js",
    allowFallback: process.env.VISUAL_QA_ALLOW_FALLBACK !== "0",
    timeoutMs: isCodexCustom ? 45 * 1000 : 120 * 1000,
    preferFastFallback: isCodexCustom,
  };
}

function getStaticRunnerStatus() {
  const runnerConfig = getRunnerConfig();
  return {
    configured: Boolean(runnerConfig.runner),
    runnerScript: runnerConfig.runner,
    runnerScriptExists: Boolean(runnerConfig.runner && fs.existsSync(path.resolve(process.cwd(), runnerConfig.runner))),
    allowFallback: runnerConfig.allowFallback,
    provider: runnerConfig.providerStatus.provider,
    providerMode: runnerConfig.providerStatus.mode || "",
    model: runnerConfig.providerStatus.model || "",
    apiKeyConfigured: runnerConfig.providerStatus.apiKeyConfigured,
    baseUrlConfigured: runnerConfig.providerStatus.baseUrlConfigured,
    codexRunnable: runnerConfig.providerStatus.codexRunnable,
    codexDetail: runnerConfig.providerStatus.codexDetail || "",
    codexConfiguredProvider: runnerConfig.providerStatus.codexConfiguredProvider || "",
    codexUsesCustomProvider: Boolean(runnerConfig.providerStatus.codexUsesCustomProvider),
    providerBaseUrl: runnerConfig.providerStatus.codexProviderBaseUrl || "",
    timeoutMs: runnerConfig.timeoutMs,
    preferFastFallback: runnerConfig.preferFastFallback,
    promptVersion: "agent-b-visual-v1",
    skillPath: "legal-work-orchestrator",
    downstreamSkill: "legal-contract-orchestrator",
  };
}

const runnerHealth = createRunnerHealthTracker("Visual QA runner", getStaticRunnerStatus);

function getRunnerStatus() {
  return runnerHealth.getStatus();
}

function runVisualQa(request) {
  const runnerConfig = getRunnerConfig();
  const startedAt = Date.now();
  runnerHealth.startRun();
  return runConfiguredVisualQa(request, runnerConfig).catch((error) => {
    if (!runnerConfig.allowFallback) {
      runnerHealth.markFailure({
        error: error.message || String(error),
        durationMs: Date.now() - startedAt,
        source: path.basename(runnerConfig.runner || ""),
      });
      throw new Error(`Visual QA failed: ${error.message || String(error)}`);
    }
    const result = {
      ok: true,
      source: "visual-qa-fallback",
      fallbackReason: error.message || String(error),
      promptVersion: "agent-b-visual-v1",
      skillPath: "legal-work-orchestrator",
      downstreamSkill: "legal-contract-orchestrator",
      ...buildFallbackVisualQa(request),
    };
    runnerHealth.markFallback({
      error: error.message || String(error),
      fallbackReason: result.fallbackReason,
      durationMs: Date.now() - startedAt,
      source: result.source,
    });
    return result;
  }).then((result) => {
    if (result?.source !== "visual-qa-fallback") {
      runnerHealth.markSuccess({
        durationMs: Date.now() - startedAt,
        source: result?.source || path.basename(runnerConfig.runner || ""),
      });
    }
    return result;
  });
}

function runConfiguredVisualQa(request, runnerConfig = getRunnerConfig()) {
  return new Promise((resolve, reject) => {
    const runnerPath = path.resolve(process.cwd(), runnerConfig.runner);
    const child = execFile(process.execPath, [runnerPath], { maxBuffer: 20 * 1024 * 1024, timeout: runnerConfig.timeoutMs }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${error.message}\n${stderr || ""}`.trim()));
        return;
      }
      try {
        resolve({
          ok: true,
          source: path.basename(runnerConfig.runner),
          promptVersion: "agent-b-visual-v1",
          skillPath: "legal-work-orchestrator",
          downstreamSkill: "legal-contract-orchestrator",
          ...parseRunnerJson(stdout),
        });
      } catch (parseError) {
        reject(parseError);
      }
    });
    if (child.stdin && typeof child.stdin.on === "function") child.stdin.on("error", () => {});
    child.stdin.write(JSON.stringify(request, null, 2));
    child.stdin.end();
  });
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

module.exports = { runVisualQa, getRunnerStatus, buildFallbackVisualQa, toIssue, _resetRunnerStatusForTesting: () => runnerHealth.resetForTesting() };
