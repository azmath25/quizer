import { getFirebaseServices, getSession } from "../firebase-client.js";
import { isReadAction, mayCacheAction, jobPollDelayMs } from "./request-policy.js";

// Only ambiguous transport failures retain a request ID for deliberate retry.
// Distinct concurrent mutations must never share an automatically assigned ID.
const retryableRequests = new Map();
const inflightReads = new Map();
const cache = new Map();
const TTL = 60000;
let cacheGeneration = 0;
function invalidate() {
  ++cacheGeneration;
  cache.clear();
  // Outstanding reads may complete, but new reads cannot join an old flight.
}
document.addEventListener("session-cleared", () => {
  retryableRequests.clear();
  inflightReads.clear();
  invalidate();
});
const requestKey = (action, data) =>
  JSON.stringify([getSession().epoch, action, data]);

export function warm(action, data = {}) {
  if (!mayCacheAction(action)) return;
  const key = requestKey(action, data), hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return;
  const generation = cacheGeneration, epoch = getSession().epoch;
  api(action, data).then((value) => {
    if (generation === cacheGeneration && getSession().epoch === epoch)
      cache.set(key, { at: Date.now(), value });
  }).catch(() => {});
}
export function apiSWR(action, data, onData) {
  if (typeof onData !== "function")
    throw new TypeError("SWR callback required.");
  // No sensitive/private data or signed link is held in the SWR cache.
  if (!mayCacheAction(action))
    return api(action, data).then((value) => {
      onData(value, false);
      return value;
    });
  const key = requestKey(action, data),
    hit = cache.get(key),
    generation = cacheGeneration,
    epoch = getSession().epoch;
  if (hit) onData(hit.value, true);
  if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.value);
  return api(action, data).then((value) => {
    // A mutation or sign-out can invalidate a pending read. Never restore its
    // obsolete cache entry, or repaint a newer view using its old response.
    if (generation !== cacheGeneration || getSession().epoch !== epoch)
      return value;
    cache.set(key, { at: Date.now(), value });
    if (!hit || JSON.stringify(hit.value) !== JSON.stringify(value))
      onData(value, false);
    return value;
  });
}
export function api(action, data = {}, requestId) {
  const read = isReadAction(action);
  if (!read) invalidate();
  // Only verified read-only actions may share an in-flight HTTP request.
  // Two identical writes are independent intents; server idempotency is keyed
  // to the explicit request ID, never to action/payload coincidence.
  if (!read || requestId) return call(action, data, requestId);
  const key = JSON.stringify([getSession().epoch, cacheGeneration, action, data]);
  if (inflightReads.has(key)) return inflightReads.get(key);
  const p = call(action, data).finally(() => {
    if (inflightReads.get(key) === p) inflightReads.delete(key);
  });
  inflightReads.set(key, p);
  return p;
}
async function call(action, data = {}, requestId) {
  const c = await getFirebaseServices(),
    epoch = getSession().epoch,
    key = JSON.stringify([epoch, action, data]),
    explicitRequestId = Boolean(requestId);
  // Consume a retry receipt before starting the call: a concurrent identical
  // mutation obtains a *different* ID instead of reusing this active receipt.
  if (!explicitRequestId) {
    requestId = retryableRequests.get(key) ?? crypto.randomUUID();
    retryableRequests.delete(key);
  }
  let response;
  try {
    response = await c.functionsSDK.httpsCallable(
      c.functions,
      "api",
    )({ apiVersion: 2, action, requestId, ...data });
  } catch (error) {
    if (!explicitRequestId &&
        /(?:unavailable|deadline-exceeded|internal|network)/.test(
          error.code ?? "",
        ) &&
        getSession().epoch === epoch)
      retryableRequests.set(key, requestId);
    throw error;
  }
  if (getSession().epoch !== epoch)
    throw Object.assign(
      new Error("Your account changed. Reload to continue."),
      { reason: "SESSION_CHANGED" },
    );
  return { ...response.data.data, _serverTime: response.data.serverTime };
}

export async function waitForJob(jobId, onProgress = () => {}) {
  if (!jobId) throw new TypeError("Job ID required.");
  const deadline = Date.now() + 270000;
  for (let i = 0; i < 180 && Date.now() < deadline; i++) {
    const job = await api("getJob", { jobId });
    onProgress(job);
    if (job.status === "succeeded") return job.result;
    if (job.status === "failed" || job.status === "cancelled")
      throw Object.assign(
        new Error(job.error?.message || "Processing was cancelled."),
        { jobId, reason: job.error?.reason },
      );
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(jobPollDelayMs(i), remaining)));
  }
  throw Object.assign(
    new Error(
      "Processing is continuing. Reopen this page to check its status.",
    ),
    { jobId },
  );
}
