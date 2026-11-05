// A saved problem's metadata is independent of its immutable question revision.
// Send only metadata when statement, choices, grading and image bindings are unchanged.
export function problemSavePayload(current, baseline, persisted = true) {
  if (!persisted || !baseline) return current;
  const sameContent =
    JSON.stringify(current.content) === JSON.stringify(baseline.content) &&
    JSON.stringify(current.grading) === JSON.stringify(baseline.grading);
  return sameContent ? { metadata: current.metadata } : current;
}
