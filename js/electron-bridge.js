/**
 * Electron bridge — detects desktop environment and enhances UI
 * with native capabilities (open folder, save dialog, etc.).
 */

(function () {
  const isElectron = !!(window.electronAPI || (window.process && window.process.versions && window.process.versions.electron));

  if (!isElectron) {
    console.log("[ElectronBridge] Running in browser mode.");
    return;
  }

  console.log("[ElectronBridge] Running in Electron mode.");
  document.body.classList.add("electron-mode");

  // Expose helper for other modules
  window.isElectronApp = true;

  // Enhance topbar with "Open Archive Folder" button
  function enhanceTopbar() {
    const topbarActions = document.querySelector(".topbar-actions");
    if (!topbarActions || topbarActions.querySelector("[data-open-archive]")) return;

    const btn = document.createElement("button");
    btn.className = "ghost-button";
    btn.setAttribute("data-open-archive", "");
    btn.title = "打开合同归档文件夹";
    btn.textContent = "📁 归档";
    btn.style.marginRight = "8px";
    btn.addEventListener("click", async () => {
      try {
        const paths = await window.electronAPI.getPaths();
        if (paths && paths.contractsDir) {
          await window.electronAPI.openFolder(paths.contractsDir);
        }
      } catch (e) {
        console.error("[ElectronBridge] Failed to open folder:", e);
      }
    });

    const firstChild = topbarActions.firstElementChild;
    if (firstChild) {
      topbarActions.insertBefore(btn, firstChild);
    } else {
      topbarActions.appendChild(btn);
    }
  }

  // Enhance contract cards with "Open Folder" link
  function enhanceContractCards() {
    document.querySelectorAll(".contract-card, .review-contract-identity").forEach((card) => {
      if (card.querySelector("[data-open-contract-folder]")) return;
      const nameEl = card.querySelector("h3, .section-title");
      if (!nameEl) return;

      const link = document.createElement("button");
      link.className = "small-button";
      link.setAttribute("data-open-contract-folder", "");
      link.textContent = "📂";
      link.title = "打开合同归档文件夹";
      link.style.marginLeft = "8px";
      link.style.fontSize = "12px";
      link.addEventListener("click", async (e) => {
        e.stopPropagation();
        try {
          const contract = Store.getActiveContract();
          if (!contract) return;
          const res = await legalWorkbenchFetch("/api/contracts");
          if (!res.ok) return;
          const data = await res.json();
          const match = data.contracts?.find((c) => c.id === contract.id);
          if (match?.folderPath) {
            await window.electronAPI.openFolder(match.folderPath);
          }
        } catch (err) {
          console.error("[ElectronBridge]", err);
        }
      });

      nameEl.appendChild(link);
    });
  }

  // Observe DOM changes to enhance dynamically rendered elements
  let observer = null;
  let enhancementDebounce = null;

  function runEnhancements() {
    TimerRegistry.clear("electron-bridge-enhance");
    TimerRegistry.set("electron-bridge-enhance", setTimeout(() => {
      enhanceTopbar();
      enhanceContractCards();
    }, 50));
  }

  function startObserving() {
    if (!document.body) {
      TimerRegistry.set("electron-bridge-start", setTimeout(startObserving, 100));
      return;
    }
    if (observer) {
      try { observer.disconnect(); } catch (e) {}
    }
    observer = new MutationObserver(runEnhancements);
    observer.observe(document.body, { childList: true, subtree: true });
    runEnhancements();
  }

  function handleVisibilityChange() {
    if (document.hidden && observer) {
      try { observer.disconnect(); } catch (e) {}
    } else if (!document.hidden) {
      startObserving();
    }
  }
  function handleBeforeUnload() {
    TimerRegistry.clear("electron-bridge-enhance");
    TimerRegistry.clear("electron-bridge-start");
    if (observer) {
      try { observer.disconnect(); } catch (e) {}
    }
  }
  function handleDomReady() {
    startObserving();
  }

  if (typeof document.removeEventListener === "function") {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
  }
  if (typeof window.removeEventListener === "function") {
    window.removeEventListener("beforeunload", handleBeforeUnload);
  }
  if (typeof document.removeEventListener === "function") {
    document.removeEventListener("DOMContentLoaded", handleDomReady);
  }

  // Disconnect when page is hidden to reduce CPU during background operations
  if (typeof document.addEventListener === "function") {
    document.addEventListener("visibilitychange", handleVisibilityChange);
  }

  // Cleanup on page unload to prevent observer leaks during hot reload
  if (typeof window.addEventListener === "function") {
    window.addEventListener("beforeunload", handleBeforeUnload);
  }

  if (document.readyState === "loading") {
    if (typeof document.addEventListener === "function") {
      document.addEventListener("DOMContentLoaded", handleDomReady);
    }
  } else {
    startObserving();
  }
})();
