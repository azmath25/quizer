import {
  define,
  manage,
  canReadProblem,
  path,
  version,
  hash,
  Timestamp,
  millis,
  admission,
} from "../domain/runtime.js";
import {
  DEFAULT_SETTINGS,
  assert,
  id,
  number,
  text,
  fields,
  enumeration,
  validateSettings,
  timestampInput,
  assetIds,
} from "../../shared/schema.js";
import { createProblemRecord } from "./problems.js";
export async function newQuiz(
  c,
  title = "Untitled quiz",
  quizId = c.key("cloud-"),
) {
  const profile = await c.get(`users/${c.actor.uid}`, false);
  const quiz = {
    schemaVersion: 2,
    ownerId: c.actor.uid,
    ownerDisplayName: profile?.displayName ?? c.actor.displayName,
    title: text(title, "Title", 200, true),
    searchTitle: title.toLowerCase(),
    description: "",
    subject: "",
    difficulty: "",
    lifecycle: "active",
    visibility: "private",
    accessMode: "approval",
    opensAt: null,
    closesAt: null,
    maxAttempts: 1,
    publishedRevisionId: null,
    draftVersion: 1,
    version: 1,
    publishingJobId: null,
    createdAt: c.now,
    updatedAt: c.now,
    publishedAt: null,
    trashedAt: null,
  };
  c.set(`quizzes/${quizId}`, quiz);
  c.set(`quizzes/${quizId}/drafts/current`, {
    version: 1,
    title,
    description: "",
    subject: "",
    difficulty: "",
    itemOrder: [],
    settings: { ...DEFAULT_SETTINGS },
    updatedAt: c.now,
    updatedBy: c.actor.uid,
  });
  c.audit("quiz.created", "quiz", quizId, { quizId, quizOwnerId: c.actor.uid });
  return { quizId, version: 1, draftVersion: 1 };
}
export async function getOwnedQuiz(c, quizId) {
  const quiz = await c.get(path("quizzes", quizId));
  manage(c.actor, quiz);
  assert(
    quiz.schemaVersion === 2,
    "MIGRATION_REQUIRED",
    "This quiz needs to be migrated before editing.",
  );
  return quiz;
}
export async function snapshotSource(c, quizId, quiz, item) {
  const problem = await c.get(`problems/${id(item.problemId)}`, false);
  const permitted =
    problem &&
    problem.lifecycle === "active" &&
    (problem.ownerId === c.actor.uid ||
      c.actor.role === "admin" ||
      problem.bankVisibility === "teachers");
  if (permitted) {
    const revision = await c.get(
      `problems/${item.problemId}/revisions/${id(item.problemRevisionId)}`,
    );
    return {
      kind: "problem",
      path: `problems/${item.problemId}/revisions/${item.problemRevisionId}`,
      problemId: item.problemId,
      problemRevisionId: item.problemRevisionId,
    };
  }
  const retainedRevision =
    quiz.publishedRevisionId ?? quiz.lastPublishedRevisionId;
  if (retainedRevision && item.itemId) {
    const old = await c.get(
      `quizzes/${quizId}/revisions/${retainedRevision}/items/${id(item.itemId)}`,
      false,
    );
    if (
      old &&
      old.problemId === item.problemId &&
      old.problemRevisionId === item.problemRevisionId
    )
      return {
        kind: "snapshot",
        path: `quizzes/${quizId}/revisions/${retainedRevision}`,
        itemId: item.itemId,
        problemId: item.problemId,
        problemRevisionId: item.problemRevisionId,
      };
  }
  assert(
    false,
    "RESOURCE_UNAVAILABLE",
    "A selected problem is no longer shared. Use an existing published slot or choose another problem.",
  );
}
export async function sourceContent(c, source) {
  if (source.kind === "problem")
    return {
      content: await c.get(source.path),
      grading: await c.get(source.path + "/grading/main"),
    };
  return {
    content: await c.get(source.path + "/items/" + source.itemId),
    grading: await c.get(source.path + "/grading/" + source.itemId),
  };
}
export async function projectCatalog(c, quizId, quiz, revision = null) {
  if (
    quiz.lifecycle !== "active" ||
    quiz.visibility !== "public" ||
    !quiz.publishedRevisionId
  ) {
    c.delete(`catalog/${quizId}`);
    return;
  }
  revision ??= await c.get(
    `quizzes/${quizId}/revisions/${quiz.publishedRevisionId}`,
  );
  assert(
    revision.state === "ready",
    "RESOURCE_UNAVAILABLE",
    "Publication is not ready.",
  );
  c.set(`catalog/${quizId}`, {
    quizId,
    title: revision.title,
    searchTitle: revision.title.toLowerCase(),
    description: revision.description,
    ownerDisplayName: quiz.ownerDisplayName,
    subject: revision.subject,
    difficulty: revision.difficulty,
    durationSeconds: revision.settings.durationSeconds,
    questionCount: revision.itemCount,
    totalPoints: revision.totalPoints,
    accessMode: quiz.accessMode,
    opensAt: quiz.opensAt,
    closesAt: quiz.closesAt,
    publishedRevisionId: quiz.publishedRevisionId,
    updatedAt: c.now,
  });
}
define("createQuiz", "teacher", ["title"], (c, r) => newQuiz(c, r.title), {
  mutation: true,
});
define(
  "listPublicQuizzes",
  "guest",
  ["search", "subject", "limit", "cursor"],
  (c, r) => {
    const filters = [];
    if (r.subject)
      filters.push(["subject", "==", text(r.subject, "Subject", 80)]);
    let order = "updatedAt",
      direction = "desc";
    if (r.search) {
      const s = text(r.search, "Title prefix", 200).toLowerCase();
      filters.push(
        ["searchTitle", ">=", s],
        ["searchTitle", "<=", s + "\uf8ff"],
      );
      order = "searchTitle";
      direction = "asc";
    }
    return c.list("catalog", filters, r, order, direction);
  },
);
define(
  "listMyQuizzes",
  "teacher",
  ["lifecycle", "visibility", "search", "limit", "cursor"],
  (c, r) => {
    const filters = [
      ["ownerId", "==", c.actor.uid],
      [
        "lifecycle",
        "==",
        enumeration(
          r.lifecycle ?? "active",
          ["active", "trashed"],
          "lifecycle",
        ),
      ],
    ];
    if (r.visibility)
      filters.push([
        "visibility",
        "==",
        enumeration(r.visibility, ["private", "public"], "visibility"),
      ]);
    let order = "updatedAt",
      direction = "desc";
    if (r.search) {
      const s = text(r.search, "Title prefix", 200).toLowerCase();
      filters.push(
        ["searchTitle", ">=", s],
        ["searchTitle", "<=", s + "\uf8ff"],
      );
      order = "searchTitle";
      direction = "asc";
    }
    return c.list("quizzes", filters, r, order, direction);
  },
);
define("getQuizDraft", "teacher", ["quizId"], async (c, r) => {
  const quiz = await getOwnedQuiz(c, r.quizId);
  const draft = await c.get(`quizzes/${r.quizId}/drafts/current`);
  const items = await c.all(`quizzes/${r.quizId}/draftItems`);
  return {
    quizId: r.quizId,
    quiz,
    draft,
    items: items.map(({ _path, id, ...i }) => i),
  };
});
define("getQuizDraftItems", "teacher", ["quizId", "itemIds"], async (c, r) => {
  const quiz = await getOwnedQuiz(c, r.quizId);
  assert(
    Array.isArray(r.itemIds) && r.itemIds.length <= 20,
    "INVALID_FIELDS",
    "Request at most 20 problems.",
  );
  const items = [];
  for (const itemId of r.itemIds) {
    const slot = await c.get(`quizzes/${r.quizId}/draftItems/${id(itemId)}`);
    const source = await snapshotSource(c, r.quizId, quiz, slot);
    const { content, grading } = await sourceContent(c, source);
    items.push({ ...slot, content, grading });
  }
  return { items };
});
define(
  "saveQuizDraft",
  "teacher",
  [
    "quizId",
    "expectedDraftVersion",
    "patch",
    "upsertItems",
    "removeItemIds",
    "itemOrder",
  ],
  async (c, r) => {
    const qp = path("quizzes", r.quizId),
      quiz = await getOwnedQuiz(c, r.quizId);
    assert(
      !quiz.publishingJobId && quiz.lifecycle === "active",
      "FAILED_PRECONDITION",
      "Wait for publishing to finish, or restore the quiz.",
    );
    const draft = await c.get(`${qp}/drafts/current`);
    version(draft.version, r.expectedDraftVersion);
    const patch = r.patch ?? {};
    fields(
      patch,
      ["title", "description", "subject", "difficulty", "settings"],
      "draft",
    );
    const next = {
      ...draft,
      version: draft.version + 1,
      updatedAt: c.now,
      updatedBy: c.actor.uid,
    };
    for (const [k, max] of [
      ["title", 200],
      ["description", 2000],
      ["subject", 80],
      ["difficulty", 40],
    ])
      if (patch[k] !== undefined)
        next[k] = text(patch[k], k, max, k === "title");
    if (patch.settings)
      next.settings = validateSettings(patch.settings, draft.settings);
    const upserts = r.upsertItems ?? [],
      removes = r.removeItemIds ?? [];
    assert(
      Array.isArray(upserts) &&
        Array.isArray(removes) &&
        upserts.length <= 20 &&
        removes.length <= 20,
      "INVALID_FIELDS",
      "Save at most 20 changed problems per request.",
    );
    const order = [...draft.itemOrder],
      mapping = {},
      existing = new Set(order);
    const seen = new Set();
    for (const item of upserts) {
      fields(
        item,
        ["clientKey", "itemId", "problemId", "problemRevisionId", "points"],
        "quiz item",
      );
      assert(
        !!item.clientKey !== !!item.itemId,
        "INVALID_FIELDS",
        "Use either an existing item ID or a new client key.",
      );
      const identity = id(item.itemId ?? item.clientKey);
      assert(!seen.has(identity), "INVALID_FIELDS", "Duplicate item.");
      seen.add(identity);
      const itemId = item.itemId ? id(item.itemId) : c.key("itm_", identity);
      if (item.itemId)
        assert(existing.has(itemId), "INVALID_FIELDS", "Unknown quiz slot.");
      else {
        mapping[identity] = itemId;
        order.push(itemId);
      }
      const slot = {
        itemId,
        problemId: id(item.problemId),
        problemRevisionId: id(item.problemRevisionId),
        points: number(item.points, "Points", 0.00000001, 1000),
        reuseFromQuizRevisionId: null,
      };
      const source = await snapshotSource(c, r.quizId, quiz, slot);
      if (source.kind === "snapshot")
        slot.reuseFromQuizRevisionId =
          quiz.publishedRevisionId ?? quiz.lastPublishedRevisionId;
      c.set(`${qp}/draftItems/${itemId}`, slot);
    }
    for (const itemId of removes) {
      id(itemId);
      assert(
        existing.has(itemId) && !seen.has(itemId),
        "INVALID_FIELDS",
        "Invalid removed slot.",
      );
      c.delete(`${qp}/draftItems/${itemId}`);
    }
    const remaining = order.filter((i) => !removes.includes(i));
    next.itemOrder = r.itemOrder
      ? r.itemOrder.map((k) => mapping[k] ?? id(k))
      : remaining;
    assert(
      Array.isArray(next.itemOrder) &&
        next.itemOrder.length <= 500 &&
        new Set(next.itemOrder).size === next.itemOrder.length &&
        next.itemOrder.length === remaining.length &&
        next.itemOrder.every((i) => remaining.includes(i)),
      "INVALID_FIELDS",
      "Order must contain every remaining slot exactly once.",
    );
    c.set(`${qp}/drafts/current`, next);
    c.set(qp, {
      ...quiz,
      title: next.title,
      searchTitle: next.title.toLowerCase(),
      description: next.description,
      subject: next.subject,
      difficulty: next.difficulty,
      draftVersion: next.version,
      version: quiz.version + 1,
      updatedAt: c.now,
    });
    c.audit("quiz.draft_saved", "quiz", r.quizId, {
      quizId: r.quizId,
      quizOwnerId: quiz.ownerId,
      changedFields: [...Object.keys(patch), "items"],
    });
    return {
      draftVersion: next.version,
      version: quiz.version + 1,
      itemOrder: next.itemOrder,
      itemIdMap: mapping,
    };
  },
  { mutation: true },
);
define(
  "setQuizAccessPolicy",
  "teacher",
  [
    "quizId",
    "expectedVersion",
    "visibility",
    "accessMode",
    "opensAt",
    "closesAt",
    "maxAttempts",
  ],
  async (c, r) => {
    const quiz = await getOwnedQuiz(c, r.quizId);
    version(quiz.version, r.expectedVersion);
    const visibility = enumeration(
        r.visibility,
        ["private", "public"],
        "visibility",
      ),
      accessMode = enumeration(
        r.accessMode,
        ["approval", "open"],
        "access mode",
      );
    assert(
      visibility !== "private" || accessMode === "approval",
      "INVALID_FIELDS",
      "Private quizzes require approval.",
    );
    const opens = timestampInput(r.opensAt ?? null, "opening time"),
      closes = timestampInput(r.closesAt ?? null, "closing time");
    assert(
      !opens || !closes || opens < closes,
      "INVALID_FIELDS",
      "Closing time must be after opening time.",
    );
    const maxAttempts =
      r.maxAttempts === null
        ? null
        : number(r.maxAttempts ?? 1, "Maximum attempts", 1, 10000, true);
    if (quiz.publishedRevisionId) {
      const rev = await c.get(
        `quizzes/${r.quizId}/revisions/${quiz.publishedRevisionId}`,
      );
      assert(
        closes ||
          ![rev.settings.scoreRelease, rev.settings.solutionRelease].includes(
            "afterClose",
          ),
        "INVALID_FIELDS",
        "Keep a closing time for after-close release.",
      );
    }
    const next = {
      ...quiz,
      visibility,
      accessMode,
      opensAt: opens ? Timestamp.fromDate(opens) : null,
      closesAt: closes ? Timestamp.fromDate(closes) : null,
      maxAttempts,
      version: quiz.version + 1,
      updatedAt: c.now,
    };
    await projectCatalog(c, r.quizId, next);
    c.set(`quizzes/${r.quizId}`, next);
    c.audit("quiz.access_policy_changed", "quiz", r.quizId, {
      quizId: r.quizId,
      quizOwnerId: quiz.ownerId,
    });
    return { version: next.version };
  },
  { mutation: true },
);
define(
  "publishQuiz",
  "teacher",
  ["quizId", "expectedDraftVersion", "expectedVersion"],
  async (c, r) => {
    const quiz = await getOwnedQuiz(c, r.quizId);
    version(quiz.version, r.expectedVersion);
    const draft = await c.get(`quizzes/${r.quizId}/drafts/current`);
    version(draft.version, r.expectedDraftVersion);
    assert(
      quiz.lifecycle === "active" && !quiz.publishingJobId,
      "FAILED_PRECONDITION",
      "This quiz cannot be published now.",
    );
    assert(
      draft.itemOrder.length > 0,
      "INVALID_FIELDS",
      "Add at least one problem.",
    );
    assert(
      quiz.closesAt ||
        ![draft.settings.scoreRelease, draft.settings.solutionRelease].includes(
          "afterClose",
        ),
      "INVALID_FIELDS",
      "Set a closing time for after-close release.",
    );
    await c.rate("publish", 10, 60000);
    const sources = [];
    for (const itemId of draft.itemOrder) {
      const item = await c.get(`quizzes/${r.quizId}/draftItems/${itemId}`);
      sources.push({
        ...item,
        source: await snapshotSource(c, r.quizId, quiz, item),
      });
    }
    const revisionId = c.key("qrv_", r.quizId),
      jobId = await c.job("publish_quiz", r.quizId, {
        revisionId,
        draftVersion: draft.version,
        sources,
      });
    const lastRevisionId =
      quiz.publishedRevisionId ?? quiz.lastPublishedRevisionId;
    const last = lastRevisionId
      ? await c.get(`quizzes/${r.quizId}/revisions/${lastRevisionId}`)
      : null;
    c.set(`quizzes/${r.quizId}/revisions/${revisionId}`, {
      schemaVersion: 2,
      state: "building",
      revisionNumber: (last?.revisionNumber ?? 0) + 1,
      publicationJobId: jobId,
      sourceDraftVersion: draft.version,
      title: draft.title,
      description: draft.description,
      subject: draft.subject,
      difficulty: draft.difficulty,
      settings: draft.settings,
      itemOrder: draft.itemOrder,
      itemCount: draft.itemOrder.length,
      totalPoints:
        Math.round(sources.reduce((s, i) => s + i.points, 0) * 1e8) / 1e8,
      manifestHash: hash({ draft, sources }),
      createdBy: c.actor.uid,
      createdAt: c.now,
      readyAt: null,
    });
    c.set(`quizzes/${r.quizId}`, {
      ...quiz,
      publishingJobId: jobId,
      version: quiz.version + 1,
      updatedAt: c.now,
    });
    return { jobId, revisionId };
  },
  { mutation: true },
);
for (const [name, event] of [
  ["unpublishQuiz", "unpublished"],
  ["trashQuiz", "trashed"],
  ["restoreQuiz", "restored"],
])
  define(
    name,
    "teacher",
    ["quizId", "expectedVersion"],
    async (c, r) => {
      const quiz = await getOwnedQuiz(c, r.quizId);
      version(quiz.version, r.expectedVersion);
      const next = { ...quiz, version: quiz.version + 1, updatedAt: c.now };
      if (name === "unpublishQuiz") next.publishedRevisionId = null;
      else {
        next.lifecycle = name === "trashQuiz" ? "trashed" : "active";
        next.trashedAt = name === "trashQuiz" ? c.now : null;
        if (name === "restoreQuiz") {
          next.visibility = "private";
          next.accessMode = "approval";
        }
      }
      await projectCatalog(c, r.quizId, next);
      c.set(`quizzes/${r.quizId}`, next);
      c.audit("quiz." + event, "quiz", r.quizId, {
        quizId: r.quizId,
        quizOwnerId: quiz.ownerId,
      });
      return { version: next.version };
    },
    { mutation: true },
  );
