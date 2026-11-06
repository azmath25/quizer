/**
 * Isolated, teacher-only proof-of-concept:
 * Firebase Auth + Firestore teacher role -> Mimo published chat workflow.
 * Only this server module can access the Mimo project API key.
 * No quiz/attempt records, confidential grading keys, or files are read.
 */
import { createHash } from "node:crypto";
import { createMimoClient } from "./client.js";

export const MIMO_CHAT_CONFIG = Object.freeze({
  origin: "https://mimo-execution-993130348924.europe-west1.run.app",
  workflowId: "c_mw4j0tz4_mpyp7v",
  version: 1,
  costLimitUsd: 0.05,
});
const REQUEST_ID = /^[a-zA-Z0-9_-]{16,100}$/;
const MAX_PER_MINUTE = 4;
export const MAX_PER_DAY = 250;
const LIMITS_COLLECTION = "mimoTeacherChatLimits";

export class TeacherChatError extends Error {
  constructor(code) { super(code); this.name = "TeacherChatError"; this.code = code; }
}
function fail(code) { throw new TeacherChatError(code); }
function boundedString(value, max, allowEmpty = false) {
  if (typeof value !== "string" || value.length > max ||
      (!allowEmpty && !value.trim())) fail("INVALID_FIELDS");
  return value;
}
function validatePayload(data) {
  if (!data || typeof data !== "object" || Array.isArray(data) ||
      Object.keys(data).some(key => !["message","history","context","requestId"].includes(key)))
    fail("INVALID_FIELDS");
  const message = boundedString(data.message, 3000).trim();
  const context = boundedString(data.context ?? "", 4000, true).trim();
  const history = data.history ?? [];
  if (!Array.isArray(history) || history.length > 8) fail("INVALID_FIELDS");
  const previous = history.map(entry => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) ||
        Object.keys(entry).some(k => !["role","content"].includes(k)) ||
        !["user","assistant"].includes(entry.role)) fail("INVALID_FIELDS");
    return { role: entry.role, content: boundedString(entry.content, 1200).trim() };
  });
  if (typeof data.requestId !== "string" || !REQUEST_ID.test(data.requestId))
    fail("INVALID_FIELDS");
  const input = JSON.stringify({
    message,
    recent_history: previous,
    authorized_context: context,
  });
  if (Buffer.byteLength(input, "utf8") > 11000) fail("INVALID_FIELDS");
  return { requestId: data.requestId, input };
}
function authorize(auth, role) {
  if (typeof auth?.uid !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(auth.uid))
    fail("AUTH_REQUIRED");
  if (auth.token?.email_verified !== true) fail("EMAIL_UNVERIFIED");
  if (!role || !["teacher","admin"].includes(role.role) ||
      (role.accountStatus ?? "active") !== "active")
    fail("ROLE_REQUIRED");
  return auth.uid;
}
function requireReply(result) {
  if (result.status !== "completed") fail("MIMO_NOT_COMPLETED");
  const reply = result.output?.exports?.reply;
  if (typeof reply !== "string" || !reply.trim() || reply.length > 14000)
    fail("MIMO_INVALID_RESPONSE");
  return reply;
}

/** Dependency-injected to test without live paid model calls. */
export function createTeacherChat({
  db, projectKey, fetchImpl = globalThis.fetch, now = () => Date.now(),
} = {}) {
  if (!db?.doc || typeof db.runTransaction !== "function")
    throw new Error("Firestore dependency required");
  return async function teacherChat({auth, data}) {
    // Input and config preflight never touch remote APIs.
    const body = validatePayload(data);
    if (typeof auth?.uid !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(auth.uid))
      fail("AUTH_REQUIRED");
    if (auth.token?.email_verified !== true) fail("EMAIL_UNVERIFIED");
    const client = createMimoClient({
      ...MIMO_CHAT_CONFIG, projectKey, fetchImpl, timeoutMs: 95000,
    });
    const roleDoc = await db.doc("roles/" + auth.uid).get();
    const uid = authorize(auth, roleDoc.exists ? roleDoc.data() : null);

    // Atomic daily and rolling-minute quota. No network I/O in the transaction.
    const digest = createHash("sha256").update(body.input).digest("hex");
    const quotaRef = db.doc(LIMITS_COLLECTION + "/" + uid);
    const current = now();
    await db.runTransaction(async tx => {
      const snap = await tx.get(quotaRef);
      const old = snap.exists ? snap.data() : {};
      const day = new Date(current).toISOString().slice(0, 10);
      const value = old.day === day ? old : {day, count:0, requests:{}, recent:[]};
      const previous = value.requests ?? {};
      if (Object.hasOwn(previous, body.requestId)) {
        if (previous[body.requestId] !== digest) fail("REQUEST_ID_CONFLICT");
        return;
      }
      const recent = (Array.isArray(value.recent) ? value.recent : [])
        .filter(ms => typeof ms === "number" && ms <= current && current - ms < 60000);
      if (recent.length >= MAX_PER_MINUTE || value.count >= MAX_PER_DAY)
        fail("RATE_LIMITED");
      tx.set(quotaRef, {
        day, count: value.count + 1,
        requests: {...previous, [body.requestId]:digest},
        recent: [...recent, current],
      });
    });
    try {
      const result = await client.start({
        uid, requestId: body.requestId, input: body.input, background: false,
      });
      return {reply: requireReply(result), runId: result.runId};
    } catch (error) {
      if (error instanceof TeacherChatError) throw error;
      const codes = new Set([
        "MIMO_NOT_CONFIGURED","MIMO_PROJECT_NOT_AUTHORIZED",
        "MIMO_OUTCOME_UNKNOWN","MIMO_RATE_LIMITED",
        "MIMO_WORKFLOW_OR_RUN_NOT_FOUND",
      ]);
      fail(codes.has(error?.code) ? error.code : "MIMO_UNAVAILABLE");
    }
  };
}
