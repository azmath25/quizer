import test from "node:test";
import assert from "node:assert/strict";
import { initializeApp } from "../../functions/node_modules/firebase-admin/lib/esm/app/index.js";
import {
  getFirestore,
  Timestamp,
} from "../../functions/node_modules/firebase-admin/lib/esm/firestore/index.js";
import { getAuth } from "../../functions/node_modules/firebase-admin/lib/esm/auth/index.js";
import { getStorage } from "../../functions/node_modules/firebase-admin/lib/esm/storage/index.js";
import { dispatch } from "../../functions/src/router.js";
import { runJob } from "../../functions/src/jobs/worker.js";
import { randomUUID } from "node:crypto";
assert(process.env.FIRESTORE_EMULATOR_HOST);
initializeApp({
  projectId: "demo-mathquiz-v2",
  storageBucket: "demo-mathquiz-v2.appspot.com",
});
const db = getFirestore(),
  auth = getAuth(),
  bucket = getStorage().bucket(),
  actors = {};
const call = async (who, action, data = {}) =>
  (
    await dispatch(db, actors[who] ?? null, {
      apiVersion: 2,
      action,
      requestId: randomUUID(),
      ...data,
    })
  ).data;
test("AI fixtures", async () => {
  for (const [uid, role] of [
    ["ai_teacher", "teacher"],
    ["ai_other", "teacher"],
    ["ai_student", "student"],
  ]) {
    await auth.createUser({
      uid,
      email: uid + "@example.test",
      emailVerified: true,
      password: "Testing123!",
    });
    await db.doc("roles/" + uid).set({
      role,
      accountStatus: "active",
      version: 1,
      updatedAt: Timestamp.now(),
      updatedBy: "seed",
    });
    actors[uid] = {
      uid,
      token: { email: uid + "@example.test", email_verified: true, name: uid },
    };
    await call(uid, "getSessionInfo");
  }
});
test("Chats are private, ordered, auto-titled and fully deletable", async () => {
  const { chatId } = await call("ai_teacher", "createChat", {});
  await call("ai_teacher", "appendChatMessages", {
    chatId,
    messages: [
      { role: "user", text: "Solve x+1=3" },
      { role: "assistant", text: "x=2" },
    ],
  });
  const got = await call("ai_teacher", "getChat", { chatId });
  assert.equal(got.chat.title, "Solve x+1=3");
  assert.deepEqual(
    got.messages.map((m) => m.role),
    ["user", "assistant"],
  );
  await assert.rejects(call("ai_other", "getChat", { chatId }));
  await assert.rejects(call("ai_student", "listChats", {}));
  assert.equal((await call("ai_teacher", "listChats", {})).items.length, 1);
  await call("ai_teacher", "deleteChat", { chatId });
  assert.equal((await call("ai_teacher", "listChats", {})).items.length, 0);
  const left = await db
    .collection(`users/ai_teacher/chats/${chatId}/messages`)
    .get();
  assert.equal(left.size, 0);
});
test("A queued extraction fails cleanly without a provider and notifies the owner", async () => {
  const bytes = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF");
  const r = await call("ai_teacher", "createAssetUpload", {
    kind: "document",
    name: "exam.pdf",
    contentType: "application/pdf",
    expectedBytes: bytes.length,
  });
  await bucket
    .file(r.stagingPath)
    .save(bytes, {
      resumable: false,
      metadata: { contentType: "application/pdf" },
    });
  const fin = await call("ai_teacher", "finalizeAssetUpload", {
    assetId: r.assetId,
  });
  assert(await runJob(db, fin.jobId));
  await assert.rejects(
    call("ai_other", "createExtractionJob", {
      assetId: r.assetId,
      name: "x",
      target: "bulk",
    }),
  );
  const { jobId } = await call("ai_teacher", "createExtractionJob", {
    assetId: r.assetId,
    name: "exam.pdf",
    target: "quiz",
  });
  let list = await call("ai_teacher", "listMyJobs", {});
  assert.equal(list.items[0].status, "queued");
  assert.equal((await call("ai_other", "listMyJobs", {})).items.length, 0);
  assert.equal(await runJob(db, jobId), false);
  list = await call("ai_teacher", "listMyJobs", {});
  assert.equal(list.items[0].status, "failed");
  assert.equal(list.items[0].error.reason, "AI_NOT_CONNECTED");
  const notes = await call("ai_teacher", "listMyNotifications", {});
  assert(notes.items.some((n) => n.type === "ai_job" && n.targetId === jobId));
});
test("Non-PDF bytes are rejected for documents", async () => {
  const r = await call("ai_teacher", "createAssetUpload", {
    kind: "document",
    name: "fake.pdf",
    contentType: "application/pdf",
    expectedBytes: 4,
  });
  await bucket
    .file(r.stagingPath)
    .save(Buffer.from("fake"), {
      resumable: false,
      metadata: { contentType: "application/pdf" },
    });
  const fin = await call("ai_teacher", "finalizeAssetUpload", {
    assetId: r.assetId,
  });
  assert.equal(await runJob(db, fin.jobId), false);
});
