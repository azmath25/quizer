// Test fixtures only. This script refuses production projects and services.
import {
  initializeApp,
  getApps,
} from "../functions/node_modules/firebase-admin/lib/esm/app/index.js";
import {
  getFirestore,
  Timestamp,
} from "../functions/node_modules/firebase-admin/lib/esm/firestore/index.js";
import { getAuth } from "../functions/node_modules/firebase-admin/lib/esm/auth/index.js";
import { getStorage } from "../functions/node_modules/firebase-admin/lib/esm/storage/index.js";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dispatch } from "../functions/src/router.js";
import { runJob } from "../functions/src/jobs/worker.js";
import { fromLegacyQuestion } from "../shared/schema.js";
const sharp = createRequire(
  new URL("../functions/package.json", import.meta.url),
)("sharp");
export async function seed() {
  const project = process.env.GCLOUD_PROJECT || "demo-mathquiz-v2";
  if (
    !project.startsWith("demo-") ||
    !process.env.FIRESTORE_EMULATOR_HOST ||
    !process.env.FIREBASE_AUTH_EMULATOR_HOST ||
    !process.env.FIREBASE_STORAGE_EMULATOR_HOST
  )
    throw new Error(
      "Run with the Auth, Firestore and Storage emulators and a demo- project.",
    );
  if (!getApps().length)
    initializeApp({
      projectId: project,
      storageBucket: project + ".appspot.com",
    });
  const db = getFirestore(),
    auth = getAuth(),
    bucket = getStorage().bucket(),
    actors = {};
  const prior = (await db.doc("system/qaFixtures").get()).data();
  if (prior?.ready) return prior;
  for (const [uid, role, name, email] of [
    ["qa_teacher", "teacher", "Maya Chen", "teacher@example.test"],
    ["qa_other_teacher", "teacher", "Jon Ellis", "other-teacher@example.test"],
    ["qa_student", "student", "Alex Morgan", "student@example.test"],
    ["qa_admin", "admin", "Site administrator", "admin@example.test"],
  ]) {
    await auth
      .createUser({
        uid,
        email,
        emailVerified: true,
        password: "Testing123!",
        displayName: name,
      })
      .catch((e) => {
        if (
          e.code !== "auth/uid-already-exists" &&
          e.code !== "auth/email-already-exists"
        )
          throw e;
      });
    await db.doc("roles/" + uid).set({
      role,
      accountStatus: "active",
      version: 1,
      updatedAt: Timestamp.now(),
      updatedBy: "emulator_seed",
    });
    actors[uid] = { uid, token: { email, email_verified: true, name } };
  }
  await db.doc("system/accessControl").set({ activeAdminCount: 1, version: 1 });
  await db.doc("system/maintenance").set({ enabled: false });
  const call = async (uid, action, data = {}) =>
    (
      await dispatch(db, actors[uid], {
        apiVersion: 2,
        action,
        requestId: randomUUID(),
        ...data,
      })
    ).data;
  for (const uid of Object.keys(actors)) await call(uid, "getSessionInfo");
  const quizzes = [];
  for (const [filename, title] of [
    ["algebra-essentials", "Algebra essentials"],
    ["geometry-perspective", "Geometry practice"],
    ["olympiad-warmup", "Olympiad warm-up"],
  ]) {
    const quiz = JSON.parse(
      await readFile(
        new URL(
          "../tests/fixtures/quizzes/" + filename + ".quiz.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const bindings = {};
    for (const [alias, data] of Object.entries(quiz.assets ?? {})) {
      const match = /^data:[^,]+;base64,(.+)$/.exec(data);
      if (!match) continue;
      const image = await sharp(Buffer.from(match[1], "base64"))
        .png()
        .toBuffer();
      const asset = await call("qa_teacher", "createAssetUpload", {
        name: alias,
        kind: "image",
        contentType: "image/png",
        expectedBytes: image.length,
      });
      await bucket.file(asset.stagingPath).save(image, {
        resumable: false,
        metadata: { contentType: "image/png" },
      });
      const job = await call("qa_teacher", "finalizeAssetUpload", {
        assetId: asset.assetId,
      });
      if (!(await runJob(db, job.jobId)))
        throw new Error("Seed image job failed");
      bindings[alias] = asset.assetId;
    }
    const imported = await call("qa_teacher", "createImportJob", {
      name: title,
      itemCount: quiz.questions.length,
    });
    const records = quiz.questions.map((q, i) => ({
      ...fromLegacyQuestion(q, bindings),
      metadata: {
        title: `${title}: problem ${i + 1}`,
        subject: quiz.subject,
        difficulty: quiz.difficulty,
        tags: [],
        bankVisibility: "teachers",
      },
      importItemKey: "item_" + i,
      originalQuestionId: q.id,
      points: q.points,
    }));
    await call("qa_teacher", "importProblemBatch", {
      jobId: imported.jobId,
      records,
    });
    const created = await call("qa_teacher", "finishImportJob", {
      jobId: imported.jobId,
      title,
      description: quiz.description,
      settings: {
        durationSeconds: quiz.durationMinutes * 60,
        solutionRelease: "immediate",
      },
      order: records.map((r) => r.importItemKey),
    });
    const draft = await call("qa_teacher", "getQuizDraft", {
      quizId: created.quizId,
    });
    const saved = await call("qa_teacher", "saveQuizDraft", {
      quizId: created.quizId,
      expectedDraftVersion: draft.draft.version,
      patch: { subject: quiz.subject, difficulty: quiz.difficulty },
    });
    const policy = await call("qa_teacher", "setQuizAccessPolicy", {
      quizId: created.quizId,
      expectedVersion: saved.version,
      visibility: "public",
      accessMode: filename === "geometry-perspective" ? "approval" : "open",
      maxAttempts: 5,
    });
    const publication = await call("qa_teacher", "publishQuiz", {
      quizId: created.quizId,
      expectedVersion: policy.version,
      expectedDraftVersion: saved.draftVersion,
    });
    if (!(await runJob(db, publication.jobId)))
      throw new Error("Seed publication failed");
    quizzes.push({
      id: created.quizId,
      title,
      revisionId: publication.revisionId,
    });
  }
  await call("qa_student", "requestQuizAccess", { quizId: quizzes[1].id });
  const attempt = await call("qa_student", "startAttempt", {
    quizId: quizzes[2].id,
  });
  const questions = await call("qa_student", "getAttemptQuestions", {
    attemptId: attempt.attemptId,
    itemIds: attempt.order,
  });
  await call("qa_student", "saveAnswers", {
    attemptId: attempt.attemptId,
    expectedAnswerVersion: 0,
    changes: questions.items.map((item) => ({
      itemId: item.itemId,
      value:
        item.type === "choice"
          ? item.options[0].id
          : item.answerMode === "manual"
            ? "By parity, the two integers must have the same remainder modulo 2."
            : "2",
      expectedRevision: 0,
    })),
  });
  const submitted = await call("qa_student", "submitAttempt", {
    attemptId: attempt.attemptId,
  });
  if (!(await runJob(db, submitted.jobId)))
    throw new Error("Seed grading failed");
  const result = {
    ready: true,
    quizzes,
    attemptId: attempt.attemptId,
    createdAt: Timestamp.now(),
  };
  await db.doc("system/qaFixtures").set(result);
  return result;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await seed();
  console.log(
    JSON.stringify(
      {
        accounts: [
          "teacher@example.test",
          "other-teacher@example.test",
          "student@example.test",
          "admin@example.test",
        ],
        password: "Testing123!",
        quizzes: result.quizzes,
        attemptId: result.attemptId,
      },
      null,
      2,
    ),
  );
}
