import { watchSession, getSession } from "../firebase-client.js";
import { icon, e } from "./ui.js";
const links = [
  ["home", "index.html", "Home"],
  ["quiz", "quizzes.html", "Quizzes"],
  ["activity", "activity.html", "My activity"],
  ["teach", "teaching.html", "Teaching"],
  ["ai", "ai.html", "AI Studio"],
  ["admin", "admin.html", "Admin"],
];
const THEMES = {
  light: { label: "Light", icon: "sun" },
  dark: { label: "Dark", icon: "moon" },
  system: { label: "System", icon: "monitor" },
};
const THEME_KEY = "mathquiz.theme.choice";
let currentThemeChoice = null;

function localAppearance() {
  try { return JSON.parse(localStorage.getItem("mathquiz.appearance") || "{}"); }
  catch { return {}; }
}
export function getPreferredTheme(preferences = {}) {
  if (currentThemeChoice && THEMES[currentThemeChoice]) return currentThemeChoice;
  try {
    const localChoice = localStorage.getItem(THEME_KEY);
    if (THEMES[localChoice]) return localChoice;
  } catch {}
  if (THEMES[preferences?.theme]) return preferences.theme;
  const cached = localAppearance().theme;
  return THEMES[cached] ? cached : "light";
}
function updateThemeSwitcher(theme) {
  const summary = document.querySelector("#theme-trigger");
  if (!summary) return;
  summary.innerHTML = icon(THEMES[theme].icon);
  summary.setAttribute("aria-label", "Appearance: " + THEMES[theme].label);
  summary.title = "Appearance: " + THEMES[theme].label;
  document.querySelectorAll("[data-theme-choice]").forEach((button) => {
    const selected = button.dataset.themeChoice === theme;
    button.setAttribute("aria-pressed", String(selected));
  });
}
const EQUATIONS = ["e^{iπ}+1=0", "∑ 1/n²=π²/6", "∫ x² dx", "a²+b²=c²", "φ=(1+√5)/2", "lim n→∞", "∇·F", "x=(-b±√Δ)/2a", "sin²+cos²=1", "dy/dx", "∞", "π", "√2", "n!"];
function mountBackdrop() {
  if (document.querySelector("#math-bg")) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "assets/css/math.css?v=13";
  const polish = document.createElement("link");
  polish.rel = "stylesheet";
  polish.href = "assets/css/polish.css?v=13";
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
  header.innerHTML = `<div class="header-inner"><a class="brand" href="index.html"><span class="brand-icon" aria-hidden="true"><svg viewBox="0 0 64 64"><path d="M43 17H21l11 15-11 15h22" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><circle class="brand-orbit" cx="46" cy="46" r="5" fill="var(--accent)"/></svg></span><span class="logo-flip-container" role="img" aria-label="Math Quiz"><span class="flip-card logo-flip-card"><span class="flip-face flip-face--front logo-face--small logo-face"><span class="logo-mark" aria-hidden="true">√</span><span class="logo-az">Math</span><span class="logo-math">Quiz</span></span><span class="flip-face flip-face--back logo-face--big logo-face"><span class="logo-mark" aria-hidden="true">√</span><span class="logo-az">Math</span><span class="logo-math">Quiz</span></span></span></span></a><nav aria-label="Main navigation" id="desktop-nav"></nav><div class="header-controls"><details class="theme-menu" id="theme-menu"><summary id="theme-trigger" class="theme-trigger" aria-label="Appearance: Light" title="Choose appearance">${icon("sun")}</summary><div class="theme-options" role="group" aria-label="Appearance"><button type="button" data-theme-choice="light" aria-pressed="false">${icon("sun")}<span>Light</span></button><button type="button" data-theme-choice="dark" aria-pressed="false">${icon("moon")}<span>Dark</span></button><button type="button" data-theme-choice="system" aria-pressed="false">${icon("monitor")}<span>System</span></button></div></details><a class="profile-link" href="profile.html" id="account-link">${icon("profile")}<span>Profile</span></a></div></div>`;
  const draw = (s) => {
    const page = document.body.dataset.page;
    const nav = links
      .filter(([key]) => key !== "teach" || s.capabilities.teach)
      .filter(([key]) => key !== "admin" || s.capabilities.admin)
      .filter(([key]) => key !== "ai" || s.capabilities.admin);
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
    // The visible name is hidden only on narrow mobile headers.
    account.setAttribute("aria-label", s.authResolved && !s.user ? "Sign in" : "Profile");
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
    footer.innerHTML = `<span>Math Quiz</span><span>${s.capabilities.teach ? '<a href="guide.html">LaTeX guide</a> · ' : ""}<a href="profile.html#appearance">Text size</a></span>`;
    applyAppearance(s.profile?.preferences || localAppearance());
    if (s.authResolved)
      import("./assistant.js?v=13").then((m) => m.mountAssistant(s)).catch(() => {});
  };
  document.querySelector("#site-header").addEventListener("click", (event) => {
    const choice = event.target.closest("[data-theme-choice]");
    if (choice) {
      const theme = choice.dataset.themeChoice;
      if (!THEMES[theme]) return;
      currentThemeChoice = theme;
      try { localStorage.setItem(THEME_KEY, theme); } catch {}
      applyAppearance(getSession().profile?.preferences || localAppearance());
      document.querySelector("#theme-menu").open = false;
      return;
    }
    if (!event.target.closest("#theme-menu")) {
      document.querySelector("#theme-menu").open = false;
    }
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest("#theme-menu")) {
      const menu = document.querySelector("#theme-menu");
      if (menu) menu.open = false;
    }
  });
  watchSession(draw);
  document.addEventListener("route-changed", () => {
    draw(getSession());
    popLogo();
  });
}
export function applyAppearance(preferences = {}) {
  const saved = localAppearance();
  const theme = getPreferredTheme(preferences);
  const scale = Number(preferences.textScale ?? saved.textScale ?? 1);
  const textScale = [1, 1.125, 1.25].includes(scale) ? scale : 1;
  try {
    localStorage.setItem("mathquiz.appearance", JSON.stringify({ theme, textScale }));
  } catch {}
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.setProperty("--text-scale", String(textScale));
  updateThemeSwitcher(theme);
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
