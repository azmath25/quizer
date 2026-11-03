import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { initializeApp } from "../../functions/node_modules/firebase-admin/lib/esm/app/index.js";
import { getFirestore, Timestamp } from "../../functions/node_modules/firebase-admin/lib/esm/firestore/index.js";
import { getAuth } from "../../functions/node_modules/firebase-admin/lib/esm/auth/index.js";
import { dispatch } from "../../functions/src/router.js";

assert(process.env.FIRESTORE_EMULATOR_HOST, "Firestore emulator required");
initializeApp({ projectId: "demo-mathquiz-v2", storageBucket: "demo-mathquiz-v2.appspot.com" });
const db = getFirestore();
const uid = "qn1_teacher";
const actor = { uid, token: { email: "qn1@example.test", email_verified: true, name: "QN1 Teacher" } };
const call = async (action, data = {}, requestId = randomUUID()) =>
  (await dispatch(db, actor, { apiVersion: 2, action, requestId, ...data })).data;

const sampleProblem = {
  metadata: { title: "Arithmetic", subject: "Math", difficulty: "Practice", tags: [], bankVisibility: "private" },
  content: { type: "open", answerMode: "auto", statementLatex: "Compute $1+1$.",
    options: [], defaultPoints: 1, questionAssetBindings: {} },
  grading: { correctOptionId: null, acceptedAnswers: ["2"], tolerance: 0,
    explanationLatex: "", rubricLatex: "", solutionAssetBindings: {} },
};
const revisionStamp = (snapshot) =>
  snapshot.updateTime.seconds + ":" + snapshot.updateTime.nanoseconds;
const slotStamps = async (quizId) => new Map(
  (await db.collection("quizzes/" + quizId + "/draftItems").get()).docs
    .map((doc) => [doc.id, revisionStamp(doc)]),
);
const assertSameSlotStamps = async (quizId, before) =>
  assert.deepEqual(await slotStamps(quizId), before);
const countQuizAudit = async (quizId) =>
  (await db.collection("auditEvents").get()).docs
    .filter((doc) => doc.data().quizId === quizId).length;
const countPublishedRevisions = async (quizId) =>
  (await db.collection("quizzes/" + quizId + "/revisions").get()).size;

test("QN1: 100/500-slot rename, settings and no-op do not reimport, republish or write problem slots", async () => {
  await getAuth().createUser({ uid, email: "qn1@example.test", emailVerified: true });
  await db.doc("roles/" + uid).set({
    role: "teacher", accountStatus: "active", version: 1, updatedAt: Timestamp.now(),
  });
  await call("getSessionInfo");
  const problem = await call("createProblem", sampleProblem);
  const canonicalBefore = await db.doc("problems/" + problem.problemId).get();

  for (const count of [100, 500]) {
    const created = await call("createQuiz", { title: "Original " + count });
    const quizId = created.quizId;
    const ids = Array.from({ length: count }, (_, i) => "itm_" + i);
    const collection = db.collection("quizzes/" + quizId + "/draftItems");
    for (let offset = 0; offset < count; offset += 200) {
      const batch = db.batch();
      for (const id of ids.slice(offset, offset + 200))
        batch.set(collection.doc(id), {
          itemId: id, problemId: problem.problemId,
          problemRevisionId: problem.revisionId,
          points: 1, reuseFromQuizRevisionId: null,
        });
      await batch.commit();
    }
    const draftRef = db.doc("quizzes/" + quizId + "/drafts/current");
    await draftRef.update({ itemOrder: ids });
    let original = await slotStamps(quizId);
    assert.equal(original.size, count);
    let draftBefore = await draftRef.get();
    let quizBefore = await db.doc("quizzes/" + quizId).get();
    let auditBefore = await countQuizAudit(quizId);
    const noOpRequestId = randomUUID();
    const noOp = await call("saveQuizDraft", {
      quizId, expectedDraftVersion: draftBefore.data().version,
      patch: { title: draftBefore.data().title },
      itemOrder: ids,
    }, noOpRequestId);
    assert.equal(noOp.unchanged, true);
    assert.equal(noOp.draftVersion, draftBefore.data().version);
    assert.equal(noOp.version, quizBefore.data().version);
    assert.equal(revisionStamp(await draftRef.get()), revisionStamp(draftBefore));
    assert.equal(revisionStamp(await db.doc("quizzes/" + quizId).get()), revisionStamp(quizBefore));
    assert.equal((await db.doc("operations/" + uid + "/requests/" + noOpRequestId).get()).exists, false);
    assert.equal(await countQuizAudit(quizId), auditBefore);
    await assertSameSlotStamps(quizId, original);

    const renamed = await call("saveQuizDraft", {
      quizId, expectedDraftVersion: noOp.draftVersion,
      patch: { title: "Renamed " + count },
    });
    assert.equal(renamed.draftVersion, noOp.draftVersion + 1);
    assert.equal((await draftRef.get()).data().title, "Renamed " + count);
    await assertSameSlotStamps(quizId, original);
    const settings = await call("saveQuizDraft", {
      quizId, expectedDraftVersion: renamed.draftVersion,
      patch: { settings: { durationSeconds: 900 } },
    });
    assert.equal(settings.draftVersion, renamed.draftVersion + 1);
    assert.equal((await draftRef.get()).data().settings.durationSeconds, 900);
    await assertSameSlotStamps(quizId, original);

    const at = Math.floor(count / 2);
    const changed = await call("saveQuizDraft", {
      quizId, expectedDraftVersion: settings.draftVersion,
      upsertItems: [{
        itemId: ids[at], problemId: problem.problemId,
        problemRevisionId: problem.revisionId, points: 3,
      }],
    });
    assert.equal(changed.draftVersion, settings.draftVersion + 1);
    const after = await slotStamps(quizId);
    const modified = ids.filter((id) => after.get(id) !== original.get(id));
    assert.deepEqual(modified, [ids[at]]);
    assert.equal((await collection.doc(ids[at]).get()).data().points, 3);
    assert.deepEqual((await draftRef.get()).data().itemOrder, ids);
    assert.equal(await countPublishedRevisions(quizId), 0);
    assert.equal(revisionStamp(await db.doc("problems/" + problem.problemId).get()),
      revisionStamp(canonicalBefore));
    original = after;
    await assertSameSlotStamps(quizId, original);
  }
});
