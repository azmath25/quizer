import {
  initFirebase,
  getSession,
  watchSession,
  logout,
} from "./firebase-client.js";
import { mountShell } from "./components/shell.js";
import {
  loading,
  pageHead,
  empty,
  linkButton,
  notice,
} from "./components/ui.js";
import { loginURL } from "./core/navigation.js";
import { startRouter, go, isStale, loadModule, setWarmer } from "./core/router.js";
import { warm } from "./services/api.js";
const pages = {
  home: "guest",
  catalog: "guest",
  login: "guest",
  profile: "user",
  activity: "user",
  teaching: "teacher",
  "quiz-manage": "teacher",
  problems: "teacher",
  "problem-edit": "teacher",
  "quiz-editor": "teacher",
  quiz: "guest",
  results: "user",
  access: "guest",
  admin: "admin",
  guide: "teacher",
};
const main = document.querySelector("main");
mountShell();
main.innerHTML = loading("Opening your workspace…");
await initFirebase();
let page = "",
  session = getSession(),
  mounted = false,
  waitingForPermissions = false;
function roleSettled() {
  const s = getSession();
  if (!s.user || s.roleResolved || s.status === "error") return Promise.resolve();
  return new Promise((done) => {
    const stop = watchSession((n) => {
      if (!n.user || n.roleResolved || n.status === "error") {
        queueMicrotask(() => stop?.());
        done();
      }
    });
  });
}
async function renderPage(name, file, token) {
  page = name;
  mounted = false;
  const root = document.createElement("div");
  main.replaceChildren(root);
  root.innerHTML = loading("Opening your workspace…");
  await roleSettled();
  if (isStale(token)) return;
  session = getSession();
  const permission = pages[page];
  if (["unconfigured", "error"].includes(session.status)) {
    root.innerHTML =
      pageHead(page === "home" ? "Home" : "Quiz service unavailable") +
      `<section class="panel">${empty(session.status === "unconfigured" ? "The quiz service is not connected yet" : "Could not load your account", session.error, `<button class="button secondary" id="reload">Try again</button>${session.user ? '<button class="button secondary" id="sign-out">Sign out</button>' : ""}`)}</section>`;
    document.querySelector("#reload").onclick = () => location.reload();
    if (root.querySelector("#sign-out"))
      root.querySelector("#sign-out").onclick = logout;
  } else if (permission !== "guest" && !session.user)
    go(loginURL(), { replace: true });
  else if (session.accountStatus === "disabled") {
    root.innerHTML =
      notice("This account has been disabled. Contact the site owner.", "error") +
      `<button class="button secondary" id="sign-out">Sign out</button>`;
    root.querySelector("#sign-out").onclick = logout;
  } else if (
    (permission === "teacher" && !session.capabilities.teach) ||
    (permission === "admin" && !session.capabilities.admin)
  )
    root.innerHTML =
      pageHead("Access restricted") +
      empty(
        "This page is for " +
          (permission === "admin" ? "administrators" : "teachers"),
        session.user?.emailVerified
          ? "Ask an administrator to grant the required role."
          : "Verify your email address from your profile.",
        linkButton("Open profile", "profile.html"),
      );
  else {
    try {
      const controller = await loadModule(file);
      if (isStale(token)) return;
      await controller.mount(root, session, token);
      if (!isStale(token)) mounted = true;
    } catch (error) {
      if (isStale(token)) return;
      root.innerHTML =
        pageHead("Could not open this page") +
        notice(error.message, "error") +
        linkButton("Go home", "index.html", "secondary");
    }
  }
}
watchSession((next) => {
  if (page === "login" || !page) return;
  if (waitingForPermissions && next.status === "ready" && next.roleResolved) {
    location.reload();
    return;
  }
  if (mounted && (!next.roleResolved || next.status === "error")) {
    mounted = false;
    waitingForPermissions = true;
    main.innerHTML = next.status === "error" ? notice(next.error || "Could not verify your permissions. Reload to retry.", "error") : loading("Checking your permissions…");
    return;
  }
  if (!mounted) return;
  if (
    next.user?.uid !== session.user?.uid ||
    next.role !== session.role ||
    next.accountStatus !== session.accountStatus
  ) {
    mounted = false;
    main.replaceChildren();
    location.reload();
  }
});
const warmers = {
  "index.html": () => warm("getDashboard"),
  "quizzes.html": () => warm("listPublicQuizzes", { limit: 12 }),
  "activity.html": () => getSession().user && warm("listMyAttempts", { limit: 20 }),
  "teaching.html": () =>
    getSession().capabilities.teach &&
    warm("listMyQuizzes", { limit: 20, lifecycle: "active" }),
};
setWarmer((file) => warmers[file]?.());
await startRouter(renderPage);
// Warm the main menu destinations once the current page is up.
setTimeout(() => {
  for (const file of Object.keys(warmers)) warmers[file]();
}, 1500);
document.addEventListener("click", (event) => {
  const back = event.target.closest(".qc-back");
  if (back) {
    go(back.closest(".quiz-card").querySelector("a[href]").getAttribute("href"));
    return;
  }
  const image = event.target.closest(".math-content img");
  if (!image) return;
  const d = document.createElement("dialog");
  d.className = "image-dialog";
  const close = document.createElement("button");
  close.className = "button secondary";
  close.textContent = "Close image";
  close.onclick = () => d.close();
  const copy = image.cloneNode();
  copy.loading = "eager";
  d.append(close, copy);
  document.body.append(d);
  d.addEventListener("close", () => d.remove(), { once: true });
  d.showModal();
});
