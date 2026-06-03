const { execFile } = require("child_process");
const path = require("path");
const { parseRunnerJson } = require("./utils");

const RUNNER = process.env.VISUAL_QA_RUNNER_SCRIPT || "scripts/ai-visual-qa-runner.js";
const ALLOW_FALLBACK = process.env.VISUAL_QA_ALLOW_FALLBACK !== "0";

function runVisualQa(request) {
  return runConfiguredVisualQa(request).catch((error) => {
    if (!ALLOW_FALLBACK) {
      throw new Error(`Visual QA 执行失败：${error.message || String(error)}`);
    }
    return {
      ok: true,
      source: "visual-qa-fallback",
      fallbackReason: error.message || String(error),
      ...buildFallbackVisualQa(request),
    };
  });
}

function runConfiguredVisualQa(request) {
  return new Promise((resolve, reject) => {
    const runnerPath = path.resolve(process.cwd(), RUNNER);
    const child = execFile(process.execPath, [runnerPath], { maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${error.message}\n${stderr || ""}`.trim()));
        return;
      }
      try {
        resolve({
          ok: true,
          source: path.basename(RUNNER),
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
        ? `本地兜底检查发现 ${high.length} 个高风险、${medium.length} 个中风险展示/交付问题。Agent B 暂未接通。`
        : "Agent B 暂未接通；本地兜底检查未发现明显展示、编号或导出阻断问题。",
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
    recommendation: item.recommendation || "请在发送前复核。",
  };
}

module.exports = { runVisualQa, buildFallbackVisualQa, toIssue };
