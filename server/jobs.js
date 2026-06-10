const crypto = require("crypto");
const { sendJson } = require("./http-utils");
const { globalCache } = require("./analysis-cache");
const { saveAnalysisJob, listAnalysisJobs, deleteAnalysisJob } = require("./store");

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
const queuedJobIds = [];

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

function withTimeout(promise, timeoutMs, message, onTimeout) {
  let timer = null;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        if (typeof onTimeout === "function") {
          try { onTimeout(); } catch (e) {}
        }
        reject(new Error(message));
      }, timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function terminateJobChild(job) {
  if (!job?.__child) return;
  try {
    job.__child.kill("SIGTERM");
    setTimeout(() => {
      try {
        if (job.__child && !job.__child.killed) job.__child.kill("SIGKILL");
      } catch (error) {}
    }, 3000);
  } catch (error) {}
}

function countActiveAnalysisJobs() {
  cleanupAnalysisJobs();
  return [...analysisJobs.values()].filter((job) => job.status === "running").length;
}

function queuePhaseForPosition(position) {
  return position > 0 ? `排队中（第 ${position} 位）` : JOB_PHASES.queued;
}

function updateQueuePositions() {
  queuedJobIds.forEach((id, index) => {
    const job = analysisJobs.get(id);
    if (!job || job.status !== "queued") return;
    job.positionInQueue = index;
    job.phase = queuePhaseForPosition(index);
    job.updatedAt = new Date().toISOString();
    saveAnalysisJob(job);
  });
}

function removeFromQueue(id) {
  const index = queuedJobIds.indexOf(id);
  if (index >= 0) {
    queuedJobIds.splice(index, 1);
    updateQueuePositions();
  }
}

function cleanupAnalysisJobs() {
  const now = Date.now();
  for (const [id, job] of analysisJobs.entries()) {
    const updatedAt = Date.parse(job.updatedAt || job.createdAt || "1970-01-01T00:00:00Z") || 0;
    if ((job.status === "queued" || job.status === "running") && now - updatedAt > ANALYSIS_JOB_TIMEOUT_MS) {
      try { job.__controller?.abort(); } catch (e) {}
      terminateJobChild(job);
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
      removeFromQueue(id);
      deleteAnalysisJob(id);
    }
  }
}

const cleanupInterval = setInterval(cleanupAnalysisJobs, 60 * 1000);
if (typeof cleanupInterval.unref === "function") cleanupInterval.unref();

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
      if (attempt < MAX_RETRIES && isRetryableError(error)) {
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
  throw lastError;
}

async function executeAnalysisJob(job, request) {
  const current = analysisJobs.get(job.id);
  if (!current || current.status === "cancelled") return;

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
      positionInQueue: null,
    });
    saveAnalysisJob(current);
    return;
  }

  // 2. Diff review if previous text provided
  let diffResult = null;
  if (request.previous_text && request.contract_text && request.previous_text !== request.contract_text) {
    try {
      const { buildInlineDiffParts } = require("../js/diff-engine");
      diffResult = buildInlineDiffParts(request.previous_text, request.contract_text);
    } catch (e) {}
  }

  Object.assign(current, {
    status: "running",
    phase: JOB_PHASES.running,
    updatedAt: new Date().toISOString(),
    positionInQueue: null,
  });
  saveAnalysisJob(current);

  try {
    const { analyzeLegalReview } = require("./legal-skill-adapter");
    const result = await withTimeout(
      runWithRetry(
        () => analyzeLegalReview(request, {
          signal: current.__controller.signal,
          onChild: (child) => {
            current.__child = child;
          },
        }),
        current,
        current.__controller.signal
      ),
      ANALYSIS_JOB_TIMEOUT_MS,
      "AI legal review job timed out",
      () => { try { current.__controller.abort(); } catch (e) {} }
    );
    if (current.status === "cancelled" || current.__aborted) return;

    if (Array.isArray(diffResult) && diffResult.length > 0) {
      diffResult = diffResult.slice(0, 200);
      result.diffReview = {
        changed: true,
        parts: diffResult,
        summary: `检测到文本差异，共 ${diffResult.length} 个差异片段`,
      };
    }

    const costMeta = buildCostMetadata(result);
    result.__costMeta = costMeta;
    current.costMeta = costMeta;

    globalCache.set(request, result);

    Object.assign(current, {
      status: "completed",
      phase: JOB_PHASES.completed,
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      result,
    });
    saveAnalysisJob(current);
  } catch (error) {
    if (/timed out|timeout/i.test(String(error?.message || error || ""))) {
      try { current.__controller.abort(); } catch (abortError) {}
      terminateJobChild(current);
    }
    if (current.status === "cancelled" || current.__aborted) return;
    Object.assign(current, {
      status: "failed",
      phase: JOB_PHASES.failed,
      updatedAt: new Date().toISOString(),
      error: publicJobError(error),
    });
    saveAnalysisJob(current);
  } finally {
    current.__child = null;
    processAnalysisQueue();
  }
}

