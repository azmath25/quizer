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
const page = document.body.dataset.page,
  permission = pages[page],
  main = document.querySelector("main");
mountShell();
main.innerHTML = loading("Opening your workspace…");
await initFirebase();
let session = getSession();
let mounted = false, waitingForPermissions = false;
if (["unconfigured", "error"].includes(session.status)) {
  main.innerHTML =
    pageHead(page === "home" ? "Home" : "Quiz service unavailable") +
    `<section class="panel">${empty(session.status === "unconfigured" ? "The quiz service is not connected yet" : "Could not load your account", session.error, `<button class="button secondary" id="reload">Try again</button>${session.user ? '<button class="button secondary" id="sign-out">Sign out</button>' : ""}`)}</section>`;
  document.querySelector("#reload").onclick = () => location.reload();
  if (main.querySelector("#sign-out"))
    main.querySelector("#sign-out").onclick = logout;
} else if (permission !== "guest" && !session.user)
  location.replace(loginURL());
else if (session.accountStatus === "disabled") {
  main.innerHTML =
    notice("This account has been disabled. Contact the site owner.", "error") +
    `<button class="button secondary" id="sign-out">Sign out</button>`;
  main.querySelector("#sign-out").onclick = logout;
} else if (
  (permission === "teacher" && !session.capabilities.teach) ||
  (permission === "admin" && !session.capabilities.admin)
)
  main.innerHTML =
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
    const controller = await import(`./pages/${page}.js`);
    await controller.mount(main, session);
    mounted = true;
  } catch (error) {
    main.innerHTML =
      pageHead("Could not open this page") +
      notice(error.message, "error") +
      linkButton("Go home", "index.html", "secondary");
  }
}
watchSession((next) => {
  if (page === "login") return;
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
document.addEventListener("click", (event) => {
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
