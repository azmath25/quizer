import {
  define,
  manage,
  canReadProblem,
  path,
  hash,
  version,
} from "../domain/runtime.js";
import {
  validateMetadata,
  validateProblem,
  assetIds,
  enumeration,
  id,
  text,
  assert,
} from "../../shared/schema.js";
import { retainAssets } from "../domain/assets.js";
export async function createProblemRecord(
  c,
  input,
  key = "",
  source = null,
  authorizedCopy = false,
) {
  const metadata = validateMetadata(input.metadata),
    { content, grading } = validateProblem(input.content, input.grading);
  const problemId = c.key("prb_", key),
    revisionId = c.key("prv_", key);
  const profile = await c.get(`users/${c.actor.uid}`, false);
  const record = {
    schemaVersion: 2,
    ownerId: c.actor.uid,
    ownerDisplayName: profile?.displayName ?? c.actor.displayName,
    ...metadata,
    searchTitle: metadata.title.toLowerCase(),
    lifecycle: "active",
    latestRevisionId: revisionId,
    revisionNumber: 1,
    version: 1,
    sourceProblemId: source?.problemId ?? null,
    sourceProblemRevisionId: source?.revisionId ?? null,
    createdAt: c.now,
    updatedAt: c.now,
    trashedAt: null,
  };
  const revision = {
    schemaVersion: 2,
    ...content,
    revisionNumber: 1,
    createdBy: c.actor.uid,
    createdAt: c.now,
    source: {
      importJobId: input.importJobId ?? null,
      sourceAssetId: input.sourceAssetId ?? null,
      originalQuestionId: input.originalQuestionId ?? null,
    },
    contentHash: hash({ content, grading }),
  };
  await retainAssets(
    c,
    assetIds(content, grading),
    `problems/${problemId}/revisions/${revisionId}`,
    c.actor.uid,
    { authorizedCopy },
  );
  if (input.sourceAssetId)
    await retainAssets(
      c,
      [input.sourceAssetId],
      `problems/${problemId}/source`,
      c.actor.uid,
    );
  c.set(`problems/${problemId}`, record);
  c.set(`problems/${problemId}/revisions/${revisionId}`, revision);
  c.set(`problems/${problemId}/revisions/${revisionId}/grading/main`, {
    ...grading,
    createdAt: c.now,
  });
  c.audit(source ? "problem.forked" : "problem.created", "problem", problemId);
  return { problemId, revisionId, version: 1 };
}
export async function readProblem(c, problemId, revisionId = null) {
  const problem = await c.get(path("problems", problemId));
  canReadProblem(c.actor, problem);
  const rid = revisionId ? id(revisionId) : problem.latestRevisionId;
  const content = await c.get(`problems/${problemId}/revisions/${rid}`),
    grading = await c.get(
      `problems/${problemId}/revisions/${rid}/grading/main`,
    );
  // Full source imports are owner-only, even when the problem is shared.
  const source =
    problem.ownerId === c.actor.uid || c.actor.role === "admin"
      ? content.source
      : {
          importJobId: null,
          sourceAssetId: null,
          originalQuestionId: content.source.originalQuestionId,
        };
  return {
    problemId,
    revisionId: rid,
    problem,
    content: { ...content, source },
    grading,
  };
}
define(
  "listProblems",
  "teacher",
  [
    "view",
    "lifecycle",
    "search",
    "subject",
    "difficulty",
    "tag",
    "limit",
    "cursor",
  ],
  (c, r) => {
    const view = enumeration(r.view ?? "mine", ["mine", "shared"], "bank view");
    const filters =
      view === "mine"
        ? [
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
          ]
        : [
            ["bankVisibility", "==", "teachers"],
            ["lifecycle", "==", "active"],
          ];
    const optional = [r.subject, r.difficulty, r.tag].filter(Boolean);
    assert(
      optional.length <= 1,
      "INVALID_FIELDS",
      "Use one subject, difficulty or tag filter at a time.",
    );
    if (r.subject)
      filters.push(["subject", "==", text(r.subject, "Subject", 80)]);
    if (r.difficulty)
      filters.push(["difficulty", "==", text(r.difficulty, "Difficulty", 40)]);
    if (r.tag) filters.push(["tags", "array-contains", text(r.tag, "Tag", 60)]);
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
    return c.list("problems", filters, r, order, direction);
  },
);
define("getProblem", "teacher", ["problemId", "revisionId"], (c, r) =>
  readProblem(c, r.problemId, r.revisionId),
);
define(
  "createProblem",
  "teacher",
  ["metadata", "content", "grading"],
  (c, r) => createProblemRecord(c, r),
  { mutation: true },
);
define(
  "saveProblemRevision",
  "teacher",
  ["problemId", "expectedVersion", "metadata", "content", "grading"],
  async (c, r) => {
    const p = path("problems", r.problemId),
      old = await c.get(p);
    manage(c.actor, old);
    version(old.version, r.expectedVersion);
    assert(
      old.lifecycle === "active",
      "RESOURCE_UNAVAILABLE",
      "Restore the problem before editing.",
    );
    const metadata = validateMetadata(r.metadata),
      { content, grading } = validateProblem(r.content, r.grading);
    const revisionId = c.key("prv_", r.problemId);
    // Existing images on the previous revision remain valid after a fork.
    const previous = await c.get(`${p}/revisions/${old.latestRevisionId}`),
      key = await c.get(`${p}/revisions/${old.latestRevisionId}/grading/main`);
    const priorIds = new Set(assetIds(previous, key));
    const ids = assetIds(content, grading);
    await retainAssets(
      c,
      ids.filter((a) => priorIds.has(a)),
      `${p}/revisions/${revisionId}`,
      old.ownerId,
      { authorizedCopy: true },
    );
    await retainAssets(
      c,
      ids.filter((a) => !priorIds.has(a)),
      `${p}/revisions/${revisionId}`,
      old.ownerId,
    );
    c.set(`${p}/revisions/${revisionId}`, {
      schemaVersion: 2,
      ...content,
      revisionNumber: old.revisionNumber + 1,
      createdBy: c.actor.uid,
      createdAt: c.now,
      source: previous.source,
      contentHash: hash({ content, grading }),
    });
    c.set(`${p}/revisions/${revisionId}/grading/main`, {
      ...grading,
      createdAt: c.now,
    });
    c.set(p, {
      ...old,
      ...metadata,
      searchTitle: metadata.title.toLowerCase(),
      latestRevisionId: revisionId,
      revisionNumber: old.revisionNumber + 1,
      version: old.version + 1,
      updatedAt: c.now,
    });
    c.audit("problem.revision_saved", "problem", r.problemId);
    return { problemId: r.problemId, revisionId, version: old.version + 1 };
  },
  { mutation: true },
);
define(
  "forkProblem",
  "teacher",
  ["problemId", "revisionId", "title"],
  async (c, r) => {
    const original = await readProblem(c, r.problemId, r.revisionId);
    const { content, grading, problem } = original;
    return createProblemRecord(
      c,
      {
        metadata: {
          title: r.title ?? `${problem.title} (copy)`,
          subject: problem.subject,
          difficulty: problem.difficulty,
          tags: problem.tags,
          bankVisibility: "private",
        },
        content: Object.fromEntries(
          [
            "type",
            "answerMode",
            "statementLatex",
            "options",
            "defaultPoints",
            "questionAssetBindings",
          ].map((k) => [k, content[k]]),
        ),
        grading: Object.fromEntries(
          [
            "correctOptionId",
            "acceptedAnswers",
            "tolerance",
            "explanationLatex",
            "rubricLatex",
            "solutionAssetBindings",
          ].map((k) => [k, grading[k]]),
        ),
      },
      "",
      { problemId: r.problemId, revisionId: original.revisionId },
      true,
    );
  },
  { mutation: true },
);
for (const [name, event] of [
  ["setProblemSharing", "sharing_changed"],
  ["trashProblem", "trashed"],
  ["restoreProblem", "restored"],
])
  define(
    name,
    "teacher",
    ["problemId", "expectedVersion", "visibility"],
    async (c, r) => {
      const p = path("problems", r.problemId),
        old = await c.get(p);
      manage(c.actor, old);
      version(old.version, r.expectedVersion);
      const next = { ...old, version: old.version + 1, updatedAt: c.now };
      if (name === "setProblemSharing")
        next.bankVisibility = enumeration(
          r.visibility,
          ["private", "teachers"],
          "sharing",
        );
      else {
        next.lifecycle = name === "trashProblem" ? "trashed" : "active";
        next.trashedAt = name === "trashProblem" ? c.now : null;
        if (name === "restoreProblem") next.bankVisibility = "private";
      }
      c.set(p, next);
      c.audit("problem." + event, "problem", r.problemId);
      return { version: next.version };
    },
    { mutation: true },
  );
define(
  "listProblemRevisions",
  "teacher",
  ["problemId", "limit", "cursor"],
  async (c, r) => {
    const p = await c.get(path("problems", r.problemId));
    canReadProblem(c.actor, p);
    const page = await c.list(
      `problems/${r.problemId}/revisions`,
      [],
      r,
      "createdAt",
    );
    return {
      ...page,
      items: page.items.map((v) => ({
        id: v.id,
        revisionNumber: v.revisionNumber,
        createdAt: v.createdAt,
        createdBy: v.createdBy,
      })),
    };
  },
);
