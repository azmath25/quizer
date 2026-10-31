import { watchSession, getSession } from "../firebase-client.js";
import { icon, e } from "./ui.js";
const links = [
  ["home", "index.html", "Home"],
  ["quiz", "quizzes.html", "Quizzes"],
  ["activity", "activity.html", "My activity"],
  ["teach", "teaching.html", "Teaching"],
  ["admin", "admin.html", "Admin"],
];
const EQUATIONS = ["e^{iπ}+1=0", "∑ 1/n²=π²/6", "∫ x² dx", "a²+b²=c²", "φ=(1+√5)/2", "lim n→∞", "∇·F", "x=(-b±√Δ)/2a", "sin²+cos²=1", "dy/dx", "∞", "π", "√2", "n!"];
function mountBackdrop() {
  if (document.querySelector("#math-bg")) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "assets/css/math.css?v=5";
  const polish = document.createElement("link");
  polish.rel = "stylesheet";
  polish.href = "assets/css/polish.css?v=1";
  document.head.append(link, polish);
  const bg = document.createElement("div");
  bg.id = "math-bg";
  bg.setAttribute("aria-hidden", "true");
  bg.innerHTML = EQUATIONS.map((t, i) => `<span style="--x:${(i * 37 + 7) % 94}%;--d:${22 + ((i * 7) % 18)}s;--delay:${-i * 3.1}s;--s:${0.9 + ((i * 13) % 10) / 10}rem">${t}</span>`).join("");
  document.body.prepend(bg);
}
export function mountShell() {
  mountBackdrop();
  const header = document.querySelector("#site-header");
  header.innerHTML = `<div class="header-inner"><a class="brand" href="index.html"><span class="brand-icon" aria-hidden="true"><svg viewBox="0 0 64 64"><path d="M43 17H21l11 15-11 15h22" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><circle class="brand-orbit" cx="46" cy="46" r="5" fill="#ffd66b"/></svg></span><span class="logo-flip-container" role="img" aria-label="Math Quiz"><span class="flip-card logo-flip-card"><span class="flip-face flip-face--front logo-face--small logo-face"><span class="logo-mark" aria-hidden="true">√</span><span class="logo-az">Math</span><span class="logo-math">Quiz</span></span><span class="flip-face flip-face--back logo-face--big logo-face"><span class="logo-mark" aria-hidden="true">√</span><span class="logo-az">Math</span><span class="logo-math">Quiz</span></span></span></span></a><nav aria-label="Main navigation" id="desktop-nav"></nav><a class="profile-link" href="profile.html" id="account-link">${icon("profile")}<span>Profile</span></a></div>`;
  const draw = (s) => {
    const page = document.body.dataset.page;
    const nav = links
      .filter(([key]) => key !== "teach" || s.capabilities.teach)
      .filter(([key]) => key !== "admin" || s.capabilities.admin);
    const active = (url) =>
      url.split(".")[0] === page ||
      (page === "home" && url === "index.html") ||
      (page === "catalog" && url === "quizzes.html");
    document.querySelector("#desktop-nav").innerHTML = nav
      .map(
        ([key, url, label]) =>
          `<a href="${url}" ${active(url) ? 'aria-current="page"' : ""}>${e(label)}</a>`,
      )
      .join("");
    const account = document.querySelector("#account-link");
    account.href = s.authResolved && !s.user ? "login.html" : "profile.html";
    account.innerHTML = s.user
      ? `<span class="avatar">${e((s.profile?.displayName || s.user.email || "U").slice(0, 1).toUpperCase())}</span><span>${e((s.profile?.displayName || "Profile").split(" ")[0])}</span>`
      : `${icon("profile")}<span>${s.authResolved ? "Sign in" : "Profile"}</span>`;
    document.querySelector("#mobile-nav").innerHTML = [
      ...links.slice(0, 3),
      ["profile", "profile.html", "Profile"],
    ]
      .map(
        ([key, url, label]) =>
          `<a href="${url}" ${active(url) ? 'aria-current="page"' : ""}>${icon(key)}<span>${label}</span></a>`,
      )
      .join("");
    const footer = document.querySelector("#site-footer");
    footer.innerHTML = `<span>Math Quiz</span><span>${s.capabilities.teach ? '<a href="guide.html">LaTeX guide</a> · ' : ""}<a href="profile.html#appearance">Appearance</a></span>`;
    if (s.profile?.preferences) applyAppearance(s.profile.preferences);
    if (s.authResolved)
      import("./assistant.js?v=1").then((m) => m.mountAssistant(s)).catch(() => {});
  };
  watchSession(draw);
  document.addEventListener("route-changed", () => {
    draw(getSession());
    popLogo();
  });
}
export function applyAppearance(preferences) {
  localStorage.setItem("mathquiz.appearance", JSON.stringify(preferences));
  document.documentElement.dataset.theme = preferences.theme || "light";
  document.documentElement.style.setProperty(
    "--text-scale",
    preferences.textScale || 1,
  );
}

let popTimer;
function popLogo() {
  const card = document.querySelector(".logo-flip-card");
  if (!card) return;
  clearTimeout(popTimer);
  card.classList.remove("is-flipped");
  void card.offsetWidth;
  card.classList.add("is-flipped");
  popTimer = setTimeout(() => card.classList.remove("is-flipped"), 520);
}
