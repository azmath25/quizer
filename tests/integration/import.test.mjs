import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { initializeApp } from "../../functions/node_modules/firebase-admin/lib/esm/app/index.js";
import {
  getFirestore,
  Timestamp,
} from "../../functions/node_modules/firebase-admin/lib/esm/firestore/index.js";
import { getAuth } from "../../functions/node_modules/firebase-admin/lib/esm/auth/index.js";
import { dispatch } from "../../functions/src/router.js";
import { runJob } from "../../functions/src/jobs/worker.js";
assert(process.env.FIRESTORE_EMULATOR_HOST);
initializeApp({
  projectId: "demo-mathquiz-v2",
  storageBucket: "demo-mathquiz-v2.appspot.com",
});
const db = getFirestore(),
  uid = "bulk_teacher",
  actor = {
    uid,
    token: {
      email: "bulk@example.test",
      email_verified: true,
      name: "Bulk teacher",
    },
  };
const call = async (action, data = {}, requestId = randomUUID()) =>
  (await dispatch(db, actor, { apiVersion: 2, action, requestId, ...data }))
    .data;
const record = (i) => ({
  importItemKey: "item_" + i,
  originalQuestionId: "q" + i,
  metadata: {
    title: "Problem " + i,
    subject: "Algebra",
    difficulty: "Practice",
    tags: [],
    bankVisibility: "private",
  },
  content: {
    type: "open",
    answerMode: "auto",
    statementLatex: "Compute $1+1$.",
    options: [],
    defaultPoints: 1,
    questionAssetBindings: {},
  },
  grading: {
    correctOptionId: null,
    acceptedAnswers: ["2"],
    tolerance: 0,
    explanationLatex: "$2$",
    rubricLatex: "",
    solutionAssetBindings: {},
  },
  points: 1,
});
test("A 500-problem import is chunked, resumable, hidden until complete and duplicate-safe", async () => {
  await getAuth().createUser({
    uid,
    email: "bulk@example.test",
    emailVerified: true,
  });
  await db
    .doc("roles/" + uid)
    .set({
      role: "teacher",
      accountStatus: "active",
      version: 1,
      updatedAt: Timestamp.now(),
    });
  await call("getSessionInfo");
  const imported = await call("createImportJob", {
    name: "500 problems",
    itemCount: 500,
  });
  await assert.rejects(
    call("finishImportJob", { jobId: imported.jobId, order: [] }),
  );
  const first = Array.from({ length: 20 }, (_, i) => record(i));
  const batch = await call("importProblemBatch", {
    jobId: imported.jobId,
    records: first,
  });
  assert.equal(batch.processed, 20);
  assert.deepEqual(
    (
      await call("importProblemBatch", {
        jobId: imported.jobId,
        records: first,
      })
    ).mappings,
    batch.mappings,
  );
  await assert.rejects(
    call("importProblemBatch", {
      jobId: imported.jobId,
      records: [{ ...record(0), points: 2 }],
    }),
    (e) => e.reason === "VERSION_CONFLICT",
  );
  assert.equal((await call("listMyQuizzes")).items.length, 0);
  for (let offset = 20; offset < 500; offset += 20)
    await call("importProblemBatch", {
      jobId: imported.jobId,
      records: Array.from({ length: 20 }, (_, i) => record(offset + i)),
    });
  const finished = await call("finishImportJob", {
    jobId: imported.jobId,
    title: "500 problems",
    order: Array.from({ length: 500 }, (_, i) => "item_" + i),
  });
  const draft = await call("getQuizDraft", { quizId: finished.quizId });
  assert.equal(draft.items.length, 500);
  assert.equal(draft.draft.itemOrder.length, 500);
  assert.equal(draft.quiz.visibility, "private");
  assert.equal(
    (await call("finishImportJob", { jobId: imported.jobId, order: [] }))
      .quizId,
    finished.quizId,
  );
});
test("Publication version numbers remain increasing after unpublish and republish", async () => {
  const p = await call("createProblem", {
    metadata: record(0).metadata,
    content: record(0).content,
    grading: record(0).grading,
  });
  const q = await call("createQuiz", { title: "Version continuity" });
  const d = await call("saveQuizDraft", {
    quizId: q.quizId,
    expectedDraftVersion: 1,
    upsertItems: [
      {
        clientKey: "one",
        problemId: p.problemId,
        problemRevisionId: p.revisionId,
        points: 1,
      },
    ],
    itemOrder: ["one"],
  });
  let pub = await call("publishQuiz", {
    quizId: q.quizId,
    expectedVersion: d.version,
    expectedDraftVersion: d.draftVersion,
  });
  assert(await runJob(db, pub.jobId));
  let current = await call("getQuizDraft", { quizId: q.quizId });
  await call("unpublishQuiz", {
    quizId: q.quizId,
    expectedVersion: current.quiz.version,
  });
  current = await call("getQuizDraft", { quizId: q.quizId });
  pub = await call("publishQuiz", {
    quizId: q.quizId,
    expectedVersion: current.quiz.version,
    expectedDraftVersion: current.draft.version,
  });
  assert(await runJob(db, pub.jobId));
  assert.equal(
    (
      await db.doc(`quizzes/${q.quizId}/revisions/${pub.revisionId}`).get()
    ).data().revisionNumber,
    2,
  );
});
