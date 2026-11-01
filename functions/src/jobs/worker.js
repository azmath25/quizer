import { randomUUID } from "node:crypto";
import { getAuth } from "firebase-admin/auth";
import sharp from "sharp";
import archiver from "archiver";
import { PassThrough } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  transact,
  requireRole,
  manage,
  Timestamp,
  millis,
  hash,
  wire,
} from "../domain/runtime.js";
import { assetIds, assert, fields, LIMITS } from "../../shared/schema.js";
import {
  gradeSnapshotAnswer,
  summarize,
  csvCell,
} from "../../shared/grading.js";
import { retainAssets } from "../domain/assets.js";
import { sourceContent, projectCatalog, newQuiz } from "../api/quizzes.js";
import { createProblemRecord } from "../api/problems.js";
import { reportFilters } from "../api/reports.js";
import { bucket } from "../api/assets.js";
import { extractProblems } from "../ai/provider.js";
import { updateStatistics } from "../domain/statistics.js";

async function authFor(uid) {
  if (uid === "system") return null;
  const u = await getAuth().getUser(uid);
  return {
    uid,
    token: {
      email: u.email ?? "",
      email_verified: u.emailVerified,
      name: u.displayName ?? "",
    },
  };
}
export async function runJob(db, jobId) {
  if ((await db.doc("system/maintenance").get()).data()?.enabled) return false;
  const lease = randomUUID();
  let job = await transact(db, "job.lease", lease, async (c) => {
    const j = await c.get(`jobs/${jobId}`, false);
    if (!j || !["queued", "running"].includes(j.status) || j.kind === "import")
      return null;
    if (j.status === "running" && millis(j.leaseExpiresAt) > millis(c.now))
      return null;
    const next = {
      ...j,
      status: "running",
      leaseOwner: lease,
      leaseExpiresAt: Timestamp.fromMillis(millis(c.now) + 300000),
      updatedAt: c.now,
      retryCount: j.retryCount + 1,
      error: null,
    };
    c.set(`jobs/${jobId}`, next);
    return next;
  });
  if (!job) return false;
  let auth = null;
  const unit = async (suffix, fn, { privileged = true } = {}) =>
    transact(
      db,
      "job." + job.kind,
      `${jobId}-${suffix}`,
      async (c) => {
        const latest = await c.get(`jobs/${jobId}`);
        assert(
          latest.status === "running" && latest.leaseOwner === lease,
          "JOB_LEASE",
          "Another worker owns this job.",
        );
        if (privileged) requireRole(c.actor, "teacher");
        const result = await fn(c, latest);
        const after = await c.get(`jobs/${jobId}`);
        if (after.status === "running")
          c.set(`jobs/${jobId}`, {
            ...after,
            updatedAt: c.now,
            leaseExpiresAt: Timestamp.fromMillis(millis(c.now) + 300000),
          });
        return result;
      },
      auth,
    );
  const finish = (c, j, result, event = null) => {
    c.set(`jobs/${jobId}`, {
      ...j,
      status: "succeeded",
      result,
      completedAt: c.now,
      updatedAt: c.now,
      leaseOwner: null,
      leaseExpiresAt: null,
      progress: {
        ...j.progress,
        stage: "Complete",
        processed: j.progress.total,
      },
    });
    if (event) c.audit(event, "quiz", j.targetId, { quizId: j.targetId });
  };
  try {
    auth = await authFor(job.requestedBy);
    if (job.kind === "publish_quiz") {
      const { sources, revisionId } = job.input;
      for (
        let offset = job.progress.processed ?? 0;
        offset < sources.length;
        offset++
      ) {
        await unit(`item-${offset}`, async (c, j) => {
          const quiz = await c.get(`quizzes/${job.targetId}`);
          manage(c.actor, quiz);
          assert(
            quiz.lifecycle === "active" && quiz.publishingJobId === jobId,
            "FAILED_PRECONDITION",
            "This publication was cancelled or its quiz was trashed.",
          );
          const slot = sources[offset],
            { content, grading } = await sourceContent(c, slot.source);
          const item = {
            schemaVersion: 2,
            itemId: slot.itemId,
            problemId: slot.problemId,
            problemRevisionId: slot.problemRevisionId,
            type: content.type,
            answerMode: content.answerMode,
            statementLatex: content.statementLatex,
            options: content.options,
            questionAssetBindings: content.questionAssetBindings,
            points: slot.points,
          };
          await retainAssets(
            c,
            assetIds(content, grading),
            `quizzes/${job.targetId}/revisions/${revisionId}/items/${slot.itemId}`,
            quiz.ownerId,
            { authorizedCopy: true },
          );
          c.set(
            `quizzes/${job.targetId}/revisions/${revisionId}/items/${slot.itemId}`,
            item,
          );
          c.set(
            `quizzes/${job.targetId}/revisions/${revisionId}/grading/${slot.itemId}`,
            grading,
          );
          c.set(`jobs/${jobId}`, {
            ...j,
            progress: {
              processed: offset + 1,
              total: sources.length,
              stage: "Copying problems",
            },
          });
        });
      }
      auth = await authFor(job.requestedBy);
      await unit("finish", async (c, j) => {
        const quiz = await c.get(`quizzes/${job.targetId}`);
        manage(c.actor, quiz);
        assert(
          quiz.lifecycle === "active" &&
            quiz.publishingJobId === jobId &&
            quiz.draftVersion === job.input.draftVersion,
          "VERSION_CONFLICT",
          "The quiz changed before publishing finished.",
        );
        const p = `quizzes/${job.targetId}/revisions/${job.input.revisionId}`,
          revision = await c.get(p);
        assert(
          quiz.closesAt ||
            ![
              revision.settings.scoreRelease,
              revision.settings.solutionRelease,
            ].includes("afterClose"),
          "INVALID_FIELDS",
          "A closing time is required.",
        );
        const ready = { ...revision, state: "ready", readyAt: c.now },
          next = {
            ...quiz,
            publishedRevisionId: job.input.revisionId,
            lastPublishedRevisionId: job.input.revisionId,
            publishingJobId: null,
            publishedAt: c.now,
            updatedAt: c.now,
            version: quiz.version + 1,
          };
        c.set(p, ready);
        c.set(`quizzes/${job.targetId}`, next);
        await projectCatalog(c, job.targetId, next, ready);
        finish(
          c,
          j,
          { quizId: job.targetId, revisionId: job.input.revisionId },
          "quiz.published",
        );
      });
    } else if (job.kind === "duplicate_quiz") {
      const { sources, draft } = job.input;
      for (
        let offset = job.progress.processed ?? 0;
        offset < sources.length;
        offset++
      )
        await unit(`item-${offset}`, async (c, j) => {
          const quiz = await c.get(`quizzes/${job.targetId}`);
          manage(c.actor, quiz);
          assert(
            quiz.lifecycle === "active" && quiz.publishingJobId === jobId,
            "FAILED_PRECONDITION",
            "The duplicate was cancelled.",
          );
          const slot = sources[offset],
            data = await sourceContent(c, slot.source);
          const content = Object.fromEntries(
            [
              "type",
              "answerMode",
              "statementLatex",
              "options",
              "defaultPoints",
              "questionAssetBindings",
            ].map((k) => [
              k,
              data.content[k] ?? (k === "defaultPoints" ? slot.points : null),
            ]),
          );
          const grading = Object.fromEntries(
            [
              "correctOptionId",
              "acceptedAnswers",
              "tolerance",
              "explanationLatex",
              "rubricLatex",
              "solutionAssetBindings",
            ].map((k) => [k, data.grading[k]]),
          );
          const created = await createProblemRecord(
            c,
            {
              metadata: {
                title: `${draft.title} — ${offset + 1}`,
                subject: draft.subject,
                difficulty: draft.difficulty,
                tags: [],
                bankVisibility: "private",
              },
              content,
              grading,
            },
            `${jobId}:${offset}`,
            { problemId: slot.problemId, revisionId: slot.problemRevisionId },
            true,
          );
          const itemId = "itm_" + hash(`${jobId}:${offset}`).slice(0, 28);
          c.set(`quizzes/${job.targetId}/draftItems/${itemId}`, {
            itemId,
            problemId: created.problemId,
            problemRevisionId: created.revisionId,
            points: slot.points,
            reuseFromQuizRevisionId: null,
          });
          c.set(`jobs/${jobId}`, {
            ...j,
            progress: {
              processed: offset + 1,
              total: sources.length,
              stage: "Copying problems",
            },
          });
        });
      await unit("finish", async (c, j) => {
        const quiz = await c.get(`quizzes/${job.targetId}`);
        manage(c.actor, quiz);
        const d = await c.get(`quizzes/${job.targetId}/drafts/current`);
        c.set(`quizzes/${job.targetId}/drafts/current`, {
          ...d,
          description: draft.description,
          subject: draft.subject,
          difficulty: draft.difficulty,
          settings: draft.settings,
          itemOrder: sources.map(
            (_, offset) => "itm_" + hash(`${jobId}:${offset}`).slice(0, 28),
          ),
        });
        c.set(`quizzes/${job.targetId}`, {
          ...quiz,
          publishingJobId: null,
          updatedAt: c.now,
        });
        finish(c, j, { quizId: job.targetId }, "quiz.duplicated");
      });
    } else if (job.kind === "grade_attempt") {
      const snap = await db.doc(`attempts/${job.targetId}`).get();
      const attempt = snap.data();
      assert(
        attempt && attempt.status !== "active",
        "FAILED_PRECONDITION",
        "Attempt must be frozen before grading.",
      );
      for (
        let start = job.progress.processed ?? 0;
        start < attempt.order.length;
        start += 20
      )
        await unit(
          `grade-${start}`,
          async (c, j) => {
            const a = await c.get(`attempts/${job.targetId}`);
            assert(
              a.status !== "active" && a.gradeVersion === 0,
              "FAILED_PRECONDITION",
              "Grading has already completed.",
            );
            for (const itemId of a.order.slice(start, start + 20)) {
              const item = await c.get(
                  `quizzes/${a.quizId}/revisions/${a.quizRevisionId}/items/${itemId}`,
                ),
                key = await c.get(
                  `quizzes/${a.quizId}/revisions/${a.quizRevisionId}/grading/${itemId}`,
                ),
                answer = await c.get(
                  `attempts/${job.targetId}/answers/${itemId}`,
                  false,
                );
              const g = gradeSnapshotAnswer(
                item,
                key,
                answer?.value ?? "",
                null,
                a.settingsSnapshot.penalty,
              );
              c.set(`attempts/${job.targetId}/grades/${itemId}`, {
                ...g,
                gradedBy: "system",
                gradingVersion: 1,
                feedbackLatex: "",
                updatedAt: c.now,
                version: 1,
              });
            }
            c.set(`jobs/${jobId}`, {
              ...j,
              progress: {
                processed: Math.min(start + 20, a.order.length),
                total: a.order.length,
                stage: "Grading",
              },
            });
          },
          { privileged: false },
        );
      await unit(
        "finish",
        async (c, j) => {
          const a = await c.get(`attempts/${job.targetId}`);
          const grades = await c.all(`attempts/${job.targetId}/grades`);
          assert(
            grades.length === a.order.length,
            "FAILED_PRECONDITION",
            "Some grades are missing.",
          );
          if (a.gradeVersion === 0) {
            const totals = summarize(grades),
              next = {
                ...a,
                totals,
                gradeState: totals.pending ? "pending_manual" : "final",
                gradeVersion: 1,
                finalizedAt: c.now,
              };
            await updateStatistics(c, a, next);
            c.set(`attempts/${job.targetId}`, next);
            c.audit("grade.completed", "attempt", job.targetId, {
              quizId: a.quizId,
              quizOwnerId: a.quizOwnerId,
              affectedUserId: a.studentId,
            });
            c.notify(
              a.quizOwnerId,
              totals.pending ? "marking_required" : "submission",
              `${a.studentDisplayName} submitted ${a.quizTitle}`,
              a.quizId,
              job.targetId,
            );
            c.notify(
              a.studentId,
              "graded",
              `Your submission was processed: ${a.quizTitle}`,
              a.quizId,
              job.targetId,
            );
          }
          finish(c, j, { attemptId: job.targetId });
        },
        { privileged: false },
      );
    } else if (job.kind === "finalize_asset") {
      const asset = await unit("check", (c) => c.get(`assets/${job.targetId}`));
      assert(
        asset.ownerId === job.requestedBy,
        "RESOURCE_UNAVAILABLE",
        "Asset unavailable.",
      );
      const file = bucket().file(asset.stagingPath),
        [meta] = await file.getMetadata();
      assert(
        Number(meta.size) === asset.expectedBytes &&
          meta.contentType === asset.declaredContentType,
        "INVALID_FIELDS",
        "Uploaded file size or type does not match its reservation.",
      );
      const [raw] = await file.download({ validation: "crc32c" });
      assert(
        raw.length === asset.expectedBytes,
        "INVALID_FIELDS",
        "Upload size changed.",
      );
      let output = raw,
        contentType = "text/plain",
        width = null,
        height = null,
        extension = "tex",
        notice = null;
      if (asset.kind === "image") {
        const decoder = sharp(raw, {
          limitInputPixels: 16000000,
          animated: false,
          failOn: "warning",
        });
        const info = await decoder.metadata();
        assert(
          ["png", "jpeg", "webp", "gif"].includes(info.format),
          "INVALID_FIELDS",
          "Unsupported image signature.",
        );
        const expected = {
          png: "image/png",
          jpeg: "image/jpeg",
          webp: "image/webp",
          gif: "image/gif",
        }[info.format];
        assert(
          expected === asset.declaredContentType,
          "INVALID_FIELDS",
          "The image bytes do not match the declared file type.",
        );
        assert(
          info.width * info.height <= 16000000,
          "INVALID_FIELDS",
          "Use images below 16 megapixels.",
        );
        width = info.width;
        height = info.height;
        if (info.format === "jpeg") {
          output = await decoder.rotate().jpeg({ quality: 94 }).toBuffer();
          contentType = "image/jpeg";
          extension = "jpg";
        } else if (info.format === "webp") {
          output = await decoder.rotate().webp({ lossless: true }).toBuffer();
          contentType = "image/webp";
          extension = "webp";
        } else {
          output = await decoder.rotate().png().toBuffer();
          contentType = "image/png";
          extension = "png";
        }
        if (info.format === "gif")
          notice = "Animated GIFs are converted to their first frame.";
        const normalized = await sharp(output).metadata();
        width = normalized.width;
        height = normalized.height;
      } else if (asset.kind === "document") {
        assert(
          raw.subarray(0, 5).toString("latin1") === "%PDF-",
          "INVALID_FIELDS",
          "The file is not a valid PDF.",
        );
        contentType = "application/pdf";
        extension = "pdf";
      } else {
        assert(
          !raw.includes(0),
          "INVALID_FIELDS",
          "Source files must be text.",
        );
        new TextDecoder("utf-8", { fatal: true }).decode(raw);
        contentType = asset.declaredContentType;
        extension = contentType === "application/json" ? "json" : "tex";
      }
      const storagePath =
        asset.kind === "image"
          ? `assets/${asset.ownerId}/${job.targetId}/image.${extension}`
          : `sources/${asset.ownerId}/${job.targetId}/original.${extension}`;
      // Record the deterministic destination before writing bytes so crash cleanup
      // can find an object even if finalization never reaches its final transaction.
      await unit("destination", async (c) => {
        const a = await c.get(`assets/${job.targetId}`);
        assert(
          a.status === "processing",
          "FAILED_PRECONDITION",
          "Upload cancelled.",
        );
        c.set(`assets/${job.targetId}`, {
          ...a,
          pendingStoragePath: storagePath,
        });
      });
      const finalFile = bucket().file(storagePath);
      const checksum = hash(output);
      try {
        await finalFile.save(output, {
          resumable: false,
          preconditionOpts: { ifGenerationMatch: 0 },
          metadata: {
            contentType,
            cacheControl: "private, max-age=120",
            metadata: { sha256: checksum },
          },
        });
      } catch (e) {
        if (e.code !== 412) throw e;
        const [existsMeta] = await finalFile.getMetadata();
        assert(
          existsMeta.metadata?.sha256 === checksum,
          "FAILED_PRECONDITION",
          "Immutable asset checksum mismatch.",
        );
      }
      const [finalMeta] = await finalFile.getMetadata();
      await unit("finish", async (c, j) => {
        const a = await c.get(`assets/${job.targetId}`);
        assert(
          a.status === "processing" || a.status === "ready",
          "FAILED_PRECONDITION",
          "Upload cancelled.",
        );
        if (a.status !== "ready") {
          const usage = await c.get(`usage/${a.ownerId}`);
          assert(
            usage.finalizedBytes +
              usage.reservedBytes -
              a.expectedBytes +
              output.length <=
              usage.limitBytes,
            "QUOTA_EXCEEDED",
            "The converted image exceeds your storage allowance.",
          );
          c.set(`usage/${a.ownerId}`, {
            ...usage,
            reservedBytes: usage.reservedBytes - a.expectedBytes,
            finalizedBytes: usage.finalizedBytes + output.length,
            updatedAt: c.now,
          });
          c.set(`assets/${job.targetId}`, {
            ...a,
            status: "ready",
            storagePath,
            generation: String(finalMeta.generation),
            contentType,
            sizeBytes: output.length,
            sha256: checksum,
            width,
            height,
            readyAt: c.now,
            version: a.version + 1,
            notice,
            reservationReleased: true,
            pendingStoragePath: null,
          });
          c.audit("asset.uploaded", "asset", job.targetId);
        }
        finish(c, j, { assetId: job.targetId, status: "ready", notice });
      });
      await file.delete({ ignoreNotFound: true });
    } else if (job.kind === "ai_extract") {
      const asset = await unit("check", async (c) => {
        const a = await c.get(`assets/${job.targetId}`);
        assert(
          a.ownerId === job.requestedBy && a.status === "ready",
          "RESOURCE_UNAVAILABLE",
          "File unavailable.",
        );
        return a;
      });
      const [bytes] = await bucket()
        .file(asset.storagePath, { generation: asset.generation })
        .download();
      const extracted = await extractProblems({
        bytes,
        contentType: asset.contentType,
        name: asset.originalName,
      });
      await unit("finish", (c, j) => {
        finish(c, j, {
          title: extracted.title,
          problemCount: extracted.problemCount,
          latex: extracted.latex,
        });
        c.notify(
          j.requestedBy,
          "ai_job",
          "Your quiz is parsed and ready for review.",
          null,
          jobId,
        );
      });
    } else if (job.kind === "cleanup_asset") {
      const asset = await unit(
        "check",
        async (c) => {
          const a = await c.get(`assets/${job.targetId}`);
          assert(
            a.referenceCount === 0 && a.status === "deleting",
            "FAILED_PRECONDITION",
            "Referenced files cannot be removed.",
          );
          return a;
        },
        { privileged: false },
      );
      await bucket().file(asset.stagingPath).delete({ ignoreNotFound: true });
      if (asset.storagePath)
        await bucket()
          .file(asset.storagePath, { generation: asset.generation })
          .delete({
            ignoreNotFound: true,
            ifGenerationMatch: asset.generation,
          });
      if (
        asset.pendingStoragePath &&
        asset.pendingStoragePath !== asset.storagePath
      )
        await bucket()
          .file(asset.pendingStoragePath)
          .delete({ ignoreNotFound: true });
      await unit(
        "finish",
        async (c, j) => {
          const a = await c.get(`assets/${job.targetId}`),
            usage = await c.get(`usage/${a.ownerId}`, false);
          assert(
            a.referenceCount === 0 && a.status === "deleting",
            "FAILED_PRECONDITION",
            "Asset was retained.",
          );
          if (usage && !a.reservationReleased)
            c.set(`usage/${a.ownerId}`, {
              ...usage,
              reservedBytes: Math.max(0, usage.reservedBytes - a.expectedBytes),
              updatedAt: c.now,
            });
          c.set(`assets/${job.targetId}`, {
            ...a,
            status: "failed",
            reservationReleased: true,
            deletedAt: c.now,
          });
          finish(c, j, { assetId: job.targetId, deleted: true });
        },
        { privileged: false },
      );
    } else if (job.kind === "export_results" || job.kind === "export_quiz") {
      await unit("authorize", async (c) =>
        manage(c.actor, await c.get(`quizzes/${job.targetId}`)),
      );
      const extension = job.kind === "export_results" ? "csv" : "zip",
        filename = `${job.targetId}-${jobId}.${extension}`,
        storagePath = `exports/${job.requestedBy}/${jobId}/${filename}`,
        file = bucket().file(storagePath);
      let count = 0;
      if (job.kind === "export_results") {
        const stream = file.createWriteStream({
          resumable: false,
          metadata: {
            contentType: "text/csv; charset=utf-8",
            cacheControl: "private, no-store",
          },
        });
        const output = new PassThrough();
        const writing = pipeline(output, stream);
        output.write(
          "\uFEFF" +
            [
              "Name",
              "Email",
              "Attempt",
              "Kind",
              "Revision",
              "Status",
              "Grade state",
              "Score",
              "Possible",
              "Percentage",
              "Correct",
              "Incorrect",
              "Skipped",
              "Pending",
              "Partial",
              "Started UTC",
              "Submitted UTC",
              "Last saved UTC",
              "Provenance",
            ]
              .map(csvCell)
              .join(",") +
            "\r\n",
        );
        let query = db.collection("attempts");
        for (const [key, op, value] of reportFilters(
          job.input.filters,
          job.targetId,
        ))
          query = query.where(key, op, value);
        query = query
          .where("startedAt", "<=", job.input.asOf)
          .orderBy("startedAt")
          .orderBy("__name__");
        let last;
        for (;;) {
          const page = await (last ? query.startAfter(last) : query)
            .limit(200)
            .get();
          for (const doc of page.docs) {
            const a = doc.data();
            const row =
              [
                a.studentDisplayName,
                a.studentEmail,
                a.ordinal,
                a.attemptKind,
                a.quizRevisionId,
                a.status,
                a.gradeState,
                a.totals.score,
                a.totals.possible,
                a.totals.percentage,
                a.totals.correct,
                a.totals.incorrect,
                a.totals.skipped,
                a.totals.pending,
                a.totals.partial,
                wire(a.startedAt),
                wire(a.submittedAt),
                wire(a.lastSavedAt),
                a.provenance,
              ]
                .map(csvCell)
                .join(",") + "\r\n";
            if (!output.write(row))
              await new Promise((resolve) => output.once("drain", resolve));
            count++;
          }
          if (page.size < 200) break;
          last = page.docs.at(-1);
          await unit(`progress-${count}`, async (c, j) => {
            manage(c.actor, await c.get(`quizzes/${job.targetId}`));
            c.set(`jobs/${jobId}`, {
              ...j,
              progress: { processed: count, total: count, stage: "Exporting" },
            });
          });
        }
        output.end();
        await writing;
      } else {
        const revision = (
          await db
            .doc(`quizzes/${job.targetId}/revisions/${job.input.revisionId}`)
            .get()
        ).data();
        const archive = archiver("zip", { zlib: { level: 6 } }),
          output = file.createWriteStream({
            resumable: false,
            metadata: {
              contentType: "application/zip",
              cacheControl: "private, no-store",
            },
          }),
          writing = pipeline(archive, output);
        const records = [],
          ids = new Set();
        for (const itemId of revision.itemOrder) {
          const base = `quizzes/${job.targetId}/revisions/${job.input.revisionId}`;
          const content = (
              await db.doc(base + "/items/" + itemId).get()
            ).data(),
            grading = (await db.doc(base + "/grading/" + itemId).get()).data();
          records.push({ content, grading });
          assetIds(content, grading).forEach((a) => ids.add(a));
        }
        const assets = {};
        for (const assetId of ids) {
          const asset = (await db.doc("assets/" + assetId).get()).data();
          const name = `images/${assetId}.${asset.contentType.split("/")[1]}`;
          assets[assetId] = {
            path: name,
            originalName: asset.originalName,
            sha256: asset.sha256,
          };
          archive.append(
            bucket()
              .file(asset.storagePath, { generation: asset.generation })
              .createReadStream(),
            { name },
          );
        }
        archive.append(
          JSON.stringify(
            wire({
              schemaVersion: 2,
              kind: "math-quiz-backup",
              quizId: job.targetId,
              revision,
              records,
              assets,
            }),
            null,
            2,
          ),
          { name: "quiz.json" },
        );
        await archive.finalize();
        await writing;
        count = records.length;
      }
      const [metadata] = await file.getMetadata();
      auth = await authFor(job.requestedBy);
      await unit("finish", async (c, j) => {
        manage(c.actor, await c.get(`quizzes/${job.targetId}`));
        finish(
          c,
          j,
          {
            storagePath,
            generation: String(metadata.generation),
            filename,
            count,
            asOf: job.input.asOf ?? c.now,
          },
          "report.exported",
        );
      });
    } else assert(false, "INVALID_FIELDS", "Unsupported job type.");
    return true;
  } catch (error) {
    await transact(db, "job.failed", jobId, async (c) => {
      const latest = await c.get(`jobs/${jobId}`, false);
      if (!latest || latest.leaseOwner !== lease || latest.status !== "running")
        return;
      const safeError = {
        reason: error.reason ?? "JOB_FAILED",
        message: error.reason
          ? error.message
          : "Processing failed. Check backend logs and retry the job.",
        retryable: true,
      };
      c.set(`jobs/${jobId}`, {
        ...latest,
        status: "failed",
        error: safeError,
        updatedAt: c.now,
        leaseOwner: null,
        leaseExpiresAt: null,
      });
      if (job.kind === "ai_extract")
        c.notify(
          job.requestedBy,
          "ai_job",
          "A document extraction needs attention.",
          null,
          jobId,
        );
      if (job.kind === "finalize_asset") {
        const a = await c.get(`assets/${job.targetId}`, false);
        if (a && a.status !== "ready") {
          c.set(`assets/${job.targetId}`, {
            ...a,
            status: "failed",
            version: a.version + 1,
          });
          c.audit("asset.failed", "asset", job.targetId);
        }
      }
    });
    console.error("job_failed", {
      jobId,
      kind: job.kind,
      reason: error.reason ?? error.code ?? "JOB_FAILED",
    });
    return false;
  }
}
