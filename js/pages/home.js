import { apiSWR } from "../services/api.js";
import {
  pageHead, linkButton, quizCard, empty, e, icon, badge, date, notice,
} from "../components/ui.js";

export async function mount(root, session) {
  await apiSWR("getDashboard", {}, (data) => draw(root, session, data));
}

function draw(root, session, data) {
  const name = session.profile?.displayName?.split(" ")[0];
  const teaching = session.capabilities.teach;
  const active = (data.attempts ?? []).filter((a) => a.status === "active");
  const recent = (data.attempts ?? []).filter((a) => a.status !== "active");
  const quizzes = teaching ? data.myQuizzes : data.publicQuizzes;
  const listing = teaching ? "teaching.html" : "quizzes.html";
  const pending = teaching ? (data.marking ?? []) : [];

  const quick = teaching
    ? `<nav class="quick-links" aria-label="Teacher shortcuts">
        <a class="quick-link" href="upload.html">${icon("plus")}Create quiz</a>
        <a class="quick-link" href="problems.html">${icon("book")}Problem bank</a>
        <a class="quick-link" href="teaching.html#requests">${icon("teach")}Requests</a>
      </nav>`
    : "";

  root.innerHTML =
    pageHead(name ? `Hello, ${e(name)}` : "Home",
      "Your mathematics workspace.") +
    (!session.user
      ? `<section class="welcome-strip"><div><h2>Take a quiz. Track your results.</h2>
          <p>Sign in to save answers and progress.</p></div>
          ${linkButton("Sign in", "login.html")}</section>`
      : "") +
    (session.user && !session.user.emailVerified
      ? notice("Verify your email address before starting a quiz.", "warning")
      : "") +
    quick +
    (active.length
      ? `<section class="home-section"><div class="section-head">
          <h2>Continue</h2><a href="activity.html">All attempts</a></div>
          ${active.slice(0, 2).map(a => `<div class="welcome-strip">
             <div><h2>${e(a.quizTitle)}</h2><p>Started ${date(a.startedAt)}</p></div>
             ${linkButton("Resume", `quiz.html?attempt=${a.id}`, "primary", "arrow")}
          </div>`).join("")}</section>`
      : "") +
    `<div class="workspace-grid home-simple">
      <div class="stack">
        <section class="home-section"><div class="section-head">
          <h2>${teaching ? "Your quizzes" : "Public quizzes"}</h2>
          <a href="${listing}">View all ${icon("arrow")}</a></div>
          <div class="grid two">${(quizzes ?? []).slice(0, 2)
            .map(q => quizCard(q, {management: teaching})).join("")}</div>
          ${quizzes?.length ? "" : `<div class="panel">${empty(
            teaching ? "Create your first quiz" : "No public quizzes yet",
            teaching ? "Start from your problem bank." : "Check back for published quizzes.",
            teaching ? linkButton("Create quiz", "upload.html", "primary") : ""
          )}</div>`}
        </section>
        ${pending.length ? `<section class="home-section">
           <div class="section-head"><h2>Needs marking</h2>
             <a href="teaching.html#results">View all</a></div>
           <div class="panel">${pending.slice(0, 2).map(a => `<div class="list-row">
             <div class="row-main"><h3>${e(a.quizTitle)}</h3>
               <p>${e(a.studentDisplayName)} · ${a.pending} to mark</p></div>
             ${linkButton("Review", `results.html?id=${a.id}`, "secondary")}
           </div>`).join("")}</div>
         </section>` : ""}
      </div>
      <aside class="stack">
        ${session.user ? `<section class="panel"><div class="section-head">
          <h2>Recent results</h2><a href="activity.html">View all</a></div>
          ${recent.length ? recent.slice(0, 2).map(a => `<a class="list-row"
            href="results.html?id=${e(a.id)}"><div class="row-main">
              <h3>${e(a.quizTitle)}</h3><p>${date(a.startedAt)}</p></div>
            ${badge(a.gradeState === "pending_manual" ? "Marking" : a.status)}
          </a>`).join("") : '<p class="muted small">No results yet.</p>'}
          <div class="home-resource-links">
            <a href="profile.html#starred">Starred problems</a>
            <a href="activity.html#updates">Notifications</a>
            ${session.capabilities.admin ? '<a href="admin.html">Administration</a>' : ""}
          </div></section>`
          : `<section class="panel"><h2>Get started</h2>
              <p class="muted small">Browse quizzes, request access and solve problems.</p>
              ${linkButton("Browse quizzes", "quizzes.html", "secondary")}
            </section>`}
      </aside>
    </div>`;
}
