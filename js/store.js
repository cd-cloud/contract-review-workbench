/**
 * Minimal state access layer to reduce direct global `state` mutation.
 * All modules should prefer these helpers over raw `state.` access.
 */

const Store = {
  get() {
    return state;
  },

  mutate(action, updater, options = {}) {
    const prevStateRef = state;
    let prevStateSnapshot = null;
    // Only pay for an expensive deep clone when rollback is explicitly requested.
    if (options.rollback) {
      const deepClone = typeof clone === "function" ? clone : (v) => JSON.parse(JSON.stringify(v));
      prevStateSnapshot = deepClone(state);
    }
    const next = { ...state };
    try {
      if (typeof updater === "function") updater(next);
      // If updater reassigned the global state variable (e.g. reset), respect it
      if (state !== prevStateRef) {
        // state was replaced inside updater; do not overwrite with next
      } else {
        Object.assign(state, next);
      }
      if (options.audit) {
        const details = typeof options.auditDetails === "function"
          ? options.auditDetails(state)
          : (options.auditDetails || {});
        Store.recordAudit(action || "state-update", details);
      }
      if (options.save !== false) saveState();
      if (typeof options.after === "function") options.after(state);
    } catch (error) {
      // Rollback to pre-mutation snapshot on failure, if one was captured.
      if (prevStateSnapshot) {
        Object.keys(prevStateSnapshot).forEach((key) => { state[key] = prevStateSnapshot[key]; });
        Object.keys(state).forEach((key) => { if (!(key in prevStateSnapshot)) delete state[key]; });
      }
      console.error("[Store] Mutation failed, state rolled back:", action, error);
      throw error;
    }
    return state;
  },

  getContract(id) {
    return state.contracts.find((c) => c.id === id);
  },

  getActiveContract() {
    return state.contracts.find((c) => c.id === state.activeContractId) || null;
  },

  getClauseActions(sourceKey) {
    state.clauseActions = state.clauseActions || {};
    state.clauseActions[sourceKey] = state.clauseActions[sourceKey] || {};
    return state.clauseActions[sourceKey];
  },

  getInsertedClauses(sourceKey) {
    state.insertedClauses = state.insertedClauses || {};
    state.insertedClauses[sourceKey] = state.insertedClauses[sourceKey] || [];
    return state.insertedClauses[sourceKey];
  },

  getWorkbenchMaterial(contract) {
    const updates = (state.updates || []).filter((u) => u.contractId === contract.id);
    const activeUpdate = updates.find((u) => u.id === state.activeUpdateId);
    if (activeUpdate?.versionText) {
      const text = activeUpdate.acceptedText || activeUpdate.versionText || "";
      return {
        sourceKey: `${contract.id}:${activeUpdate.id}`,
        title: `${contract.name} — ${activeUpdate.type} ${activeUpdate.createdAt || ""}`.trim(),
        text,
        mode: state.reviewMode || "clean",
      };
    }
    return {
      sourceKey: contract.id,
      title: contract.name,
      text: contract.cleanText || contract.text || "",
      mode: state.reviewMode || "clean",
    };
  },

  setActiveContract(contractId) {
    // Keep cross-view timers such as backend-health alive when switching contracts.
    if (typeof TimerRegistry !== "undefined") TimerRegistry.clearAllExcept(["backend-health"]);
    if (typeof clauseEditAutosaveTimer !== "undefined" && clauseEditAutosaveTimer) {
      clearTimeout(clauseEditAutosaveTimer);
      clauseEditAutosaveTimer = null;
    }
    state.activeContractId = contractId;
    state.activeClauseId = state.clauses.find((c) => c.contractId === contractId)?.id || null;
    const updates = (state.updates || []).filter((u) => u.contractId === contractId);
    state.activeUpdateId = updates.at(-1)?.id || null;
    // Load large texts from backend on demand. Backend is the source of truth.
    if (typeof ensureContractTextsLoaded === "function") {
      ensureContractTextsLoaded(contractId);
    }
  },

  pushUpdate(update) {
    state.updates = state.updates || [];
    state.updates.unshift(update);
  },

  recordAudit(action, details = {}) {
    const maxAuditLogs = typeof MAX_AUDIT_LOGS === "number" ? MAX_AUDIT_LOGS : 500;
    state.auditLogs = state.auditLogs || [];
    state.auditLogs.unshift({
      id: uid("audit"),
      action,
      details,
      userId: "local-admin",
      createdAt: new Date().toISOString(),
    });
    state.auditLogs = state.auditLogs.slice(0, maxAuditLogs);
  },
};

if (typeof window !== "undefined") window.Store = Store;
if (typeof globalThis !== "undefined") globalThis.Store = Store;
