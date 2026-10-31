import { getFirebaseServices, getSession } from "../firebase-client.js";
const pendingRequests = new Map();
document.addEventListener("session-cleared", () => pendingRequests.clear());
const inflight = new Map();
document.addEventListener("session-cleared", () => inflight.clear());
export function api(action, data = {}, requestId) {
  if (requestId) return call(action, data, requestId);
  const key = JSON.stringify([getSession().epoch, action, data]);
  if (inflight.has(key)) return inflight.get(key);
  const p = call(action, data).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
async function call(action, data = {}, requestId) {
  const c = await getFirebaseServices(),
    epoch = getSession().epoch;
  const key = JSON.stringify([epoch, action, data]);
  requestId ??= pendingRequests.get(key) ?? crypto.randomUUID();
  pendingRequests.set(key, requestId);
  let response;
  try {
    response = await c.functionsSDK.httpsCallable(
      c.functions,
      "api",
    )({ apiVersion: 2, action, requestId, ...data });
    pendingRequests.delete(key);
  } catch (error) {
    if (
      !/(?:unavailable|deadline-exceeded|internal|network)/.test(
        error.code ?? "",
      )
    )
      pendingRequests.delete(key);
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
  for (let i = 0; i < 180; i++) {
    const job = await api("getJob", { jobId });
    onProgress(job);
    if (job.status === "succeeded") return job.result;
    if (job.status === "failed" || job.status === "cancelled")
      throw Object.assign(
        new Error(job.error?.message || "Processing was cancelled."),
        { jobId, reason: job.error?.reason },
      );
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw Object.assign(
    new Error(
      "Processing is continuing. Reopen this page to check its status.",
    ),
    { jobId },
  );
}
