function reorderSubclauseByDrag(draggedSubclauseId, targetSubclauseId) {
  const contract = state.contracts.find((item) => item.id === state.activeContractId);
  if (!contract) return;
  const material = getWorkbenchMaterial(contract);
  const clauses = splitVersionClauses(material.text, material.sourceKey);
  const draggedLocation = findSubclauseLocation(clauses, draggedSubclauseId);
  const targetLocation = findSubclauseLocation(clauses, targetSubclauseId);
  if (!draggedLocation || !targetLocation) return;
  const { parent: draggedParent, subclause: dragged } = draggedLocation;
  const { parent: targetParent, subclause: target } = targetLocation;
  if (draggedParent.id === targetParent.id) {
    const subclauses = splitSubclauses(draggedParent);
    const stableOrder = subclauses.map((subclause) => subclause.stableId);
    const from = stableOrder.indexOf(dragged.stableId);
    const to = stableOrder.indexOf(target.stableId);
    if (from < 0 || to < 0 || from === to) return;
    stableOrder.splice(from, 1);
    stableOrder.splice(to, 0, dragged.stableId);
    state.subclauseOrder = state.subclauseOrder || {};
    state.subclauseOrder[getSubclauseOrderKey(draggedParent)] = stableOrder;
  } else {
    moveSubclauseAcrossParents(draggedParent, dragged, targetParent, target);
  }
  state.activeWorkbenchClauseId = targetParent.id;
  state.activeSubclauseId = dragged.id;
  recordAudit("调整小条款顺序", { contractName: contract.name, clauseTitle: dragged.title });
  saveState();
  persistBackendReorderState(material.sourceKey);
  renderReview();
  scrollToSubclause(state.activeSubclauseId);
}

function findSubclauseLocation(clauses, subclauseId) {
  for (const parent of clauses) {
    const subclauses = splitSubclauses(parent);
    const subclause = subclauses.find((item) => item.id === subclauseId);
    if (subclause) return { parent, subclause, subclauses };
  }
  return null;
}

function moveSubclauseAcrossParents(draggedParent, dragged, targetParent, target) {
  const moves = getSubclauseMoveList();
  const existingIndex = moves.findIndex((move) => move.id === dragged.id || move.stableId === dragged.stableId);
  const fromParentId = existingIndex >= 0 ? moves[existingIndex].fromParentId : draggedParent.id;
  const snapshot = existingIndex >= 0 ? moves[existingIndex].snapshot : {
    ...dragged,
    originalParentId: draggedParent.id,
    originalParentStableId: draggedParent.stableId || draggedParent.id,
  };
  if (fromParentId === targetParent.id) {
    if (existingIndex >= 0) moves.splice(existingIndex, 1);
  } else {
    const move = {
      id: dragged.id,
      stableId: dragged.stableId,
      fromParentId,
      toParentId: targetParent.id,
      targetSubclauseId: target.id,
      targetStableId: target.stableId,
      snapshot,
      updatedAt: new Date().toISOString(),
    };
    if (existingIndex >= 0) moves[existingIndex] = move;
    else moves.push(move);
  }
  const targetSubclauses = splitSubclauses(targetParent);
  const stableOrder = targetSubclauses.map((subclause) => subclause.stableId).filter((stableId) => stableId !== dragged.stableId);
  const insertAt = Math.max(0, stableOrder.indexOf(target.stableId));
  stableOrder.splice(insertAt, 0, dragged.stableId);
  state.subclauseOrder = state.subclauseOrder || {};
  state.subclauseOrder[getSubclauseOrderKey(targetParent)] = stableOrder;
}

function reorderClauseByDrag(draggedClauseId, targetClauseId) {
  const contract = state.contracts.find((item) => item.id === state.activeContractId);
  if (!contract) return;
  const material = getWorkbenchMaterial(contract);
  const clauses = splitVersionClauses(material.text, material.sourceKey);
  const dragged = clauses.find((clause) => clause.id === draggedClauseId);
  const target = clauses.find((clause) => clause.id === targetClauseId);
  if (!dragged || !target) return;
  const stableOrder = clauses.map((clause) => clause.stableId);
  const from = stableOrder.indexOf(dragged.stableId);
  const to = stableOrder.indexOf(target.stableId);
  if (from < 0 || to < 0 || from === to) return;
  stableOrder.splice(from, 1);
  stableOrder.splice(to, 0, dragged.stableId);
  state.clauseOrder = state.clauseOrder || {};
  state.clauseOrder[material.sourceKey] = stableOrder;
  recordReorderAudit(material.sourceKey, dragged.title, target.title);
  {
    recordAudit("拖动调整条款顺序", {
      contractName: contract.name,
      clauseTitle: dragged.title,
      note: `移动到 ${target.title} 附近`,
    });
  }
  state.activeWorkbenchClauseId = draggedClauseId;
  saveState();
  persistBackendReorderState(material.sourceKey);
  renderReview();
  scrollToWorkbenchClause(`${material.sourceKey}:${dragged.stableId}`);
}

function recordReorderAudit(sourceKey, draggedTitle, targetTitle) {
  state.insertionAudits = state.insertionAudits || {};
  state.insertionAudits[sourceKey] = state.insertionAudits[sourceKey] || [];
  state.insertionAudits[sourceKey].push({
    id: uid("reorder-audit"),
    message: `已调整“${draggedTitle}”的位置，并基于新顺序全局重排条款序号；系统已同步迁移可识别的“第X条”引用，请复核复杂交叉引用。`,
    createdAt: today(),
  });
}

function persistBackendReorderState(sourceKey) {
  if (typeof persistBackendAuxState !== "function") return;
  const clauseOrder = state.clauseOrder?.[sourceKey];
  const insertionAudits = state.insertionAudits?.[sourceKey] || [];
  const payload = {
    clauseOrder: {
      ...(state.clauseOrder || {}),
      ...(Array.isArray(clauseOrder) && clauseOrder.length ? { [sourceKey]: clauseOrder } : {}),
    },
    subclauseOrder: state.subclauseOrder || {},
    subclauseMoves: state.subclauseMoves || [],
    insertionAudits: {
      ...(state.insertionAudits || {}),
      ...(Array.isArray(insertionAudits) && insertionAudits.length ? { [sourceKey]: insertionAudits } : {}),
    },
  };
  persistBackendAuxState(payload).catch(() => {});
}
