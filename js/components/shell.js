import { watchSession, getSession } from "../firebase-client.js";
import { icon, e } from "./ui.js";
const links = [
  ["home", "index.html", "Home"],
  ["quiz", "quizzes.html", "Quizzes"],
  ["activity", "activity.html", "My activity"],
  ["teach", "teaching.html", "Teaching"],
  ["admin", "admin.html", "Admin"],
];
export function mountShell() {
  const header = document.querySelector("#site-header");
  header.innerHTML = `<div class="header-inner"><a class="brand" href="index.html"><span class="brand-icon" aria-hidden="true">∑</span><span>Math Quiz</span></a><nav aria-label="Main navigation" id="desktop-nav"></nav><a class="profile-link" href="profile.html" id="account-link">${icon("profile")}<span>Profile</span></a></div>`;
  const page = document.body.dataset.page;
  watchSession((s) => {
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
