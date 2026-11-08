import { apiSWR } from "../services/api.js";
import {
  linkButton, quizCard, empty, e, icon, badge, date, notice,
} from "../components/ui.js";

// Atlas v2. All figures below come from the existing getDashboard payload.
// No extra data requests, writes, permissions or speculative prefetches.
export async function mount(root, session) {
  await apiSWR("getDashboard", {}, (data) => draw(root, session, data));
}

function draw(root, session, data) {
  const teacher = Boolean(session.capabilities.teach);
  const signedIn = Boolean(session.user);
  const firstName = session.profile?.displayName?.trim().split(/\s+/)[0] || "";
  const attempts = Array.isArray(data.attempts) ? data.attempts : [];
  const active = attempts.filter(a => a.status === "active");
  const recent = attempts.filter(a => a.status !== "active");
  const quizzes = teacher ? (data.myQuizzes ?? []) : (data.publicQuizzes ?? []);
  const pending = teacher ? (data.marking ?? []) : [];
  const listing = teacher ? "teaching.html" : "quizzes.html";

  const subject = teacher ? "YOUR TEACHING SPACE" : signedIn ? "YOUR LEARNING SPACE" : "WELCOME TO MATH QUIZ";
  const heading = teacher
    ? 'Make room for <em>better teaching.</em>'
    : signedIn
      ? 'Make progress, <em>one problem at a time.</em>'
      : 'A clearer way to <em>practice mathematics.</em>';
  const intro = teacher
    ? "Your quizzes, problems, students and AI tools — in one focused place."
    : signedIn
      ? "Pick up where you left off, discover a quiz, and keep your progress in sight."
      : "Find a quiz, sharpen your reasoning, and return to your progress whenever you sign in.";
  const primary = teacher
    ? linkButton("Create a quiz", "upload.html", "primary", "plus")
    : linkButton("Explore quizzes", "quizzes.html", "primary", "arrow");
  const secondary = teacher
    ? linkButton("Open AI Studio", "ai.html", "secondary", "spark")
    : signedIn ? linkButton("My activity", "activity.html", "secondary", "clock")
      : linkButton("Sign in", "login.html", "secondary");
  const stats = [
    [quizzes.length, teacher ? "Your quizzes" : "Available quizzes", "quiz"],
    [active.length, "In progress", "clock"],
    [recent.length, "Recent attempts", "book"],
  ];
  const metricHtml = stats.map(([count, label, symbol]) =>
    `<div class="home-metric"><span class="home-metric-icon">${icon(symbol)}</span><div>
      <strong>${Number(count).toLocaleString()}</strong><span>${label}</span></div></div>`).join("");

  const actionLinks = teacher ? [
    ["Create a quiz", "upload.html", "plus"],
    ["Problem bank", "problems.html", "book"],
    ["AI conversations", "ai.html", "spark"],
    ["Extract a document", "ai.html?mode=job", "quiz"],
  ] : signedIn ? [
    ["Browse quizzes", "quizzes.html", "quiz"],
    ["Review attempts", "activity.html", "clock"],
    ["Saved problems", "profile.html#starred", "book"],
    ["My profile", "profile.html", "profile"],
  ] : [
    ["Browse quizzes", "quizzes.html", "quiz"],
    ["Sign in", "login.html", "profile"],
  ];
  const shortcuts = actionLinks.map(([label, url, symbol]) =>
    `<a class="home-action-link" href="${e(url)}">${icon(symbol)}
      <span>${e(label)}</span><span class="home-action-arrow">${icon("arrow")}</span></a>`).join("");

  const resume = active.length ? `<section class="home-section" aria-label="Continue unfinished quizzes">
      <div class="section-head"><h2>Pick up where you left off</h2><a href="activity.html">All activity ${icon("arrow")}</a></div>
      <div class="home-continue">${active.slice(0, 2).map(a => `
        <article class="welcome-strip">
          <div><h3>${e(a.quizTitle || "Quiz in progress")}</h3><p>Started ${date(a.startedAt)}</p></div>
          ${linkButton("Resume", `quiz.html?attempt=${encodeURIComponent(a.id)}`, "primary", "arrow")}
        </article>`).join("")}</div>
    </section>` : "";

  const quizListing = `<section class="home-section" aria-label="Quizzes">
    <div class="section-head"><h2>${teacher ? "Your latest quizzes" : "Explore quizzes"}</h2>
      <a href="${listing}">View all ${icon("arrow")}</a></div>
    ${quizzes.length ? `<div class="grid two">${quizzes.slice(0, 2)
      .map(q => quizCard(q, {management: teacher})).join("")}</div>` :
      `<div class="panel">${empty(
        teacher ? "Your first quiz starts here" : "No public quizzes yet",
        teacher ? "Create a quiz or start with a problem from your bank." : "New quizzes will appear here when published.",
        teacher ? linkButton("Create quiz", "upload.html", "primary") : ""
      )}</div>`}
  </section>`;

  const pendingHtml = pending.length ? `<section class="home-section">
    <div class="section-head"><h2>Needs your review</h2><a href="teaching.html#results">All marking ${icon("arrow")}</a></div>
    <div class="panel home-side-panel">${pending.slice(0, 3).map(a => `
      <div class="list-row"><div class="row-main"><h3>${e(a.quizTitle)}</h3>
        <p>${e(a.studentDisplayName)} · ${e(a.pending)} waiting</p></div>
        ${linkButton("Review", `results.html?id=${encodeURIComponent(a.id)}`, "secondary")}</div>
      `).join("")}</div>
  </section>` : "";

  const results = signedIn ? `<section class="home-section">
    <div class="section-head"><h2>Recent activity</h2><a href="activity.html">View history ${icon("arrow")}</a></div>
    <div class="panel home-side-panel">
      ${recent.length ? recent.slice(0, 3).map(a => `<a class="list-row" href="results.html?id=${encodeURIComponent(a.id)}">
        <div class="row-main"><h3>${e(a.quizTitle || "Quiz")}</h3><p>${date(a.startedAt)}</p></div>
        ${badge(a.gradeState === "pending_manual" ? "Marking" : a.status)}</a>`).join("")
        : '<p class="muted small">Your completed quizzes will appear here.</p>'}
      <div class="home-resource-links"><a href="profile.html#starred">Starred problems</a>
        <a href="activity.html#updates">Updates</a>
        ${session.capabilities.admin ? '<a href="admin.html">Administration</a>' : ""}</div>
    </div>
  </section>` : `<section class="home-section">
    <div class="section-head"><h2>Your progress, saved</h2></div>
    <div class="panel home-side-panel"><p class="muted">Sign in when you're ready to save your answers and see previous results.</p>
      <div style="margin-top:16px">${linkButton("Sign in", "login.html", "secondary")}</div></div>
  </section>`;

  root.innerHTML = `<div class="home-v2">
    <header class="home-hero">
      <div class="home-hero-main">
        <div class="home-eyebrow">${subject}${firstName ? ` · ${e(firstName)}` : ""}</div>
        <h1>${heading}</h1>
        <p class="home-hero-description">${intro}</p>
        <div class="home-hero-actions">${primary}${secondary}</div>
      </div>
      <div class="home-hero-side" aria-label="Quiz overview">
        <div><span class="home-side-small">${teacher ? "Your quiz library" : "Open quiz library"}</span>
          <strong>${Number(quizzes.length).toLocaleString()}</strong>
          <span>${teacher ? "Quizzes in your teaching workspace" : "Quizzes ready to explore"}</span></div>
        <div class="home-formula" aria-hidden="true">∑</div>
      </div>
    </header>
    ${signedIn && !session.user.emailVerified ?
      notice("Verify your email address before starting a quiz.", "warning") : ""}
    <div class="home-metrics" aria-label="Your workspace at a glance">${metricHtml}</div>
    <div class="home-content">
      <div class="home-feed">${resume}${quizListing}</div>
      <aside class="home-rail" aria-label="Workspace shortcuts and recent activity">
        <section class="home-section"><div class="section-head"><h2>Quick access</h2></div>
          <nav class="home-action-list" aria-label="Quick access">${shortcuts}</nav></section>
        ${pendingHtml}${results}
      </aside>
    </div>
  </div>`;
}
