import { api } from "./api.js";

const LEGACY_KEY = "mathquiz.starred";
const stars = new Map();
let loading = null;
document.addEventListener("session-cleared", () => {
  stars.clear();
  loading = null;
});

export const problemRef = (problemId) => `p:${problemId}`;
export const itemRef = (quizId, itemId) => `i:${quizId}:${itemId}`;

const notify = () => document.dispatchEvent(new CustomEvent("stars-changed"));

async function migrateLegacy() {
  let ids = [];
  try {
    ids = JSON.parse(localStorage.getItem(LEGACY_KEY) || "[]");
  } catch {}
  if (!ids.length) return;
  await Promise.all(
    ids.slice(0, 100).map((problemId) =>
      api("setStar", { kind: "problem", problemId, starred: true }).catch(() => {}),
    ),
  );
  localStorage.removeItem(LEGACY_KEY);
}

export function loadStars() {
  loading ??= migrateLegacy()
    .then(() => api("listStars"))
    .then((r) => {
      stars.clear();
      for (const s of r.items) stars.set(s.ref, s);
      notify();
      return [...stars.values()];
    })
    .catch((error) => {
      loading = null;
      throw error;
    });
  return loading;
}

export const isStarred = (ref) => stars.has(ref);
export const starList = () => [...stars.values()];

export async function removeStar(ref) {
  const prior = stars.get(ref);
  stars.delete(ref);
  notify();
  try {
    await api("setStar", { ref, starred: false });
  } catch (error) {
    if (prior) stars.set(ref, prior);
    notify();
    throw error;
  }
}

// target: { kind: "problem", problemId, title? } or { kind: "quizItem", attemptId, quizId, itemId }
export async function toggleStar(target) {
  const ref =
    target.kind === "problem"
      ? problemRef(target.problemId)
      : itemRef(target.quizId, target.itemId);
  const was = stars.has(ref),
    prior = stars.get(ref);
  if (was) stars.delete(ref);
  else stars.set(ref, { ref, kind: target.kind, title: target.title || "Starred problem", subject: "", href: "#" });
  notify();
  try {
    const { kind, problemId, attemptId, itemId } = target;
    await api("setStar", { kind, problemId, attemptId, itemId, starred: !was });
    loading = null;
    loadStars().catch(() => {});
  } catch (error) {
    if (was) stars.set(ref, prior);
    else stars.delete(ref);
    notify();
    throw error;
  }
  return !was;
}
