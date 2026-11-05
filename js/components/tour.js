import { e } from "./ui.js";

const STEPS = {
  teacher: [
    ["teaching.html", "Teaching workspace", "Create quizzes, reuse problems from your bank, and review student attempts."],
    ["quizzes.html", "Quizzes", "Browse published quizzes as your students see them."],
    ["activity.html", "Attempts and results", "Your activity is here. In results, you can review responses, release marks and see Ask AI."],
    ["ai.html", "AI Studio", "Open the full AI workspace here. Problem Bank also has a quick Ask AI popup."],
    ["profile.html", "Profile", "Manage your appearance and starred items, or replay this tour."],
  ],
  student: [
    ["quizzes.html", "Start a quiz", "Browse quizzes. Open answers support a math keyboard and an optional handwriting scratchpad."],
    ["activity.html", "Your results", "Resume unfinished quizzes and review submitted answers. Ask AI opens a popup only after submission."],
    ["profile.html", "Profile", "Your starred items, appearance and tour replay are here."],
  ],
};
const key = (uid) => `mathquiz.tour.v1.${uid}`;
const visible = (el) => el && el.getClientRects().length > 0;
let running = false;

export const tourSeen = (uid) => localStorage.getItem(key(uid)) === "1";
export function startTour(session, { force = false } = {}) {
  const uid = session.user?.uid;
  if (!uid || running || (!force && tourSeen(uid))) return;
  const steps = STEPS[session.capabilities.teach ? "teacher" : "student"];
  running = true;
  const opener = document.activeElement;
  const card = document.createElement("div");
  card.className = "tour";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-label", "Quick tour");
  document.body.append(card);
  let at = 0,
    ring;
  const target = (href) =>
    [...document.querySelectorAll(`#desktop-nav a[href="${href}"], #mobile-nav a[href="${href}"], #account-link[href="${href}"]`)].find(visible);
  function place(el) {
    ring?.classList.remove("tour-target");
    ring = el;
    el?.classList.add("tour-target");
    const w = Math.min(340, innerWidth - 24);
    card.style.width = w + "px";
    if (!el) return Object.assign(card.style, { left: "12px", top: "auto", bottom: "12px" });
    const r = el.getBoundingClientRect(),
      below = r.bottom + 12 + 190 < innerHeight;
    card.style.left = Math.max(12, Math.min(r.left, innerWidth - w - 12)) + "px";
    card.style.top = below ? r.bottom + 12 + "px" : "auto";
    card.style.bottom = below ? "auto" : innerHeight - r.top + 12 + "px";
  }
  function show() {
    const [href, title, text] = steps[at],
      last = at === steps.length - 1;
    card.innerHTML = `<p class="tour-count">${at + 1} of ${steps.length}</p><h2>${e(title)}</h2><p>${e(text)}</p><div class="actions"><button type="button" class="button ghost small" data-skip>Skip</button>${at ? '<button type="button" class="button secondary small" data-back>Back</button>' : ""}<button type="button" class="button primary small" data-next>${last ? "Done" : "Next"}</button></div>`;
    place(target(href));
    card.querySelector("[data-next]").focus();
  }
  function end() {
    localStorage.setItem(key(uid), "1");
    ring?.classList.remove("tour-target");
    card.remove();
    document.removeEventListener("keydown", keys);
    removeEventListener("resize", reposition);
    running = false;
    if (opener?.isConnected) opener.focus();
  }
  const reposition = () => place(target(steps[at][0]));
  const keys = (event) => {
    if (event.key === "Escape") end();
    else if (event.key === "Tab") {
      const f = [...card.querySelectorAll("button")];
      const first = f[0],
        lastEl = f.at(-1);
      if (event.shiftKey && document.activeElement === first) (event.preventDefault(), lastEl.focus());
      else if (!event.shiftKey && document.activeElement === lastEl) (event.preventDefault(), first.focus());
    }
  };
  card.onclick = (event) => {
    const b = event.target.closest("button");
    if (!b) return;
    if (b.dataset.skip !== undefined) end();
    else if (b.dataset.back !== undefined) (at--, show());
    else if (at === steps.length - 1) end();
    else (at++, show());
  };
  document.addEventListener("keydown", keys);
  addEventListener("resize", reposition);
  show();
}
