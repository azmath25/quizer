import { gradeQuestion } from "./legacy-core.js";
export function gradeSnapshotAnswer(
  item,
  key,
  value,
  manualPoints = null,
  penalty = 0,
) {
  const result = gradeQuestion(
    {
      id: item.itemId,
      type: item.type,
      answerMode: item.answerMode,
      prompt: item.statementLatex,
      points: item.points,
      options: item.options.map((o) => ({ id: o.id, text: o.textLatex })),
      answer: key.correctOptionId,
      answers: key.acceptedAnswers,
      tolerance: key.tolerance,
    },
    value,
    manualPoints,
  );
  if (result.status === "incorrect") result.awarded = -penalty;
  return { ...result, possible: item.points, manualPoints };
}
export function summarize(grades) {
  const totals = {
    score: 0,
    possible: 0,
    percentage: 0,
    correct: 0,
    incorrect: 0,
    skipped: 0,
    pending: 0,
    partial: 0,
  };
  for (const g of grades) {
    totals.score += g.awarded;
    totals.possible += g.possible;
    totals[g.status]++;
  }
  totals.score = Math.round(totals.score * 1e8) / 1e8;
  totals.possible = Math.round(totals.possible * 1e8) / 1e8;
  totals.percentage = totals.possible
    ? Math.max(0, Math.min(100, (totals.score / totals.possible) * 100))
    : 0;
  return totals;
}
export function csvCell(value) {
  let s = String(value ?? "");
  if (/^[\s]*[=+@-]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
