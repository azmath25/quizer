import test from "node:test";
import assert from "node:assert/strict";
import { initializeApp } from "../../functions/node_modules/firebase-admin/lib/esm/app/index.js";
import {
  getFirestore,
  Timestamp,
} from "../../functions/node_modules/firebase-admin/lib/esm/firestore/index.js";
import { getAuth } from "../../functions/node_modules/firebase-admin/lib/esm/auth/index.js";
import { getStorage } from "../../functions/node_modules/firebase-admin/lib/esm/storage/index.js";
import { createRequire } from "node:module";
const sharp = createRequire(
  new URL("../../functions/package.json", import.meta.url),
)("sharp");
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
const call = async (who, action, data = {}, now, requestId = randomUUID()) =>
  (
    await dispatch(
      db,
      actors[who] ?? null,
      { apiVersion: 2, action, requestId, ...data },
      now ? { now } : {},
    )
  ).data;
const record = (overrides = {}) => ({
  metadata: {
    title: "Numerical exercise",
    subject: "Algebra",
    difficulty: "Practice",
    tags: [],
    bankVisibility: "teachers",
  },
  content: {
    type: "open",
    answerMode: "auto",
    statementLatex: "Compute $1+1$.",
    options: [],
    defaultPoints: 2,
    questionAssetBindings: {},
    ...overrides.content,
  },
  grading: {
    correctOptionId: null,
    acceptedAnswers: ["2"],
    tolerance: 0,
    explanationLatex: "$1+1=2$.",
    rubricLatex: "",
    solutionAssetBindings: {},
    ...overrides.grading,
  },
});
async function quizFor({
  settings = {},
  recordInput = record(),
  privateQuiz = false,
} = {}) {
  const p = await call("ext_teacher", "createProblem", recordInput);
  const q = await call("ext_teacher", "createQuiz", {
    title: "Integration quiz",
  });
  const saved = await call("ext_teacher", "saveQuizDraft", {
    quizId: q.quizId,
    expectedDraftVersion: 1,
    patch: { settings },
    upsertItems: [
      {
        clientKey: "one",
        problemId: p.problemId,
        problemRevisionId: p.revisionId,
        points: 2,
      },
    ],
    itemOrder: ["one"],
  });
  let version = saved.version;
  if (!privateQuiz)
    version = (
      await call("ext_teacher", "setQuizAccessPolicy", {
        quizId: q.quizId,
        expectedVersion: version,
        visibility: "public",
        accessMode: "open",
        maxAttempts: null,
      })
    ).version;
  const publication = await call("ext_teacher", "publishQuiz", {
    quizId: q.quizId,
    expectedVersion: version,
    expectedDraftVersion: saved.draftVersion,
  });
  assert(await runJob(db, publication.jobId));
  return {
    quizId: q.quizId,
    itemId: saved.itemOrder[0],
    problem: p,
    revisionId: publication.revisionId,
  };
}
test("Extended fixtures provision real emulator accounts", async () => {
  for (const [uid, role] of [
    ["ext_teacher", "teacher"],
    ["ext_other_teacher", "teacher"],
    ["ext_student", "student"],
    ["ext_other_student", "student"],
  ]) {
    await auth.createUser({
      uid,
      email: uid + "@example.test",
      emailVerified: true,
      password: "Testing123!",
      displayName: uid,
    });
    await db
      .doc("roles/" + uid)
      .set({
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
test("Server deadline rejects late writes and timeout grades last saved answer", async () => {
  const q = await quizFor({ settings: { durationSeconds: 1 } }),
    now = Timestamp.now(),
    a = await call("ext_student", "startAttempt", { quizId: q.quizId }, now);
  await call(
    "ext_student",
    "saveAnswers",
    {
      attemptId: a.attemptId,
      expectedAnswerVersion: 0,
      changes: [{ itemId: q.itemId, value: "2", expectedRevision: 0 }],
    },
    Timestamp.fromMillis(now.toMillis() + 500),
  );
  await assert.rejects(
    call(
      "ext_student",
      "saveAnswers",
      {
        attemptId: a.attemptId,
        expectedAnswerVersion: 1,
        changes: [{ itemId: q.itemId, value: "4", expectedRevision: 1 }],
      },
      Timestamp.fromMillis(now.toMillis() + 1000),
    ),
    (e) => e.reason === "ATTEMPT_EXPIRED",
  );
  const end = await call(
    "ext_student",
    "getAttempt",
    { attemptId: a.attemptId },
    Timestamp.fromMillis(now.toMillis() + 1000),
  );
  assert.equal(end.status, "timed_out");
  const raw = (await db.doc("attempts/" + a.attemptId).get()).data();
  assert(await runJob(db, raw.gradingJobId));
  assert.equal(
    (await call("ext_student", "getAttemptResult", { attemptId: a.attemptId }))
      .attempt.totals.score,
    2,
  );
});
test("Private request tokens grant only application; denial and link revocation are enforced", async () => {
  const q = await quizFor({ privateQuiz: true }),
    link = await call("ext_teacher", "createJoinLink", { quizId: q.quizId });
  assert.equal(
    (await call(null, "resolveJoinLink", { token: link.token })).quizId,
    q.quizId,
  );
  assert(!(await db.doc("joinLinks/" + link.linkId).get()).data().token);
  await call("ext_student", "requestQuizAccess", { token: link.token });
  await assert.rejects(
    call("ext_student", "startAttempt", { quizId: q.quizId }),
    (e) => e.reason === "ACCESS_PENDING",
  );
  await call("ext_teacher", "decideQuizAccess", {
    quizId: q.quizId,
    targetUid: "ext_student",
    decision: "decline",
    expectedVersion: 1,
  });
  await assert.rejects(
    call("ext_student", "requestQuizAccess", { token: link.token }),
    (e) => e.reason === "ACCESS_REVOKED",
  );
  await call("ext_teacher", "revokeJoinLink", {
    quizId: q.quizId,
    linkId: link.linkId,
  });
  await assert.rejects(
    call(null, "resolveJoinLink", { token: link.token }),
    (e) => e.reason === "RESOURCE_UNAVAILABLE",
  );
});
test("Revocation and Trash stop future starts while preserving an active attempt", async () => {
  const q = await quizFor(),
    a = await call("ext_student", "startAttempt", { quizId: q.quizId });
  const p = (
    await db.doc(`quizzes/${q.quizId}/participants/ext_student`).get()
  ).data();
  await call("ext_teacher", "decideQuizAccess", {
    quizId: q.quizId,
    targetUid: "ext_student",
    decision: "revoke",
    expectedVersion: p.version,
  });
  const current = await call("ext_teacher", "getQuizDraft", {
    quizId: q.quizId,
  });
  await call("ext_teacher", "trashQuiz", {
    quizId: q.quizId,
    expectedVersion: current.quiz.version,
  });
  assert.equal(
    (await call("ext_student", "startAttempt", { quizId: q.quizId })).attemptId,
    a.attemptId,
  );
  await call("ext_student", "saveAnswers", {
    attemptId: a.attemptId,
    expectedAnswerVersion: 0,
    changes: [{ itemId: q.itemId, value: "2", expectedRevision: 0 }],
  });
  await call("ext_student", "submitAttempt", { attemptId: a.attemptId });
  await assert.rejects(
    call("ext_student", "startAttempt", { quizId: q.quizId }),
  );
  assert((await db.doc("attempts/" + a.attemptId).get()).exists);
  const trashed = await call("ext_teacher", "getQuizDraft", {
    quizId: q.quizId,
  });
  await call("ext_teacher", "restoreQuiz", {
    quizId: q.quizId,
    expectedVersion: trashed.quiz.version,
  });
  assert.equal(
    (await call("ext_teacher", "getQuizDraft", { quizId: q.quizId })).quiz
      .visibility,
    "private",
  );
});
test("No-back navigation is enforced and active content remains pinned after source edits", async () => {
  const q = await quizFor({ settings: { allowBack: false } });
  const draft = await call("ext_teacher", "getQuizDraft", { quizId: q.quizId });
  const save = await call("ext_teacher", "saveQuizDraft", {
    quizId: q.quizId,
    expectedDraftVersion: draft.draft.version,
    upsertItems: [
      {
        clientKey: "second",
        problemId: q.problem.problemId,
        problemRevisionId: q.problem.revisionId,
        points: 2,
      },
    ],
    itemOrder: [q.itemId, "second"],
  });
  const pub = await call("ext_teacher", "publishQuiz", {
    quizId: q.quizId,
    expectedVersion: save.version,
    expectedDraftVersion: save.draftVersion,
  });
  await runJob(db, pub.jobId);
  const a = await call("ext_student", "startAttempt", { quizId: q.quizId });
  await call("ext_student", "navigateAttempt", {
    attemptId: a.attemptId,
    targetIndex: 1,
  });
  await assert.rejects(
    call("ext_student", "getAttemptQuestions", {
      attemptId: a.attemptId,
      itemIds: [q.itemId],
    }),
  );
  await assert.rejects(
    call("ext_student", "saveAnswers", {
      attemptId: a.attemptId,
      expectedAnswerVersion: 0,
      changes: [{ itemId: q.itemId, value: "2", expectedRevision: 0 }],
    }),
  );
  await call("ext_teacher", "saveProblemRevision", {
    problemId: q.problem.problemId,
    expectedVersion: 1,
    ...record({
      content: { statementLatex: "Changed problem" },
      grading: { acceptedAnswers: ["999"] },
    }),
  });
  const question = await call("ext_student", "getAttemptQuestions", {
    attemptId: a.attemptId,
    itemIds: [a.order[1]],
  });
  assert.equal(question.items[0].statementLatex, "Compute $1+1$.");
  assert.equal(a.quizRevisionId, pub.revisionId);
});
test("Image finalization is idempotent; question and never-release solution assets remain separate", async () => {
  const image = await sharp({
      create: { width: 16, height: 16, channels: 3, background: "#2459d3" },
    })
      .png()
      .toBuffer(),
    assets = [];
  for (const name of ["question.png", "solution.png"]) {
    const reservation = await call("ext_teacher", "createAssetUpload", {
      kind: "image",
      name,
      contentType: "image/png",
      expectedBytes: image.length,
    });
    await bucket
      .file(reservation.stagingPath)
      .save(image, {
        resumable: false,
        metadata: { contentType: "image/png" },
      });
    const final = await call("ext_teacher", "finalizeAssetUpload", {
      assetId: reservation.assetId,
    });
    assert(await runJob(db, final.jobId));
    assert.equal(
      (
        await call("ext_teacher", "finalizeAssetUpload", {
          assetId: reservation.assetId,
        })
      ).status,
      "ready",
    );
    assert(
      (await db.doc("assets/" + reservation.assetId).get())
        .data()
        .storagePath.startsWith("assets/ext_teacher/"),
    );
    assets.push(reservation.assetId);
  }
  const q = await quizFor({
    settings: { solutionRelease: "never" },
    recordInput: record({
      content: {
        statementLatex: "Compute $1+1$. \\includegraphics{question.png}",
        questionAssetBindings: { "question.png": assets[0] },
      },
      grading: {
        explanationLatex: "\\includegraphics{solution.png}",
        solutionAssetBindings: { "solution.png": assets[1] },
      },
    }),
  });
  const a = await call("ext_student", "startAttempt", { quizId: q.quizId });
  assert.equal(
    (
      await call("ext_student", "getAssetLinks", {
        context: { kind: "attempt", id: a.attemptId },
        assetIds: [assets[0]],
      })
    ).links.length,
    1,
  );
  await assert.rejects(
    call("ext_student", "getAssetLinks", {
      context: { kind: "attempt", id: a.attemptId },
      assetIds: [assets[1]],
    }),
  );
  const submitted = await call("ext_student", "submitAttempt", {
    attemptId: a.attemptId,
  });
  await runJob(db, submitted.jobId);
  await assert.rejects(
    call("ext_student", "getAssetLinks", {
      context: { kind: "result", id: a.attemptId },
      assetIds: [assets[1]],
    }),
  );
  await assert.rejects(
    call("ext_teacher", "releaseResults", {
      quizId: q.quizId,
      attemptIds: [a.attemptId],
      solutions: true,
    }),
  );
  const bad = await call("ext_teacher", "createAssetUpload", {
    kind: "image",
    name: "fake.png",
    contentType: "image/png",
    expectedBytes: 4,
  });
  await bucket
    .file(bad.stagingPath)
    .save(Buffer.from("fake"), { metadata: { contentType: "image/png" } });
  const final = await call("ext_teacher", "finalizeAssetUpload", {
    assetId: bad.assetId,
  });
  assert.equal(await runJob(db, final.jobId), false);
  assert.equal(
    (await db.doc("assets/" + bad.assetId).get()).data().status,
    "failed",
  );
});
test("Withdrawing bank sharing preserves owned published snapshots and authorized duplication", async () => {
  const q = await quizFor();
  const copy = await call("ext_other_teacher", "createQuiz", {
    title: "Shared test",
  });
  let saved = await call("ext_other_teacher", "saveQuizDraft", {
    quizId: copy.quizId,
    expectedDraftVersion: 1,
    upsertItems: [
      {
        clientKey: "shared",
        problemId: q.problem.problemId,
        problemRevisionId: q.problem.revisionId,
        points: 2,
      },
    ],
    itemOrder: ["shared"],
  });
  let pub = await call("ext_other_teacher", "publishQuiz", {
    quizId: copy.quizId,
    expectedVersion: saved.version,
    expectedDraftVersion: saved.draftVersion,
  });
  assert(await runJob(db, pub.jobId));
  await call("ext_teacher", "setProblemSharing", {
    problemId: q.problem.problemId,
    expectedVersion: 1,
    visibility: "private",
  });
  const d = await call("ext_other_teacher", "getQuizDraft", {
    quizId: copy.quizId,
  });
  pub = await call("ext_other_teacher", "publishQuiz", {
    quizId: copy.quizId,
    expectedVersion: d.quiz.version,
    expectedDraftVersion: d.draft.version,
  });
  assert(await runJob(db, pub.jobId));
  const current = await call("ext_other_teacher", "getQuizDraft", {
    quizId: copy.quizId,
  });
  const duplicate = await call("ext_other_teacher", "duplicateQuiz", {
    quizId: copy.quizId,
    expectedVersion: current.quiz.version,
  });
  assert(await runJob(db, duplicate.jobId));
  assert.equal(
    (
      await call("ext_other_teacher", "getQuizDraft", {
        quizId: duplicate.quizId,
      })
    ).draft.itemOrder.length,
    1,
  );
  await assert.rejects(
    call("ext_other_teacher", "getProblem", { problemId: q.problem.problemId }),
  );
});
test("Authorized CSV and ZIP exports contain only the selected quiz and saved revision", async () => {
  const q = await quizFor();
  const a = await call("ext_student", "startAttempt", { quizId: q.quizId });
  const sub = await call("ext_student", "submitAttempt", {
    attemptId: a.attemptId,
  });
  await runJob(db, sub.jobId);
  await assert.rejects(
    call("ext_other_teacher", "exportQuizResults", { quizId: q.quizId }),
  );
  for (const action of ["exportQuizResults", "exportQuizBackup"]) {
    const job = await call("ext_teacher", action, { quizId: q.quizId });
    assert(await runJob(db, job.jobId));
    const result = await call("ext_teacher", "getJob", { jobId: job.jobId });
    assert(result.result.storagePath.startsWith("exports/ext_teacher/"));
    const [bytes] = await bucket.file(result.result.storagePath).download();
    assert(bytes.length);
    if (action === "exportQuizResults") {
      assert(bytes.toString().includes("ext_student"));
      assert(!bytes.toString().includes("ext_other_student"));
    } else assert.equal(bytes.subarray(0, 2).toString(), "PK");
  }
});
test("Expired failed upload reservations release quota without touching referenced assets", async () => {
  const { sweep } = await import("../../functions/src/jobs/sweeper.js");
  const before = (await call("ext_teacher", "getUploadUsage")).reservedBytes;
  const reservation = await call("ext_teacher", "createAssetUpload", {
    kind: "image",
    name: "expired.png",
    contentType: "image/png",
    expectedBytes: 8,
  });
  await db
    .doc("assets/" + reservation.assetId)
    .update({
      status: "failed",
      expiresAt: Timestamp.fromMillis(Date.now() - 1000),
    });
  await sweep(db);
  const asset = (await db.doc("assets/" + reservation.assetId).get()).data();
  assert.equal(asset.reservationReleased, true);
  assert(asset.deletedAt);
  assert.equal(
    (await call("ext_teacher", "getUploadUsage")).reservedBytes,
    before,
  );
});
