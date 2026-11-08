import { apiSWR } from "../services/api.js";
import { linkButton, quizCard, empty, e, icon, badge, date, notice } from "../components/ui.js";

// The home page is a dashboard, not a second navigation menu.
// Keep one dashboard request, all previous data, and capability-checked links.
export async function mount(root, session) {
  await apiSWR("getDashboard", {}, data => draw(root, session, data));
}

function draw(root, session, data) {
  const teacher = Boolean(session.capabilities.teach);
  const signedIn = Boolean(session.user);
  const name = session.profile?.displayName?.trim().split(/\s+/)[0] || "";
  const attempts = Array.isArray(data.attempts) ? data.attempts : [];
  const active = attempts.filter(a => a.status === "active");
  const recent = attempts.filter(a => a.status !== "active");
  const quizzes = teacher ? (data.myQuizzes ?? []) : (data.publicQuizzes ?? []);
  const pending = teacher ? (data.marking ?? []) : [];
  const listing = teacher ? "teaching.html" : "quizzes.html";
  const title = signedIn
    ? (name ? `Welcome back, ${e(name)}.` : "Your workspace")
    : "Practice mathematics.";
  const intro = teacher
    ? "Continue your work, review submissions, or prepare a new quiz."
    : signedIn
      ? "Continue a quiz or review your recent results."
      : "Choose a quiz to get started. Sign in to save your progress.";
  const primary = teacher
    ? linkButton("Create quiz", "upload.html", "primary", "plus")
    : signedIn ? "" : linkButton("Browse quizzes", "quizzes.html", "primary", "arrow");

  const resume = active.length ? `<section class="home-section">
    <div class="section-head"><h2>Continue</h2><a href="activity.html">All attempts ${icon("arrow")}</a></div>
    <div class="home-continue">${active.slice(0, 2).map(a => `
      <article class="welcome-strip"><div><h3>${e(a.quizTitle || "Quiz in progress")}</h3>
        <p>Started ${date(a.startedAt)}</p></div>
        ${linkButton("Resume", `quiz.html?attempt=${encodeURIComponent(a.id)}`, "primary", "arrow")}
      </article>`).join("")}</div>
  </section>` : "";

  const quizCards = `<section class="home-section">
    <div class="section-head">
      <h2>${teacher ? "Your quizzes" : "Available quizzes"}</h2>
      <a href="${listing}">View all ${icon("arrow")}</a>
    </div>
    ${quizzes.length ? `<div class="grid two">${quizzes.slice(0, 2)
      .map(q => quizCard(q, {management: teacher})).join("")}</div>`
    : `<div class="panel">${empty(
        teacher ? "Create your first quiz" : "No quizzes yet",
        teacher ? "Start from your problem bank or a new set of questions."
          : "Published quizzes will appear here.",
        teacher ? linkButton("Create quiz", "upload.html", "primary") : ""
      )}</div>`}
  </section>`;

  const needsMarking = pending.length ? `<section class="home-section">
    <div class="section-head"><h2>Needs marking</h2><a href="teaching.html#results">Review all</a></div>
    <div class="panel home-side-panel">${pending.slice(0, 3).map(a => `
      <div class="list-row"><div class="row-main">
        <h3>${e(a.quizTitle || "Quiz")}</h3>
        <p>${e(a.studentDisplayName || "Student")} · ${e(a.pending)} awaiting review</p></div>
        ${linkButton("Review", `results.html?id=${encodeURIComponent(a.id)}`, "secondary")}
      </div>`).join("")}</div>
  </section>` : "";

  const activity = signedIn ? `<section class="home-section">
    <div class="section-head"><h2>Recent results</h2><a href="activity.html">All activity</a></div>
    <div class="panel home-side-panel">
      ${recent.length ? recent.slice(0, 3).map(a => `
        <a class="list-row" href="results.html?id=${encodeURIComponent(a.id)}">
          <div class="row-main"><h3>${e(a.quizTitle || "Quiz")}</h3>
            <p>${date(a.startedAt)}</p></div>
          ${badge(a.gradeState === "pending_manual" ? "Marking" : a.status)}
        </a>`).join("") : '<p class="muted small">Your results will appear after you complete a quiz.</p>'}
    </div>
  </section>` : `<section class="home-section">
    <div class="section-head"><h2>Save your progress</h2></div>
    <div class="panel home-side-panel">
      <p class="muted small">Sign in to save quiz attempts and see previous results.</p>
      <div class="home-signin">${linkButton("Sign in", "login.html", "secondary")}</div>
    </div>
  </section>`;

  root.innerHTML = `<div class="home-v2 home-ordered">
    <header class="home-intro">
      <div><h1>${title}</h1><p>${intro}</p></div>
      ${primary ? `<div class="home-intro-action">${primary}</div>` : ""}
    </header>
    ${signedIn && !session.user.emailVerified
      ? notice("Verify your email address before starting a quiz.", "warning") : ""}
    <div class="home-content">
      <div class="home-feed">${resume}${quizCards}</div>
      <aside class="home-rail" aria-label="Progress and items needing attention">
        ${needsMarking}${activity}
      </aside>
    </div>
  </div>`;
}
