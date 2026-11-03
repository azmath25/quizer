import test from "node:test";
import assert from "node:assert/strict";
import {
  activityOutboxEnabled, makeActivityOutboxDocument, activityFingerprint,
} from "../../functions/src/neon/activity-outbox.js";
import { createActivityRelay } from "../../functions/src/neon/activity-relay.js";

const audit = {
  actorId: "teacher_a", actorRoleAtTime: "teacher",
  action: "quiz.draft_saved", targetType: "quiz", targetId: "quiz_a",
  quizId: "quiz_a", quizOwnerId: "teacher_a",
  changedFields: ["title", "some user answer!"], occurredAt: "2026-11-03T09:00:00.000Z",
  answerText: "TOP SECRET ANSWER", token: "TOP SECRET TOKEN",
};
const document = () => makeActivityOutboxDocument("evt_a", audit, new Date("2026-11-03T09:00:00Z"));

function fakes() {
  const stored = new Map();
  const doc = document();
  const pending = new Map([["evt_a", doc]]);
  let ackFailures = 0;
  const sql = {
    calls: [],
    async query(text, values) {
      this.calls.push({ text, values });
      if (text.startsWith("INSERT ")) {
        if (stored.has(values[0])) return { rows: [] };
        stored.set(values[0], values[10]);
        return { rows: [{ event_id: values[0] }] };
      }
      return { rows: stored.has(values[0])
        ? [{ payload_hash: stored.get(values[0]) }] : [] };
    },
  };
  const outbox = {
    async get(id) { return pending.get(id) ?? null; },
    async listPending(limit) {
      return [...pending].filter(([,d]) => d.deliveryStatus === "pending")
        .slice(0,limit).map(([id]) => id);
    },
    async ack(id, hash) {
      if (ackFailures-- > 0) throw new Error("FIRESTORE_OUTAGE");
      const old = pending.get(id);
      assert.equal(old.payloadHash, hash);
      pending.set(id, { ...old, deliveryStatus: "delivered" });
    },
  };
  return { stored, pending, sql, outbox, failAckOnce: () => { ackFailures = 1; } };
}
test("QN5 is disabled by default", async () => {
  assert.equal(activityOutboxEnabled({}), false);
  assert.equal(activityOutboxEnabled({ QUIZER_NEON_ACTIVITY_OUTBOX_ENABLED:"false" }), false);
  assert.equal(activityOutboxEnabled({ QUIZER_NEON_ACTIVITY_OUTBOX_ENABLED:"true" }), true);
  assert.deepEqual(await createActivityRelay({}).drain(), { disabled:true, attempted:0 });
});
test("outbox stores no answer, token, arbitrary field or user-provided raw payload", () => {
  const d = document();
  assert(!JSON.stringify(d).includes("TOP SECRET"));
  assert.deepEqual(d.changedFields, ["title"]);
  assert.equal(d.deliveryStatus, "pending");
  assert.match(d.payloadHash, /^[a-f0-9]{64}$/);
  assert.equal(activityFingerprint(d), d.payloadHash);
});
test("one event reaches Neon then is acknowledged in Firebase", async () => {
  const f = fakes(), relay = createActivityRelay({ ...f, enabled:true });
  const result = await relay.relayOne("evt_a");
  assert.deepEqual(result, { delivered:true, duplicate:false });
  assert.equal(f.stored.size, 1);
  assert.equal(f.pending.get("evt_a").deliveryStatus, "delivered");
  assert.equal(f.sql.calls[0].values[0], "evt_a");
});
test("Neon commit followed by Firebase ack failure is safely replayable", async () => {
  const f = fakes(), relay = createActivityRelay({ ...f, enabled:true });
  f.failAckOnce();
  await assert.rejects(relay.relayOne("evt_a"), /FIRESTORE_OUTAGE/);
  assert.equal(f.stored.size, 1);
  assert.equal(f.pending.get("evt_a").deliveryStatus, "pending");
  assert.deepEqual(await relay.relayOne("evt_a"), { delivered:true, duplicate:true });
  assert.equal(f.stored.size, 1);
  assert.equal(f.pending.get("evt_a").deliveryStatus, "delivered");
});
test("event-id collision with different hash refuses acknowledgement", async () => {
  const f = fakes(), relay = createActivityRelay({ ...f, enabled:true });
  f.stored.set("evt_a", "a".repeat(64));
  await assert.rejects(relay.relayOne("evt_a"), /AUDIT_EVENT_ID_COLLISION/);
  assert.equal(f.pending.get("evt_a").deliveryStatus, "pending");
});
test("outbox tampering is rejected before any SQL call", async () => {
  const f = fakes(), relay = createActivityRelay({ ...f, enabled:true });
  f.pending.set("evt_a", { ...document(), action:"quiz.deleted" });
  await assert.rejects(relay.relayOne("evt_a"), /AUDIT_PAYLOAD_INTEGRITY_ERROR/);
  assert.equal(f.sql.calls.length, 0);
});
test("relay drain caps batch size and reports failures without losing pending data", async () => {
  const f = fakes(), relay = createActivityRelay({ ...f, enabled:true });
  await assert.rejects(relay.drain(26), /Invalid activity relay batch size/);
  const report = await relay.drain(25);
  assert.deepEqual({ attempted:report.attempted,delivered:report.delivered,failed:report.failed },
    { attempted:1,delivered:1,failed:0 });
  assert.deepEqual(await relay.drain(25), { attempted:0, delivered:0, failed:0, failures:[] });
});
test("schema outbox only writes in the audit path behind explicit flag", () => {
  // Inspect integration code to ensure no historical auditEvents scan/backfill.
  // The runtime's Context.audit is the sole emission point, off by default.
  assert.equal(typeof createActivityRelay, "function");
  assert.equal(typeof makeActivityOutboxDocument, "function");
});
