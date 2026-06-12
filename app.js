let globalLoadingStartedAt = 0;
let globalLoadingTimer = null;
let globalLoadingCancelHandler = null;
let globalLoadingMeta = "";

function normalizeLoadingOptions(input, showCancel = false) {
  if (typeof input === "object" && input !== null) {
    return {
      title: input.title || input.text || "AI 正在处理...",
      detail: input.detail || "正在提交任务，请稍候。",
      meta: input.meta || "",
      steps: Array.isArray(input.steps) ? input.steps : [],
      showCancel: Boolean(input.showCancel),
      cancelText: input.cancelText || "取消",
      onCancel: input.onCancel,
    };
  }
  return {
    title: input || "AI 正在处理...",
    detail: "正在提交任务，请稍候。",
    meta: "",
    steps: [],
    showCancel,
    cancelText: "取消",
    onCancel: null,
  };
}

function elapsedLoadingText() {
  if (!globalLoadingStartedAt) return "已等待 0 秒";
  const seconds = Math.max(0, Math.round((Date.now() - globalLoadingStartedAt) / 1000));
  if (seconds < 90) return `已等待 ${seconds} 秒`;
  return `已等待 ${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

function renderGlobalLoadingSteps(steps = []) {
  return steps.map((step) => {
    const label = typeof step === "string" ? step : step.label;
    const status = typeof step === "string" ? "pending" : (step.status || "pending");
    return `<li class="global-loading-step ${escapeHtml(status)}">${escapeHtml(label || "")}</li>`;
  }).join("");
}

function setGlobalLoadingStatus(update = {}) {
  const overlay = document.getElementById("global-loading-overlay");
  const textEl = overlay?.querySelector(".global-loading-text");
  const detailEl = overlay?.querySelector(".global-loading-detail");
  const metaEl = overlay?.querySelector(".global-loading-meta");
  const stepsEl = overlay?.querySelector(".global-loading-steps");
  const cancelBtn = document.getElementById("global-loading-cancel");
  if (!overlay) return;
  if (update.title && textEl) textEl.textContent = update.title;
  if (update.detail && detailEl) detailEl.textContent = update.detail;
  if ("meta" in update) globalLoadingMeta = update.meta || "";
  if (metaEl) metaEl.textContent = [elapsedLoadingText(), globalLoadingMeta].filter(Boolean).join("｜");
  if (stepsEl && Array.isArray(update.steps)) stepsEl.innerHTML = renderGlobalLoadingSteps(update.steps);
  if (cancelBtn && "showCancel" in update) cancelBtn.classList.toggle("hidden", !update.showCancel);
  if (cancelBtn && update.cancelText) cancelBtn.textContent = update.cancelText;
}

function showGlobalLoading(input = "AI 正在处理...", showCancel = false) {
  const overlay = document.getElementById("global-loading-overlay");
  const cancelBtn = document.getElementById("global-loading-cancel");
  if (!overlay) return;
  const options = normalizeLoadingOptions(input, showCancel);
  globalLoadingStartedAt = Date.now();
  globalLoadingCancelHandler = typeof options.onCancel === "function" ? options.onCancel : null;
  if (globalLoadingTimer) clearInterval(globalLoadingTimer);
  globalLoadingTimer = setInterval(() => setGlobalLoadingStatus({}), 1000);
  if (typeof globalLoadingTimer.unref === "function") globalLoadingTimer.unref();
  if (cancelBtn) {
    cancelBtn.disabled = false;
    cancelBtn.onclick = () => {
      if (globalLoadingCancelHandler) globalLoadingCancelHandler();
    };
  }
  setGlobalLoadingStatus(options);
  overlay.classList.remove("hidden");
}

function hideGlobalLoading() {
  const overlay = document.getElementById("global-loading-overlay");
  if (globalLoadingTimer) clearInterval(globalLoadingTimer);
  globalLoadingTimer = null;
  globalLoadingStartedAt = 0;
  globalLoadingCancelHandler = null;
  globalLoadingMeta = "";
  const cancelBtn = document.getElementById("global-loading-cancel");
  if (cancelBtn) {
    cancelBtn.disabled = false;
    cancelBtn.onclick = null;
  }
  if (overlay) overlay.classList.add("hidden");
}

let state = loadState();
let isBackendOnline = true;
let offlineSyncPending = false;
let clauseEditAutosaveTimer = null;

const STALE_JOB_TIMEOUT_MS = 10 * 60 * 1000;

async function checkBackendHealth() {
  try {
    const request = typeof legalWorkbenchFetch === "function"
      ? legalWorkbenchFetch("/api/health", { method: "GET" })
      : fetch("/api/health", { method: "GET", credentials: "include" });
    const res = await request;
    if (res.ok && !isBackendOnline) {
      isBackendOnline = true;
      hideOfflineBanner();
      if (offlineSyncPending) {
        flushBackendSync();
        offlineSyncPending = false;
      }
    }
  } catch (error) {
    if (isBackendOnline) {
      isBackendOnline = false;
      showOfflineBanner();
    }
  }
}

function showOfflineBanner() {
  let banner = document.getElementById("offline-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "offline-banner";
    banner.className = "offline-banner";
    banner.textContent = "后端服务暂时断开，编辑内容已缓存到本地。恢复后将自动同步。";
    document.body.appendChild(banner);
  }
  banner.classList.remove("hidden");
}

function hideOfflineBanner() {
  const banner = document.getElementById("offline-banner");
  if (banner) banner.classList.add("hidden");
}

// Check backend health every 30 seconds
TimerRegistry.set("backend-health", setInterval(checkBackendHealth, 30000));
window.addEventListener("beforeunload", () => TimerRegistry.clear("backend-health"));

document.addEventListener("dblclick", handleDocumentDblclick);
document.addEventListener("focusout", handleDocumentFocusout);
document.addEventListener("change", handleDocumentChange);
document.addEventListener("input", handleDocumentInput);
document.addEventListener("submit", handleDocumentSubmit);

document.querySelector("#upload-form").addEventListener("submit", handleUploadFormSubmit);
document.querySelector("#progress-form").addEventListener("submit", handleProgressFormSubmit);
document.querySelector("#add-clause-form").addEventListener("submit", handleAddClauseFormSubmit);

render();

hydrateFromBackendOnStart().then((loaded) => {
  if (loaded) render();
});

refreshRunnerStatus().then(() => {
  if (getCurrentViewName() === "review") renderReview();
});
