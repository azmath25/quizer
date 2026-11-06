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
    return "Quizer limit reached (4 requests per minute or 25 per UTC day). Please try later.";
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
  if (reason === "THREAD_NOT_FOUND" || reason === "DOCUMENT_NOT_FOUND") {
    return "This saved chat or document is unavailable for your account.";
  }
  if (reason === "DOCUMENT_NOT_READY") {
    return "This document is not ready to use in chat.";
  }
  if (reason === "MEMORY_NOT_CONFIGURED") {
    return "Saved chat history is not enabled yet. Your live Mimo chat may still be available.";
  }
  if (reason === "INVALID_FIELDS") {
    return "The requested AI action contains invalid or excessive content.";
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


/** One Firebase callable for chat, history and text-document actions. */
export async function teacherAiAction(payload) {
  const before = getSession();
  if (!canUseMimoTeacherChat(before)) {
    throw Object.assign(new Error("Verified teacher access is required."), {
      code: before?.user?.uid ? "functions/permission-denied" : "functions/unauthenticated",
    });
  }
  const services = await getFirebaseServices();
  const current = getSession();
  if (!canUseMimoTeacherChat(current) || current.epoch !== before.epoch ||
      current.user.uid !== before.user.uid) {
    throw Object.assign(new Error("Session changed."), {code:"functions/unauthenticated"});
  }
  const callable = services.functionsSDK.httpsCallable(services.functions, "mimoTeacherChat", {
    timeout:115000,
  });
  const response = await callable(payload);
  const after = getSession();
  if (!canUseMimoTeacherChat(after) || after.epoch !== before.epoch ||
      after.user.uid !== before.user.uid) {
    throw Object.assign(new Error("Session changed."), {code:"functions/unauthenticated"});
  }
  return response?.data;
}

export const listTeacherChats = () => teacherAiAction({action:"chat.list",limit:25});
export const getTeacherChat = (threadId) => teacherAiAction({action:"chat.get",threadId});
export const listTeacherDocuments = () => teacherAiAction({action:"document.list",limit:20});
export const getTeacherDocument = (documentId) =>
  teacherAiAction({action:"document.get",documentId});
export const createTeacherTextDocument = ({title,text}) =>
  teacherAiAction({action:"document.create_text",title,text});

export async function sendTeacherChatMessage({
  message, context = "", history = [], requestId = crypto.randomUUID(),
  threadId = null, documentId = null, mode = "explain",
} = {}) {
  const text = String(message || "").trim();
  if (!text || text.length > 3000) throw new Error("The message must contain 1–3000 characters.");
  if (typeof requestId !== "string" || !requestId || requestId.length > 100) {
    throw new Error("Invalid request reference.");
  }
  const boundedHistory = (Array.isArray(history) ? history : [])
    .filter((item) => item && (item.role === "user" || item.role === "assistant"))
    .slice(-8)
    .map((item) => ({role: item.role, content: String(item.content || "").slice(0, 1200)}));
  const result = await teacherAiAction({
    action:"chat.send",
    message:text,
    context:String(context||"").slice(0,4000),
    history:boundedHistory,
    requestId,
    mode,
    ...(threadId ? {threadId} : {}),
    ...(documentId ? {documentId} : {}),
  });
  if (typeof result?.reply !== "string" || !result.reply.trim()) {
    throw Object.assign(new Error("No response."), {code:"functions/unavailable"});
  }
  return {
    reply:result.reply,runId:result.runId,threadId:result.threadId || null,
    saved:result.saved !== false,warningCode:result.warningCode || null,
  };
}
