const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const { parseRunnerJson } = require("./utils");

function getRunnerConfig() {
  return {
    runner: process.env.VISUAL_QA_RUNNER_SCRIPT || "scripts/ai-visual-qa-runner.js",
    allowFallback: process.env.VISUAL_QA_ALLOW_FALLBACK !== "0",
  };
}

function getRunnerStatus() {
  const runnerConfig = getRunnerConfig();
  return {
    configured: Boolean(runnerConfig.runner),
    runnerScript: runnerConfig.runner,
    runnerScriptExists: Boolean(runnerConfig.runner && fs.existsSync(path.resolve(process.cwd(), runnerConfig.runner))),
    allowFallback: runnerConfig.allowFallback,
  };
}

function runVisualQa(request) {
  const runnerConfig = getRunnerConfig();
  return runConfiguredVisualQa(request, runnerConfig).catch((error) => {
    if (!runnerConfig.allowFallback) {
      throw new Error(`Visual QA failed: ${error.message || String(error)}`);
    }
    return {
      ok: true,
      source: "visual-qa-fallback",
      fallbackReason: error.message || String(error),
      ...buildFallbackVisualQa(request),
    };
  });
}

function runConfiguredVisualQa(request, runnerConfig = getRunnerConfig()) {
  return new Promise((resolve, reject) => {
    const runnerPath = path.resolve(process.cwd(), runnerConfig.runner);
    const child = execFile(process.execPath, [runnerPath], { maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${error.message}\n${stderr || ""}`.trim()));
        return;
      }
      try {
        resolve({
          ok: true,
          source: path.basename(runnerConfig.runner),
          ...parseRunnerJson(stdout),
        });
      } catch (parseError) {
        reject(parseError);
      }
    });
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
        ? `Local fallback found ${high.length} high-risk and ${medium.length} medium-risk presentation or delivery issues. Agent B model check is unavailable.`
        : "Agent B model check is unavailable; local fallback found no obvious blocking presentation or numbering issues.",
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
    title: item.title || "Review item",
    detail: item.detail || "",
    recommendation: item.recommendation || "Please review before sending.",
  };
}

module.exports = { runVisualQa, getRunnerStatus, buildFallbackVisualQa, toIssue };
