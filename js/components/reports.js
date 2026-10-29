import { e, badge, date, points, linkButton, icon } from "./ui.js";
export function attemptRows(items) {
  return items
    .map(
      (a) =>
        `<tr><td data-label="Student"><span class="participant">${e(a.studentDisplayName)}<small>${e(a.studentEmail || "")}</small></span></td><td data-label="Quiz">${e(a.quizTitle)}<br><small class="muted">Attempt ${a.ordinal} · ${a.attemptKind === "retry_incorrect" ? "Retry" : "Standard"}</small></td><td data-label="Status">${badge(a.status === "active" ? "In progress" : a.gradeState === "pending_manual" ? "Needs marking" : a.status, a.gradeState === "pending_manual" ? "amber" : a.status === "active" ? "blue" : "")}</td><td data-label="Score">${a.status === "active" ? "—" : a.totals?.score !== null && a.totals?.score !== undefined ? `${points(a.totals.score)} / ${points(a.totals.possible)}${a.totals.pending ? "<br><small>Provisional</small>" : ""}` : "Grading"}</td><td data-label="Started">${date(a.startedAt)}</td><td>${linkButton("Review", `results.html?id=${a.attemptId}`, "secondary small")}</td></tr>`,
    )
    .join("");
}
export const attemptTable = () =>
  '<div class="table-wrap mobile-cards"><table><thead><tr><th>Student</th><th>Quiz / attempt</th><th>Status</th><th>Score</th><th>Started</th><th><span class="sr-only">Review</span></th></tr></thead><tbody></tbody></table></div>';
export function activityRows(items) {
  return items
    .map(
      (a) =>
        `<div class="event-row"><span class="event-marker">${icon(a.action.startsWith("attempt") ? "quiz" : a.action.startsWith("access") ? "profile" : "activity")}</span><div class="event-main"><h3>${e(a.action.replaceAll(".", " · ").replaceAll("_", " "))}</h3><p>${e(a.actorId)} ${badge(a.actorRoleAtTime)} · ${e(a.targetType)} ${e(a.targetId)}</p>${a.targetType === "attempt" ? `<a class="text-link" href="results.html?id=${e(a.targetId)}">View responses ${icon("arrow")}</a>` : ""}</div><time class="event-time">${date(a.occurredAt)}</time></div>`,
    )
    .join("");
}
