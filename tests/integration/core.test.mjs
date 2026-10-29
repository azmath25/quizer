import test from "node:test";
import assert from "node:assert/strict";
import { initializeApp } from "../../functions/node_modules/firebase-admin/lib/esm/app/index.js";
import {
  getFirestore,
  Timestamp,
} from "../../functions/node_modules/firebase-admin/lib/esm/firestore/index.js";
import { getAuth } from "../../functions/node_modules/firebase-admin/lib/esm/auth/index.js";
import { dispatch } from "../../functions/src/router.js";
import { runJob } from "../../functions/src/jobs/worker.js";
import { randomUUID } from "node:crypto";
assert(process.env.FIRESTORE_EMULATOR_HOST, "Emulator required");
initializeApp({
  projectId: "demo-mathquiz-v2",
  storageBucket: "demo-mathquiz-v2.appspot.com",
});
const db = getFirestore(),
  auth = getAuth();
const actors = {};
async function call(who, action, data = {}, requestId = randomUUID(), now) {
  return (
    await dispatch(
      db,
      who ? actors[who] : null,
      { apiVersion: 2, action, requestId, ...data },
      now ? { now } : {},
    )
  ).data;
}
const problem = (mode = "choice") => ({
  metadata: {
    title: "Parity",
    subject: "Number theory",
    difficulty: "Olympiad",
    tags: ["parity"],
    bankVisibility: "private",
  },
  content: {
    type: mode === "choice" ? "choice" : "open",
    answerMode: mode === "proof" ? "manual" : "auto",
    statementLatex:
      mode === "choice"
        ? "A sum of $3$ odd integers is:"
        : mode === "proof"
          ? "Prove your claim."
          : "Compute $3/2$.",
    options:
      mode === "choice"
        ? [
            { id: "a", textLatex: "Even" },
            { id: "b", textLatex: "Odd" },
          ]
        : [],
    defaultPoints: mode === "choice" ? 2 : mode === "proof" ? 5 : 3,
    questionAssetBindings: {},
  },
  grading: {
    correctOptionId: mode === "choice" ? "b" : null,
    acceptedAnswers: mode === "numeric" ? ["3/2"] : [],
    tolerance: 0.000001,
    explanationLatex: "A solution.",
    rubricLatex: "Explain each step.",
    solutionAssetBindings: {},
  },
});
let quiz, items, attempt;
test("Provision accounts; preserve roles; reject escalation, unverified and disabled access", async () => {
  for (const [uid, role, verified, status] of [
    ["teacher_a", "teacher", true, "active"],
    ["teacher_b", "teacher", true, "active"],
    ["student_a", "student", true, "active"],
    ["student_b", "student", true, "active"],
    ["unverified", "teacher", false, "active"],
    ["disabled", "teacher", true, "disabled"],
    ["admin_a", "admin", true, "active"],
    ["admin_b", "admin", true, "active"],
  ]) {
    await auth.createUser({
      uid,
      email: `${uid}@example.test`,
      emailVerified: verified,
      password: "Testing123!",
      displayName: uid,
    });
    await db.doc("roles/" + uid).set({
      role,
      accountStatus: status,
      version: 1,
      updatedAt: Timestamp.now(),
      updatedBy: "seed",
    });
    actors[uid] = {
      uid,
      token: {
        email: `${uid}@example.test`,
        email_verified: verified,
        name: uid,
      },
    };
    if (status === "active") await call(uid, "getSessionInfo");
  }
  await db.doc("system/accessControl").set({ activeAdminCount: 2, version: 1 });
  await assert.rejects(
    call("student_a", "updateProfile", { role: "admin", expectedVersion: 1 }),
    (e) => e.reason === "INVALID_FIELDS",
  );
  await assert.rejects(
    call("unverified", "createProblem", problem()),
    (e) => e.reason === "EMAIL_UNVERIFIED",
  );
  await assert.rejects(
    call("disabled", "createQuiz"),
    (e) => e.reason === "ACCOUNT_DISABLED",
  );
});
test("Problem revisions, shared read, owner protection, immutable source and idempotency", async () => {
  const request = randomUUID(),
    p = await call("teacher_a", "createProblem", problem(), request);
  assert.equal(
    (await call("teacher_a", "createProblem", problem(), request)).problemId,
    p.problemId,
  );
  await assert.rejects(
    call(
      "teacher_a",
      "createProblem",
      { ...problem(), metadata: { ...problem().metadata, title: "Changed" } },
      request,
    ),
    (e) => e.reason === "INVALID_FIELDS",
  );
  await assert.rejects(
    call("teacher_b", "getProblem", { problemId: p.problemId }),
    (e) => e.reason === "RESOURCE_UNAVAILABLE",
  );
  await call("teacher_a", "setProblemSharing", {
    problemId: p.problemId,
    visibility: "teachers",
    expectedVersion: 1,
  });
  const shared = await call("teacher_b", "getProblem", {
    problemId: p.problemId,
  });
  assert.equal(shared.grading.correctOptionId, "b");
  await assert.rejects(
    call("teacher_b", "saveProblemRevision", {
      problemId: p.problemId,
      expectedVersion: 2,
      ...problem(),
    }),
    (e) => e.reason === "RESOURCE_UNAVAILABLE",
  );
  const fork = await call("teacher_b", "forkProblem", {
    problemId: p.problemId,
  });
  assert.equal(
    (await call("teacher_b", "getProblem", { problemId: fork.problemId }))
      .problem.sourceProblemId,
    p.problemId,
  );
  const p2 = await call("teacher_a", "createProblem", problem("numeric")),
    p3 = await call("teacher_a", "createProblem", problem("proof"));
  quiz = await call("teacher_a", "createQuiz", { title: "Parity practice" });
  assert.equal((await call(null, "listPublicQuizzes")).items.length, 0);
  const saved = await call("teacher_a", "saveQuizDraft", {
    quizId: quiz.quizId,
    expectedDraftVersion: 1,
    patch: { settings: { penalty: 1 } },
    upsertItems: [p, p2, p3].map((x, i) => ({
      clientKey: `slot${i}`,
      problemId: x.problemId,
      problemRevisionId: x.revisionId,
      points: [2, 3, 5][i],
    })),
    itemOrder: ["slot0", "slot1", "slot2"],
  });
  items = saved.itemOrder;
  quiz.version = saved.version;
  quiz.draftVersion = saved.draftVersion;
  await assert.rejects(
    call("teacher_a", "saveQuizDraft", {
      quizId: quiz.quizId,
      expectedDraftVersion: 1,
      patch: { title: "Stale" },
    }),
    (e) => e.reason === "VERSION_CONFLICT",
  );
  await assert.rejects(
    call("teacher_b", "getQuizDraft", { quizId: quiz.quizId }),
    (e) => e.reason === "RESOURCE_UNAVAILABLE",
  );
});
test("Publish complete immutable snapshots; private questions stay protected", async () => {
  const published = await call("teacher_a", "publishQuiz", {
    quizId: quiz.quizId,
    expectedVersion: quiz.version,
    expectedDraftVersion: quiz.draftVersion,
  });
  assert.equal(await runJob(db, published.jobId), true);
  assert.equal(
    (await call("teacher_a", "getJob", { jobId: published.jobId })).status,
    "succeeded",
  );
  await assert.rejects(
    call("student_a", "getQuizOverview", { quizId: quiz.quizId }),
    (e) => e.reason === "RESOURCE_UNAVAILABLE",
  );
  await assert.rejects(
    call("student_a", "getQuizDraft", { quizId: quiz.quizId }),
    (e) => e.reason === "ROLE_REQUIRED",
  );
  const q = await call("teacher_a", "getQuizDraft", { quizId: quiz.quizId });
  quiz.version = q.quiz.version;
  await assert.rejects(
    call("teacher_a", "setQuizAccessPolicy", {
      quizId: quiz.quizId,
      expectedVersion: quiz.version,
      visibility: "private",
      accessMode: "open",
      maxAttempts: 2,
    }),
    (e) => e.reason === "INVALID_FIELDS",
  );
  await call("teacher_a", "setQuizAccessPolicy", {
    quizId: quiz.quizId,
    expectedVersion: quiz.version,
    visibility: "public",
    accessMode: "approval",
    maxAttempts: 3,
  });
  const catalog = await call(null, "listPublicQuizzes");
  assert.equal(catalog.items.length, 1);
  assert.equal(catalog.items[0].title, "Parity practice");
  assert(!JSON.stringify(catalog).includes("correctOptionId"));
});
test("Application, approval, one active allocation, strict answer writes and server grading", async () => {
  const request = await call("student_a", "requestQuizAccess", {
    quizId: quiz.quizId,
    message: "May I join?",
  });
  assert.equal(request.accessStatus, "pending");
  await assert.rejects(
    call("student_a", "startAttempt", { quizId: quiz.quizId }),
    (e) => e.reason === "ACCESS_PENDING",
  );
  await call("teacher_a", "decideQuizAccess", {
    quizId: quiz.quizId,
    targetUid: "student_a",
    decision: "approve",
    expectedVersion: 1,
  });
  const concurrent = await Promise.all([
    call("student_a", "startAttempt", { quizId: quiz.quizId }),
    call("student_a", "startAttempt", { quizId: quiz.quizId }),
  ]);
  attempt = concurrent[0];
  assert.equal(concurrent[0].attemptId, concurrent[1].attemptId);
  assert.equal(attempt.ordinal, 1);
  const questions = await call("student_a", "getAttemptQuestions", {
    attemptId: attempt.attemptId,
    itemIds: items,
  });
  assert.equal(questions.items.length, 3);
  assert(!JSON.stringify(questions).includes("correctOptionId"));
  assert(!JSON.stringify(questions).includes("solutionAssetBindings"));
  await assert.rejects(
    call("student_b", "getAttempt", { attemptId: attempt.attemptId }),
    (e) => e.reason === "RESOURCE_UNAVAILABLE",
  );
  const saved = await call("student_a", "saveAnswers", {
    attemptId: attempt.attemptId,
    expectedAnswerVersion: 0,
    changes: items.map((itemId, i) => ({
      itemId,
      value: ["b", "9", "Here is my proof."][i],
      expectedRevision: 0,
    })),
  });
  assert.equal(saved.answerVersion, 1);
  await assert.rejects(
    call("student_a", "saveAnswers", {
      attemptId: attempt.attemptId,
      expectedAnswerVersion: 0,
      changes: [{ itemId: items[0], value: "a", expectedRevision: 1 }],
    }),
    (e) => e.reason === "VERSION_CONFLICT",
  );
  const same = await call("student_a", "saveAnswers", {
    attemptId: attempt.attemptId,
    expectedAnswerVersion: 1,
    changes: [{ itemId: items[0], value: "b", expectedRevision: 1 }],
  });
  assert.equal(same.answerVersion, 1);
  assert.equal(
    (
      await call("student_a", "getAnswerHistory", {
        attemptId: attempt.attemptId,
        itemId: items[0],
      })
    ).items.length,
    1,
  );
  const frozen = await call("student_a", "submitAttempt", {
    attemptId: attempt.attemptId,
  });
  assert.equal(frozen.status, "submitted");
  assert.equal(
    (await call("student_a", "submitAttempt", { attemptId: attempt.attemptId }))
      .jobId,
    frozen.jobId,
  );
  await assert.rejects(
    call("student_a", "saveAnswers", {
      attemptId: attempt.attemptId,
      expectedAnswerVersion: 1,
      changes: [{ itemId: items[0], value: "a", expectedRevision: 1 }],
    }),
    (e) => e.reason === "ATTEMPT_FROZEN",
  );
  assert.equal(await runJob(db, frozen.jobId), true);
  const result = await call("student_a", "getAttemptResult", {
    attemptId: attempt.attemptId,
  });
  assert.equal(result.attempt.totals.score, 1);
  assert.equal(result.attempt.totals.pending, 1);
  assert.equal(result.items[0].solution, null);
});
test("Teacher marking, penalties, release isolation, statistics and audit", async () => {
  await assert.rejects(
    call("teacher_b", "saveManualGrade", {
      attemptId: attempt.attemptId,
      itemId: items[2],
      points: 3,
      expectedGradeVersion: 1,
    }),
    (e) => e.reason === "RESOURCE_UNAVAILABLE",
  );
  const grade = await call("teacher_a", "saveManualGrade", {
    attemptId: attempt.attemptId,
    itemId: items[2],
    points: 3,
    feedback: "Good approach.",
    expectedGradeVersion: 1,
  });
  assert.equal(grade.totals.score, 4);
  assert.equal(grade.totals.partial, 1);
  const corrected = await call("teacher_a", "saveManualGrade", {
    attemptId: attempt.attemptId,
    itemId: items[2],
    points: 0,
    reason: "Missing the required argument.",
    expectedGradeVersion: 2,
  });
  assert.equal(corrected.totals.score, 0);
  assert.equal(corrected.totals.incorrect, 2);
  const stats = await call("teacher_a", "getQuizStatistics", {
    quizId: quiz.quizId,
  });
  assert.equal(stats.finalCount, 1);
  assert.equal(stats.averageScore, 0);
  assert.equal(stats.uniqueParticipants, 1);
  await call("teacher_a", "releaseResults", {
    quizId: quiz.quizId,
    attemptIds: [attempt.attemptId],
    solutions: true,
  });
  assert.equal(
    (
      await call("student_a", "getAttemptResult", {
        attemptId: attempt.attemptId,
      })
    ).items[0].solution.correctOptionId,
    "b",
  );
  const events = await call("admin_a", "listActivity", {
    actorId: "teacher_a",
    limit: 100,
  });
  assert(events.items.some((e) => e.action === "grade.manually_changed"));
  assert(!JSON.stringify(events).includes("Here is my proof."));
});
test("Canonical role changes with existing tokens; concurrent last-admin protection", async () => {
  await call("admin_a", "setUserRole", {
    targetUid: "teacher_b",
    role: "student",
    expectedVersion: 1,
    reason: "Test demotion",
  });
  await assert.rejects(
    call("teacher_b", "createQuiz"),
    (e) => e.reason === "ROLE_REQUIRED",
  );
  const results = await Promise.allSettled([
    call("admin_a", "setUserRole", {
      targetUid: "admin_a",
      role: "student",
      expectedVersion: 1,
      reason: "Test",
    }),
    call("admin_b", "setUserRole", {
      targetUid: "admin_b",
      role: "student",
      expectedVersion: 1,
      reason: "Test",
    }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    (await db.doc("system/accessControl").get()).data().activeAdminCount,
    1,
  );
});

test("Old profile fields are normalized without changing the canonical teacher role", async () => {
  await db
    .doc("users/teacher_a")
    .set({ displayName: "Existing teacher", email: "teacher_a@example.test" });
  const result = await call("teacher_a", "getSessionInfo");
  assert.equal(result.profile.version, 1);
  assert.deepEqual(result.profile.preferences, {
    theme: "light",
    textScale: 1,
  });
  assert.equal(result.profile.uid, "teacher_a");
  assert.equal(result.role, "teacher");
});
