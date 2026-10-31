import {
  define,
  path,
  version,
  released,
  Timestamp,
} from "../domain/runtime.js";
import {
  id,
  assert,
  number,
  text,
  enumeration,
  studentItem,
  timestampInput,
} from "../../shared/schema.js";
import { gradeSnapshotAnswer, summarize } from "../../shared/grading.js";
import {
  authorizeAttempt,
  attemptManager,
  attemptDTO,
  expire,
} from "./attempts.js";
import { getOwnedQuiz } from "./quizzes.js";
import { updateStatistics } from "../domain/statistics.js";
export async function resultPage(c, r, staffOnly = false) {
  let a = await c.get(path("attempts", r.attemptId));
  authorizeAttempt(c, a, staffOnly);
  a = await expire(c, r.attemptId, a);
  const staff = attemptManager(c.actor, a),
    score = staff || released(a, "score", c.now),
    solutions = staff || released(a, "solutions", c.now);
  const offset = number(r.offset ?? 0, "Offset", 0, a.order.length, true),
    limit = number(r.limit ?? 10, "Page size", 1, 20, true);
  const chosen = a.order.slice(offset, offset + limit),
    items = [];
  assert(
    a.status !== "active" || staff,
    "ATTEMPT_FROZEN",
    "Submit the quiz before viewing its result.",
  );
  for (const itemId of chosen) {
    const item = await c.get(
      `quizzes/${a.quizId}/revisions/${a.quizRevisionId}/items/${itemId}`,
    );
    const answer = await c.get(
      `attempts/${r.attemptId}/answers/${itemId}`,
      false,
    );
    const grade = score
      ? await c.get(`attempts/${r.attemptId}/grades/${itemId}`, false)
      : null;
    const key = solutions
      ? await c.get(
          `quizzes/${a.quizId}/revisions/${a.quizRevisionId}/grading/${itemId}`,
        )
      : null;
    items.push({
      ...studentItem(item),
      answer: answer
        ? {
            value: answer.value,
            revision: answer.revision,
            updatedAt: answer.updatedAt,
          }
        : { value: "", revision: 0, updatedAt: null },
      grade: grade
        ? {
            status: grade.status,
            awarded: grade.awarded,
            possible: grade.possible,
            feedbackLatex: grade.feedbackLatex,
            version: grade.version,
            manualPoints: grade.manualPoints,
          }
        : null,
      solution: key
        ? {
            correctOptionId: key.correctOptionId,
            acceptedAnswers: key.acceptedAnswers,
            explanationLatex: key.explanationLatex,
            solutionAssetBindings: key.solutionAssetBindings,
            ...(staff
              ? { rubricLatex: key.rubricLatex, tolerance: key.tolerance }
              : {}),
          }
        : null,
    });
  }
  return {
    attempt: attemptDTO(c, a, r.attemptId),
    items,
    nextOffset:
      offset + chosen.length < a.order.length ? offset + chosen.length : null,
    totalItems: a.order.length,
  };
}
define("getAttemptResult", "user", ["attemptId", "offset", "limit"], (c, r) =>
  resultPage(c, r),
);
define(
  "getTeacherAttempt",
  "teacher",
  ["attemptId", "offset", "limit"],
  (c, r) => resultPage(c, r, true),
);
define(
  "getAdminAttempt",
  "admin",
  ["attemptId", "offset", "limit"],
  async (c, r) => {
    const result = await resultPage(c, r, true);
    c.audit("admin.attempt_viewed", "attempt", r.attemptId, {
      quizId: result.attempt.quizId,
      affectedUserId: result.attempt.studentId,
    });
    return result;
  },
);
export function reportFilters(r, quizId) {
  const filters = [["quizId", "==", quizId]];
  if (r.revisionId) filters.push(["quizRevisionId", "==", id(r.revisionId)]);
  if (r.studentId) filters.push(["studentId", "==", id(r.studentId)]);
  if (r.status)
    filters.push([
      "status",
      "==",
      enumeration(
        r.status,
        ["active", "submitted", "timed_out", "terminated", "abandoned"],
        "status",
      ),
    ]);
  assert(
    [r.revisionId, r.studentId, r.status].filter(Boolean).length <= 1,
    "INVALID_FIELDS",
    "Use one revision, student or status filter at a time.",
  );
  if (r.from)
    filters.push([
      "startedAt",
      ">=",
      Timestamp.fromDate(timestampInput(r.from, "start date")),
    ]);
  if (r.to)
    filters.push([
      "startedAt",
      "<=",
      Timestamp.fromDate(timestampInput(r.to, "end date")),
    ]);
  return filters;
}
define(
  "listQuizAttempts",
  "teacher",
  [
    "quizId",
    "revisionId",
    "studentId",
    "status",
    "from",
    "to",
    "limit",
    "cursor",
  ],
  async (c, r) => {
    await getOwnedQuiz(c, r.quizId);
    const page = await c.list(
      "attempts",
      reportFilters(r, r.quizId),
      r,
      "startedAt",
    );
    return { ...page, items: page.items.map((a) => attemptDTO(c, a, a.id)) };
  },
);
define(
  "listTeacherAttempts",
  "teacher",
  ["pendingOnly", "limit", "cursor"],
  async (c, r) => {
    const filters = [["quizOwnerId", "==", c.actor.uid]];
    if (r.pendingOnly) filters.push(["gradeState", "==", "pending_manual"]);
    const page = await c.list("attempts", filters, r, "startedAt");
    return { ...page, items: page.items.map((a) => attemptDTO(c, a, a.id)) };
  },
);
define(
  "saveManualGrade",
  "teacher",
  [
    "attemptId",
    "itemId",
    "points",
    "feedback",
    "reason",
    "expectedGradeVersion",
  ],
  async (c, r) => {
    const a = await c.get(path("attempts", r.attemptId));
    authorizeAttempt(c, a, true);
    assert(
      a.status !== "active" &&
        ["pending_manual", "final"].includes(a.gradeState),
      "FAILED_PRECONDITION",
      "Wait for automatic grading to finish.",
    );
    version(a.gradeVersion, r.expectedGradeVersion);
    const itemId = id(r.itemId);
    assert(
      a.order.includes(itemId),
      "RESOURCE_UNAVAILABLE",
      "Problem unavailable.",
    );
    const item = await c.get(
        `quizzes/${a.quizId}/revisions/${a.quizRevisionId}/items/${itemId}`,
      ),
      key = await c.get(
        `quizzes/${a.quizId}/revisions/${a.quizRevisionId}/grading/${itemId}`,
      );
    assert(
      item.answerMode === "manual",
      "INVALID_FIELDS",
      "This response is automatically marked.",
    );
    number(r.points, "Mark", 0, item.points);
    text(r.feedback ?? "", "Feedback", 30000);
    text(r.reason ?? "", "Reason", 500);
    const old = await c.get(`attempts/${r.attemptId}/grades/${itemId}`);
    if (old.manualPoints !== null)
      text(r.reason, "Correction reason", 500, true);
    const answer = await c.get(
      `attempts/${r.attemptId}/answers/${itemId}`,
      false,
    );
    assert(
      answer?.value?.trim(),
      "INVALID_FIELDS",
      "An unanswered problem is marked as skipped.",
    );
    const grade = {
      ...gradeSnapshotAnswer(
        item,
        key,
        answer.value,
        r.points,
        a.settingsSnapshot.penalty,
      ),
      feedbackLatex: r.feedback ?? "",
      gradedBy: c.actor.uid,
      gradingVersion: 1,
      updatedAt: c.now,
      version: old.version + 1,
    };
    const all = await c.all(`attempts/${r.attemptId}/grades`);
    const totals = summarize(all.map((g) => (g.id === itemId ? grade : g)));
    const next = {
      ...a,
      totals,
      gradeVersion: a.gradeVersion + 1,
      gradeState: totals.pending ? "pending_manual" : "final",
      finalizedAt: c.now,
    };
    c.set(`attempts/${r.attemptId}/grades/${itemId}`, grade);
    c.set(`attempts/${r.attemptId}/gradeEvents/${c.key("gre_", itemId)}`, {
      itemId,
      before: old,
      after: grade,
      reason: r.reason ?? "",
      actorId: c.actor.uid,
      occurredAt: c.now,
    });
    await updateStatistics(c, a, next);
    c.set(`attempts/${r.attemptId}`, next);
    c.audit("grade.manually_changed", "attempt", r.attemptId, {
      quizId: a.quizId,
      quizOwnerId: a.quizOwnerId,
      affectedUserId: a.studentId,
      changedFields: [itemId],
    });
    c.notify(
      a.studentId,
      "grade_updated",
      `Mark updated: ${a.quizTitle}`,
      a.quizId,
      r.attemptId,
    );
    return { gradeVersion: next.gradeVersion, grade, totals };
  },
  { mutation: true },
);
define(
  "listGradeEvents",
  "teacher",
  ["attemptId", "limit", "cursor"],
  async (c, r) => {
    const a = await c.get(path("attempts", r.attemptId));
    authorizeAttempt(c, a, true);
    return c.list(`attempts/${r.attemptId}/gradeEvents`, [], r, "occurredAt");
  },
);
define(
  "releaseResults",
  "teacher",
  ["quizId", "attemptIds", "score", "solutions"],
  async (c, r) => {
    const quiz = await getOwnedQuiz(c, r.quizId);
    assert(
      r.score === true || r.solutions === true,
      "INVALID_FIELDS",
      "Choose scores or solutions to release.",
    );
    assert(
      Array.isArray(r.attemptIds) &&
        r.attemptIds.length > 0 &&
        r.attemptIds.length <= 25 &&
        new Set(r.attemptIds).size === r.attemptIds.length,
      "INVALID_FIELDS",
      "Choose 1–25 attempts.",
    );
    for (const attemptId of r.attemptIds) {
      const a = await c.get(path("attempts", attemptId));
      assert(
        a.quizId === r.quizId && a.status !== "active",
        "RESOURCE_UNAVAILABLE",
        "An attempt is unavailable or still active.",
      );
      assert(
        !r.solutions || a.settingsSnapshot.solutionRelease !== "never",
        "INVALID_FIELDS",
        "Solutions for this revision are set to never be released.",
      );
      c.set(`attempts/${attemptId}`, {
        ...a,
        scoreReleasedAt: r.score ? c.now : a.scoreReleasedAt,
        solutionsReleasedAt: r.solutions ? c.now : a.solutionsReleasedAt,
      });
      c.audit("result.released", "attempt", attemptId, {
        quizId: r.quizId,
        quizOwnerId: quiz.ownerId,
        affectedUserId: a.studentId,
      });
      c.notify(
        a.studentId,
        "result_released",
        `Results released: ${a.quizTitle}`,
        r.quizId,
        attemptId,
      );
    }
    return { released: r.attemptIds.length };
  },
  { mutation: true },
);
define(
  "getQuizProblemStats",
  "teacher",
  ["quizId", "revisionId"],
  async (c, r) => {
    const quiz = await getOwnedQuiz(c, r.quizId),
      revisionId = id(r.revisionId ?? quiz.publishedRevisionId),
      base = `quizzes/${r.quizId}/revisions/${revisionId}`;
    const [items, found] = await Promise.all([
      c.all(`${base}/items`),
      c.all(
        "attempts",
        [
          ["quizId", "==", r.quizId],
          ["quizRevisionId", "==", revisionId],
        ],
        "startedAt",
        "desc",
        150,
      ),
    ]);
    const attempts = found
      .filter(
        (a) =>
          a.attemptKind === "standard" &&
          ["submitted", "timed_out"].includes(a.status),
      )
      .slice(0, 100);
    const stats = new Map(
      items.map((i) => [
        i.id,
        { item: i, answered: 0, correct: 0, incorrect: 0, wrong: new Map() },
      ]),
    );
    for (let i = 0; i < attempts.length; i += 10) {
      const batch = await Promise.all(
        attempts.slice(i, i + 10).map(async (a) => ({
          grades: await c.all(`attempts/${a.id}/grades`),
          answers: new Map(
            (await c.all(`attempts/${a.id}/answers`)).map((x) => [x.id, x]),
          ),
        })),
      );
      for (const { grades, answers } of batch)
        for (const g of grades) {
          const st = stats.get(g.id);
          if (!st || !["correct", "incorrect"].includes(g.status)) continue;
          st.answered++;
          if (g.status === "correct") st.correct++;
          else {
            st.incorrect++;
            const raw = String(answers.get(g.id)?.value ?? "").trim();
            if (!raw) continue;
            const opt = st.item.options?.find((o) => o.id === raw),
              label = opt ? opt.textLatex : raw.slice(0, 80);
            st.wrong.set(label, (st.wrong.get(label) ?? 0) + 1);
          }
        }
    }
    const order = (
      await c.get(`quizzes/${r.quizId}/revisions/${revisionId}`, false)
    )?.itemOrder;
    const ids = Array.isArray(order) ? order : [...stats.keys()];
    return {
      revisionId,
      attemptsConsidered: attempts.length,
      problems: ids
        .filter((k) => stats.has(k))
        .map((k, index) => {
          const st = stats.get(k);
          return {
            itemId: k,
            index: index + 1,
            statementLatex: String(st.item.statementLatex ?? "").slice(0, 200),
            type: st.item.type,
            points: st.item.points,
            answered: st.answered,
            correct: st.correct,
            percentCorrect: st.answered
              ? Math.round((st.correct / st.answered) * 1000) / 10
              : null,
            commonWrong: [...st.wrong]
              .sort((x, y) => y[1] - x[1])
              .slice(0, 3)
              .map(([answer, count]) => ({ answer, count })),
          };
        }),
    };
  },
);
define(
  "getQuizStatistics",
  "teacher",
  ["quizId", "revisionId"],
  async (c, r) => {
    const quiz = await getOwnedQuiz(c, r.quizId);
    const revisionId = id(r.revisionId ?? quiz.publishedRevisionId);
    const s = (await c.get(
      `quizzes/${r.quizId}/statistics/${revisionId}`,
      false,
    )) ?? {
      attempts: 0,
      active: 0,
      completed: 0,
      pending: 0,
      finalCount: 0,
      scoreSum: 0,
      percentageSum: 0,
      uniqueParticipants: 0,
    };
    return {
      ...s,
      revisionId,
      averageScore: s.finalCount ? s.scoreSum / s.finalCount : null,
      averagePercentage: s.finalCount ? s.percentageSum / s.finalCount : null,
      asOf: s.updatedAt ?? c.now,
      attemptKind: "standard",
    };
  },
);
define(
  "getQuizHistory",
  "teacher",
  ["quizId", "limit", "cursor"],
  async (c, r) => {
    await getOwnedQuiz(c, r.quizId);
    return c.list("auditEvents", [["quizId", "==", r.quizId]], r, "occurredAt");
  },
);
define(
  "exportQuizResults",
  "teacher",
  ["quizId", "revisionId", "studentId", "status", "from", "to"],
  async (c, r) => {
    await getOwnedQuiz(c, r.quizId);
    reportFilters(r, r.quizId);
    const input = Object.fromEntries(
      ["revisionId", "studentId", "status", "from", "to"]
        .filter((k) => r[k] !== undefined)
        .map((k) => [k, r[k]]),
    );
    return {
      jobId: await c.job("export_results", r.quizId, {
        filters: input,
        asOf: c.now,
      }),
    };
  },
  { mutation: true },
);
define(
  "exportQuizBackup",
  "teacher",
  ["quizId", "revisionId"],
  async (c, r) => {
    const quiz = await getOwnedQuiz(c, r.quizId);
    const revisionId = id(r.revisionId ?? quiz.publishedRevisionId);
    const rev = await c.get(`quizzes/${r.quizId}/revisions/${revisionId}`);
    assert(
      rev.state === "ready",
      "FAILED_PRECONDITION",
      "Publish a revision before exporting a backup.",
    );
    return { jobId: await c.job("export_quiz", r.quizId, { revisionId }) };
  },
  { mutation: true },
);

define(
  "getLegacyResponses",
  "user",
  ["attemptId", "limit", "cursor"],
  async (c, r) => {
    const a = await c.get(path("attempts", r.attemptId));
    authorizeAttempt(c, a);
    assert(
      a.provenance === "legacy_client_v1",
      "INVALID_FIELDS",
      "This is not a legacy result.",
    );
    return c.list(
      `attempts/${r.attemptId}/legacyAnswers`,
      [],
      r,
      "originalQuestionId",
      "asc",
    );
  },
);