define(
  "listQuizRevisions",
  "teacher",
  ["quizId", "limit", "cursor"],
  async (c, r) => {
    await getOwnedQuiz(c, r.quizId);
    return c.list(`quizzes/${r.quizId}/revisions`, [], r, "createdAt");
  },
);
define(
  "previewQuizRevision",
  "teacher",
  ["quizId", "revisionId", "itemIds", "includeKeys"],
  async (c, r) => {
    await getOwnedQuiz(c, r.quizId);
    const rev = await c.get(
      `quizzes/${r.quizId}/revisions/${id(r.revisionId)}`,
    );
    const selected = r.itemIds ?? rev.itemOrder.slice(0, 20);
    assert(
      Array.isArray(selected) &&
        selected.length <= 20 &&
        selected.every((i) => rev.itemOrder.includes(i)),
      "INVALID_FIELDS",
      "Invalid problem selection.",
    );
    const items = [];
    for (const itemId of selected)
      items.push({
        content: await c.get(
          `quizzes/${r.quizId}/revisions/${r.revisionId}/items/${itemId}`,
        ),
        ...(r.includeKeys
          ? {
              grading: await c.get(
                `quizzes/${r.quizId}/revisions/${r.revisionId}/grading/${itemId}`,
              ),
            }
          : {}),
      });
    return { revision: rev, items };
  },
);
define(
  "duplicateQuiz",
  "teacher",
  ["quizId", "expectedVersion"],
  async (c, r) => {
    const quiz = await getOwnedQuiz(c, r.quizId);
    version(quiz.version, r.expectedVersion);
    const draft = await c.get(`quizzes/${r.quizId}/drafts/current`);
    const sources = [];
    for (const itemId of draft.itemOrder) {
      const slot = await c.get(`quizzes/${r.quizId}/draftItems/${itemId}`);
      sources.push({
        ...slot,
        source: await snapshotSource(c, r.quizId, quiz, slot),
      });
    }
    const created = await newQuiz(c, `${draft.title} (copy)`);
    const jobId = await c.job("duplicate_quiz", created.quizId, {
      sourceQuizId: r.quizId,
      draft,
      sources,
    });
    const next = await c.get(`quizzes/${created.quizId}`);
    c.set(`quizzes/${created.quizId}`, { ...next, publishingJobId: jobId });
    return { ...created, jobId };
  },
  { mutation: true },
);
define("getJob", "user", ["jobId"], async (c, r) => {
  const job = await c.get(path("jobs", r.jobId));
  assert(
    job.requestedBy === c.actor.uid || c.actor.role === "admin",
    "RESOURCE_UNAVAILABLE",
    "This job is unavailable.",
  );
  if (job.kind !== "grade_attempt")
    assert(
      c.actor.emailVerified && ["teacher", "admin"].includes(c.actor.role),
      "ROLE_REQUIRED",
      "Teacher access is required.",
    );
  return {
    jobId: r.jobId,
    kind: job.kind,
    status: job.status,
    progress: job.progress,
    result: job.result,
    error: job.error,
    updatedAt: job.updatedAt,
  };
});
define(
  "retryJob",
  "teacher",
  ["jobId"],
  async (c, r) => {
    const job = await c.get(path("jobs", r.jobId));
    assert(
      job.requestedBy === c.actor.uid || c.actor.role === "admin",
      "RESOURCE_UNAVAILABLE",
      "Job unavailable.",
    );
    assert(
      job.status === "failed",
      "INVALID_FIELDS",
      "Only failed jobs can be retried.",
    );
    assert(
      !["import"].includes(job.kind),
      "INVALID_FIELDS",
      "Resume this import from the editor.",
    );
    c.set(`jobs/${r.jobId}`, {
      ...job,
      status: "queued",
      error: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: c.now,
    });
    if (job.kind === "finalize_asset") {
      const asset = await c.get(`assets/${job.targetId}`);
      assert(
        asset.status === "failed",
        "FAILED_PRECONDITION",
        "Asset cannot be retried.",
      );
      c.set(`assets/${job.targetId}`, { ...asset, status: "processing" });
    }
    c.audit("job.retried", "job", r.jobId);
    return { jobId: r.jobId };
  },
  { mutation: true },
);
define(
  "createImportJob",
  "teacher",
  ["name", "sourceAssetId", "itemCount"],
  async (c, r) => {
    const count = number(r.itemCount, "Problem count", 1, 500, true);
    if (r.sourceAssetId) {
      const asset = await c.get(path("assets", r.sourceAssetId));
      assert(
        asset.ownerId === c.actor.uid &&
          asset.status === "ready" &&
          asset.kind === "source",
        "RESOURCE_UNAVAILABLE",
        "Source is unavailable.",
      );
    }
    const jobId = await c.job("import", c.key("cloud-", "import-target"), {
      name: text(r.name, "Import name", 200, true),
      sourceAssetId: r.sourceAssetId ?? null,
      itemCount: count,
    });
    const j = await c.get(`jobs/${jobId}`);
    c.set(`jobs/${jobId}`, {
      ...j,
      status: "running",
      progress: { processed: 0, total: count, stage: "Importing" },
    });
    return { jobId };
  },
  { mutation: true },
);
define(
  "importProblemBatch",
  "teacher",
  ["jobId", "records"],
  async (c, r) => {
    const job = await c.get(path("jobs", r.jobId));
    assert(
      job.kind === "import" &&
        job.requestedBy === c.actor.uid &&
        job.status === "running",
      "RESOURCE_UNAVAILABLE",
      "Import is unavailable.",
    );
    assert(
      Array.isArray(r.records) &&
        r.records.length >= 1 &&
        r.records.length <= 20,
      "INVALID_FIELDS",
      "Import 1–20 problems at once.",
    );
    const mappings = [];
    let added = 0;
    for (const record of r.records) {
      fields(record, [
        "importItemKey",
        "originalQuestionId",
        "metadata",
        "content",
        "grading",
        "points",
      ]);
      const key = id(record.importItemKey);
      const mappingPath = `jobs/${r.jobId}/mappings/${key}`,
        old = await c.get(mappingPath, false);
      const checksum = hash(record);
      if (old) {
        assert(
          old.hash === checksum,
          "VERSION_CONFLICT",
          "An imported problem changed. Start a new import.",
        );
        mappings.push(old);
        continue;
      }
      const result = await createProblemRecord(
        c,
        {
          ...record,
          importJobId: r.jobId,
          sourceAssetId: job.input.sourceAssetId,
        },
        `${r.jobId}:${key}`,
      );
      const mapping = {
        importItemKey: key,
        ...result,
        itemId: c.key("itm_", `${r.jobId}:${key}`),
        points: number(
          record.points ?? record.content.defaultPoints,
          "Points",
          0.00000001,
          1000,
        ),
        hash: checksum,
      };
      c.set(mappingPath, mapping);
      c.set(`quizzes/${job.targetId}/draftItems/${mapping.itemId}`, {
        itemId: mapping.itemId,
        problemId: mapping.problemId,
        problemRevisionId: mapping.revisionId,
        points: mapping.points,
        reuseFromQuizRevisionId: null,
      });
      mappings.push(mapping);
      added++;
    }
    assert(
      job.progress.processed + added <= job.input.itemCount,
      "INVALID_FIELDS",
      "Too many imported problems.",
    );
    c.set(`jobs/${r.jobId}`, {
      ...job,
      progress: { ...job.progress, processed: job.progress.processed + added },
      updatedAt: c.now,
    });
    return { mappings, processed: job.progress.processed + added };
  },
  { mutation: true },
);
define(
  "finishImportJob",
  "teacher",
  ["jobId", "title", "description", "settings", "order"],
  async (c, r) => {
    const job = await c.get(path("jobs", r.jobId));
    assert(
      job.kind === "import" && job.requestedBy === c.actor.uid,
      "RESOURCE_UNAVAILABLE",
      "Import is unavailable.",
    );
    if (job.status === "succeeded") return job.result;
    assert(
      job.progress.processed === job.input.itemCount,
      "FAILED_PRECONDITION",
      "Some problems have not been imported yet.",
    );
    assert(
      Array.isArray(r.order) &&
        r.order.length === job.input.itemCount &&
        new Set(r.order).size === r.order.length,
      "INVALID_FIELDS",
      "Invalid import order.",
    );
    const result = await newQuiz(c, r.title ?? job.input.name, job.targetId);
    const items = [];
    for (const key of r.order) {
      const m = await c.get(`jobs/${r.jobId}/mappings/${id(key)}`);
      items.push(m.itemId);
    }
    const draft = await c.get(`quizzes/${result.quizId}/drafts/current`);
    c.set(`quizzes/${result.quizId}/drafts/current`, {
      ...draft,
      description: text(r.description ?? "", "Description", 2000),
      settings: validateSettings(r.settings ?? {}),
      itemOrder: items,
    });
    c.set(`jobs/${r.jobId}`, {
      ...job,
      status: "succeeded",
      result,
      completedAt: c.now,
      updatedAt: c.now,
      progress: { ...job.progress, stage: "Complete" },
    });
    return result;
  },
  { mutation: true },
);

