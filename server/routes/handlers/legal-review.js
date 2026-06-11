const { sendJson, readJson, serverErrorPayload } = require("../../http-utils");
const { analyzeLegalReview } = require("../../legal-skill-adapter");
const { createAnalysisJob, cancelJob, summarizeJob, getJob } = require("../../jobs");

async function handleLegalReview(req, res, url) {
  if (req.method === "POST" && url.pathname === "/api/legal-review") {
    try {
      const request = await readJson(req);
      const result = await analyzeLegalReview(request);
      sendJson(res, 200, result, req);
    } catch (error) {
      sendJson(res, error.statusCode || 500, serverErrorPayload(error, "Legal review failed"), req);
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/legal-review/jobs") {
    try {
      const request = await readJson(req);
      const job = createAnalysisJob(request);
      sendJson(res, 202, { ok: true, job: summarizeJob(job) }, req);
    } catch (error) {
      console.error("[legal-review/jobs] Failed to create analysis job:", error);
      sendJson(res, error.statusCode || 500, { ok: false, error: error.message || String(error) }, req);
    }
    return true;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/legal-review/jobs/")) {
    const id = decodeURIComponent(url.pathname.split("/").pop());
    const job = getJob(id);
    if (!job) {
      sendJson(res, 404, { ok: false, error: "Job not found" }, req);
      return true;
    }
    sendJson(res, 200, { ok: true, job: summarizeJob(job, true) }, req);
    return true;
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/legal-review/jobs/") && url.pathname.endsWith("/cancel")) {
    const parts = url.pathname.split("/");
    const id = decodeURIComponent(parts[parts.length - 2] || "");
    const job = getJob(id);
    if (!job) {
      sendJson(res, 404, { ok: false, error: "Job not found" }, req);
      return true;
    }
    cancelJob(id);
    sendJson(res, 200, { ok: true, job: summarizeJob(job, true) }, req);
    return true;
  }

  return false;
}

module.exports = { handleLegalReview };
