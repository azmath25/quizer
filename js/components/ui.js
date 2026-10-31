import { escapeHTML as e } from "../common.js";
import { errorMessage } from "../firebase-client.js";
export { e };
const paths = {
  home: "M3 10 12 3l9 7v11h-6v-7H9v7H3z",
  quiz: "M7 3h10v3H7z M5 5H3v16h18V5h-2 M7 11h10 M7 16h7",
  activity: "M4 18V6 M10 18V10 M16 18V3 M22 21H2",
  profile: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M4 21v-3a8 8 0 0 1 16 0v3",
  teach: "m2 8 10-5 10 5-10 5z M6 10v7c4 3 8 3 12 0v-7 M22 8v9",
  admin: "M12 3 3 7v5c0 5 5 8 9 10 4-2 9-5 9-10V7z M8 12l3 3 5-6",
  plus: "M12 5v14 M5 12h14",
  arrow: "M5 12h14 M13 6l6 6-6 6",
  upload: "M12 16V3 M7 8l5-5 5 5 M4 16v5h16v-5",
  clock: "M12 7v5l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  book: "M3 4h7l2 2 2-2h7v16h-7l-2 2-2-2H3z M12 6v16",
  check: "m5 12 4 4L19 6",
  search: "M16 16l6 6 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  sun: "M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2 M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0",
  flag: "M5 22V3h14l-3 5 3 5H5",
  close: "M5 5l14 14 M19 5 5 19",
  refresh:
    "M20 7V2 M20 7h-5 M4 17v5 M4 17h5 M20 7a9 9 0 0 0-16 2 M4 17a9 9 0 0 0 16-2",
};
export const icon = (name) =>
  `<svg class="icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${paths[name] || paths.quiz}"/></svg>`;
export const badge = (value, tone = "") =>
  `<span class="badge ${e(tone)}">${e(String(value).replaceAll("_", " "))}</span>`;
export const pageHead = (title, description = "", actions = "") =>
  `<div class="page-heading"><div><h1>${e(title)}</h1>${description ? `<p>${e(description)}</p>` : ""}</div>${actions ? `<div class="actions">${actions}</div>` : ""}</div>`;
export const linkButton = (label, url, tone = "primary", symbol = "") =>
  `<a class="button ${tone}" href="${e(url)}">${symbol ? icon(symbol) : ""}${e(label)}</a>`;
export const empty = (title, description = "", action = "") =>
  `<div class="empty"><div class="empty-icon">${icon("quiz")}</div><h3>${e(title)}</h3>${description ? `<p>${e(description)}</p>` : ""}${action}</div>`;
export const loading = (message = "Loading…") =>
  `<div class="loading" role="status" aria-label="${e(message)}"><div class="skeleton"><i></i><i></i><i></i></div></div>`;
export const notice = (text, tone = "info") =>
  `<div class="notice ${tone}" role="${tone === "error" ? "alert" : "status"}">${e(text)}</div>`;
export const date = (value) =>
  value
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "—";
export const timezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
export const duration = (seconds) =>
  !seconds
    ? "Untimed"
    : seconds < 60
      ? `${seconds} sec`
      : `${Math.round(seconds / 60)} min`;
export const points = (n) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(n ?? 0);
export const field = (label, name, type = "text", value = "", extra = "") =>
  `<label class="field"><span>${e(label)}</span><input name="${e(name)}" type="${type}" value="${e(value)}" ${extra}></label>`;
export const textarea = (label, name, value = "", extra = "") =>
  `<label class="field"><span>${e(label)}</span><textarea name="${e(name)}" ${extra}>${e(value)}</textarea></label>`;
export const select = (label, name, choices, value) =>
  `<label class="field"><span>${e(label)}</span><select name="${e(name)}">${choices
    .map((choice) => {
      const [id, label] = Array.isArray(choice) ? choice : [choice, choice];
      return `<option value="${e(id)}" ${id === value ? "selected" : ""}>${e(label)}</option>`;
    })
    .join("")}</select></label>`;
export const checkbox = (label, name, value) =>
  `<label class="check"><input type="checkbox" name="${e(name)}" ${value ? "checked" : ""}><span>${e(label)}</span></label>`;
