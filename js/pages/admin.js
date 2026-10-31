import { api } from "../services/api.js";
import {
  pageHead,
  select,
  field,
  textarea,
  bindForm,
  busy,
  message,
  dialog,
  e,
  badge,
  date,
  empty,
  loading,
  pagination,
  linkButton,
  icon
} from "../components/ui.js";
import { activityRows } from "../components/reports.js";
export async function mount(root) {
  let tab = "users";
  root.innerHTML =
    pageHead("Administration", "Manage access and inspect recorded activity.") +
    `<div class="admin-intro">${icon("admin")}Activity records show saved actions and server timestamps. Response details remain on each attempt.</div><div class="tabs" role="tablist" aria-label="Administration"><button data-tab="users" aria-selected="true" role="tab">Users</button><button data-tab="activity" aria-selected="false" role="tab">Activity</button><button data-tab="content" aria-selected="false" role="tab">Content</button><button data-tab="jobs" aria-selected="false" role="tab">Processing jobs</button></div><div data-message></div><section class="panel" id="admin-panel"></section>`;
  const panel = root.querySelector("#admin-panel");
  async function users() {
    panel.innerHTML = `<form class="toolbar">${field("Email starts with", "search", "search", "", 'placeholder="Search accounts…" maxlength="200"')}<button class="button primary">Search</button></form><div id="users-list"></div>`;
    let search = "",
      rows = [];
    const list = panel.querySelector("#users-list"),
      setPage = pagination(list, load);
    async function load(cursor) {
      const result = await api("listUsers", {
        ...(search ? { search } : {}),
        limit: 25,
        ...(cursor ? { cursor } : {}),
      });
      if (!cursor) {
        rows = [];
        list.innerHTML = "";
      }
      rows.push(...result.items);
      list.insertAdjacentHTML(
        "beforeend",
        result.items
          .map(
            (u) =>
              `<div class="list-row"><span class="avatar">${e(u.displayName.slice(0, 1).toUpperCase())}</span><div class="row-main"><h3>${e(u.displayName)} ${badge(u.role, "blue")}</h3><p>${e(u.email)} · ${u.emailVerified ? "Verified" : "Unverified"} · ${e(u.accountStatus)}</p><details><summary class="small">Account ID</summary><code class="inline-code">${e(u.id)}</code></details></div><div class="actions"><button class="button secondary small" data-role="${e(u.id)}">Change role</button><button class="button secondary small" data-status="${e(u.id)}">${u.accountStatus === "disabled" ? "Enable" : "Disable"}</button><button class="button ghost small" data-user-events="${e(u.id)}">Activity</button></div></div>`,
          )
          .join(""),
      );
      if (!rows.length) list.innerHTML = empty("No matching users");
      setPage(result.nextCursor);
      list.querySelectorAll("[data-role]").forEach(
        (b) =>
          (b.onclick = () =>
            busy(
              b,
              async () => {
                const user = rows.find((u) => u.id === b.dataset.role),
                  values = await dialog({
                    title: "Change account role",
                    body:
                      `<p>${e(user.displayName)} · ${e(user.email)}</p>` +
                      select(
                        "Role",
                        "role",
                        [
                          ["student", "Student"],
                          ["teacher", "Teacher"],
                          ["admin", "Administrator"],
                        ],
                        user.role,
                      ) +
                      textarea(
                        "Reason",
                        "reason",
                        "",
                        'required maxlength="500"',
                      ),
                    confirm: "Save role",
                  });
                if (!values) return;
                await api("setUserRole", {
                  targetUid: user.id,
                  role: values.get("role"),
                  expectedVersion: user.version,
                  reason: values.get("reason"),
                });
                await load();
              },
              root,
            )),
      );
      list.querySelectorAll("[data-status]").forEach(
        (b) =>
          (b.onclick = () =>
            busy(
              b,
              async () => {
                const user = rows.find((u) => u.id === b.dataset.status),
                  values = await dialog({
                    title:
                      (user.accountStatus === "disabled"
                        ? "Enable"
                        : "Disable") + " account",
                    body:
                      `<p>${e(user.displayName)} · ${e(user.email)}</p>` +
                      textarea(
                        "Reason",
                        "reason",
                        "",
                        'required maxlength="500"',
                      ),
                    confirm: "Save",
                    danger: user.accountStatus !== "disabled",
                  });
                if (!values) return;
                await api("setAccountStatus", {
                  targetUid: user.id,
                  status:
                    user.accountStatus === "disabled" ? "active" : "disabled",
                  expectedVersion: user.version,
                  reason: values.get("reason"),
                });
                await load();
              },
              root,
            )),
      );
      list
        .querySelectorAll("[data-user-events]")
        .forEach(
          (b) =>
            (b.onclick = () =>
              switchTab("activity", { actorId: b.dataset.userEvents })),
        );
    }
    bindForm(panel.querySelector("form"), async (values) => {
      search = values.get("search");
      await load();
    });
    await load();
  }
  async function activity(initial = {}) {
    panel.innerHTML = `<form class="toolbar">${select(
      "Filter by",
      "kind",
      [
        ["actorId", "Account ID"],
        ["actorRoleAtTime", "Role at the time"],
        ["quizId", "Quiz ID"],
        ["actionName", "Action name"],
      ],
      initial.actorId ? "actorId" : "actorId",
    )}${field("Filter value", "value", "text", initial.actorId || "", 'placeholder="Blank = all activity" maxlength="128"')}<button class="button primary">Apply</button></form><div class="history-feed"></div>`;
    let filter = initial;
    const list = panel.querySelector(".history-feed"),
      setPage = pagination(list, load);
    async function load(cursor) {
      const result = await api("listActivity", {
        ...filter,
        limit: 25,
        ...(cursor ? { cursor } : {}),
      });
      if (!cursor) list.innerHTML = "";
      list.insertAdjacentHTML("beforeend", activityRows(result.items));
      if (!result.items.length && !cursor)
        list.innerHTML = empty("No matching activity");
      setPage(result.nextCursor);
    }
    bindForm(panel.querySelector("form"), async (values) => {
      const key =
        values.get("kind") === "actorRoleAtTime" ? "role" : values.get("kind");
      filter = values.get("value") ? { [key]: values.get("value") } : {};
      await load();
    });
    await load();
  }
  async function content() {
    panel.innerHTML = `<form class="toolbar">${select(
      "Content",
      "kind",
      [
        ["quizzes", "Quizzes"],
        ["problems", "Problems"],
      ],
      "quizzes",
    )}${field("Owner account ID (optional)", "ownerId", "text", "", 'maxlength="128"')}${select(
      "State",
      "lifecycle",
      [
        ["active", "Active"],
        ["trashed", "Trash"],
      ],
      "active",
    )}<button class="button primary">Apply</button></form><div id="content-list"></div>`;
    let filter = { kind: "quizzes", lifecycle: "active" };
    const list = panel.querySelector("#content-list"),
      setPage = pagination(list, load);
    async function load(cursor) {
      const result = await api("adminListContent", {
        ...filter,
        limit: 25,
        ...(cursor ? { cursor } : {}),
      });
      if (!cursor) list.innerHTML = "";
      list.insertAdjacentHTML(
        "beforeend",
        result.items
          .map(
            (row) =>
              `<div class="list-row"><div class="row-main"><h3>${e(row.title)}</h3><p>${e(row.ownerDisplayName || row.ownerId)} · ${date(row.updatedAt)} · ${e(row.lifecycle)}</p></div>${linkButton("Open", `${filter.kind === "quizzes" ? "quiz-manage" : "problem-edit"}.html?id=${row.id}`, "secondary")}</div>`,
          )
          .join(""),
      );
      if (!result.items.length && !cursor)
        list.innerHTML = empty("No matching content");
      setPage(result.nextCursor);
    }
    bindForm(panel.querySelector("form"), async (values) => {
      filter = Object.fromEntries([...values].filter(([, v]) => v));
      await load();
    });
    await load();
  }
  async function jobs() {
    panel.innerHTML = `<form class="toolbar">${select(
      "Job status",
      "status",
      [
        ["failed", "Failed"],
        ["running", "Running"],
        ["queued", "Queued"],
        ["succeeded", "Completed"],
        ["cancelled", "Cancelled"],
      ],
      "failed",
    )}<button class="button primary">Refresh</button></form><div id="jobs-list"></div>`;
    let status = "failed";
    const list = panel.querySelector("#jobs-list"),
      setPage = pagination(list, load);
    async function load(cursor) {
      const result = await api("listJobs", {
        status,
        limit: 25,
        ...(cursor ? { cursor } : {}),
      });
      if (!cursor) list.innerHTML = "";
      list.insertAdjacentHTML(
        "beforeend",
        result.items
          .map(
            (j) =>
              `<div class="list-row"><div class="row-main"><h3>${e(j.kind.replaceAll("_", " "))} ${badge(j.status, j.status === "failed" ? "red" : "")}</h3><p>${e(j.requestedBy)} · ${date(j.updatedAt)} · ${j.progress.processed}/${j.progress.total}</p><p class="inline-code">${e(j.id)}</p>${j.error ? `<p class="job-error">${e(j.error.message)}</p>` : ""}</div><div class="actions">${j.status === "failed" && j.kind !== "import" ? `<button class="button secondary" data-retry="${e(j.id)}">Retry job</button>` : ""}${["publish_quiz", "duplicate_quiz"].includes(j.kind) ? linkButton("Open quiz", `quiz-manage.html?id=${j.targetId}`, "ghost") : ""}</div></div>`,
          )
          .join(""),
      );
      if (!result.items.length && !cursor)
        list.innerHTML = empty("No jobs in this state");
      setPage(result.nextCursor);
      list.querySelectorAll("[data-retry]").forEach(
        (b) =>
          (b.onclick = () =>
            busy(
              b,
              async () => {
                await api("retryJob", { jobId: b.dataset.retry });
                await load();
              },
              root,
            )),
      );
    }
    bindForm(panel.querySelector("form"), async (values) => {
      status = values.get("status");
      await load();
    });
    await load();
  }
  async function switchTab(value, initial) {
    tab = value;
    root
      .querySelectorAll("[data-tab]")
      .forEach((b) =>
        b.setAttribute("aria-selected", String(b.dataset.tab === tab)),
      );
    panel.innerHTML = loading();
    await { users, activity, content, jobs }[tab](initial);
  }
  root
    .querySelectorAll("[data-tab]")
    .forEach(
      (b) => (b.onclick = () => busy(b, () => switchTab(b.dataset.tab), root)),
    );
  await switchTab(tab);
}
