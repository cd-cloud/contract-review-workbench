const { sendJson } = require("./http-utils");
const { globalCache } = require("./analysis-cache");

const MAX_ANALYSIS_JOBS = Number(process.env.LEGAL_WORKBENCH_MAX_JOBS || 2);
const ANALYSIS_JOB_TIMEOUT_MS = Number(process.env.LEGAL_WORKBENCH_JOB_TIMEOUT_MS || 10 * 60 * 1000);
const ANALYSIS_JOB_TTL_MS = Number(process.env.LEGAL_WORKBENCH_JOB_TTL_MS || 30 * 60 * 1000);
const MAX_RETRIES = Number(process.env.LEGAL_WORKBENCH_MAX_RETRIES || 2);
const RETRY_BASE_DELAY_MS = Number(process.env.LEGAL_WORKBENCH_RETRY_BASE_MS || 2000);

const JOB_PHASES = {
  queued: "已进入 Codex 分析队列",
  running: "Codex Skill 正在审阅合同",
  completed: "分析完成",
  failed: "分析失败",
  cancelled: "分析已取消",
  timedOut: "Analysis timed out",
};

const analysisJobs = new Map();

function publicJobError(error) {
  const message = String(error?.message || error || "");
  if (/cancelled|canceled|已取消/i.test(message)) return "AI 分析已取消";
  if (/timed out|timeout|超时/i.test(message)) return "AI 分析超时，请稍后重试";
  if (/401|403|Unauthorized|Forbidden/i.test(message)) return "AI 服务认证失败，请检查本地运行配置";
  if (/429|Too many|rate limit/i.test(message)) return "AI 服务请求过于频繁，请稍后再试";
  return process.env.NODE_ENV === "development"
    ? message
    : "AI 审阅暂不可用，请稍后重试";
}

