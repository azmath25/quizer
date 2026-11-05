import { e, duration, points, icon, pageHead, notice, linkButton } from "../components/ui.js";
import { onLeave } from "../core/router.js";

// A full-page preflight, not a modal. It NEVER creates an attempt,
// retrieves protected questions or starts the exam timer.
export function showQuizRules(root, quiz, { begin, started }) {
  let left = false;
  // The student may use main navigation while a Start request is pending.
  // Never render a late response over a different route. Any committed
  // attempt remains recoverable from its normal quiz overview.
  onLeave(() => { left = true; });
  const overview = root.querySelector(".quiz-overview");
  if (!overview) throw new Error("Quiz overview is unavailable.");
  const panel = document.createElement("section");
  panel.className = "quiz-rules";
  panel.setAttribute("aria-labelledby", "rules-title");
  const count = Number.isSafeInteger(quiz.questionCount)
    ? quiz.questionCount : "—";
  const time = duration(quiz.durationSeconds);
  const remaining = quiz.maxAttempts === null
    ? "Unlimited attempts"
    : String(Math.max(0,
      (quiz.maxAttempts ?? 0) + (quiz.extraAttempts ?? 0) -
        (quiz.attemptCount ?? 0))) + " remaining";
  panel.innerHTML =
    '<div class="rules-topline"><span class="rules-eyebrow">' +
      icon("book") + ' BEFORE YOU BEGIN</span>' +
      '<span class="rules-timer-note">' + icon("clock") +
      ' Timer not started</span></div>' +
    '<header class="rules-header"><h1 id="rules-title">' +
      e(quiz.title) + '</h1>' +
      '<p>Read the instructions. Begin when you are ready.</p></header>' +
    '<div class="rules-facts" aria-label="Quiz facts">' +
      '<div><strong>' + e(String(count)) + '</strong><span>Questions</span></div>' +
      '<div><strong>' + e(time) + '</strong><span>Time limit</span></div>' +
      '<div><strong>' + e(remaining) + '</strong><span>Attempts</span></div>' +
      '<div><strong>' + e(points(quiz.totalPoints)) +
        '</strong><span>Total points</span></div></div>' +
    '<div class="rules-content"><h2>Instructions</h2>' +
      '<ul class="rules-list">' +
      '<li>' + icon("clock") + '<span>' +
        (quiz.durationSeconds
          ? "Your timer starts after you press Begin quiz. It continues if you leave the page."
          : "This quiz has no countdown timer.") + '</span></li>' +
      '<li>' + icon("check") +
        '<span>Your answers are saved as you work. Wait for the saved confirmation before closing the tab.</span></li>' +
      '<li>' + icon("flag") +
        '<span>You may flag questions for review. Returning to previous questions depends on the teacher’s settings.</span></li>' +
      '<li>' + icon("check") +
        '<span>Submit when finished. Written responses may need teacher marking.</span></li>' +
      '</ul></div>' +
    '<div class="rules-footer">' +
      '<div class="rules-prep" role="status" aria-live="polite">' +
        icon("refresh") + '<span id="rules-prep-status">Preparing the math display…</span>' +
      '</div>' +
      '<div class="rules-actions">' +
        '<button type="button" class="button secondary" id="rules-back">Back to overview</button>' +
        '<button type="button" class="button primary" id="rules-begin">Begin quiz ' +
          icon("arrow") + '</button></div>' +
      '<p class="rules-security">Opening this screen does not use an attempt or reveal questions.</p>' +
    '</div>';
  overview.hidden = true;
  root.append(panel);
  panel.querySelector("#rules-begin").focus({ preventScroll: true });
  const status = panel.querySelector("#rules-prep-status");
  // Frontend-only preparation: do not initiate an authenticated quiz or a
  // new Firebase call. The server authorizes content only after Begin.
  Promise.all([
    document.fonts?.ready ?? Promise.resolve(),
    window.MathJax?.startup?.promise ?? Promise.resolve(),
  ]).then(() => {
    if (panel.isConnected) status.textContent =
      "Math display ready. Your timer is still stopped.";
  }).catch(() => {
    if (panel.isConnected) status.textContent =
      "You can begin. Math will finish loading with the first question.";
  });

  let starting = false;
  const beginButton = panel.querySelector("#rules-begin");
  const backButton = panel.querySelector("#rules-back");
  backButton.addEventListener("click", () => {
    if (starting) return;
    left = true;
    panel.remove();
    overview.hidden = false;
    overview.querySelector("#start")?.focus({ preventScroll: true });
  });
  beginButton.addEventListener("click", async () => {
    if (starting) return;
    starting = true;
    beginButton.disabled = true;
    backButton.disabled = true;
    status.textContent = "Starting your attempt and opening the first question…";
    let attempt;
    try {
      // The server creates the attempt and chooses the official start time.
      attempt = await begin();
      if (left || !panel.isConnected) return;
    } catch (error) {
      if (left || !panel.isConnected) return;
      starting = false;
      beginButton.disabled = false;
      backButton.disabled = false;
      status.textContent =
        "The request did not complete. If an attempt was created, reopening the quiz will resume it.";
      panel.querySelector(".rules-error")?.remove();
      const errorNode = document.createElement("div");
      errorNode.className = "rules-error";
      errorNode.setAttribute("role", "alert");
      errorNode.textContent = error?.message || "Please try again.";
      panel.querySelector(".rules-footer").prepend(errorNode);
      return;
    }
    // Once the server has started the attempt, NEVER offer a second Begin.
    // Recovery should resume this attempt, not consume another attempt.
    try {
      await started(attempt);
    } catch (error) {
      if (left) return;
      root.innerHTML = pageHead("Attempt started") +
        notice("Your attempt started, but the first problem could not be displayed. You can safely resume this same attempt.", "warning") +
        '<section class="panel"><p>' + e(error?.message || "Please retry.") +
        '</p>' + linkButton("Resume attempt",
          "quiz.html?attempt=" + encodeURIComponent(attempt.attemptId),
          "primary") + '</section>';
    }
  });
}
