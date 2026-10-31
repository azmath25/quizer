import { api, apiSWR } from "../services/api.js";
import {
  pageHead,
  linkButton,
  quizCard,
  empty,
  loading,
  select,
  e,
  badge,
  date,
  pagination,
  message
} from "../components/ui.js";
import { attemptRows, attemptTable } from "../components/reports.js";
export async function mount(root) {
  let tab =
      location.hash === "#requests"
        ? "requests"
        : location.hash === "#results"
          ? "results"
          : "quizzes",
    lifecycle = "active",
    pendingOnly = false;
  root.innerHTML =
    pageHead(
      "Teaching",
      "Manage your quizzes, participants and marking.",
      linkButton("Problem bank", "problems.html", "secondary", "book") +
        linkButton("Create quiz", "upload.html", "primary", "plus"),
    ) +
    `<div class="tabs" role="tablist" aria-label="Teaching workspace"><button data-tab="quizzes" role="tab">My quizzes</button><button data-tab="requests" role="tab">Access requests</button><button data-tab="results" role="tab">Results</button></div><div class="toolbar" id="filters"></div><div data-message></div><div id="teaching-list"></div>`;
  const list = root.querySelector("#teaching-list"),
    filters = root.querySelector("#filters"),
    setPage = pagination(list, load);
  let loadId = 0;
  async function load(cursor) {
    if (!cursor) list.innerHTML = loading();
    const action =
      tab === "quizzes"
        ? "listMyQuizzes"
        : tab === "requests"
          ? "listTeacherRequests"
          : "listTeacherAttempts";
    const params = {
      limit: 20,
      ...(tab === "quizzes"
        ? { lifecycle }
        : tab === "results"
          ? { pendingOnly }
          : {}),
      ...(cursor ? { cursor } : {}),
    };
    if (!cursor) {
      const stamp = ++loadId;
      await apiSWR(action, params, (r) => stamp === loadId && render(r, null));
      return;
    }
    render(await api(action, params), cursor);
    function render(result, cursor) {    if (!cursor) {
      list.innerHTML = tab === "results" ? attemptTable() : "";
      list.className = tab === "quizzes" ? "grid" : "panel";
    }
    if (tab === "quizzes")
      list.insertAdjacentHTML(
        "beforeend",
        result.items.map((q) => quizCard(q, { management: true })).join(""),
      );
    else if (tab === "requests")
      list.insertAdjacentHTML(
        "beforeend",
        result.items
          .map(
            (p) =>
              `<div class="list-row"><div class="row-main"><h3>${e(p.displayName || p.uid)}</h3><p>${e(p.quizTitle)} · ${date(p.requestedAt)}</p>${p.requestMessage ? `<p class="access-message">${e(p.requestMessage)}</p>` : ""}</div><div class="actions">${badge(p.accessStatus, "amber")}${linkButton("Review request", `quiz-manage.html?id=${p.quizId}#access`, "secondary")}</div></div>`,
          )
          .join(""),
      );
    else
      list
        .querySelector("tbody")
        ?.insertAdjacentHTML("beforeend", attemptRows(result.items));
    if (!result.items.length && !cursor) {
      list.className = "panel";
      list.innerHTML = empty(
        tab === "quizzes"
          ? lifecycle === "trashed"
            ? "Trash is empty"
            : "No quizzes yet"
          : tab === "requests"
            ? "No pending requests"
            : "No submissions yet",
        tab === "quizzes"
          ? "Create a quiz from LaTeX, JSON or your problem bank."
          : tab === "requests"
            ? "Students’ access requests will appear here."
            : "Your students’ attempts will appear here.",
        tab === "quizzes" && lifecycle === "active"
          ? linkButton("Create quiz", "upload.html")
          : "",
      );
    }
    setPage(result.nextCursor);
    }
  }
  async function switchTab(value) {
    tab = value;
    root
      .querySelectorAll("[data-tab]")
      .forEach((b) =>
        b.setAttribute("aria-selected", String(b.dataset.tab === tab)),
      );
    filters.innerHTML =
      tab === "quizzes"
        ? select(
            "Show",
            "lifecycle",
            [
              ["active", "Active quizzes"],
              ["trashed", "Trash"],
            ],
            lifecycle,
          )
        : tab === "results"
          ? select(
              "Show",
              "pending",
              [
                ["all", "All submissions"],
                ["pending", "Needs marking"],
              ],
              pendingOnly ? "pending" : "all",
            )
          : "";
    filters
      .querySelector("select")
      ?.addEventListener("change", async (event) => {
        if (tab === "quizzes") lifecycle = event.target.value;
        else pendingOnly = event.target.value === "pending";
        await load();
      });
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