export function message(root, text, tone = "error") {
  let node = root.querySelector("[data-message]");
  if (!node) {
    node = document.createElement("div");
    node.dataset.message = "";
    root.prepend(node);
  }
  node.innerHTML = text ? notice(text, tone) : "";
  if (tone === "error")
    node.scrollIntoView({ block: "nearest", behavior: "smooth" });
}
export function bindForm(form, fn) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter;
    await busy(button, () => fn(new FormData(form)), form);
  });
}
export async function busy(
  button,
  fn,
  errorRoot = button?.closest("form") || document.querySelector("main"),
) {
  if (button?.disabled) return;
  const original = button?.innerHTML;
  if (button) {
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
  }
  try {
    return await fn();
  } catch (error) {
    if (error.reason === "SESSION_CHANGED") return;
    message(errorRoot, errorMessage(error));
    if (error.jobId) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = "Processing ID: " + error.jobId;
      errorRoot.querySelector("[data-message]")?.append(p);
    }
    return null;
  } finally {
    if (button) {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      if (original !== undefined) button.innerHTML = original;
    }
  }
}
export function action(root, selector, fn) {
  root
    .querySelector(selector)
    ?.addEventListener("click", (event) =>
      busy(event.currentTarget, () => fn(event), root),
    );
}
export async function dialog({
  title,
  body,
  confirm = "Continue",
  danger = false,
}) {
  const previous = document.activeElement,
    node = document.createElement("dialog");
  node.className = "dialog";
  node.innerHTML = `<form method="dialog"><div class="dialog-head"><h2>${e(title)}</h2><button class="icon-button" value="cancel" aria-label="Close">${icon("close")}</button></div><div class="dialog-body">${body}</div><div class="dialog-footer"><button class="button secondary" value="cancel">Cancel</button><button class="button ${danger ? "danger" : "primary"}" value="confirm">${e(confirm)}</button></div></form>`;
  document.body.append(node);
  node.showModal();
  return new Promise((resolve) =>
    node.addEventListener(
      "close",
      () => {
        const result =
          node.returnValue === "confirm"
            ? new FormData(node.querySelector("form"))
            : null;
        node.remove();
        previous?.focus();
        resolve(result);
      },
      { once: true },
    ),
  );
}
export const confirmDialog = (title, body, confirm = "Confirm") =>
  dialog({ title, body: `<p>${e(body)}</p>`, confirm, danger: true });
export function quizCard(q, { management = false } = {}) {
  const id = q.quizId ?? q.id;
  const tone = [...String(q.subject || "Mathematics")].reduce((n, ch) => n + ch.charCodeAt(0), 0) % 5;
  return `<article class="quiz-card" data-tone="${tone}"><div class="qc-inner"><div class="qc-face qc-front"><div class="card-top"><span class="subject">${e(q.subject || "Mathematics")}</span>${badge(management ? (q.lifecycle === "trashed" ? "Trash" : q.publishedRevisionId ? "Published" : "Draft") : q.accessMode === "approval" ? "Approval required" : "Open", q.accessMode === "approval" ? "amber" : "blue")}</div><h3><a href="${management ? "quiz-manage" : "quiz"}.html?id=${e(id)}">${e(q.title)}</a></h3>${q.description ? `<p class="clamp">${e(q.description)}</p>` : ""}<div class="card-meta"><span>${icon("clock")}${duration(q.durationSeconds)}</span>${q.questionCount !== undefined ? `<span>${q.questionCount} problems</span>` : ""}${q.totalPoints !== undefined ? `<span>${points(q.totalPoints)} points</span>` : ""}</div><div class="card-foot"><span>${e(q.ownerDisplayName || "Teacher")}</span><a class="text-link" href="${management ? "quiz-manage" : "quiz"}.html?id=${e(id)}">${management ? "Manage" : "View quiz"} ${icon("arrow")}</a></div></div><div class="qc-face qc-back" aria-hidden="true"><span class="qc-symbol">${["∑", "π", "∫", "√", "∞"][tone]}</span><strong>${e(q.title)}</strong><span>${q.questionCount !== undefined ? q.questionCount + " problems · " : ""}${duration(q.durationSeconds)}</span><span class="qc-go">${management ? "Manage" : "Start"} ${icon("arrow")}</span></div></div></article>`;
}
export function pagination(container, load) {
  let cursor = null;
  const button = document.createElement("button");
  button.className = "button secondary load-more";
  button.textContent = "Load more";
  button.hidden = true;
  container.after(button);
  button.onclick = () => busy(button, () => load(cursor), container);
  return (next) => {
    cursor = next;
    button.hidden = !cursor;
  };
}
export function downloadBlob(data, filename, type = "application/json") {
  const blob = new Blob([data], { type }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