function withTimeout(promise, timeoutMs, message) {
  let timer = null;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function countActiveAnalysisJobs() {
  cleanupAnalysisJobs();
  return [...analysisJobs.values()].filter((job) => job.status === "queued" || job.status === "running").length;
}

function cleanupAnalysisJobs() {
  const now = Date.now();
  for (const [id, job] of analysisJobs.entries()) {
    const updatedAt = Date.parse(job.updatedAt || job.createdAt || "1970-01-01T00:00:00Z") || 0;
    if ((job.status === "queued" || job.status === "running") && now - updatedAt > ANALYSIS_JOB_TIMEOUT_MS) {
      Object.assign(job, {
        status: "failed",
        phase: JOB_PHASES.timedOut,
        updatedAt: new Date().toISOString(),
        error: "AI legal review job timed out",
      });
    }
    const completedAt = Date.parse(job.completedAt || job.updatedAt || job.createdAt || "1970-01-01T00:00:00Z") || 0;
    if (!["queued", "running"].includes(job.status) && now - completedAt > ANALYSIS_JOB_TTL_MS) {
      analysisJobs.delete(id);
    }
  }
}

setInterval(cleanupAnalysisJobs, 60 * 1000).unref?.();

function buildCostMetadata(result) {
  const meta = {
    model: result?.runner?.model || "unknown",
    provider: result?.runner?.provider || "unknown",
    source: result?.source || "unknown",
    ...result?.__costMeta,
  };
  // If the runner returned usage, pass it through
  if (result?.usage) {
    meta.inputTokens = result.usage.prompt_tokens || result.usage.input_tokens || 0;
    meta.outputTokens = result.usage.completion_tokens || result.usage.output_tokens || 0;
    meta.totalTokens = result.usage.total_tokens || (meta.inputTokens + meta.outputTokens);
  }
  // Rough CNY estimate (example rates)
  if (meta.totalTokens) {
    const ratePer1k = meta.model.includes("moonshot") ? 0.024 : 0.03;
    meta.estimatedCostCny = Number(((meta.totalTokens / 1000) * ratePer1k).toFixed(4));
  }
  return meta;
}

async function runWithRetry(fn, job, signal) {
  let lastError = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (signal?.aborted || job?.__aborted) {
      throw new Error("AI analysis was cancelled");
    }
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (signal?.aborted || job?.__aborted) throw error;
      if (attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

function createAnalysisJob(request) {
  cleanupAnalysisJobs();
  if (countActiveAnalysisJobs() >= MAX_ANALYSIS_JOBS) {
    const error = new Error("Too many legal review jobs are already running");
    error.statusCode = 429;
    throw error;
  }
  const id = `job-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const controller = new AbortController();
  const job = {
    id,
    status: "queued",
    phase: JOB_PHASES.queued,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    result: null,
    error: null,
    __controller: controller,
    __child: null,
    costMeta: null,
  };
  analysisJobs.set(id, job);

  setImmediate(async () => {
    const current = analysisJobs.get(id);
    if (!current) return;
    if (current.status === "cancelled") return;

    // 1. Check cache
    const cached = globalCache.get(request);
    if (cached) {
      Object.assign(current, {
        status: "completed",
        phase: JOB_PHASES.completed,
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        result: cached.result,
        costMeta: { ...cached.result?.__costMeta, cacheHit: true },
      });
      return;
    }

    // 2. Diff review if previous text provided
    let diffResult = null;
    if (request.previous_text && request.contract_text && request.previous_text !== request.contract_text) {
      try {
        const { buildInlineDiffParts } = require("../js/diff-engine");
        diffResult = buildInlineDiffParts(request.previous_text, request.contract_text);
      } catch (e) {
        // Non-fatal: diff engine may fail on extreme sizes
      }
    }

    Object.assign(current, {
      status: "running",
      phase: JOB_PHASES.running,
      updatedAt: new Date().toISOString(),
    });

    try {
      const { analyzeLegalReview } = require("./legal-skill-adapter");
      const result = await withTimeout(
        runWithRetry(() => analyzeLegalReview(request, { signal: controller.signal }), current, controller.signal),
        ANALYSIS_JOB_TIMEOUT_MS,
        "AI legal review job timed out"
      );
      if (current.status === "cancelled" || current.__aborted) return;

      // Attach diff result if computed
      if (diffResult) {
        result.diffReview = {
          changed: true,
          parts: diffResult.slice(0, 200),
          summary: `检测到文本差异，共 ${diffResult.length} 个差异片段`,
        };
      }

      // Build cost metadata
      const costMeta = buildCostMetadata(result);
      result.__costMeta = costMeta;
      current.costMeta = costMeta;

      // Store in cache
      globalCache.set(request, result);

      Object.assign(current, {
        status: "completed",
        phase: JOB_PHASES.completed,
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        result,
      });
    } catch (error) {
      if (current.status === "cancelled" || current.__aborted) return;
      Object.assign(current, {
        status: "failed",
        phase: JOB_PHASES.failed,
        updatedAt: new Date().toISOString(),
        error: publicJobError(error),
      });
    }
  });
  return job;
}

function cancelJob(id) {
  const job = analysisJobs.get(id);
  if (!job) return null;
  if (job.status !== "queued" && job.status !== "running") return job;

  job.__aborted = true;
  if (job.__controller) {
    try { job.__controller.abort(); } catch (e) {}
  }
  if (job.__child) {
    try {
      job.__child.kill("SIGTERM");
      setTimeout(() => {
        try { if (!job.__child.killed) job.__child.kill("SIGKILL"); } catch (e) {}
      }, 3000);
    } catch (e) {}
  }

  Object.assign(job, {
    status: "cancelled",
    phase: "Analysis cancelled",
    updatedAt: new Date().toISOString(),
    error: null,
  });
  return job;
}

function summarizeJob(job, includeResult = false) {
  const base = {
    id: job.id,
    status: job.status,
    phase: job.phase,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt || null,
    error: job.error,
    result: includeResult ? job.result : undefined,
  };
  if (job.costMeta) {
    base.costMeta = job.costMeta;
  }
  return base;
}

function getJob(id) {
  return analysisJobs.get(id);
}

function _clearAllJobsForTesting() {
  analysisJobs.clear();
}

module.exports = { createAnalysisJob, cancelJob, summarizeJob, getJob, _clearAllJobsForTesting };
