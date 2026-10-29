// Owner-run migration. Never imported by the public website.
import { initializeApp } from "../functions/node_modules/firebase-admin/lib/esm/app/index.js";
import {
  getFirestore,
  Timestamp,
} from "../functions/node_modules/firebase-admin/lib/esm/firestore/index.js";
import { getAuth } from "../functions/node_modules/firebase-admin/lib/esm/auth/index.js";
import { getStorage } from "../functions/node_modules/firebase-admin/lib/esm/storage/index.js";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
const sharp = createRequire(
  new URL("../functions/package.json", import.meta.url),
)("sharp");
import {
  validateQuiz,
  imageReferences,
  resolveAsset,
} from "../shared/legacy-core.js";
import {
  fromLegacyQuestion,
  validateProblem,
  DEFAULT_SETTINGS,
} from "../shared/schema.js";
import { hash, transact, wire } from "../functions/src/domain/runtime.js";
import { createProblemRecord } from "../functions/src/api/problems.js";
import { projectCatalog } from "../functions/src/api/quizzes.js";
import { retainAssets } from "../functions/src/domain/assets.js";
const args = process.argv.slice(2),
  option = (name, fallback = null) =>
    args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const project = option("--project"),
  apply = args.includes("--apply"),
  runId = option("--run-id"),
  only = option("--only-quiz"),
  resume = args.includes("--resume"),
  reportPath = option("--report");
if (!project || !runId || !/^[-_a-zA-Z0-9]{1,100}$/.test(runId))
  throw new Error(
    "Usage: node scripts/migrate-v1.mjs --project PROJECT_ID --run-id RUN_ID [--only-quiz QUIZ_ID] [--apply] [--resume] [--report PATH]. Default is dry run.",
  );
if (args.includes("--dry-run") && apply)
  throw new Error("Choose --dry-run or --apply, not both.");
initializeApp({
  projectId: project,
  storageBucket: option("--bucket", project + ".firebasestorage.app"),
});
const db = getFirestore(),
  bucket = getStorage().bucket(),
  auth = getAuth();
const report = {
  project,
  runId,
  mode: apply ? "apply" : "dry-run",
  startedAt: new Date().toISOString(),
  quizzes: [],
  legacyResults: 0,
  errors: [],
  applied: 0,
};
const stamp = (value) =>
  value?.toDate
    ? value
    : typeof value === "number" && Number.isFinite(value)
      ? Timestamp.fromMillis(value)
      : typeof value === "string" && Number.isFinite(Date.parse(value))
        ? Timestamp.fromDate(new Date(value))
        : Timestamp.now();
