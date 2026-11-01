import { getStorage } from "firebase-admin/storage";
import {
  define,
  path,
  hash,
  millis,
  Timestamp,
  requireRole,
} from "../domain/runtime.js";
import {
  assert,
  id,
  text,
  number,
  enumeration,
  assetIds,
  LIMITS,
} from "../../shared/schema.js";
import { readProblem } from "./problems.js";
import { getOwnedQuiz, snapshotSource, sourceContent } from "./quizzes.js";
import { authorizeAttempt, attemptManager, expire } from "./attempts.js";
import { released } from "../domain/runtime.js";
import { DEMO } from "../config.js";
export const bucket = () =>
  getStorage().bucket(process.env.STORAGE_BUCKET || undefined);
export async function signObject(storagePath, generation) {
  if (DEMO) {
    // Emulator-only bearer tokens. Production never installs Firebase download tokens.
    const token = hash(storagePath + ":demo-only");
    const file = bucket().file(storagePath);
    await file.setMetadata({
      metadata: { firebaseStorageDownloadTokens: token },
    });
    return `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}/v0/b/${bucket().name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`;
  }
  try {
    const [url] = await bucket()
      .file(storagePath, { generation })
      .getSignedUrl({
        version: "v4",
        action: "read",
        expires: Date.now() + 120000,
        queryParams: { generation: String(generation) },
      });
    return url;
  } catch (error) {
    console.error("sign_failed", {
      message: String(error.message).slice(0, 300),
    });
    assert(
      false,
      "SIGNING_UNAVAILABLE",
      "Images cannot be signed. The functions service account needs the Service Account Token Creator role (see FIREBASE-SETUP.md).",
    );
  }
}
define(
  "createAssetUpload",
  "teacher",
  ["kind", "name", "contentType", "expectedBytes"],
  async (c, r) => {
    const kind = enumeration(r.kind, ["image", "source"], "asset kind"),
      size = number(
        r.expectedBytes,
        "File size",
        1,
        kind === "image" ? LIMITS.imageBytes : LIMITS.sourceBytes,
        true,
      );
    const mime = enumeration(
      r.contentType,
      kind === "image"
        ? ["image/png", "image/jpeg", "image/webp", "image/gif"]
        : ["text/plain", "application/json", "application/x-tex"],
      "file type",
    );
    text(r.name, "Filename", 180, true);
    await c.rate("upload", 60);
    const usage = (await c.get(`usage/${c.actor.uid}`, false)) ?? {
      reservedBytes: 0,
      finalizedBytes: 0,
      limitBytes: LIMITS.teacherBytes,
    };
    assert(
      usage.reservedBytes + usage.finalizedBytes + size <= usage.limitBytes,
      "QUOTA_EXCEEDED",
      "Your upload allowance is full. Contact the administrator.",
    );
    const assetId = c.key("ast_"),
      expiresAt = Timestamp.fromMillis(millis(c.now) + 3600000),
      stagingPath = `staging/${c.actor.uid}/${assetId}/original`;
    c.set(`assets/${assetId}`, {
      ownerId: c.actor.uid,
      kind,
      originalName: r.name,
      declaredContentType: mime,
      expectedBytes: size,
      status: "awaiting_upload",
      stagingPath,
      storagePath: null,
      generation: null,
      contentType: null,
      sizeBytes: null,
      sha256: null,
      width: null,
      height: null,
      expiresAt,
      createdAt: c.now,
      readyAt: null,
      referenceCount: 0,
      version: 1,
    });
    c.set(`usage/${c.actor.uid}`, {
      ...usage,
      reservedBytes: usage.reservedBytes + size,
      updatedAt: c.now,
    });
    return { assetId, stagingPath, expiresAt };
  },
  { mutation: true },
);
define(
  "finalizeAssetUpload",
  "teacher",
  ["assetId"],
  async (c, r) => {
    const asset = await c.get(path("assets", r.assetId));
    assert(
      asset.ownerId === c.actor.uid,
      "RESOURCE_UNAVAILABLE",
      "Upload unavailable.",
    );
    if (asset.status === "ready")
      return { assetId: r.assetId, status: "ready" };
    if (asset.status === "processing") return { jobId: asset.jobId };
    assert(
      asset.status === "awaiting_upload" &&
        millis(asset.expiresAt) > millis(c.now),
      "ASSET_NOT_READY",
      "Upload reservation expired.",
    );
    const jobId = await c.job("finalize_asset", r.assetId, {});
    c.set(`assets/${r.assetId}`, {
      ...asset,
      status: "processing",
      jobId,
      version: asset.version + 1,
    });
    return { jobId };
  },
  { mutation: true },
);
define(
  "cancelAssetUpload",
  "teacher",
  ["assetId"],
  async (c, r) => {
    const asset = await c.get(path("assets", r.assetId));
    assert(
      asset.ownerId === c.actor.uid &&
        ["awaiting_upload", "failed"].includes(asset.status) &&
        asset.referenceCount === 0,
      "FAILED_PRECONDITION",
      "This upload cannot be removed.",
    );
    const jobId = await c.job("cleanup_asset", r.assetId, {});
    c.set(`assets/${r.assetId}`, {
      ...asset,
      status: "deleting",
      version: asset.version + 1,
    });
    return { jobId };
  },
  { mutation: true },
);
define(
  "getUploadUsage",
  "teacher",
  [],
  async (c) =>
    (await c.get(`usage/${c.actor.uid}`, false)) ?? {
      reservedBytes: 0,
      finalizedBytes: 0,
      limitBytes: LIMITS.teacherBytes,
    },
);
define(
  "setUploadAllowance",
  "admin",
  ["targetUid", "limitBytes"],
  async (c, r) => {
    id(r.targetUid);
    number(r.limitBytes, "Upload allowance", 0, 107374182400, true);
    const old = (await c.get(`usage/${r.targetUid}`, false)) ?? {
      reservedBytes: 0,
      finalizedBytes: 0,
    };
    c.set(`usage/${r.targetUid}`, {
      ...old,
      limitBytes: r.limitBytes,
      updatedAt: c.now,
    });
    c.audit("account.upload_allowance_changed", "user", r.targetUid, {
      affectedUserId: r.targetUid,
    });
    return { limitBytes: r.limitBytes };
  },
  { mutation: true },
);
define("getAssetLinks", "user", ["context", "assetIds"], async (c, r) => {
  assert(
    r.context && typeof r.context === "object" && !Array.isArray(r.context),
    "INVALID_FIELDS",
    "An image context is required.",
  );
  const context = r.context;
  for (const key of Object.keys(context))
    assert(
      ["kind", "id", "revisionId"].includes(key),
      "INVALID_FIELDS",
      "Invalid context field.",
    );
  id(context.id);
  assert(
    Array.isArray(r.assetIds) &&
      r.assetIds.length <= 20 &&
      r.assetIds.every((a) => typeof a === "string"),
    "INVALID_FIELDS",
    "Request at most 20 images.",
  );
  const allowed = new Set();
  if (context.kind === "problem") {
    const data = await readProblem(c, context.id, context.revisionId);
    assetIds(data.content, data.grading).forEach((a) => allowed.add(a));
  } else if (context.kind === "quiz_draft") {
    const quiz = await getOwnedQuiz(c, context.id);
    const draft = await c.get(`quizzes/${context.id}/drafts/current`);
    for (const itemId of draft.itemOrder) {
      const slot = await c.get(`quizzes/${context.id}/draftItems/${itemId}`),
        source = await snapshotSource(c, context.id, quiz, slot),
        data = await sourceContent(c, source);
      assetIds(data.content, data.grading).forEach((a) => allowed.add(a));
    }
  } else if (context.kind === "attempt" || context.kind === "result") {
    let a = await c.get(`attempts/${context.id}`);
    authorizeAttempt(c, a);
    a = await expire(c, context.id, a);
    const staff = attemptManager(c.actor, a);
    if (context.kind === "attempt")
      assert(
        a.status === "active",
        "ATTEMPT_FROZEN",
        "This attempt has ended.",
      );
    else
      assert(
        a.status !== "active" || staff,
        "RESOURCE_UNAVAILABLE",
        "Result unavailable.",
      );
    const ids =
      context.kind === "attempt" && !a.settingsSnapshot.allowBack && !staff
        ? [a.order[a.currentFrontier]]
        : a.order;
    const showKey =
      context.kind === "result" && (staff || released(a, "solutions", c.now));
    const base = `quizzes/${a.quizId}/revisions/${a.quizRevisionId}`;
    await Promise.all(
      ids.map(async (itemId) => {
        const [item, key] = await Promise.all([
          c.get(`${base}/items/${itemId}`),
          showKey ? c.get(`${base}/grading/${itemId}`) : null,
        ]);
        Object.values(item.questionAssetBindings).forEach((x) =>
          allowed.add(x),
        );
        if (key)
          Object.values(key.solutionAssetBindings).forEach((x) =>
            allowed.add(x),
          );
      }),
    );
  } else if (context.kind === "source" || context.kind === "owned_upload") {
    requireRole(c.actor, "teacher");
    const a = await c.get(`assets/${context.id}`);
    assert(
      a.ownerId === c.actor.uid || c.actor.role === "admin",
      "RESOURCE_UNAVAILABLE",
      "Asset unavailable.",
    );
    if (context.kind === "source")
      assert(a.kind === "source", "INVALID_FIELDS", "Source required.");
    allowed.add(context.id);
  } else assert(false, "INVALID_FIELDS", "Unknown asset context.");
  for (const assetId of r.assetIds) {
    id(assetId);
    assert(
      allowed.has(assetId),
      "RESOURCE_UNAVAILABLE",
      "An image is not part of this content.",
    );
  }
  const links = await Promise.all(
    r.assetIds.map(async (assetId) => {
      const asset = await c.get(`assets/${assetId}`);
      assert(
        asset.status === "ready",
        "ASSET_NOT_READY",
        "An image is not ready.",
      );
      return {
        assetId,
        url: await signObject(asset.storagePath, asset.generation),
        expiresAt: Timestamp.fromMillis(Date.now() + 120000),
        contentType: asset.contentType,
      };
    }),
  );
  return { links };
});
define("getExportLink", "teacher", ["jobId"], async (c, r) => {
  const job = await c.get(path("jobs", r.jobId));
  assert(
    ["export_quiz", "export_results"].includes(job.kind) &&
      (job.requestedBy === c.actor.uid || c.actor.role === "admin") &&
      job.status === "succeeded",
    "RESOURCE_UNAVAILABLE",
    "Export unavailable.",
  );
  await getOwnedQuiz(c, job.targetId);
  return {
    url: await signObject(job.result.storagePath, job.result.generation),
    filename: job.result.filename,
    expiresAt: Timestamp.fromMillis(Date.now() + 120000),
  };
});
