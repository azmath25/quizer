import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { initializeApp } from "../../functions/node_modules/firebase-admin/lib/esm/app/index.js";
import {
  getFirestore,
  Timestamp,
} from "../../functions/node_modules/firebase-admin/lib/esm/firestore/index.js";
import { getAuth } from "../../functions/node_modules/firebase-admin/lib/esm/auth/index.js";
import { getStorage } from "../../functions/node_modules/firebase-admin/lib/esm/storage/index.js";
assert(process.env.FIRESTORE_EMULATOR_HOST);
initializeApp({
  projectId: "demo-mathquiz-v2",
  storageBucket: "demo-mathquiz-v2.appspot.com",
});
const db = getFirestore(),
  auth = getAuth(),
  sharp = createRequire(
    new URL("../../functions/package.json", import.meta.url),
  )("sharp");
const run = async (...args) => {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      "scripts/migrate-v1.mjs",
      "--project",
      "demo-mathquiz-v2",
      "--bucket",
      "demo-mathquiz-v2.appspot.com",
      "--run-id",
      "integration_migration",
      "--only-quiz",
      "legacy_migration_quiz",
      ...args,
    ],
    { cwd: new URL("../../", import.meta.url), maxBuffer: 2e6 },
  );
  return JSON.parse(stdout);
};
test("Legacy migration dry run, image extraction, source retention and repeatable resume", async () => {
  const uid = "migration_teacher";
  await auth.createUser({
    uid,
    email: "migration@example.test",
    emailVerified: true,
  });
  await db.doc("roles/" + uid).set({ role: "teacher" });
  const image = await sharp({
    create: { width: 12, height: 12, channels: 3, background: "#2266dd" },
  })
    .png()
    .toBuffer();
  const raw = {
    schemaVersion: 1,
    title: "Original geometry",
    durationMinutes: 12,
    settings: { penalty: 0.5 },
    assets: {
      "figure.png": "data:image/png;base64," + image.toString("base64"),
    },
    questions: [
      {
        id: "q1",
        type: "open",
        answerMode: "auto",
        prompt: "Compute $2+2$. \\includegraphics{figure.png}",
        answers: ["4"],
        points: 3,
        explanation: "Add the two pairs.",
      },
    ],
  };
  const source = JSON.stringify(raw);
  await db
    .doc("quizzes/legacy_migration_quiz")
    .set({
      ownerId: uid,
      title: "Original geometry",
      status: "published",
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
  await db
    .doc("quizzes/legacy_migration_quiz/content/main")
    .set({ json: source });
  await db
    .doc("users/migration_student")
    .set({ displayName: "Legacy learner", email: "legacy@example.test" });
  await db
    .doc("users/migration_student/attempts/original_result")
    .set({
      quizId: "legacy_migration_quiz",
      quizTitle: "Original geometry",
      score: 3,
      possible: 3,
      correct: 1,
      answers: { q1: "4" },
      submittedAt: Date.now(),
      startedAt: Date.now() - 1000,
    });
  const preview = await run("--dry-run");
  assert.equal(preview.errors.length, 0);
  assert.equal(preview.applied, 0);
  assert.equal(
    (await db.doc("quizzes/legacy_migration_quiz").get()).data().schemaVersion,
    undefined,
  );
  try {
    const applied = await run("--apply");
    assert.equal(applied.errors.length, 0);
    assert.equal(applied.applied, 1);
    const root = (await db.doc("quizzes/legacy_migration_quiz").get()).data();
    assert.equal(root.schemaVersion, 2);
    assert(root.publishedRevisionId);
    assert.equal(root.visibility, "public");
    assert.equal(
      (await db.doc("quizzes/legacy_migration_quiz/content/main").get()).data()
        .json,
      source,
    );
    const items = await db
      .collection(
        `quizzes/legacy_migration_quiz/revisions/${root.publishedRevisionId}/items`,
      )
      .get();
    assert.equal(items.size, 1);
    const assetId = Object.values(
        items.docs[0].data().questionAssetBindings,
      )[0],
      asset = (await db.doc("assets/" + assetId).get()).data();
    assert(asset.referenceCount > 0);
    assert(
      (await getStorage().bucket().file(asset.storagePath).download())[0]
        .length > 0,
    );
    const results = await db
      .collection("attempts")
      .where("studentId", "==", "migration_student")
      .get();
    assert.equal(results.size, 1);
    assert.equal(results.docs[0].data().provenance, "legacy_client_v1");
    assert.equal(results.docs[0].data().quizRevisionId, null);
    assert.equal(results.docs[0].data().totals.score, 3);
    assert.equal(
      (
        await results.docs[0].ref.collection("legacyAnswers").get()
      ).docs[0].data().value,
      "4",
    );
    const count = (
      await db.collection("problems").where("ownerId", "==", uid).get()
    ).size;
    const usage = (await db.doc("usage/" + uid).get()).data().finalizedBytes;
    const resumed = await run("--apply", "--resume");
    assert.equal(resumed.errors.length, 0);
    assert.equal(
      (await db.collection("problems").where("ownerId", "==", uid).get()).size,
      count,
    );
    assert.equal(
      (await db.doc("usage/" + uid).get()).data().finalizedBytes,
      usage,
    );
    assert.equal(
      (await db.doc("system/maintenance").get()).data().enabled,
      true,
    );
  } finally {
    await db.doc("system/maintenance").set({ enabled: false });
  }
});
