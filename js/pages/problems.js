import { go } from "../core/router.js";
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
      `<div class="actions">${linkButton("Import problems", "upload.html?bank=1", "secondary", "upload")}${linkButton("New problem", "problem-edit.html", "primary", "plus")}</div>`,
    ) +
    `<div class="tabs" role="tablist" aria-label="Problem bank"><button role="tab" data-view="mine" aria-selected="true">My problems</button><button role="tab" data-view="shared" aria-selected="false">Shared with teachers</button><button role="tab" data-view="trash" aria-selected="false">Trash</button></div><form class="toolbar">${field("Title starts with", "search", "search", "", 'placeholder="Search problem titles…" maxlength="200"')}${field("Subject", "subject", "text", "", 'placeholder="Any subject" maxlength="80"')}<button class="button primary">Search</button></form><div data-message></div><div class="bank-layout"><div class="grid" id="bank-list"></div><aside class="selection-panel" id="selection-panel" aria-label="Selected problems" hidden></aside></div>`;
  const list = root.querySelector("#bank-list"),
    setPage = pagination(list, load);
  const panel = root.querySelector("#selection-panel"),
    mine = (p) => p.row.ownerId === session.user.uid;
  const total = () =>
    [...selected.values()].reduce((sum, p) => sum + (Number(p.points) || 0), 0);
  function updateTotal() {
    const node = panel.querySelector("#sel-total");
    if (node) node.textContent = points(total()) + " points";
  }
  const details = new Map();
  function fetchDetail(row) {
    const key = row.id + ":" + row.latestRevisionId;
    if (!details.has(key))
      details.set(
        key,
        api("getProblem", {
          problemId: row.id,
          revisionId: row.latestRevisionId,
        }).catch((error) => {
          details.delete(key);
          throw error;
        }),
      );
    return details.get(key);
  }
  const seen = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        seen.unobserve(en.target);
        const row = rows.find((r) => r.id === en.target.dataset.body);
        if (!row) continue;
        fetchDetail(row)
          .then((d) =>
            displayProblem(en.target, { ...d.content, defaultPoints: null, points: null }, null, {
              kind: "problem",
              id: d.problemId,
              revisionId: d.revisionId,
            }),
          )
          .then(() => en.target.classList.add("ready"))
          .catch(() => (en.target.textContent = "Preview unavailable."));
      }
    },
    { rootMargin: "200px" },
  );
  function ensureLoaded(p) {
    if (p.loaded || p.loading) return p.loading;
    p.loading = fetchDetail(p.row)
      .then((data) => {
        p.points = data.content.defaultPoints ?? 1;
        p.loaded = true;
        const input = panel.querySelector(`[data-points="${CSS.escape(p.id)}"]`);
        if (input) input.value = p.points;
        updateTotal();
      })
      .catch(() => {})
      .finally(() => (p.loading = null));
    return p.loading;
  }
  function tray() {
    const values = [...selected.values()];
    panel.hidden = values.length === 0;
    if (!values.length) return (panel.innerHTML = "");
    panel.innerHTML = `<div class="sel-head"><h2>${values.length} selected</h2><strong id="sel-total"></strong></div><ol class="sel-list">${values
      .map(
        (p, i) =>
          `<li class="sel-row" data-row="${e(p.id)}"><span class="sel-num">${i + 1}</span><span class="sel-title" title="${e(p.title)}">${e(p.title)}</span><label class="sel-points"><span class="sr-only">Points for ${e(p.title)}</span><input type="number" min="0.00000001" max="1000" step="any" value="${e(p.points)}" data-points="${e(p.id)}"></label><span class="sel-ctl"><button type="button" class="icon-button" data-move="up" data-id="${e(p.id)}" aria-label="Move up" ${i === 0 ? "disabled" : ""}>↑</button><button type="button" class="icon-button" data-move="down" data-id="${e(p.id)}" aria-label="Move down" ${i === values.length - 1 ? "disabled" : ""}>↓</button><button type="button" class="icon-button" data-remove="${e(p.id)}" aria-label="Remove ${e(p.title)}">${icon("close")}</button></span></li>`,
      )
      .join("")}</ol><div class="sel-actions"><button class="button primary" id="build-quiz">${addTo ? "Add to quiz" : "Create quiz"}</button><div class="actions"><button class="button secondary small" id="bulk-visibility">Visibility</button><button class="button ghost small" id="clear-selection">Clear</button></div></div>`;
    updateTotal();
    panel.querySelectorAll("[data-points]").forEach((n) =>
      n.addEventListener("input", () => {
        const p = selected.get(n.dataset.points);
        if (p && Number(n.value) > 0) {
          p.points = Number(n.value);
          p.loaded = true;
          updateTotal();
        }
      }),
    );
    panel.querySelectorAll("[data-move]").forEach((n) =>
      n.addEventListener("click", () => {
        const ids = [...selected.keys()],
          i = ids.indexOf(n.dataset.id),
          j = n.dataset.move === "up" ? i - 1 : i + 1;
        if (j < 0 || j >= ids.length) return;
        [ids[i], ids[j]] = [ids[j], ids[i]];
        selected = new Map(ids.map((id) => [id, selected.get(id)]));
        tray();
      }),
    );
    panel.querySelectorAll("[data-remove]").forEach((n) =>
      n.addEventListener("click", () => {
        selected.delete(n.dataset.remove);
        const box = list.querySelector(
          `[data-select="${CSS.escape(n.dataset.remove)}"]`,
        );
        if (box) box.checked = false;
        tray();
      }),
    );
    action(panel, "#clear-selection", async () => {
      selected.clear();
      list.querySelectorAll("[data-select]").forEach((n) => (n.checked = false));
      tray();
    });
    action(panel, "#bulk-visibility", bulkVisibility);
    action(panel, "#build-quiz", buildQuiz);
  }
  function paintCard(id) {
    const row = rows.find((p) => p.id === id);
    const card = list.querySelector(`[data-card="${CSS.escape(id)}"]`);
    if (!row || !card) return;
    const shared = row.bankVisibility === "teachers";
    card.querySelector("[data-vis]").innerHTML = badge(
      shared ? "Shared" : "Private",
      shared ? "blue" : "",
    );
    const t = card.querySelector("[data-share]");
    if (t) t.textContent = shared ? "Unshare" : "Share";
  }
  async function setVisibility(row, visibility) {
    const result = await api("setProblemSharing", {
      problemId: row.id,
      expectedVersion: row.version,
      visibility,
    });
    row.bankVisibility = visibility;
    row.version = result.version;
  }
  async function bulkVisibility() {
    const owned = [...selected.values()].filter(mine);
    if (!owned.length)
      throw new Error("You can only change visibility of your own problems.");
    const values = await dialog({
      title: "Problem visibility",
      body: `<p class="muted small">Applies to ${owned.length} of your selected problem${owned.length === 1 ? "" : "s"}.</p>${select("Visible to", "visibility", [["private", "Only me"], ["teachers", "All teachers"]], "private")}`,
      confirm: "Apply",
    });
    if (!values) return;
    const visibility = values.get("visibility");
    let failed = 0;
    for (let i = 0; i < owned.length; i += 5)
      await Promise.all(
        owned.slice(i, i + 5).map((p) =>
          setVisibility(p.row, visibility)
            .then(() => paintCard(p.id))
            .catch(() => failed++),
        ),
      );
    message(
      root,
      failed
        ? `${failed} problem${failed === 1 ? "" : "s"} could not be updated.`
        : "Visibility updated.",
      failed ? "error" : "success",
    );
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
            `<article class="panel bank-card" data-card="${e(p.id)}"><div class="bank-select"><span class="subject">${e(p.subject || "Mathematics")}</span><span data-vis>${view === "mine" ? badge(p.bankVisibility === "teachers" ? "Shared" : "Private", p.bankVisibility === "teachers" ? "blue" : "") : ""}</span>${view !== "trash" ? `<label class="check"><input type="checkbox" data-select="${e(p.id)}" ${selected.has(p.id) ? "checked" : ""}><span class="sr-only">Select ${e(p.title)}</span></label>` : badge("Trash")}</div><h3>${e(p.title)}</h3><div class="bank-body math-content" data-body="${e(p.id)}"><div class="skeleton" style="height:56px"></div></div><p class="muted small">Revision ${p.revisionNumber} · ${e(p.ownerDisplayName || "Teacher")}${p.difficulty ? " · " + e(p.difficulty) : ""}</p><div class="actions">${p.tags.map((t) => badge(t)).join("")}</div><div class="card-foot"><button class="button ghost small" data-preview="${e(p.id)}">Preview</button><div class="actions">${view === "trash" ? `<button class="button secondary small" data-restore="${e(p.id)}">Restore</button>` : linkButton(p.ownerId === session.user.uid || session.capabilities.admin ? "Edit" : "View / copy", `problem-edit.html?id=${p.id}`, "secondary small")}${p.ownerId === session.user.uid && view === "mine" ? `<button class="button ghost small" data-share="${e(p.id)}">${p.bankVisibility === "teachers" ? "Unshare" : "Share"}</button>` : ""}${p.ownerId === session.user.uid && view !== "trash" ? `<button class="icon-button" data-trash="${e(p.id)}" aria-label="Move ${e(p.title)} to Trash">${icon("close")}</button>` : ""}</div></div></article>`,
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
          if (n.checked) {
            const entry = { id: row.id, title: row.title, row, points: 1 };
            selected.set(row.id, entry);
            ensureLoaded(entry);
          } else selected.delete(row.id);
          tray();
        }),
    );
    list.querySelectorAll("[data-body]:not(.ready)").forEach((n) => seen.observe(n));
    list.querySelectorAll("[data-share]").forEach(
      (b) =>
        (b.onclick = async () => {
          const row = rows.find((p) => p.id === b.dataset.share),
            previous = row.bankVisibility,
            next = previous === "teachers" ? "private" : "teachers";
          row.bankVisibility = next;
          paintCard(row.id);
          try {
            const result = await api("setProblemSharing", {
              problemId: row.id,
              expectedVersion: row.version,
              visibility: next,
            });
            row.version = result.version;
          } catch (error) {
            row.bankVisibility = previous;
            paintCard(row.id);
            message(root, error.message || "Could not change visibility.");
          }
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
  async function buildQuiz() {
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
    await Promise.all(values.map(ensureLoaded));
    for (let start = 0; start < values.length; start += 20) {
      const batch = values.slice(start, start + 20).map((p, i) => ({
        clientKey: "selection_" + (start + i),
        problemId: p.id,
        problemRevisionId: p.row.latestRevisionId,
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
    go(`upload.html?id=${quizId}`);
  }
  await load();
}
