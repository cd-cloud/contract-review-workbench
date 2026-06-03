let state = loadState();
let clauseClickTimer = null;
let clauseEditAutosaveTimer = null;

const STALE_JOB_TIMEOUT_MS = 3 * 60 * 1000;

document.addEventListener("click", handleGlobalClick);
document.addEventListener("dragstart", handleDragStart);
document.addEventListener("dragover", handleDragOver);
document.addEventListener("dragleave", handleDragLeave);
document.addEventListener("drop", handleDrop);
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
