import { apiSWR } from "../services/api.js";
import { mountStarred } from "../components/starred.js";
import {
  pageHead,
  linkButton,
  quizCard,
  empty,
  e,
  icon,
  badge,
  date,
  notice,
} from "../components/ui.js";
export async function mount(root, session) {
  await apiSWR("getDashboard", {}, (data) => draw(root, session, data));
}
function draw(root, session, data) {
  const name = session.profile?.displayName?.split(" ")[0];
  const active = (data.attempts ?? []).filter((a) => a.status === "active");
  const quick = session.capabilities.teach
    ? `<div class="quick-links"><a class="quick-link" href="upload.html">${icon("plus")}Create quiz</a><a class="quick-link" href="problems.html">${icon("book")}Problem bank</a><a class="quick-link" href="teaching.html#requests">${icon("teach")}Access requests</a></div>`
    : "";
  const recent = (data.attempts ?? []).filter((a) => a.status !== "active");
  root.innerHTML =
    pageHead(
      name ? `Hello, ${name}` : "Home",
      name
        ? "Your quizzes, results and teaching tools."
        : "Browse mathematics quizzes and track your progress.",
      `<span class="date-label">${new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(new Date())}</span>`,
    ) +
    (!session.user
      ? `<section class="welcome-strip"><div><h2>Take a quiz. Keep your results.</h2><p>Sign in to request access, save your answers and see your progress.</p></div>${linkButton("Sign in", "login.html")}</section>`
      : "") +
    (session.user && !session.user.emailVerified
      ? notice(
          "Verify your email address from your profile before starting a quiz.",
          "warning",
        )
      : "") +
    quick +
    (active.length
      ? `<section class="home-section"><div class="section-head"><h2>Continue your quiz</h2></div>${active.map((a) => `<div class="welcome-strip"><div><h2>${e(a.quizTitle)}</h2><p>Started ${date(a.startedAt)} · Your saved answers will be restored.</p></div>${linkButton("Resume", `quiz.html?attempt=${a.id}`, "primary", "arrow")}</div>`).join("")}</section>`
      : "") +
    `<div class="workspace-grid"><div class="stack"><section class="home-section"><div class="section-head"><h2>${session.capabilities.teach ? "Your quizzes" : "Public quizzes"}</h2><a href="${session.capabilities.teach ? "teaching" : "quizzes"}.html">View all ${icon("arrow")}</a></div><div class="grid two">${
      (session.capabilities.teach ? data.myQuizzes : data.publicQuizzes)
        ?.slice(0, 4)
        .map((q) => quizCard(q, { management: session.capabilities.teach }))
        .join("") || ""
    }</div>${!(session.capabilities.teach ? data.myQuizzes : data.publicQuizzes)?.length ? `<div class="panel">${empty(session.capabilities.teach ? "Create your first quiz" : "No public quizzes yet", session.capabilities.teach ? "Import LaTeX or choose problems from your bank." : "Published quizzes will appear here.", session.capabilities.teach ? linkButton("Create quiz", "upload.html", "primary", "plus") : "")}</div>` : ""}</section>${session.capabilities.teach ? `<section class="home-section"><div class="section-head"><h2>Needs marking</h2><a href="teaching.html#results">View results</a></div><div class="panel">${data.marking?.length ? data.marking.map((a) => `<div class="list-row"><span class="number-tile">${icon("quiz")}</span><div class="row-main"><h3>${e(a.quizTitle)}</h3><p>${e(a.studentDisplayName)} · ${a.pending} responses to mark</p></div>${linkButton("Review", `results.html?id=${a.id}`, "secondary")}</div>`).join("") : empty("No responses waiting", "Submitted written answers will appear here.")}</div></section>` : ""}</div><aside class="stack">${session.user ? `<section class="panel"><div class="section-head"><h2>Starred problems</h2><a href="profile.html#starred">View all</a></div><div id="home-stars"></div></section><section class="panel"><div class="section-head"><h2>Recent results</h2><a href="activity.html">View all</a></div>${recent.length ? recent.map((a) => `<a class="list-row" href="results.html?id=${e(a.id)}"><span class="number-tile">${icon("check")}</span><div class="row-main"><h3>${e(a.quizTitle)}</h3><p>${date(a.startedAt)}</p></div>${badge(a.gradeState === "pending_manual" ? "Marking" : a.status)}</a>`).join("") : empty("No results yet", "Your submitted quizzes will be kept here.")}</section><section class="panel"><div class="section-head"><h2>Updates</h2><a href="activity.html#updates">View all</a></div>${data.notifications?.length ? data.notifications.map((n) => `<div class="list-row"><div class="row-main"><h3>${e(n.title)}</h3><p>${date(n.createdAt)}</p></div>${!n.readAt ? badge("New", "blue") : ""}</div>`).join("") : empty("You’re up to date", "Access decisions and marking updates appear here.")}</section>` : `<section class="panel blue"><h2>How it works</h2><ol class="muted small"><li>Choose a quiz.</li><li>Sign in and request access if needed.</li><li>Answer the problems within the time limit.</li><li>View your score and released solutions.</li></ol></section>`}${session.capabilities.admin ? `<section class="panel"><div class="section-head"><h2>Administration</h2>${icon("admin")}</div><p class="muted small">Manage teachers, students and recorded activity.</p><div class="actions">${linkButton("Open admin", "admin.html", "secondary")}</div></section>` : ""}</aside></div>`;
  const stars = root.querySelector("#home-stars");
  if (stars) mountStarred(stars, { limit: 5 });
}
