export async function updateStatistics(c, before, after) {
  if (after.attemptKind !== "standard") return;
  const p = `quizzes/${after.quizId}/statistics/${after.quizRevisionId}`,
    old = (await c.get(p, false)) ?? {
      attempts: 0,
      active: 0,
      completed: 0,
      pending: 0,
      finalCount: 0,
      scoreSum: 0,
      percentageSum: 0,
      uniqueParticipants: 0,
    };
  const contribution = (a) =>
    !a
      ? {
          attempts: 0,
          active: 0,
          completed: 0,
          pending: 0,
          finalCount: 0,
          scoreSum: 0,
          percentageSum: 0,
        }
      : {
          attempts: 1,
          active: Number(a.status === "active"),
          completed: Number(["submitted", "timed_out"].includes(a.status)),
          pending: Number(a.gradeState === "pending_manual"),
          finalCount: Number(
            ["submitted", "timed_out"].includes(a.status) &&
              a.gradeState === "final",
          ),
          scoreSum:
            ["submitted", "timed_out"].includes(a.status) &&
            a.gradeState === "final"
              ? a.totals.score
              : 0,
          percentageSum:
            ["submitted", "timed_out"].includes(a.status) &&
            a.gradeState === "final"
              ? a.totals.percentage
              : 0,
        };
  const prior = contribution(before),
    next = contribution(after),
    value = { ...old };
  for (const key of Object.keys(next))
    value[key] = (value[key] ?? 0) + next[key] - prior[key];
  if (!before) {
    const seenPath = `${p}/participants/${after.studentId}`;
    if (!(await c.get(seenPath, false))) {
      c.set(seenPath, { firstAttemptAt: after.startedAt });
      value.uniqueParticipants++;
    }
  }
  c.set(p, { ...value, updatedAt: c.now });
}