define(
  "cancelJob",
  "teacher",
  ["jobId"],
  async (c, r) => {
    const job = await c.get(path("jobs", r.jobId));
    assert(
      job.requestedBy === c.actor.uid || c.actor.role === "admin",
      "RESOURCE_UNAVAILABLE",
      "Job unavailable.",
    );
    assert(
      job.status === "failed",
      "FAILED_PRECONDITION",
      "Only failed jobs can be cancelled.",
    );
    if (["publish_quiz", "duplicate_quiz"].includes(job.kind)) {
      const quiz = await c.get(`quizzes/${job.targetId}`);
      manage(c.actor, quiz);
      if (quiz.publishingJobId === r.jobId)
        c.set(`quizzes/${job.targetId}`, {
          ...quiz,
          publishingJobId: null,
          version: quiz.version + 1,
          updatedAt: c.now,
        });
      if (job.input.revisionId) {
        const p = `quizzes/${job.targetId}/revisions/${job.input.revisionId}`,
          rev = await c.get(p);
        c.set(p, { ...rev, state: "failed" });
      }
    }
    c.set(`jobs/${r.jobId}`, { ...job, status: "cancelled", updatedAt: c.now });
    c.audit("job.cancelled", "job", r.jobId);
    return { cancelled: true };
  },
  { mutation: true },
);
