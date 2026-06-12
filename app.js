function showGlobalLoading(text = "AI 正在处理...", showCancel = false) {
  const overlay = document.getElementById("global-loading-overlay");
  const textEl = overlay?.querySelector(".global-loading-text");
  const cancelBtn = document.getElementById("global-loading-cancel");
  if (!overlay) return;
  if (textEl) textEl.textContent = text;
  if (cancelBtn) cancelBtn.classList.toggle("hidden", !showCancel);
  overlay.classList.remove("hidden");
}

function hideGlobalLoading() {
  const overlay = document.getElementById("global-loading-overlay");
  if (overlay) overlay.classList.add("hidden");
}

let state = loadState();
let isBackendOnline = true;
let offlineSyncPending = false;
let clauseEditAutosaveTimer = null;

const STALE_JOB_TIMEOUT_MS = 10 * 60 * 1000;

async function checkBackendHealth() {
  try {
    const token = getApiToken ? getApiToken() : "";
    const res = await fetch(`${getBackendUrl ? getBackendUrl() : "http://127.0.0.1:8787"}/api/health`, {
      method: "GET",
      headers: { "X-Legal-Workbench-Token": token },
    });
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
