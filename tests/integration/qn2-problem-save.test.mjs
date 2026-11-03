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
const uid = "qn2_teacher";
const actor = { uid, token: { email: "qn2@example.test", email_verified: true, name: "QN2 Teacher" } };
const call = async (action, data = {}, requestId = randomUUID()) =>
  (await dispatch(db, actor, { apiVersion: 2, action, requestId, ...data })).data;
const sample = {
  metadata: { title: "Arithmetic", subject: "Math", difficulty: "Practice",
    tags: ["addition"], bankVisibility: "private" },
  content: { type: "open", answerMode: "auto", statementLatex: "Compute $1+1$.",
    options: [], defaultPoints: 1, questionAssetBindings: {} },
  grading: { correctOptionId: null, acceptedAnswers: ["2"], tolerance: 0,
    explanationLatex: "$2$", rubricLatex: "", solutionAssetBindings: {} },
};
const stamp = (snapshot) => snapshot.updateTime.seconds + ":" + snapshot.updateTime.nanoseconds;
const auditCount = async (problemId) => (await db.collection("auditEvents").get())
  .docs.filter((doc) => doc.data().targetType === "problem" && doc.data().targetId === problemId).length;

test("QN2: no-op and metadata edits reuse revision, changed answer/content creates one immutable revision", async () => {
  await getAuth().createUser({ uid, email: "qn2@example.test", emailVerified: true });
  await db.doc("roles/" + uid).set({
    role: "teacher", accountStatus: "active", version: 1, updatedAt: Timestamp.now(),
  });
  await call("getSessionInfo");
  const created = await call("createProblem", sample);
  const p = "problems/" + created.problemId;
  const revisionPath = p + "/revisions/" + created.revisionId;
  const rootBefore = await db.doc(p).get();
  const oldContent = await db.doc(revisionPath).get();
  const oldGrading = await db.doc(revisionPath + "/grading/main").get();
  const auditsBefore = await auditCount(created.problemId);
  const noopRequestId = randomUUID();

  // Full payload retry with a fresh request ID is semantically unchanged.
  const noop = await call("saveProblemRevision", {
    problemId: created.problemId, expectedVersion: created.version, ...sample,
  }, noopRequestId);
  assert.equal(noop.unchanged, true);
  assert.equal(noop.version, created.version);
  assert.equal(noop.revisionId, created.revisionId);
  assert.equal(stamp(await db.doc(p).get()), stamp(rootBefore));
  assert.equal(stamp(await db.doc(revisionPath).get()), stamp(oldContent));
  assert.equal(stamp(await db.doc(revisionPath + "/grading/main").get()), stamp(oldGrading));
  assert.equal(await auditCount(created.problemId), auditsBefore);
  assert.equal((await db.doc("operations/" + uid + "/requests/" + noopRequestId).get()).exists, false);

  const metadata = { ...sample.metadata, title: "Renamed arithmetic", tags: ["algebra"] };
  // The frontend need only send metadata; no statement, grading, or images.
  const renamed = await call("saveProblemRevision", {
    problemId: created.problemId, expectedVersion: created.version, metadata,
  });
  assert.equal(renamed.metadataOnly, true);
  assert.equal(renamed.version, created.version + 1);
  assert.equal(renamed.revisionId, created.revisionId);
  const rootAfterRename = await db.doc(p).get();
  assert.equal(rootAfterRename.data().revisionNumber, 1);
  assert.equal(rootAfterRename.data().latestRevisionId, created.revisionId);
  assert.equal(rootAfterRename.data().searchTitle, metadata.title.toLowerCase());
  assert.equal(stamp(await db.doc(revisionPath).get()), stamp(oldContent));
  assert.equal(stamp(await db.doc(revisionPath + "/grading/main").get()), stamp(oldGrading));
  assert.equal((await db.collection(p + "/revisions").get()).size, 1);
  assert.equal(await auditCount(created.problemId), auditsBefore + 1);

  const metadataNoopId = randomUUID();
  const metadataNoop = await call("saveProblemRevision", {
    problemId: created.problemId, expectedVersion: renamed.version, metadata,
  }, metadataNoopId);
  assert.equal(metadataNoop.unchanged, true);
  assert.equal(metadataNoop.version, renamed.version);
  assert.equal((await db.doc("operations/" + uid + "/requests/" + metadataNoopId).get()).exists, false);
  assert.equal(stamp(await db.doc(p).get()), stamp(rootAfterRename));

  await assert.rejects(
    call("saveProblemRevision", {
      problemId: created.problemId, expectedVersion: created.version, metadata,
    }), (e) => e.reason === "VERSION_CONFLICT",
  );
  await assert.rejects(
    call("saveProblemRevision", {
      problemId: created.problemId, expectedVersion: renamed.version,
      metadata, content: { ...sample.content, statementLatex: "Compute $4+5$." },
    }), (e) => e.reason === "INVALID_FIELDS",
  );

  const revised = await call("saveProblemRevision", {
    problemId: created.problemId, expectedVersion: renamed.version,
    metadata, content: { ...sample.content, statementLatex: "Compute $4+5$." },
    grading: { ...sample.grading, acceptedAnswers: ["9"] },
  });
  assert.notEqual(revised.revisionId, created.revisionId);
  assert.equal(revised.version, renamed.version + 1);
  const rootAfterContent = await db.doc(p).get();
  assert.equal(rootAfterContent.data().revisionNumber, 2);
  assert.equal((await db.collection(p + "/revisions").get()).size, 2);
  assert.equal((await db.doc(revisionPath).get()).data().statementLatex, sample.content.statementLatex);
  assert.equal((await db.doc(revisionPath + "/grading/main").get()).data().acceptedAnswers[0], "2");
  assert.equal((await db.doc(p + "/revisions/" + revised.revisionId).get()).data().statementLatex, "Compute $4+5$.");
  assert.equal((await db.doc(p + "/revisions/" + revised.revisionId + "/grading/main").get()).data().acceptedAnswers[0], "9");

  // Answer-only changes must likewise produce a new immutable revision.
  const answerOnly = await call("saveProblemRevision", {
    problemId: created.problemId, expectedVersion: revised.version,
    metadata, content: { ...sample.content, statementLatex: "Compute $4+5$." },
    grading: { ...sample.grading, acceptedAnswers: ["9", "09"] },
  });
  assert.notEqual(answerOnly.revisionId, revised.revisionId);
  assert.equal((await db.doc(p).get()).data().revisionNumber, 3);
  assert.equal((await db.collection(p + "/revisions").get()).size, 3);
});
