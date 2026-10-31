import { go, onLeave } from "../core/router.js";
import { api } from "../services/api.js";
import { resolveImages } from "../services/assets.js";
import { getSession } from "../firebase-client.js";
import {
  pageHead,
  linkButton,
  loading,
  empty,
  e,
  badge,
  points,
  date,
  field,
  textarea,
  bindForm,
  action,
  busy,
  message,
  dialog,
  confirmDialog,
  pagination,
  icon,
} from "../components/ui.js";
import { latexHTML, typeset } from "../components/math-content.js";
export async function mount(root, session) {
  const attemptId = new URLSearchParams(location.search).get("id");
  if (!attemptId) throw new Error("A result ID is required.");
  let offset = 0,
    current,
    nextOffset = null,
    poll;
  async function load(reset = true) {
    if (reset) offset = 0;
    const actionName = session.capabilities.admin
      ? "getAdminAttempt"
      : "getAttemptResult";
    const result = await api(actionName, { attemptId, offset, limit: 10 });
    current = result.attempt;
    nextOffset = result.nextOffset;
    if (reset) {
      const a = current,
        grading =
          ["queued", "running", "not_started", "failed"].includes(
            a.gradeState,
          ) && a.status !== "active";
      root.innerHTML =
        pageHead(
          a.quizTitle,
          `${a.canGrade ? a.studentDisplayName + " · " : ""}Attempt ${a.ordinal} · ${a.attemptKind === "retry_incorrect" ? "Retry incorrect problems" : "Standard attempt"}`,
          linkButton(
            a.canGrade ? "Manage quiz" : "My activity",
            a.canGrade
              ? `quiz-manage.html?id=${a.quizId}#results`
              : "activity.html",
            "secondary",
          ),
        ) +
        `<div data-message></div><section class="result-summary">${a.status === "active" ? `<div class="notice">In progress · These are the student’s last server-saved responses. They may change before submission.</div>` : grading ? `<div class="notice">${a.gradeState === "failed" ? "Grading needs attention. The teacher can check the processing job." : "Your answers are submitted. Grading is in progress…"}</div>` : !a.scoreVisible ? '<div class="notice">Submitted · Your teacher has not released the score yet.</div>' : `<div class="score-line"><div class="score-number">${points(a.totals.score)} <small>/ ${points(a.totals.possible)}</small></div><div class="score-description"><h2>${a.gradeState === "pending_manual" ? "Provisional result" : "Result"}</h2><p>${points(a.totals.percentage)}% · ${a.gradeState === "pending_manual" ? `${a.totals.pending} written responses waiting for marking` : "Marking complete"}</p>${badge(a.status, a.status === "submitted" ? "green" : "")}</div></div><div class="stat-grid">${[["correct", "Correct"], ["incorrect", "Incorrect"], ["skipped", "Unanswered"], ["partial", "Partial credit"], ...(a.totals.pending ? [["pending", "Pending"]] : [])].map(([key, label]) => `<div class="stat"><strong>${a.totals[key]}</strong><span>${label}</span></div>`).join("")}</div>`}<p class="muted small">Started ${date(a.startedAt)} · ${a.submittedAt ? "Submitted " + date(a.submittedAt) : "Last saved " + date(a.lastSavedAt)}${a.submittedAt ? " · " + Math.max(0, Math.round((Date.parse(a.submittedAt) - Date.parse(a.startedAt)) / 60000)) + " minutes" : ""}</p>${a.provenance === "legacy_client_v1" ? '<p class="notice warning">Imported legacy result. This score was reported by the previous browser-based app; historical changes were not recorded.</p>' : ""}${a.terminationReason ? `<p class="notice warning">Teacher’s reason: ${e(a.terminationReason)}</p>` : ""}</section><div class="actions" id="result-actions">${a.canGrade && a.status !== "active" ? '<button class="button secondary" id="release-score">Release score</button><button class="button secondary" id="release-solutions">Release solutions</button><button class="button ghost" id="grade-history">Marking history</button>' : ""}${a.canGrade && a.status === "active" ? '<button class="button danger" id="terminate">End active attempt</button>' : ""}${!a.canGrade && a.provenance !== "legacy_client_v1" && a.status !== "active" && a.gradeState === "final" && a.scoreVisible ? '<button class="button secondary" id="retry">Retry incorrect / skipped</button>' : ""}<button class="button ghost" id="refresh-result">Refresh</button></div><div class="section-head"><h2>Responses</h2><span class="muted small">${result.totalItems} problems</span></div><div id="review-list"></div><button class="button secondary load-more" id="more-results" hidden>Load more responses</button>`;
      action(root, "#refresh-result", () => load());
      action(root, "#more-results", async () => {
        offset = nextOffset;
        await load(false);
      });
      action(root, "#retry", async () => {
        const next = await api("startAttempt", {
          quizId: a.quizId,
          sourceAttemptId: attemptId,
        });
        go(`quiz.html?attempt=${next.attemptId}`);
      });
      for (const kind of ["score", "solutions"])
        action(root, "#release-" + kind, async () => {
          if (
            !(await dialog({
              title: `Release ${kind}?`,
              body: "<p>The student will be able to see this information. Already viewed information cannot be taken back.</p>",
              confirm: "Release",
            }))
          )
            return;
          await api("releaseResults", {
            quizId: a.quizId,
            attemptIds: [attemptId],
            [kind]: true,
          });
          message(
            root,
            `${kind === "score" ? "Score" : "Solutions"} released.`,
            "success",
          );
        });
      action(root, "#terminate", async () => {
        const values = await dialog({
          title: "End active attempt",
          body: textarea(
            "Reason shown to the student",
            "reason",
            "",
            'required maxlength="500"',
          ),
          confirm: "End attempt",
          danger: true,
        });
        if (!values) return;
        await api("endActiveAttempt", {
          quizId: a.quizId,
          attemptId,
          reason: values.get("reason"),
        });
        await load();
      });
      action(root, "#grade-history", async () => {
        const events = await api("listGradeEvents", { attemptId, limit: 100 });
        await dialog({
          title: "Marking history",
          body: events.items.length
            ? events.items
                .map(
                  (v) =>
                    `<div class="history-row"><p>${date(v.occurredAt)} · ${e(v.actorId)}</p><p>${points(v.before.awarded)} → ${points(v.after.awarded)} points</p><p>${e(v.reason || "Initial marking")}</p></div>`,
                )
                .join("")
            : empty("No manual changes"),
          confirm: "Close",
        });
      });
      if (grading && a.gradeState !== "failed") {
        clearTimeout(poll);
        poll = setTimeout(() => load().catch(() => {}), 2500);
      } else clearTimeout(poll);
    }
    const list = root.querySelector("#review-list");
    if (current.provenance === "legacy_client_v1" && reset) {
      list.innerHTML =
        '<p class="notice">The original problem version is unknown. These are the response values preserved by the previous app; no change history is available.</p>';
      if (current.legacyAnswersOmitted)
        list.insertAdjacentHTML(
          "beforeend",
          '<p class="notice warning">The old app omitted response text from this large result.</p>',
        );
      const legacy = await api("getLegacyResponses", { attemptId, limit: 100 });
      list.insertAdjacentHTML(
        "beforeend",
        legacy.items
          .map(
            (r) =>
              `<section class="panel review-question"><h3>Original problem ID: ${e(r.originalQuestionId)}</h3><pre>${e(r.value)}</pre></section>`,
          )
          .join(""),
      );
    }
    for (const [i, item] of result.items.entries()) {
      const images = await resolveImages(
        {
          ...item.questionAssetBindings,
          ...item.solution?.solutionAssetBindings,
        },
        { kind: "result", id: attemptId },
      );
      const row = document.createElement("article");
      row.className = "panel review-question";
      const choiceAnswer =
        item.type === "choice"
          ? item.options.find((o) => o.id === item.answer.value)?.textLatex
          : null;
      row.innerHTML = `<div class="question-meta"><strong>PROBLEM ${offset + i + 1}</strong><div class="actions">${item.grade ? badge(item.grade.status, item.grade.status === "correct" ? "green" : item.grade.status === "incorrect" ? "red" : "amber") : ""}<span>${item.grade ? points(item.grade.awarded) + " / " : ""}${points(item.points)} points</span></div></div><div class="math-content">${latexHTML(item.statementLatex, images)}</div>${item.type === "choice" ? `<ol class="preview-options">${item.options.map((o, i) => `<li class="math-content">${String.fromCharCode(65 + i)}. ${latexHTML(o.textLatex, images)}</li>`).join("")}</ol>` : ""}<div class="review-answer"><div class="label">${current.status === "active" ? "Last saved response" : "Submitted response"}</div><div class="math-content">${latexHTML(choiceAnswer ?? item.answer.value, images) || '<span class="muted">Unanswered</span>'}</div></div><div class="actions"><span class="muted small">${item.answer.updatedAt ? "Saved " + date(item.answer.updatedAt) : "No saved response"}</span><button class="button ghost small" data-history>Change history</button></div>${item.grade?.feedbackLatex ? `<div class="notice"><strong>Teacher feedback</strong><div class="math-content">${latexHTML(item.grade.feedbackLatex)}</div></div>` : ""}${item.solution ? `<details class="answer-key"><summary>Answer and solution</summary>${item.type === "choice" ? `<p class="math-content">${latexHTML(item.options.find((o) => o.id === item.solution.correctOptionId)?.textLatex || "", images)}</p>` : `<p>${e(item.solution.acceptedAnswers.join(" or "))}</p>`}<div class="math-content">${latexHTML(item.solution.explanationLatex, images)}</div>${item.solution.rubricLatex ? `<h3>Marking rubric</h3><div class="math-content">${latexHTML(item.solution.rubricLatex, images)}</div>` : ""}</details>` : ""}${current.canGrade && current.status !== "active" && ["pending_manual", "final"].includes(current.gradeState) && item.answerMode === "manual" && item.answer.value.trim() ? `<form class="manual-grade stack"><h3>${item.grade?.manualPoints !== null ? "Correct this mark" : "Mark written response"}</h3><div class="form-grid">${field("Points", "points", "number", item.grade?.manualPoints ?? "", 'required min="0" max="' + item.points + '" step="any"')}${field("Correction reason", "reason", "text", "", 'maxlength="500" ' + (item.grade?.manualPoints !== null ? "required" : ""))}</div>${textarea("Feedback to student", "feedback", item.grade?.feedbackLatex || "", 'maxlength="30000" rows="3"')}<div data-message></div><div><button class="button primary">Save mark</button></div></form>` : ""}`;
      list.append(row);
      await typeset(row);
      action(row, "[data-history]", async () => {
        const history = await api("getAnswerHistory", {
          attemptId,
          itemId: item.itemId,
          limit: 100,
        });
        await dialog({
          title: "Saved response history",
          body: history.items.length
            ? history.items
                .map(
                  (h) =>
                    `<div class="history-row"><p>Save ${h.revision} · ${date(h.savedAt)}</p><pre>${e(item.type === "choice" ? (item.options.find((o) => o.id === h.value)?.textLatex ?? h.value) : h.value || "(empty)")}</pre></div>`,
                )
                .join("")
            : empty("No saved changes"),
          confirm: "Close",
        });
      });
      const form = row.querySelector("form");
      if (form)
        bindForm(form, async (values) => {
          await api("saveManualGrade", {
            attemptId,
            itemId: item.itemId,
            points: Number(values.get("points")),
            feedback: values.get("feedback"),
            reason: values.get("reason"),
            expectedGradeVersion: current.gradeVersion,
          });
          await load();
        });
    }
    root.querySelector("#more-results").hidden = nextOffset === null;
  }
  await load();
  const stopPoll = () => clearTimeout(poll);
  document.addEventListener("session-cleared", stopPoll, { once: true });
  onLeave(() => {
    stopPoll();
    document.removeEventListener("session-cleared", stopPoll);
  });
}
