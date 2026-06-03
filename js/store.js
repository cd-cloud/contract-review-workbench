/**
 * Minimal state access layer to reduce direct global `state` mutation.
 * All modules should prefer these helpers over raw `state.` access.
 */

const Store = {
  get() {
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
    state.activeContractId = contractId;
    state.activeClauseId = state.clauses.find((c) => c.contractId === contractId)?.id || null;
    const updates = (state.updates || []).filter((u) => u.contractId === contractId);
    state.activeUpdateId = updates.at(-1)?.id || null;
  },

  pushUpdate(update) {
    state.updates = state.updates || [];
    state.updates.unshift(update);
  },

  recordAudit(action, details = {}) {
    state.auditLogs = state.auditLogs || [];
    state.auditLogs.unshift({
      id: uid("audit"),
      action,
      details,
      userId: "local-admin",
      createdAt: new Date().toISOString(),
    });
    state.auditLogs = state.auditLogs.slice(0, MAX_AUDIT_LOGS);
  },
};
