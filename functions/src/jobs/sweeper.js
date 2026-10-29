import { transact, Timestamp, millis } from "../domain/runtime.js";
import { freeze } from "../api/attempts.js";
import { runJob } from "./worker.js";
export async function sweep(db) {
  if ((await db.doc("system/maintenance").get()).data()?.enabled) return;
  const now = Timestamp.now();
  const expired = await db
    .collection("attempts")
    .where("status", "==", "active")
    .where("deadlineAt", "<=", now)
    .orderBy("deadlineAt")
    .limit(100)
    .get();
  for (const doc of expired.docs)
    if (doc.data().deadlineAt)
      await transact(db, "timeout", doc.id, async (c) => {
        const a = await c.get(doc.ref.path);
        if (
          a.status === "active" &&
          a.deadlineAt &&
          millis(c.now) >= millis(a.deadlineAt)
        ) {
          c.actor = { uid: "system", role: "system" };
          await freeze(c, doc.id, a, "timed_out");
        }
      });
  const reservations = await db
    .collection("assets")
    .where("status", "in", ["awaiting_upload", "failed"])
    .where("expiresAt", "<=", now)
    .orderBy("expiresAt")
    .limit(50)
    .get();
  for (const doc of reservations.docs)
    await transact(db, "cleanup", doc.id, async (c) => {
      const a = await c.get(doc.ref.path);
      if (
        ["awaiting_upload", "failed"].includes(a.status) &&
        !a.reservationReleased &&
        a.referenceCount === 0
      ) {
        c.actor = { uid: "system", role: "system" };
        await c.job("cleanup_asset", doc.id);
        c.set(doc.ref.path, {
          ...a,
          status: "deleting",
          version: a.version + 1,
        });
      }
    });
  const queued = await db
    .collection("jobs")
    .where("status", "==", "queued")
    .orderBy("updatedAt")
    .limit(30)
    .get();
  const abandoned = await db
    .collection("jobs")
    .where("status", "==", "running")
    .where("leaseExpiresAt", "<=", now)
    .orderBy("leaseExpiresAt")
    .limit(30)
    .get();
  // Limit parallel workers; repeated schedules are safe because leases are transactional.
  const ids = [
    ...new Set(
      [...queued.docs, ...abandoned.docs]
        .filter((d) => d.data().kind !== "import")
        .map((d) => d.id),
    ),
  ];
  for (let i = 0; i < ids.length; i += 3)
    await Promise.all(ids.slice(i, i + 3).map((id) => runJob(db, id)));
}
