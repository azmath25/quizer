/**
 * Browser transport for the existing teacher-only Firebase callable.
 * Credential, workflow selection, quotas, and role checks are enforced server-side.
 * No automatic retries: an uncertain response can already have incurred a charge.
 */
import { getFirebaseServices, getSession } from "../firebase-client.js";

export function canUseMimoTeacherChat(session = getSession()) {
  return !!(
    session?.roleResolved &&
    session?.accountStatus === "active" &&
    session?.user?.uid &&
    session.user.emailVerified === true &&
    (session?.capabilities?.teach === true || session?.capabilities?.admin === true)
  );
}

export function mimoChatErrorMessage(error) {
  const reason = String(error?.details?.reason || error?.details?.code || "");
  const code = String(error?.code || "").replace(/^functions\//, "");
  if (reason === "RATE_LIMITED") {
    return "Quizer limit reached (4 requests per minute or 250 per UTC day). Please try later.";
  }
  if (reason === "MIMO_RATE_LIMITED") {
    return "Mimo is handling too many requests. Try again later; this message was not automatically retried.";
  }
  if (reason === "MIMO_OUTCOME_UNKNOWN") {
    return "The request may have reached Mimo, but the outcome is unknown. Do not resend immediately; keep the request reference for support.";
  }
  if (reason === "MIMO_NOT_COMPLETED") {
    return "Mimo did not complete this run. No answer is available; please try a new message later.";
  }
  if (reason === "MIMO_PROJECT_NOT_AUTHORIZED") {
    return "This project's chat workflow is not authorized. Please contact an administrator.";
  }
  if (code === "unauthenticated" || code.startsWith("auth/")) {
    return "Your sign-in session has expired. Sign in again to continue.";
  }
  if (code === "permission-denied" || reason === "TEACHER_ONLY" || reason === "UNAUTHORIZED") {
    return "Verified teacher or administrator access is required for this chat.";
  }
  if (code === "deadline-exceeded" || code === "unavailable" || code === "internal" || code === "unknown") {
    return "Chat is temporarily unavailable. The request may have been received; check before resending.";
  }
  return "Unable to send this message right now. Please check your session or try again later.";
}

export async function sendTeacherChatMessage({
  message, context = "", history = [], requestId = crypto.randomUUID(),
} = {}) {
  const before = getSession();
  if (!canUseMimoTeacherChat(before)) {
    throw Object.assign(new Error("Verified teacher access is required."), {
      code: before?.user?.uid ? "functions/permission-denied" : "functions/unauthenticated",
    });
  }
  const text = String(message || "").trim();
  if (!text || text.length > 3000) throw new Error("The message must contain 1–3000 characters.");
  if (typeof requestId !== "string" || !requestId || requestId.length > 128) {
    throw new Error("Invalid request reference.");
  }
  // Defense-in-depth only. The server owns all access and quota enforcement.
  const boundedHistory = (Array.isArray(history) ? history : [])
    .filter((item) => item && (item.role === "user" || item.role === "assistant"))
    .slice(-8)
    .map((item) => ({role: item.role, content: String(item.content || "").slice(0, 1200)}));
  const payload = {
    message: text,
    context: String(context || "").slice(0, 4000),
    history: boundedHistory,
    requestId,
  };
  const services = await getFirebaseServices();
  const current = getSession();
  if (!canUseMimoTeacherChat(current) || current.epoch !== before.epoch ||
      current.user.uid !== before.user.uid) {
    throw Object.assign(new Error("Session changed."), {code: "functions/unauthenticated"});
  }
  const callable = services.functionsSDK.httpsCallable(services.functions, "mimoTeacherChat", {
    timeout: 115000,
  });
  const response = await callable(payload); // exactly one call; deliberately no retry
  const after = getSession();
  if (!canUseMimoTeacherChat(after) || after.epoch !== before.epoch ||
      after.user.uid !== before.user.uid) {
    throw Object.assign(new Error("Session changed."), {code: "functions/unauthenticated"});
  }
  const data = response?.data;
  if (typeof data?.reply !== "string" || !data.reply.trim()) {
    throw Object.assign(new Error("No response."), {code: "functions/unavailable"});
  }
  return {reply: data.reply, runId: data.runId};
}
