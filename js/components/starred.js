import { loadStars, starList, removeStar } from "../services/stars.js";
import { e, icon, empty, message, linkButton } from "./ui.js";

// Fills `host` with the user's starred problems and keeps it current until the host leaves the page.
export function mountStarred(host, { limit = Infinity } = {}) {
  const draw = () => {
    const all = starList(),
      items = all.slice(0, limit);
    host.innerHTML = items.length
      ? items
          .map(
            (s) =>
              `<div class="list-row"><span class="number-tile">${icon("star")}</span><div class="row-main"><h3><a href="${e(s.href)}">${e(s.title)}</a></h3>${s.subject ? `<p>${e(s.subject)}</p>` : ""}</div><button type="button" class="icon-button" data-unstar="${e(s.ref)}" aria-label="Remove star" title="Remove star">${icon("close")}</button></div>`,
          )
          .join("") + (all.length > items.length ? `<p class="muted small">${all.length - items.length} more on your profile.</p>` : "")
      : empty("No starred problems", "Star problems in the bank or during a quiz to keep them here.", linkButton("Open problem bank", "problems.html", "secondary"));
  };
  host.onclick = (ev) => {
    const b = ev.target.closest("[data-unstar]");
    if (b) removeStar(b.dataset.unstar).catch((error) => message(host, error.message || "Could not remove the star."));
  };
  document.addEventListener("stars-changed", draw);
  host.innerHTML = '<div class="skeleton"><i></i></div>';
  loadStars().then(draw).catch(() => (host.innerHTML = empty("Starred problems unavailable", "Try again in a moment.")));
  const gone = new MutationObserver(() => {
    if (!host.isConnected) {
      document.removeEventListener("stars-changed", draw);
      gone.disconnect();
    }
  });
  gone.observe(document.body, { childList: true, subtree: true });
}
