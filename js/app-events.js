async function handleGlobalClick(event) {
  if (handleNavClick(event)) return;
  if (handleModalClick(event)) return;
  if (handleProgressClick(event)) return;
  if (handleReviewClick(event)) return;
  if (handleContractNavClick(event)) return;
  if (handleWorkbenchClick(event)) return;
  if (handleContractRiskClick(event)) return;
  if (await handleClauseRiskClick(event)) return;
  if (await handleClauseActionClick(event)) return;
  if (await handleExportClick(event)) return;
  if (await handleBackendClick(event)) return;
  if (handleDraftClick(event)) return;
}

async function dispatchGlobalClick(event) {
  try {
    await handleGlobalClick(event);
  } catch (error) {
    console.error("[app-events] Global click handler error:", error);
  }
}

function handleDragStart(event) {
  const subcard = event.target.closest("[data-subclause-card]");
  if (subcard) {
    event.dataTransfer.setData("application/x-subclause", subcard.dataset.subclauseCard);
    event.dataTransfer.effectAllowed = "move";
    return;
  }
  const card = event.target.closest("[data-clause-card]");
  if (!card) return;
  event.dataTransfer.setData("text/plain", card.dataset.clauseCard);
  event.dataTransfer.effectAllowed = "move";
}

function handleDragOver(event) {
  const subcard = event.target.closest("[data-subclause-card]");
  if (subcard) {
    event.preventDefault();
    subcard.classList.add("drag-over");
    return;
  }
  const card = event.target.closest("[data-clause-card]");
  if (!card) return;
  event.preventDefault();
  card.classList.add("drag-over");
}

function handleDragLeave(event) {
  const subcard = event.target.closest("[data-subclause-card]");
  if (subcard) subcard.classList.remove("drag-over");
  const card = event.target.closest("[data-clause-card]");
  if (card) card.classList.remove("drag-over");
}

function handleDrop(event) {
  const targetSubcard = event.target.closest("[data-subclause-card]");
  if (targetSubcard) {
    event.preventDefault();
    document.querySelectorAll(".drag-over").forEach((node) => node.classList.remove("drag-over"));
    const draggedSubclauseId = event.dataTransfer.getData("application/x-subclause");
    const targetSubclauseId = targetSubcard.dataset.subclauseCard;
    if (!draggedSubclauseId || draggedSubclauseId === targetSubclauseId) return;
    reorderSubclauseByDrag(draggedSubclauseId, targetSubclauseId);
    return;
  }

  const targetCard = event.target.closest("[data-clause-card]");
  if (!targetCard) return;
  event.preventDefault();
  document.querySelectorAll(".drag-over").forEach((node) => node.classList.remove("drag-over"));
  const draggedClauseId = event.dataTransfer.getData("text/plain");
  const targetClauseId = targetCard.dataset.clauseCard;
  if (!draggedClauseId || draggedClauseId === targetClauseId) return;
  reorderClauseByDrag(draggedClauseId, targetClauseId);
}

function attachGlobalAppListeners() {
  if (typeof document.removeEventListener !== "function" || typeof document.addEventListener !== "function") return;
  document.removeEventListener("click", dispatchGlobalClick);
  document.removeEventListener("dragstart", handleDragStart);
  document.removeEventListener("dragover", handleDragOver);
  document.removeEventListener("dragleave", handleDragLeave);
  document.removeEventListener("drop", handleDrop);
  document.addEventListener("click", dispatchGlobalClick);
  document.addEventListener("dragstart", handleDragStart);
  document.addEventListener("dragover", handleDragOver);
  document.addEventListener("dragleave", handleDragLeave);
  document.addEventListener("drop", handleDrop);
}
attachGlobalAppListeners();
