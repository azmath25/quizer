// QN5 — future-only audit outbox. OFF unless explicitly enabled.
// Contains only whitelisted event metadata, never request bodies/answers/keys.
import { createHash } from "node:crypto";

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const FIELD = /^[A-Za-z0-9_-]{1,128}$/;
export function activityOutboxEnabled(env = process.env) {
  return env.QUIZER_NEON_ACTIVITY_OUTBOX_ENABLED === "true";
}

export function canonicalActivityEvent(eventId, audit) {
  if (!ID.test(eventId) || !ID.test(audit.actorId) ||
      !ID.test(audit.targetId) || !/^[a-zA-Z0-9_.-]{1,120}$/.test(audit.action) ||
      !/^[a-zA-Z0-9_-]{1,40}$/.test(audit.targetType))
    throw new Error("Invalid audit event metadata");
  if (audit.quizId !== null && audit.quizId !== undefined && !ID.test(audit.quizId))
    throw new Error("Invalid audit quiz reference");
  if (audit.quizOwnerId !== null && audit.quizOwnerId !== undefined && !ID.test(audit.quizOwnerId))
    throw new Error("Invalid audit owner reference");
  const role = ["student","teacher","admin","system"].includes(audit.actorRoleAtTime)
    ? audit.actorRoleAtTime : "system";
  const occurred = audit.occurredAt?.toDate?.() ?? new Date(audit.occurredAt);
  if (!Number.isFinite(occurred.getTime())) throw new Error("Invalid audit time");
  return {
    eventId,
    actorId: audit.actorId,
    actorRoleAtTime: role,
    action: audit.action,
    targetType: audit.targetType,
    targetId: audit.targetId,
    quizId: audit.quizId ?? null,
    quizOwnerId: audit.quizOwnerId ?? null,
    // Strict allowlist avoids logging arbitrary user strings or answer values.
    changedFields: Array.isArray(audit.changedFields)
      ? [...new Set(audit.changedFields.filter(x => typeof x === "string" && FIELD.test(x)))].slice(0, 32)
      : [],
    occurredAt: occurred.toISOString(),
  };
}
export function activityFingerprint(event) {
  const canonical = canonicalActivityEvent(event.eventId, event);
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
export function makeActivityOutboxDocument(eventId, audit, now) {
  const payload = canonicalActivityEvent(eventId, audit);
  return {
    ...payload,
    payloadHash: activityFingerprint(payload),
    deliveryStatus: "pending",
    createdAt: now,
    ackedAt: null,
    schemaVersion: 1,
  };
}