function processAnalysisQueue() {
  cleanupAnalysisJobs();
  while (countActiveAnalysisJobs() < MAX_ANALYSIS_JOBS && queuedJobIds.length) {
    const nextId = queuedJobIds.shift();
    updateQueuePositions();
    const nextJob = analysisJobs.get(nextId);
    if (!nextJob || nextJob.status !== "queued" || nextJob.__aborted) continue;
    void executeAnalysisJob(nextJob, nextJob.request);
  }
}

function createAnalysisJob(request) {
  cleanupAnalysisJobs();
  const id = `job-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
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
    request,
    positionInQueue: null,
  };
  analysisJobs.set(id, job);
  queuedJobIds.push(id);
  saveAnalysisJob(job);
  updateQueuePositions();
  setImmediate(processAnalysisQueue);
  return job;
}

function cancelJob(id) {
  const job = analysisJobs.get(id);
  if (!job) return null;
  if (job.status !== "queued" && job.status !== "running") return job;

  job.__aborted = true;
  removeFromQueue(id);
  if (job.__controller) {
    try { job.__controller.abort(); } catch (e) {}
  }
  terminateJobChild(job);

  Object.assign(job, {
    status: "cancelled",
    phase: "Analysis cancelled",
    updatedAt: new Date().toISOString(),
    error: null,
    positionInQueue: null,
  });
  saveAnalysisJob(job);
  processAnalysisQueue();
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
    positionInQueue: job.status === "queued" ? job.positionInQueue ?? 0 : null,
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
  queuedJobIds.splice(0, queuedJobIds.length);
  listAnalysisJobs().forEach((job) => deleteAnalysisJob(job.id));
}

function restoreJobsFromDb() {
  const restorable = listAnalysisJobs(["queued", "running"]);
  const now = Date.now();
  restorable.forEach((job) => {
    const updatedAt = Date.parse(job.updatedAt || job.createdAt || "1970-01-01T00:00:00Z") || 0;
    if (now - updatedAt > ANALYSIS_JOB_TIMEOUT_MS) {
      saveAnalysisJob({
        ...job,
        status: "failed",
        phase: JOB_PHASES.timedOut,
        updatedAt: new Date().toISOString(),
        error: "AI legal review job timed out (restored from DB)",
      });
      return;
    }
    const restored = {
      ...job,
      status: "queued",
      phase: JOB_PHASES.queued,
      updatedAt: new Date().toISOString(),
      completedAt: null,
      __controller: new AbortController(),
      __child: null,
      __aborted: false,
      positionInQueue: null,
    };
    analysisJobs.set(restored.id, restored);
    queuedJobIds.push(restored.id);
    saveAnalysisJob(restored);
  });
  updateQueuePositions();
  if (queuedJobIds.length) setImmediate(processAnalysisQueue);
}

function cancelAllJobs() {
  try { clearInterval(cleanupInterval); } catch (e) {}
  for (const [id, job] of analysisJobs.entries()) {
    if (job.status === "queued" || job.status === "running") {
      cancelJob(id);
    }
  }
}

module.exports = { createAnalysisJob, cancelJob, summarizeJob, getJob, cancelAllJobs, _clearAllJobsForTesting, restoreJobsFromDb };
