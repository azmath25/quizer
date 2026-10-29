import { api } from "../services/api.js";
import {
  pageHead,
  linkButton,
  field,
  select,
  bindForm,
  action,
  empty,
  loading,
  e,
  badge,
  points,
  busy,
  message,
  pagination,
  dialog,
  confirmDialog,
  icon,
} from "../components/ui.js";
import { displayProblem } from "../components/math-content.js";
export async function mount(root, session) {
  const params = new URLSearchParams(location.search),
    addTo = params.get("quiz");
  let view = "mine",
    lifecycle = "active",
    filter = {},
    selected = new Map(),
    rows = [];
  root.innerHTML =
    pageHead(
      "Problem bank",
      "Build quizzes from saved problems. Each selection keeps its chosen revision.",
      linkButton("New problem", "problem-edit.html", "primary", "plus"),
    ) +
    `<div class="tabs" role="tablist" aria-label="Problem bank"><button role="tab" data-view="mine" aria-selected="true">My problems</button><button role="tab" data-view="shared" aria-selected="false">Shared with teachers</button><button role="tab" data-view="trash" aria-selected="false">Trash</button></div><form class="toolbar">${field("Title starts with", "search", "search", "", 'placeholder="Search problem titles…" maxlength="200"')}${field("Subject", "subject", "text", "", 'placeholder="Any subject" maxlength="80"')}<button class="button primary">Search</button></form><div data-message></div><div class="grid" id="bank-list"></div><section class="selection-tray" hidden><div><strong id="selected-count"></strong><p class="muted small">Chosen revisions are kept when you change pages.</p></div><div class="actions"><button class="button secondary" id="clear-selection">Clear</button><button class="button secondary" id="review-selection">Order & points</button><button class="button primary" id="build-quiz">${addTo ? "Add to quiz" : "Create quiz"}</button></div></section>`;
  const list = root.querySelector("#bank-list"),
    setPage = pagination(list, load);
  function tray() {
    const node = root.querySelector(".selection-tray");
    node.hidden = selected.size === 0;
    root.querySelector("#selected-count").textContent =
      `${selected.size} problem${selected.size === 1 ? "" : "s"} selected`;
  }
  async function load(cursor) {
    if (!cursor) {
      rows = [];
      list.innerHTML = loading();
    }
    const result = await api("listProblems", {
      view: view === "trash" ? "mine" : view,
      lifecycle: view === "trash" ? "trashed" : "active",
      ...filter,
      limit: 12,
      ...(cursor ? { cursor } : {}),
    });
    if (!cursor) list.innerHTML = "";
    rows.push(...result.items);
    list.insertAdjacentHTML(
      "beforeend",
      result.items
        .map(
          (p) =>
            `<article class="panel bank-card"><div class="bank-select"><span class="subject">${e(p.subject || "Mathematics")}</span>${view !== "trash" ? `<label class="check"><input type="checkbox" data-select="${e(p.id)}" ${selected.has(p.id) ? "checked" : ""}><span class="sr-only">Select ${e(p.title)}</span></label>` : badge("Trash")}</div><h3>${e(p.title)}</h3><p class="muted small">Revision ${p.revisionNumber} · ${e(p.ownerDisplayName || "Teacher")}${p.difficulty ? " · " + e(p.difficulty) : ""}</p><div class="actions">${p.tags.map((t) => badge(t)).join("")}</div><div class="card-foot"><button class="button ghost small" data-preview="${e(p.id)}">Preview</button><div class="actions">${view === "trash" ? `<button class="button secondary small" data-restore="${e(p.id)}">Restore</button>` : linkButton(p.ownerId === session.user.uid || session.capabilities.admin ? "Edit" : "View / copy", `problem-edit.html?id=${p.id}`, "secondary small")}${p.ownerId === session.user.uid && view !== "trash" ? `<button class="icon-button" data-trash="${e(p.id)}" aria-label="Move ${e(p.title)} to Trash">${icon("close")}</button>` : ""}</div></div></article>`,
        )
        .join(""),
    );
    if (!rows.length)
      list.innerHTML = empty(
        "No problems found",
        view === "shared"
          ? "Problems shared by teachers will appear here."
          : "Create a problem or import a LaTeX quiz.",
      );
    setPage(result.nextCursor);
    list.querySelectorAll("[data-select]").forEach(
      (n) =>
        (n.onchange = () => {
          const row = rows.find((p) => p.id === n.dataset.select);
          if (n.checked) selected.set(row.id, { ...row, points: 1 });
          else selected.delete(row.id);
          tray();
        }),
    );
    list.querySelectorAll("[data-preview]").forEach(
      (b) =>
        (b.onclick = () =>
          busy(
            b,
            async () => {
              const d = await api("getProblem", {
                problemId: b.dataset.preview,
              });
              const node = document.createElement("div");
              await displayProblem(node, d.content, d.grading, {
                kind: "problem",
                id: d.problemId,
                revisionId: d.revisionId,
              });
              await dialog({
                title: d.problem.title,
                body: node.innerHTML,
                confirm: "Close preview",
              });
            },
            root,
          )),
    );
    for (const kind of ["trash", "restore"])
      list.querySelectorAll("[data-" + kind + "]").forEach(
        (b) =>
          (b.onclick = () =>
            busy(
              b,
              async () => {
                const row = rows.find((p) => p.id === b.dataset[kind]);
                if (
                  kind === "trash" &&
                  !(await confirmDialog(
                    "Move problem to Trash?",
                    "Published quizzes keep their snapshots. This problem will leave your active bank.",
                    "Move to Trash",
                  ))
                )
                  return;
                await api(
                  kind === "trash" ? "trashProblem" : "restoreProblem",
                  { problemId: row.id, expectedVersion: row.version },
                );
                selected.delete(row.id);
                tray();
                await load();
              },
              root,
            )),
      );
  }
  bindForm(root.querySelector("form"), async (form) => {
    filter = Object.fromEntries(
      [...form.entries()].filter(([, v]) => v.trim()),
    );
    await load();
  });
  root.querySelectorAll("[data-view]").forEach(
    (b) =>
      (b.onclick = () =>
        busy(
          b,
          async () => {
            view = b.dataset.view;
            root
              .querySelectorAll("[data-view]")
              .forEach((n) => n.setAttribute("aria-selected", String(n === b)));
            await load();
          },
          root,
        )),
  );
  action(root, "#clear-selection", async () => {
    selected.clear();
    list.querySelectorAll("[data-select]").forEach((n) => (n.checked = false));
    tray();
  });
  action(root, "#review-selection", async () => {
    const values = [...selected.values()];
    for (const p of values)
      if (!p.loaded) {
        const data = await api("getProblem", {
          problemId: p.id,
          revisionId: p.latestRevisionId,
        });
        p.points = data.content.defaultPoints;
        p.loaded = true;
      }
    const body = values
      .map(
        (p, i) =>
          `<div class="form-grid">${field("Order · " + p.title, "order_" + p.id, "number", i + 1, 'min="1" max="500" required')}${field("Points", "points_" + p.id, "number", p.points, 'min="0.00000001" max="1000" step="any" required')}</div>`,
      )
      .join("");
    const form = await dialog({
      title: "Order and points",
      body,
      confirm: "Apply",
    });
    if (!form) return;
    values.forEach((p) => {
      p.position = Number(form.get("order_" + p.id));
      p.points = Number(form.get("points_" + p.id));
    });
    values.sort((a, b) => a.position - b.position);
    selected = new Map(values.map((p) => [p.id, p]));
    tray();
  });
  action(root, "#build-quiz", async () => {
    let quizId = addTo;
    if (!quizId) {
      const values = await dialog({
        title: "Create a quiz",
        body: field(
          "Quiz title",
          "title",
          "text",
          "New quiz",
          'required maxlength="200"',
        ),
        confirm: "Create private draft",
      });
      if (!values) return;
      quizId = (await api("createQuiz", { title: values.get("title") })).quizId;
    }
    let draft = await api("getQuizDraft", { quizId }),
      order = [...draft.draft.itemOrder],
      version = draft.draft.version;
    const values = [...selected.values()];
    for (const p of values)
      if (!p.loaded) {
        const data = await api("getProblem", {
          problemId: p.id,
          revisionId: p.latestRevisionId,
        });
        p.points = data.content.defaultPoints;
        p.loaded = true;
      }
    for (let start = 0; start < values.length; start += 20) {
      const batch = values.slice(start, start + 20).map((p, i) => ({
        clientKey: "selection_" + (start + i),
        problemId: p.id,
        problemRevisionId: p.latestRevisionId,
        points: p.points,
      }));
      const result = await api("saveQuizDraft", {
        quizId,
        expectedDraftVersion: version,
        upsertItems: batch,
        itemOrder: [...order, ...batch.map((i) => i.clientKey)],
      });
      version = result.draftVersion;
      order = result.itemOrder;
      message(
        root,
        `Added ${Math.min(start + 20, values.length)} of ${values.length} problems…`,
        "info",
      );
    }
    location.href = `upload.html?id=${quizId}`;
  });
  await load();
}
