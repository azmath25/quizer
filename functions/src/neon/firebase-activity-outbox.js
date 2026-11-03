// QN5 Firestore port for the trusted internal relay. NOT wired or scheduled.
// Requires Firebase Admin Firestore injected from the private backend.
import { Timestamp } from "firebase-admin/firestore";
import { requireId, requireHash } from "./contracts.js";

export function createFirebaseActivityOutboxPort(db) {
  if (!db || typeof db.doc !== "function" || typeof db.runTransaction !== "function")
    throw new Error("Trusted Firestore Admin client required");
  const ref = (eventId) => db.doc("activityOutbox/" + requireId(eventId, "event ID"));
  return Object.freeze({
    async get(eventId) {
      const snap = await ref(eventId).get();
      return snap.exists ? snap.data() : null;
    },
    async listPending(limit = 25) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 25)
        throw new Error("Invalid outbox page size");
      const snap = await db.collection("activityOutbox")
        .where("deliveryStatus", "==", "pending").limit(limit).get();
      return snap.docs.map((doc) => doc.id);
    },
    async ack(eventId, expectedHash) {
      requireHash(expectedHash);
      const doc = ref(eventId);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(doc);
        if (!snap.exists) throw new Error("AUDIT_OUTBOX_MISSING");
        const value = snap.data();
        if (value.payloadHash !== expectedHash)
          throw new Error("AUDIT_OUTBOX_CHANGED");
        if (value.deliveryStatus === "delivered") return false;
        if (value.deliveryStatus !== "pending")
          throw new Error("AUDIT_OUTBOX_BAD_STATE");
        tx.update(doc, { deliveryStatus: "delivered", ackedAt: Timestamp.now() });
        return true;
      });
    },
  });
}
