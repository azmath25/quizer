import { randomInt } from "node:crypto";
import {
  define,
  requireRole,
  path,
  version,
  millis,
  Timestamp,
  admission,
  released,
  manage,
} from "../domain/runtime.js";
import {
  assert,
  id,
  text,
  number,
  fields,
  studentItem,
  byteSize,
} from "../../shared/schema.js";
import { participant } from "./access.js";
import { updateStatistics } from "../domain/statistics.js";
export function attemptManager(actor, a) {
  return (
    !!actor?.emailVerified &&
    ["teacher", "admin"].includes(actor.role) &&
    (a.quizOwnerId === actor.uid || actor.role === "admin")
  );
}
export function authorizeAttempt(c, a, manageOnly = false) {
  requireRole(c.actor, "user");
  assert(
    manageOnly
      ? attemptManager(c.actor, a)
      : a.studentId === c.actor.uid || attemptManager(c.actor, a),
    "RESOURCE_UNAVAILABLE",
    "This attempt is unavailable.",
  );
}
export function attemptDTO(c, a, attemptId) {
  const score = released(a, "score", c.now),
    staff = attemptManager(c.actor, a);
  return {
    attemptId,
    quizId: a.quizId,
    quizTitle: a.quizTitle,
    quizRevisionId: a.quizRevisionId,
    ordinal: a.ordinal,
    attemptKind: a.attemptKind,
    sourceAttemptId: a.sourceAttemptId,
    status: a.status,
    gradeState: a.gradeState,
    startedAt: a.startedAt,
    deadlineAt: a.deadlineAt,
    submittedAt: a.submittedAt,
    lastSavedAt: a.lastSavedAt,
    currentFrontier: a.currentFrontier,
    uiState: a.uiState,
    order: a.order,
    optionOrder: a.optionOrder,
    settings: {
      durationSeconds: a.settingsSnapshot.durationSeconds,
      allowBack: a.settingsSnapshot.allowBack,
      penalty: a.settingsSnapshot.penalty,
    },
    answeredCount: a.answeredCount,
    answeredItemIds: a.answeredItemIds ?? [],
    answerVersion: a.answerVersion,
    gradeVersion: a.gradeVersion,
    scoreVisible: score || staff,
    solutionsVisible: released(a, "solutions", c.now) || staff,
    totals: score || staff ? a.totals : { possible: a.totals.possible },
    provenance: a.provenance,
    legacySnapshotUnknown: a.legacySnapshotUnknown ?? false,
    legacyAnswersOmitted: a.legacyAnswersOmitted ?? false,
    terminationReason: a.terminationReason,
    canGrade: staff,
    studentDisplayName: a.studentDisplayName,
    ...(staff ? { studentId: a.studentId, studentEmail: a.studentEmail } : {}),
  };
}
export async function freeze(
  c,
  attemptId,
  a,
  status = "submitted",
  reason = null,
) {
  if (a.status !== "active") return a;
  const timed = a.deadlineAt && millis(c.now) >= millis(a.deadlineAt);
  if (timed && status === "submitted") status = "timed_out";
  const jobId = await c.job("grade_attempt", attemptId, {});
  const next = {
    ...a,
    status,
    gradeState: "queued",
    submittedAt: status === "timed_out" ? a.deadlineAt : c.now,
    terminationReason: reason,
    gradingJobId: jobId,
  };
  const p = `quizzes/${a.quizId}/participants/${a.studentId}`,
    part = await c.get(p, false);
  if (part?.activeAttemptId === attemptId)
    c.set(p, {
      ...part,
      activeAttemptId: null,
      version: part.version + 1,
      updatedAt: c.now,
    });
  await updateStatistics(c, a, next);
  c.set(`attempts/${attemptId}`, next);
  c.audit("attempt." + status, "attempt", attemptId, {
    quizId: a.quizId,
    quizOwnerId: a.quizOwnerId,
    affectedUserId: a.studentId,
  });
  return next;
}
export async function expire(c, attemptId, a) {
  if (
    a.status === "active" &&
    a.deadlineAt &&
    millis(c.now) >= millis(a.deadlineAt)
  )
    return freeze(c, attemptId, a, "timed_out");
  return a;
}
function shuffle(values) {
  const arr = [...values];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
define(
  "startAttempt",
  "verified",
  ["quizId", "sourceAttemptId"],
  async (c, r) => {
    const quiz = await c.get(path("quizzes", r.quizId)),
      pp = `quizzes/${r.quizId}/participants/${c.actor.uid}`;
    let part = await c.get(pp, false);
    if (part?.activeAttemptId) {
      let existing = await c.get(`attempts/${part.activeAttemptId}`, false);
      if (existing) {
        existing = await expire(c, part.activeAttemptId, existing);
        if (existing.status === "active")
          return attemptDTO(c, existing, part.activeAttemptId);
      }
      part = await c.get(pp, false);
    }
    admission(quiz, part, c.actor, c.now);
    const revision = await c.get(
      `quizzes/${r.quizId}/revisions/${quiz.publishedRevisionId}`,
    );
    assert(
      revision.state === "ready",
      "RESOURCE_UNAVAILABLE",
      "This quiz is unavailable.",
    );
    let selected = [...revision.itemOrder],
      revisionId = quiz.publishedRevisionId,
      settings = revision.settings,
      total = revision.totalPoints;
    if (r.sourceAttemptId) {
      const source = await c.get(path("attempts", r.sourceAttemptId));
      assert(
        source.studentId === c.actor.uid &&
          source.quizId === r.quizId &&
          released(source, "score", c.now) &&
          source.gradeState === "final",
        "RESOURCE_UNAVAILABLE",
        "A released, fully marked result is required.",
      );
      const grades = await c.all(`attempts/${r.sourceAttemptId}/grades`);
      selected = source.order.filter((i) =>
        grades.some(
          (g) => g.id === i && ["incorrect", "skipped"].includes(g.status),
        ),
      );
      assert(
        selected.length > 0,
        "FAILED_PRECONDITION",
        "There are no incorrect or skipped problems to retry.",
      );
      revisionId = source.quizRevisionId;
      settings = source.settingsSnapshot;
      total = null;
    }
    const itemPath = (itemId) =>
      `quizzes/${r.quizId}/revisions/${revisionId}/items/${itemId}`;
    const itemDocs = new Map(
      await Promise.all(
        selected.map(async (itemId) => [itemId, await c.get(itemPath(itemId))]),
      ),
    );
    if (total === null)
      total = selected.reduce((sum, itemId) => sum + itemDocs.get(itemId).points, 0);
    const order = settings.shuffleQuestions ? shuffle(selected) : selected,
      optionOrder = {};
    for (const itemId of order) {
      const ids = itemDocs.get(itemId).options.map((o) => o.id);
      optionOrder[itemId] = settings.shuffleOptions ? shuffle(ids) : ids;
    }
    const profile = await c.get(`users/${c.actor.uid}`, false),
      attemptId = c.key("att_", r.quizId);
    const times = [
        settings.durationSeconds
          ? millis(c.now) + settings.durationSeconds * 1000
          : Infinity,
        quiz.closesAt ? millis(quiz.closesAt) : Infinity,
      ],
      end = Math.min(...times);
    const a = {
      schemaVersion: 2,
      studentId: c.actor.uid,
      studentDisplayName: profile?.displayName ?? c.actor.displayName,
      studentEmail: c.actor.email,
      quizId: r.quizId,
      quizOwnerId: quiz.ownerId,
      quizRevisionId: revisionId,
      quizTitle: revision.title,
      ordinal: (part?.attemptCount ?? 0) + 1,
      attemptKind: r.sourceAttemptId ? "retry_incorrect" : "standard",
      sourceAttemptId: r.sourceAttemptId ?? null,
      status: "active",
      gradeState: "not_started",
      startedAt: c.now,
      deadlineAt: Number.isFinite(end) ? Timestamp.fromMillis(end) : null,
      closedAtSnapshot: quiz.closesAt,
      submittedAt: null,
      finalizedAt: null,
      lastSavedAt: null,
      currentFrontier: 0,
      uiState: { currentIndex: 0, flaggedItemIds: [], version: 0 },
      order,
      optionOrder,
      settingsSnapshot: settings,
      answeredCount: 0,
      answeredItemIds: [],
      answerVersion: 0,
      gradeVersion: 0,
      scoreReleasedAt: null,
      solutionsReleasedAt: null,
      terminationReason: null,
      provenance: "server_v2",
      totals: {
        score: null,
        possible: total,
        percentage: null,
        correct: 0,
        incorrect: 0,
        skipped: 0,
        pending: 0,
        partial: 0,
      },
    };
    await updateStatistics(c, null, a);
    c.set(`attempts/${attemptId}`, a);
    c.set(pp, {
      ...(part ?? participant(c, r.quizId, quiz)),
      displayName: a.studentDisplayName,
      email: a.studentEmail,
      attemptCount: a.ordinal,
      activeAttemptId: attemptId,
      latestAttemptId: attemptId,
      version: (part?.version ?? 0) + 1,
      updatedAt: c.now,
    });
    c.audit("attempt.started", "attempt", attemptId, {
      quizId: r.quizId,
      quizOwnerId: quiz.ownerId,
      affectedUserId: c.actor.uid,
    });
    return attemptDTO(c, a, attemptId);
  },
  { mutation: true },
);
define("getAttempt", "user", ["attemptId"], async (c, r) => {
  let a = await c.get(path("attempts", r.attemptId));
  authorizeAttempt(c, a);
  a = await expire(c, r.attemptId, a);
  return attemptDTO(c, a, r.attemptId);
});
define(
  "getAttemptQuestions",
  "user",
  ["attemptId", "itemIds"],
  async (c, r) => {
    let a = await c.get(path("attempts", r.attemptId));
    authorizeAttempt(c, a);
    a = await expire(c, r.attemptId, a);
    assert(
      a.status === "active",
      "ATTEMPT_FROZEN",
      "This attempt has ended. Open its result.",
    );
    assert(
      Array.isArray(r.itemIds) &&
        r.itemIds.length > 0 &&
        r.itemIds.length <= 20,
      "INVALID_FIELDS",
      "Request 1–20 problems.",
    );
    const items = [];
    let bytes = 0;
    for (const itemId of r.itemIds) {
      id(itemId);
      const index = a.order.indexOf(itemId);
      assert(
        index >= 0 &&
          (a.settingsSnapshot.allowBack ||
            index === a.currentFrontier ||
            attemptManager(c.actor, a)),
        "RESOURCE_UNAVAILABLE",
        "This problem is unavailable.",
      );
      const item = studentItem(
        await c.get(
          `quizzes/${a.quizId}/revisions/${a.quizRevisionId}/items/${itemId}`,
        ),
      );
      const answer = await c.get(
        `attempts/${r.attemptId}/answers/${itemId}`,
        false,
      );
      const row = {
        ...item,
        answer: answer
          ? {
              value: answer.value,
              revision: answer.revision,
              updatedAt: answer.updatedAt,
            }
          : { value: "", revision: 0, updatedAt: null },
      };
      const size = byteSize(row);
      if (bytes + size > 1000000 && items.length) break;
      bytes += size;
      items.push(row);
    }
    return { items, remainingItemIds: r.itemIds.slice(items.length) };
  },
);
define(
  "saveAnswers",
  "verified",
  ["attemptId", "expectedAnswerVersion", "changes"],
  async (c, r) => {
    const p = path("attempts", r.attemptId),
      a = await c.get(p);
    assert(
      a.studentId === c.actor.uid,
      "RESOURCE_UNAVAILABLE",
      "This attempt is unavailable.",
    );
    assert(a.status === "active", "ATTEMPT_FROZEN", "This attempt has ended.");
    assert(
      !a.deadlineAt || millis(c.now) < millis(a.deadlineAt),
      "ATTEMPT_EXPIRED",
      "Time has ended. Only previously saved answers will be marked.",
    );
    version(a.answerVersion, r.expectedAnswerVersion);
    assert(
      Array.isArray(r.changes) &&
        r.changes.length > 0 &&
        r.changes.length <= 20 &&
        byteSize(r.changes) <= 262144,
      "INVALID_FIELDS",
      "Save at most 20 responses and 256 KiB at once.",
    );
    await c.rate("answer_save", 120, 60000);
    const seen = new Set(),
      confirmed = [];
    let count = a.answeredCount,
      changed = false;
    const answeredIds = new Set(a.answeredItemIds ?? []);
    for (const change of r.changes) {
      fields(change, ["itemId", "value", "expectedRevision"], "answer");
      const itemId = id(change.itemId);
      assert(!seen.has(itemId), "INVALID_FIELDS", "Duplicate response.");
      seen.add(itemId);
      const index = a.order.indexOf(itemId);
      assert(
        index >= 0 &&
          (a.settingsSnapshot.allowBack || index === a.currentFrontier),
        "INVALID_FIELDS",
        "You cannot change that problem now.",
      );
      const item = await c.get(
        `quizzes/${a.quizId}/revisions/${a.quizRevisionId}/items/${itemId}`,
      );
      text(
        change.value,
        "Response",
        item.type === "choice"
          ? 128
          : item.answerMode === "manual"
            ? 10000
            : 500,
      );
      assert(
        item.type !== "choice" ||
          change.value === "" ||
          item.options.some((o) => o.id === change.value),
        "INVALID_FIELDS",
        "Choose a valid option.",
      );
      const ap = `${p}/answers/${itemId}`,
        old = await c.get(ap, false);
      version(old?.revision ?? 0, change.expectedRevision);
      if ((old?.value ?? "") === change.value) {
        confirmed.push({
          itemId,
          revision: old?.revision ?? 0,
          savedAt: old?.updatedAt ?? null,
        });
        continue;
      }
      const revision = (old?.revision ?? 0) + 1;
      const next = {
        value: change.value,
        revision,
        updatedAt: c.now,
        lastRequestId: c.requestId,
        updatedBy: c.actor.uid,
      };
      c.set(ap, next);
      c.set(`${ap}/changes/${String(revision).padStart(8, "0")}`, {
        value: change.value,
        revision,
        savedAt: c.now,
        actorId: c.actor.uid,
        requestId: c.requestId,
      });
      count += Number(!!change.value.trim()) - Number(!!old?.value?.trim());
      if (change.value.trim()) answeredIds.add(itemId);
      else answeredIds.delete(itemId);
      confirmed.push({ itemId, revision, savedAt: c.now });
      changed = true;
    }
    if (changed) {
      c.set(p, {
        ...a,
        answeredCount: count,
        answeredItemIds: [...answeredIds],
        answerVersion: a.answerVersion + 1,
        lastSavedAt: c.now,
      });
      c.audit("attempt.answers_saved", "attempt", r.attemptId, {
        quizId: a.quizId,
        quizOwnerId: a.quizOwnerId,
        affectedUserId: a.studentId,
        changedFields: [...seen],
      });
    }
    return {
      answerVersion: a.answerVersion + (changed ? 1 : 0),
      answeredCount: count,
      answeredItemIds: [...answeredIds],
      confirmed,
      savedAt: changed ? c.now : a.lastSavedAt,
    };
  },
  { mutation: true },
);
define(
  "navigateAttempt",
  "verified",
  ["attemptId", "targetIndex"],
  async (c, r) => {
    const p = path("attempts", r.attemptId),
      a = await c.get(p);
    assert(
      a.studentId === c.actor.uid && a.status === "active",
      "ATTEMPT_FROZEN",
      "This attempt is unavailable or has ended.",
    );
    assert(
      !a.deadlineAt || millis(c.now) < millis(a.deadlineAt),
      "ATTEMPT_EXPIRED",
      "Time has ended.",
    );
    number(r.targetIndex, "Problem number", 0, a.order.length - 1, true);
    assert(
      a.settingsSnapshot.allowBack ||
        r.targetIndex === a.currentFrontier ||
        r.targetIndex === a.currentFrontier + 1,
      "INVALID_FIELDS",
      "You can only continue to the next problem.",
    );
    const currentFrontier = Math.max(a.currentFrontier, r.targetIndex),
      uiState = {
        ...a.uiState,
        currentIndex: r.targetIndex,
        version: a.uiState.version + 1,
      };
    c.set(p, { ...a, currentFrontier, uiState });
    return { currentFrontier, uiState };
  },
  { mutation: true },
);
define(
  "saveAttemptUiState",
  "verified",
  ["attemptId", "index", "flags", "expectedUiVersion"],
  async (c, r) => {
    const p = path("attempts", r.attemptId),
      a = await c.get(p);
    assert(
      a.studentId === c.actor.uid && a.status === "active",
      "ATTEMPT_FROZEN",
      "This attempt is unavailable or has ended.",
    );
    assert(
      !a.deadlineAt || millis(c.now) < millis(a.deadlineAt),
      "ATTEMPT_EXPIRED",
      "Time has ended.",
    );
    version(a.uiState.version, r.expectedUiVersion);
    number(r.index, "Problem number", 0, a.order.length - 1, true);
    assert(
      a.settingsSnapshot.allowBack || r.index === a.currentFrontier,
      "INVALID_FIELDS",
      "You cannot return to that problem.",
    );
    assert(
      Array.isArray(r.flags) &&
        r.flags.length <= a.order.length &&
        r.flags.every((i) => a.order.includes(i)),
      "INVALID_FIELDS",
      "Invalid flags.",
    );
    const uiState = {
      currentIndex: r.index,
      flaggedItemIds: [...new Set(r.flags)],
      version: a.uiState.version + 1,
    };
    c.set(p, { ...a, uiState });
    return uiState;
  },
  { mutation: true },
);
for (const [name, status] of [
  ["submitAttempt", "submitted"],
  ["abandonAttempt", "abandoned"],
])
  define(
    name,
    "user",
    ["attemptId"],
    async (c, r) => {
      let a = await c.get(path("attempts", r.attemptId));
      assert(
        a.studentId === c.actor.uid,
        "RESOURCE_UNAVAILABLE",
        "This attempt is unavailable.",
      );
      a = await freeze(c, r.attemptId, a, status);
      return {
        ...attemptDTO(c, a, r.attemptId),
        jobId: a.gradingJobId ?? null,
      };
    },
    { mutation: true },
  );
define(
  "endActiveAttempt",
  "teacher",
  ["quizId", "attemptId", "reason"],
  async (c, r) => {
    let a = await c.get(path("attempts", r.attemptId));
    authorizeAttempt(c, a, true);
    assert(
      a.quizId === r.quizId,
      "RESOURCE_UNAVAILABLE",
      "This attempt is unavailable.",
    );
    text(r.reason, "Reason", 500, true);
    a = await freeze(c, r.attemptId, a, "terminated", r.reason);
    return attemptDTO(c, a, r.attemptId);
  },
  { mutation: true },
);
define(
  "listMyAttempts",
  "user",
  ["quizId", "status", "limit", "cursor"],
  async (c, r) => {
    const filters = [["studentId", "==", c.actor.uid]];
    if (r.quizId) filters.push(["quizId", "==", id(r.quizId)]);
    if (r.status) {
      assert(
        [
          "active",
          "submitted",
          "timed_out",
          "terminated",
          "abandoned",
        ].includes(r.status),
        "INVALID_FIELDS",
        "Invalid status.",
      );
      filters.push(["status", "==", r.status]);
    }
    const page = await c.list("attempts", filters, r, "startedAt");
    return { ...page, items: page.items.map((a) => attemptDTO(c, a, a.id)) };
  },
);
define(
  "getAnswerHistory",
  "user",
  ["attemptId", "itemId", "limit", "cursor"],
  async (c, r) => {
    const a = await c.get(path("attempts", r.attemptId));
    authorizeAttempt(c, a);
    assert(
      a.order.includes(id(r.itemId)),
      "RESOURCE_UNAVAILABLE",
      "This problem is unavailable.",
    );
    return c.list(
      `attempts/${r.attemptId}/answers/${r.itemId}/changes`,
      [],
      r,
      "savedAt",
    );
  },
);
