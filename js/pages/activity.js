import { api, apiSWR } from "../services/api.js";
import {
  pageHead,
  empty,
  loading,
  linkButton,
  badge,
  e,
  date,
  points,
  action,
  pagination,
  message,
} from "../components/ui.js";
export async function mount(root) {
  let tab =
    location.hash === "#requests"
      ? "requests"
      : location.hash === "#updates"
        ? "updates"
        : "attempts";
  root.innerHTML =
    pageHead("My activity", "Your attempts, access requests and updates.") +
    `<div class="tabs" role="tablist" aria-label="Activity"><button role="tab" data-tab="attempts">Attempts</button><button role="tab" data-tab="requests">Access requests</button><button role="tab" data-tab="updates">Updates</button></div><div data-message></div><div class="panel" id="activity-list"></div>`;
  const list = root.querySelector("#activity-list");
  const page = pagination(list, load);
  let loadId = 0;
  async function load(cursor) {
    if (!cursor) list.innerHTML = loading();
    const actionName = {
      attempts: "listMyAttempts",
      requests: "listMyApplications",
      updates: "listMyNotifications",
    }[tab];
    const params = {
      limit: 20,
      ...(cursor ? { cursor } : {}),
    };
    if (!cursor) {
      const stamp = ++loadId;
      await apiSWR(actionName, params, (r) => stamp === loadId && render(r, null));
      return;
    }
    render(await api(actionName, params), cursor);
    function render(result, cursor) {    if (!cursor) list.innerHTML = "";
    if (tab === "attempts")
      list.insertAdjacentHTML(
        "beforeend",
        result.items
          .map(
            (a) =>
              `<div class="list-row"><div class="row-main"><h3>${e(a.quizTitle)}</h3><p>Attempt ${a.ordinal} · ${a.attemptKind === "retry_incorrect" ? "Retry · " : ""}${date(a.startedAt)}</p></div><div class="actions">${badge(a.status === "active" ? "In progress" : a.gradeState === "pending_manual" ? "Pending marking" : a.status, a.status === "active" ? "blue" : "")}${a.scoreVisible && a.status !== "active" ? `<strong>${points(a.totals.score)} / ${points(a.totals.possible)}</strong>` : ""}${linkButton(a.status === "active" ? "Resume" : "Result", a.status === "active" ? `quiz.html?attempt=${a.attemptId}` : `results.html?id=${a.attemptId}`, "secondary")}</div></div>`,
          )
          .join(""),
      );
    else if (tab === "requests")
      list.insertAdjacentHTML(
        "beforeend",
        result.items
          .map(
            (p) =>
              `<div class="list-row"><div class="row-main"><h3>${e(p.quizTitle || "Quiz")}</h3><p>${date(p.requestedAt || p.updatedAt)}${p.decisionReason ? " · " + e(p.decisionReason) : ""}</p></div><div class="actions">${badge(p.accessStatus, p.accessStatus === "approved" ? "green" : p.accessStatus === "pending" ? "amber" : "")}${linkButton("View quiz", `quiz.html?id=${p.quizId}`, "secondary")}</div></div>`,
          )
          .join(""),
      );
    else
      list.insertAdjacentHTML(
        "beforeend",
        result.items
          .map(
            (n) =>
              `<div class="list-row"><div class="row-main"><h3>${e(n.title)}</h3><p>${date(n.createdAt)}</p></div><div class="actions">${n.quizId ? linkButton("Open", `quiz.html?id=${n.quizId}`, "secondary") : ""}${!n.readAt ? `<button class="button ghost" data-read="${e(n.id)}">Mark read</button>` : badge("Read")}</div></div>`,
          )
          .join(""),
      );
    if (!result.items.length && !cursor)
      list.innerHTML = empty(
        tab === "attempts"
          ? "No attempts yet"
          : tab === "requests"
            ? "No access requests"
            : "No updates",
        tab === "attempts"
          ? "Choose a quiz to get started."
          : "New activity will appear here.",
        tab === "attempts" ? linkButton("Browse quizzes", "quizzes.html") : "",
      );
    page(result.nextCursor);
    }
    list.querySelectorAll("[data-read]").forEach(
      (b) =>
        (b.onclick = async () => {
          await api("markNotificationRead", { notificationId: b.dataset.read });
          b.replaceWith(document.createTextNode("Read"));
        }),
    );
  }
  async function switchTab(value) {
    tab = value;
    root
      .querySelectorAll("[data-tab]")
      .forEach((b) =>
        b.setAttribute("aria-selected", String(b.dataset.tab === tab)),
      );
    await load();
  }
  root
    .querySelectorAll("[data-tab]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          switchTab(b.dataset.tab).catch((err) => message(root, err.message))),
    );
  await switchTab(tab);
}
