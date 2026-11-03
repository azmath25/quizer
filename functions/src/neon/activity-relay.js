// QN5 — trusted worker core, NOT scheduled/deployed. No Neon credentials here.
// Acknowledgement happens strictly after the Neon insert is known durable.
import { activityFingerprint } from "./activity-outbox.js";
import { requireId, requireHash } from "./contracts.js";

export function createActivityRelay({ sql, outbox, enabled = false }) {
  if (enabled !== true)
    return Object.freeze({
      relayOne: async () => ({ disabled: true }),
      drain: async () => ({ disabled: true, attempted: 0 }),
    });
  if (!sql || typeof sql.query !== "function" ||
      !outbox || typeof outbox.get !== "function" ||
      typeof outbox.ack !== "function" || typeof outbox.listPending !== "function")
    throw new Error("Trusted outbox and Neon SQL ports required");
  async function relayOne(eventId) {
    requireId(eventId, "event ID");
    const event = await outbox.get(eventId);
    if (!event) return { missing: true };
    if (event.deliveryStatus === "delivered") return { alreadyDelivered: true };
    const expected = requireHash(event.payloadHash, "event payload hash");
    if (event.eventId !== eventId || activityFingerprint(event) !== expected)
      throw new Error("AUDIT_PAYLOAD_INTEGRITY_ERROR");
    const params = [
      eventId, event.actorId, event.actorRoleAtTime, event.action,
      event.targetType, event.targetId, event.quizId, event.quizOwnerId,
      event.changedFields, event.occurredAt, expected,
    ];
    // A unique event ID makes retries safe if Neon commits but Firebase
    // acknowledgement fails. A different hash for that ID is a hard error.
    const inserted = await sql.query(
      "INSERT INTO quizer.activity_events " +
      "(event_id,actor_uid,actor_role,action,target_type,target_id," +
      "quiz_id,quiz_owner_uid,changed_fields,occurred_at,payload_hash) " +
      "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) " +
      "ON CONFLICT(event_id) DO NOTHING RETURNING event_id",
      params,
    );
    let duplicate = false;
    if (!inserted.rows?.length) {
      duplicate = true;
      const existing = await sql.query(
        "SELECT payload_hash FROM quizer.activity_events WHERE event_id = $1",
        [eventId],
      );
      if (existing.rows?.[0]?.payload_hash !== expected)
        throw new Error("AUDIT_EVENT_ID_COLLISION");
    }
    // compare-and-set ack. Firestore failure leaves a pending event; next
    // worker run observes the same hash and acknowledges without duplication.
    await outbox.ack(eventId, expected);
    return { delivered: true, duplicate };
  }
  async function drain(limit = 25) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 25)
      throw new Error("Invalid activity relay batch size");
    const ids = await outbox.listPending(limit);
    const failures = [];
    let delivered = 0;
    for (const eventId of ids) {
      try {
        const result = await relayOne(eventId);
        if (result.delivered) delivered++;
      } catch (e) {
        failures.push({ eventId, reason: String(e?.message ?? "Relay failed").slice(0, 100) });
      }
    }
    return { attempted: ids.length, delivered, failed: failures.length, failures };
  }
  return Object.freeze({ relayOne, drain });
}