if (apply) {
  const run = await db.doc("migrationRuns/" + runId).get();
  if (run.exists && !resume)
    throw new Error(
      "Run already exists. Use --resume with unchanged source data.",
    );
  await db.doc("system/maintenance").set({
    enabled: true,
    reason: "Data migration in progress",
    updatedAt: Timestamp.now(),
  });
  await db.doc("migrationRuns/" + runId).set(
    {
      project,
      status: "running",
      updatedAt: Timestamp.now(),
      createdAt: run.data()?.createdAt ?? Timestamp.now(),
    },
    { merge: true },
  );
  const roles = await db.collection("roles").get();
  let adminCount = 0;
  for (const role of roles.docs) {
    const data = role.data();
    if (!["teacher", "admin", "student"].includes(data.role))
      throw new Error("Unknown role for " + role.id);
    const next = {
      ...data,
      accountStatus: data.accountStatus ?? "active",
      version: data.version ?? 1,
      updatedAt: data.updatedAt ?? Timestamp.now(),
      updatedBy: data.updatedBy ?? "migration",
    };
    if (next.role === "admin" && next.accountStatus === "active") adminCount++;
    await role.ref.set(next);
  }
  await db.doc("system/accessControl").set({
    activeAdminCount: adminCount,
    version: 1,
    updatedAt: Timestamp.now(),
  });
}
async function convertAsset(ownerId, quizId, alias, data) {
  const match = data.match(
    /^data:(image\/(png|jpeg|webp|gif));base64,([\s\S]+)$/,
  );
  if (!match) throw new Error("Unsupported embedded image: " + alias);
  const input = Buffer.from(match[3], "base64");
  if (input.length > 4194304) throw new Error("Oversized image: " + alias);
  const decoder = sharp(input, { limitInputPixels: 16000000, animated: false }),
    info = await decoder.metadata();
  if (!["png", "jpeg", "webp", "gif"].includes(info.format))
    throw new Error("Invalid image signature: " + alias);
  const output = await decoder.png().toBuffer(),
    checksum = hash(output),
    assetId =
      "ast_" + hash(`${runId}:${quizId}:${alias}:${checksum}`).slice(0, 28),
    storagePath = `assets/${ownerId}/${assetId}/image.png`;
  if (!apply) return { assetId, checksum, bytes: output.length };
  const file = bucket.file(storagePath);
  try {
    await file.save(output, {
      resumable: false,
      preconditionOpts: { ifGenerationMatch: 0 },
      metadata: {
        contentType: "image/png",
        cacheControl: "private, max-age=120",
        metadata: { sha256: checksum },
      },
    });
  } catch (e) {
    if (e.code !== 412) throw e;
    const [existing] = await file.getMetadata();
    if (existing.metadata?.sha256 !== checksum)
      throw new Error("Asset checksum changed.");
  }
  const [metadata] = await file.getMetadata();
  await db.runTransaction(async (tx) => {
    const ref = db.doc("assets/" + assetId),
      old = await tx.get(ref),
      usageRef = db.doc("usage/" + ownerId),
      usage = await tx.get(usageRef);
    if (old.exists) return;
    const now = Timestamp.now();
    tx.set(ref, {
      ownerId,
      kind: "image",
      originalName: alias,
      declaredContentType: match[1],
      expectedBytes: input.length,
      status: "ready",
      stagingPath: `staging/${ownerId}/${assetId}/original`,
      storagePath,
      generation: String(metadata.generation),
      contentType: "image/png",
      sizeBytes: output.length,
      sha256: checksum,
      width: info.width,
      height: info.height,
      expiresAt: now,
      createdAt: now,
      readyAt: now,
      referenceCount: 0,
      version: 1,
      reservationReleased: true,
    });
    const u = usage.data() ?? {
      reservedBytes: 0,
      finalizedBytes: 0,
      limitBytes: 1073741824,
    };
    tx.set(usageRef, {
      ...u,
      finalizedBytes: u.finalizedBytes + output.length,
      updatedAt: now,
    });
  });
  return { assetId, checksum, bytes: output.length };
}
let cursor;
for (;;) {
  let query = db.collection("quizzes").orderBy("__name__").limit(50);
  if (cursor) query = query.startAfter(cursor);
  const page = only
    ? { docs: [await db.doc("quizzes/" + only).get()], size: 1 }
    : await query.get();
  for (const doc of page.docs) {
    if (!doc.exists) {
      report.errors.push({ quizId: doc.id, error: "Quiz not found" });
      continue;
    }
    const old = doc.data();
    if (old.schemaVersion === 2) continue;
    const quizId = doc.id,
      journal = db.doc(`migrationRuns/${runId}/quizzes/${quizId}`);
    try {
      if (!old.ownerId)
        throw new Error("Missing owner; ownership was not guessed.");
      await auth.getUser(old.ownerId);
      const source = (
        await doc.ref.collection("content").doc("main").get()
      ).data();
      if (!source?.json) throw new Error("Missing legacy content/main JSON.");
      const raw = JSON.parse(source.json);
      for (const [i, q] of (raw.questions ?? []).entries())
        if (
          (q.prompt?.length ?? 0) > 30000 ||
          (q.explanation?.length ?? 0) > 30000 ||
          (q.options ?? []).some((o) => (o.text?.length ?? 0) > 10000)
        )
          throw new Error(
            `Problem ${i + 1} exceeds text limits; migration will not truncate it.`,
          );
      const quiz = validateQuiz(raw),
        sourceHash = hash({ metadata: wire(old), json: source.json }),
        prior = (await journal.get()).data();
      if (prior && prior.sourceHash !== sourceHash)
        throw new Error(
          "Source changed since the previous run. Restore the source or use a new run ID.",
        );
      const aliases = {};
      for (const alias of imageReferences(quiz)) {
        const data = resolveAsset(quiz.assets, alias);
        if (!data) throw new Error("Missing image: " + alias);
        aliases[alias] = (
          await convertAsset(old.ownerId, quizId, alias, data)
        ).assetId;
      }
      for (const [i, q] of quiz.questions.entries()) {
        const record = fromLegacyQuestion(q, aliases);
        try {
          validateProblem(record.content, record.grading);
        } catch (e) {
          throw new Error(`Problem ${i + 1}: ${e.message}`);
        }
      }
      report.quizzes.push({
        quizId,
        ownerId: old.ownerId,
        title: quiz.title,
        sourceHash,
        problemCount: quiz.questions.length,
        assetCount: Object.keys(aliases).length,
        published: old.status === "published",
      });
      if (!apply) continue;
      await journal.set(
        {
          sourceHash,
          status: "running",
          oldMetadata: old,
          sourcePath: doc.ref.path + "/content/main",
          updatedAt: Timestamp.now(),
        },
        { merge: true },
      );
      const itemOrder = [],
        revisionId = "qrv_" + hash(`${runId}:${quizId}`).slice(0, 28),
        settings = {
          ...DEFAULT_SETTINGS,
          durationSeconds: quiz.durationMinutes * 60,
          shuffleQuestions: quiz.settings.shuffleQuestions,
          shuffleOptions: quiz.settings.shuffleOptions,
          allowBack: quiz.settings.allowBack,
          penalty: quiz.settings.penalty,
          solutionRelease: quiz.settings.showSolutions ? "immediate" : "never",
        };
      for (const [i, q] of quiz.questions.entries()) {
        const itemId = "itm_" + hash(`${runId}:${quizId}:${i}`).slice(0, 28);
        itemOrder.push(itemId);
        const record = fromLegacyQuestion(q, aliases);
        record.metadata = {
          title: `${quiz.title} — ${i + 1}`,
          subject: quiz.subject,
          difficulty: quiz.difficulty,
          tags: [],
          bankVisibility: "private",
        };
        await transact(
          db,
          "migration",
          `${runId}:${quizId}:${i}`,
          async (c) => {
            c.actor = {
              uid: old.ownerId,
              role: "system",
              displayName: old.ownerName ?? "",
            };
            c.audit = () => {};
            const mapping = await c.get(`${journal.path}/mappings/${i}`, false);
            if (mapping) return;
            const created = await createProblemRecord(c, record, String(i));
            const content = await c.get(
                `problems/${created.problemId}/revisions/${created.revisionId}`,
              ),
              grading = await c.get(
                `problems/${created.problemId}/revisions/${created.revisionId}/grading/main`,
              );
            const slot = {
              itemId,
              problemId: created.problemId,
              problemRevisionId: created.revisionId,
              points: q.points,
              reuseFromQuizRevisionId: null,
            };
            c.set(`quizzes/${quizId}/draftItems/${itemId}`, slot);
            if (old.status === "published") {
              c.set(
                `quizzes/${quizId}/revisions/${revisionId}/items/${itemId}`,
                {
                  schemaVersion: 2,
                  ...slot,
                  type: content.type,
                  answerMode: content.answerMode,
                  statementLatex: content.statementLatex,
                  options: content.options,
                  questionAssetBindings: content.questionAssetBindings,
                },
              );
              c.set(
                `quizzes/${quizId}/revisions/${revisionId}/grading/${itemId}`,
                grading,
              );
              await retainAssets(
                c,
                [
                  ...new Set([
                    ...Object.values(content.questionAssetBindings),
                    ...Object.values(grading.solutionAssetBindings),
                  ]),
                ],
                `quizzes/${quizId}/revisions/${revisionId}/items/${itemId}`,
                old.ownerId,
                { authorizedCopy: true },
              );
            }
            c.set(`${journal.path}/mappings/${i}`, {
              ...created,
              itemId,
              originalQuestionId: q.id,
              contentHash: content.contentHash,
            });
          },
        );
      }
      await transact(
        db,
        "migration.finish",
        `${runId}:${quizId}`,
        async (c) => {
          c.actor = { uid: "migration", role: "system" };
          const current = await c.get(doc.ref.path);
          if (current.schemaVersion === 2) return;
          if (
            hash({
              metadata: wire(current),
              json: (await c.get(doc.ref.path + "/content/main")).json,
            }) !== sourceHash
          )
            throw new Error("Source changed during migration.");
          const now = c.now,
            published = old.status === "published";
          const target = {
            schemaVersion: 2,
            ownerId: old.ownerId,
            ownerDisplayName: old.ownerName ?? "",
            title: quiz.title,
            searchTitle: quiz.title.toLowerCase(),
            description: quiz.description,
            subject: quiz.subject,
            difficulty: quiz.difficulty,
            lifecycle: "active",
            visibility: published ? "public" : "private",
            accessMode: published ? "open" : "approval",
            opensAt: null,
            closesAt: null,
            maxAttempts: null,
            publishedRevisionId: published ? revisionId : null,
            lastPublishedRevisionId: published ? revisionId : null,
            draftVersion: 1,
            version: 1,
            publishingJobId: null,
            createdAt: stamp(old.createdAt),
            updatedAt: now,
            publishedAt: published ? now : null,
            trashedAt: null,
            migrationRunId: runId,
          };
          const revision = {
            schemaVersion: 2,
            state: "ready",
            revisionNumber: 1,
            publicationJobId: null,
            sourceDraftVersion: 1,
            title: quiz.title,
            description: quiz.description,
            subject: quiz.subject,
            difficulty: quiz.difficulty,
            settings,
            itemOrder,
            itemCount: itemOrder.length,
            totalPoints: quiz.questions.reduce((n, q) => n + q.points, 0),
            manifestHash: hash({ sourceHash, itemOrder }),
            createdBy: "migration",
            createdAt: now,
            readyAt: now,
          };
          c.set(doc.ref.path, target);
          c.set(doc.ref.path + "/drafts/current", {
            version: 1,
            title: quiz.title,
            description: quiz.description,
            subject: quiz.subject,
            difficulty: quiz.difficulty,
            itemOrder,
            settings,
            updatedAt: now,
            updatedBy: "migration",
          });
          if (published)
            c.set(doc.ref.path + "/revisions/" + revisionId, revision);
          await projectCatalog(c, quizId, target, revision);
          c.set(journal.path, {
            sourceHash,
            status: "succeeded",
            oldMetadata: old,
            sourcePath: doc.ref.path + "/content/main",
            revisionId: published ? revisionId : null,
            problemCount: itemOrder.length,
            updatedAt: now,
          });
          c.audit("migration.quiz_imported", "quiz", quizId, {
            quizId,
            quizOwnerId: old.ownerId,
          });
        },
      );
      report.applied++;
    } catch (error) {
      report.errors.push({ quizId, error: error.message });
    }
  }
  if (only || page.size < 50) break;
  cursor = page.docs.at(-1);
}
// Preserve legacy scores as legacy results; do not fabricate historical problem snapshots.
let resultCursor;
for (;;) {
  let query = db.collectionGroup("attempts").orderBy("__name__").limit(100);
  if (resultCursor) query = query.startAfter(resultCursor);
  const page = await query.get();
  for (const doc of page.docs) {
    const segments = doc.ref.path.split("/");
    if (segments.length !== 4 || segments[0] !== "users") continue;
    const old = doc.data();
    if (only && old.quizId !== only) continue;
    report.legacyResults++;
    if (!apply) continue;
    const uid = segments[1],
      attemptId = "att_legacy_" + hash(doc.ref.path).slice(0, 24),
      target = db.doc("attempts/" + attemptId);
    if ((await target.get()).exists) continue;
    const quiz = (await db.doc("quizzes/" + old.quizId).get()).data();
    if (!quiz?.ownerId) {
      report.errors.push({
        attemptId: doc.id,
        error: "Legacy result has no known quiz owner; source retained.",
      });
      continue;
    }
    const profile = (await db.doc("users/" + uid).get()).data();
    const possible = Number(old.possible) || 0,
      score = Number(old.score) || 0;
    await target.set({
      schemaVersion: 2,
      studentId: uid,
      studentDisplayName: profile?.displayName ?? uid,
      studentEmail: profile?.email ?? "",
      quizId: old.quizId,
      quizOwnerId: quiz.ownerId,
      quizRevisionId: null,
      quizTitle: old.quizTitle ?? quiz.title,
      ordinal: 1,
      attemptKind: "legacy",
      sourceAttemptId: null,
      status: old.timedOut ? "timed_out" : "submitted",
      gradeState: "final",
      startedAt: stamp(old.startedAt),
      deadlineAt: null,
      closedAtSnapshot: null,
      submittedAt: stamp(old.submittedAt),
      finalizedAt: stamp(old.submittedAt),
      lastSavedAt: null,
      currentFrontier: 0,
      uiState: { currentIndex: 0, flaggedItemIds: [], version: 0 },
      order: [],
      optionOrder: {},
      settingsSnapshot: {
        ...DEFAULT_SETTINGS,
        scoreRelease: "immediate",
        solutionRelease: "never",
      },
      answeredCount: Object.keys(old.answers ?? {}).length,
      answeredItemIds: [],
      answerVersion: 0,
      gradeVersion: 1,
      scoreReleasedAt: null,
      solutionsReleasedAt: null,
      terminationReason: null,
      provenance: "legacy_client_v1",
      legacySourcePath: doc.ref.path,
      legacyAnswersOmitted: !!old.answersOmitted,
      legacySnapshotUnknown: true,
      totals: {
        score,
        possible,
        percentage: possible
          ? Math.max(0, Math.min(100, (score / possible) * 100))
          : 0,
        correct: old.correct ?? 0,
        incorrect: old.incorrect ?? 0,
        skipped: old.skipped ?? 0,
        pending: old.pending ?? 0,
        partial: old.partial ?? 0,
      },
      migrationRunId: runId,
    });
    for (const [oldId, value] of Object.entries(old.answers ?? {})) {
      await target
        .collection("legacyAnswers")
        .doc(hash(oldId).slice(0, 24))
        .set({
          originalQuestionId: oldId,
          value,
          manualPoints: old.manualScores?.[oldId] ?? null,
          provenance: "legacy_client_v1",
        });
    }
  }
  if (page.size < 100) break;
  resultCursor = page.docs.at(-1);
}
report.finishedAt = new Date().toISOString();
if (apply)
  await db.doc("migrationRuns/" + runId).set(
    {
      status: report.errors.length ? "needs_attention" : "succeeded",
      summary: {
        applied: report.applied,
        quizzes: report.quizzes.length,
        legacyResults: report.legacyResults,
        errors: report.errors.length,
      },
      updatedAt: Timestamp.now(),
    },
    { merge: true },
  );
if (reportPath)
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
if (apply)
  console.error(
    "Maintenance remains enabled. Verify migrated data, deploy v2 rules/functions/frontend together, then set system/maintenance.enabled to false.",
  );
if (report.errors.length) process.exitCode = 1;
