// Pure helpers keep draft edits independent of the original TeX upload flow.
export function changedQuizSlots(slots, savedItems, order) {
  const saved = new Map(savedItems.map((item) => [item.itemId, item]));
  const included = new Set(order);
  return slots.filter((item) => {
    if (!included.has(item.itemId)) return false;
    const old = saved.get(item.itemId);
    return !old || item.itemId.startsWith("new_") ||
      item.points !== old.points ||
      item.problemId !== old.problemId ||
      item.problemRevisionId !== old.problemRevisionId;
  });
}

export function buildFinalQuizSaveRequest({ quizId, expectedDraftVersion, current, draft, order, currentOrder }) {
  const patch = {};
  for (const key of ["title", "description", "subject", "difficulty"])
    if (current[key] !== draft[key]) patch[key] = current[key];
  const settings = {};
  for (const [key, value] of Object.entries(current.settings))
    if (value !== draft.settings[key]) settings[key] = value;
  if (Object.keys(settings).length) patch.settings = settings;
  const changedOrder = order.length !== currentOrder.length ||
    order.some((itemId, i) => itemId !== currentOrder[i]);
  if (!Object.keys(patch).length && !changedOrder) return null;
  return {
    quizId,
    expectedDraftVersion,
    ...(Object.keys(patch).length ? { patch } : {}),
    ...(changedOrder ? { itemOrder: order } : {}),
  };
}
