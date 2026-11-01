import { go, onLeave } from "../core/router.js";
import { api, apiSWR } from "../services/api.js";
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
  toast,
  icon,
  date,
} from "../components/ui.js";
import { displayProblem, latexHTML, typeset } from "../components/math-content.js";
import { resolveImages } from "../services/assets.js";
import { loadStars, isStarred, toggleStar, problemRef } from "../services/stars.js";
import { toLatex } from "../services/ai.js";
import { quickEdit, history, bulkEdit } from "../components/problem-tools.js";
export async function mount(root, session) {
  const params = new URLSearchParams(location.search),
    addTo = params.get("quiz");
  let view = "mine",
    lifecycle = "active",
    filter = {},
    q = "",
    starOnly = false,
    sort = "new",
    all = [],
    selected = new Map(),
    rows = [];
  root.innerHTML =
    pageHead(
      "Problem bank",
      "Build quizzes from saved problems. Each selection keeps its chosen revision.",
      `<div class="actions">${linkButton("Import problems", "upload.html?bank=1", "secondary", "upload")}${linkButton("New problem", "problem-edit.html", "primary", "plus")}</div>`,
    ) +
    `<div class="tabs" role="tablist" aria-label="Problem bank"><button role="tab" data-view="mine" aria-selected="true">My problems</button><button role="tab" data-view="shared" aria-selected="false">Shared with teachers</button><button role="tab" data-view="trash" aria-selected="false">Trash</button></div><form class="toolbar">${field("Search", "q", "search", "", 'placeholder="Title, tag, subject or text…" maxlength="200"')}${field("Subject", "subject", "text", "", 'placeholder="Any subject" maxlength="80"')}<label class="field"><span>Sort</span><select name="sort"><option value="new">Newest</option><option value="old">Oldest</option><option value="title">Title A–Z</option><option value="difficulty">Difficulty</option></select></label><label class="check"><input type="checkbox" name="starred"> Starred only</label><button class="button primary">Apply</button></form><div class="filter-bar" id="filter-bar" hidden></div><div data-message></div><div class="bank-layout"><div class="grid" id="bank-list"></div><aside class="selection-panel" id="selection-panel" aria-label="Selected problems" hidden></aside></div>`;
  const list = root.querySelector("#bank-list"),
    setPage = pagination(list, load, { auto: true });
  const panel = root.querySelector("#selection-panel"),
    mine = (p) => p.row.ownerId === session.user.uid;
  const total = () =>
    [...selected.values()].reduce((sum, p) => sum + (Number(p.points) || 0), 0);
  function updateTotal() {
    const node = panel.querySelector("#sel-total");
    if (node) node.textContent = points(total()) + " points";
  }
  const details = new Map(),
    resolved = new Map();
  let slots = 0;
  const waiting = [];
  const throttled = (fn) =>
    new Promise((resolve, reject) => {
      const run = () => {
        slots++;
        fn()
          .then(resolve, reject)
          .finally(() => {
            slots--;
            waiting.shift()?.();
          });
      };
      slots < 4 ? run() : waiting.push(run);
    });
  function fetchDetail(row) {
    const key = row.id + ":" + row.latestRevisionId;
    if (!details.has(key))
      details.set(
        key,
        throttled(() =>
          api("getProblem", {
            problemId: row.id,
            revisionId: row.latestRevisionId,
          }),
        )
          .then((d) => (resolved.set(key, d), d))
          .catch((error) => {
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
      .join("")}</ol><div class="dock-split"><section class="dock-card" aria-label="Build a quiz"><h3>Build a quiz</h3><p class="muted small">${values.length} problem${values.length === 1 ? "" : "s"} in this order</p><button class="button primary" id="build-quiz">${addTo ? "Add to quiz" : "Create quiz"}</button></section><section class="dock-card" aria-label="Visibility"><h3>Visibility</h3><p class="muted small">${values.filter(mine).length} of your selected</p><div class="dock-row"><select id="bulk-vis" aria-label="Visible to"><option value="private">Only me</option><option value="teachers">All teachers</option></select><button class="button primary" id="bulk-visibility">Apply</button></div></section><section class="dock-card" aria-label="Edit details"><h3>Edit details</h3><p class="muted small">Subject, difficulty, tags</p><button class="button secondary" id="bulk-edit-open">Edit ${values.filter(mine).length} of yours</button></section></div><button class="button ghost small" id="clear-selection">Clear selection</button>`;
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
    action(panel, "#bulk-edit-open", async () => {
      const owned = [...selected.values()].filter(mine);
      if (!owned.length) throw new Error("You can only edit your own problems.");
      bulkEdit(owned.map((p) => p.row), {
        onSaved: (done) => {
          done.forEach((r) => redraw(r.id));
          message(root, `${done.length} problem${done.length === 1 ? "" : "s"} updated.`, "success");
        },
      });
    });
    action(panel, "#build-quiz", buildQuiz);
  }

    const isOwner = (p) => p.ownerId === session.user.uid;
  const visLabel = (shared) => (shared ? "Shared with teachers" : "Only me");
  const tip = (label) => `data-tooltip="${label}" aria-label="${label}"`;
  function cardHtml(p) {
    const own = isOwner(p),
      id = e(p.id),
      shared = p.bankVisibility === "teachers",
      link = new URL(`problem-edit.html?id=${p.id}`, location.href).href,
      trash = view === "trash";
    const btn = (kind, symbol, label, extra = "") =>
      `<button type="button" class="action-btn action-btn--${kind}" ${extra} ${tip(label)}>${icon(symbol)}</button>`;
    const star = isStarred(problemRef(p.id));
    const actions = trash
      ? btn("restore", "restore", "Restore", `data-restore="${id}"`) + btn("copy", "copy", "Copy LaTeX", "data-copy-latex")
      : btn("copy", "copy", "Copy LaTeX", "data-copy-latex") +
        btn("star" + (star ? " is-active" : ""), "star", star ? "Remove star" : "Star", "data-star") +
        `<div class="popover-wrapper"><button type="button" class="action-btn action-btn--pop" data-pop ${tip("Share")}>${icon("share")}</button><div class="action-popover"><div class="popover-title">Share this problem</div><div class="share-row"><input type="text" readonly value="${e(link)}" aria-label="Problem link"><button type="button" class="popover-btn" data-copy-link>Copy</button></div>${own && view === "mine" ? `<div class="popover-title">Visible to</div><button type="button" class="popover-btn wide" data-share="${id}" aria-pressed="${shared}">${visLabel(shared)}</button>` : ""}</div></div>` +
        btn("download", "download", "Download .tex", "data-download") +
        btn("solve", "bulb", "Answer and solution", "data-solve") +
        `<a class="action-btn action-btn--external" href="problem-edit.html?id=${id}" target="_blank" rel="noopener" ${tip(own || session.capabilities.admin ? "Open and edit" : "Open")}>${icon("external")}</a>`;
    const chips = [
      ["Owner", e(p.ownerDisplayName || "Teacher")],
      ["Revision", p.revisionNumber],
      ["Updated", p.updatedAt ? e(date(p.updatedAt)) : "—"],
      ...(trash ? [] : [["Visible to", `<span data-vis>${e(visLabel(shared))}</span>`]]),
      ...(p.tags?.length ? [["Tags", e(p.tags.join(", "))]] : []),
    ]
      .map(([k, v]) => `<div class="meta-chip"><span class="meta-chip-label">${k}</span><span class="meta-chip-value">${v}</span></div>`)
      .join("");
    const backActions = trash
      ? ""
      : (own ? `<button type="button" class="button secondary small" data-edit>${icon("edit")}Quick edit</button>` : "") +
        `<button type="button" class="button secondary small" data-history>${icon("restore")}Versions</button><button type="button" class="button secondary small" data-fork>${icon("copy")}Copy as new</button>` +
        (own ? `<button type="button" class="button danger small" data-trash="${id}">${icon("trash")}Move to Trash</button>` : "");
    return `<div class="problem-wrapper" data-card="${id}"><div class="prob-tabs"><div class="tab-meta"><a class="meta-id" href="problem-edit.html?id=${id}">#${id.slice(0, 6)}</a>${p.difficulty ? `<span class="meta-tag">${e(p.difficulty)}</span>` : ""}<span class="meta-tag">${e(p.subject || "Mathematics")}</span></div><div class="tab-actions">${trash ? badge("Trash") : `<label class="prob-select"><input type="checkbox" data-select="${id}" ${selected.has(p.id) ? "checked" : ""}><span class="sr-only">Select ${e(p.title)}</span></label>`}${actions}<button type="button" class="action-btn action-btn--flip" data-flip ${tip("Details")}>${icon("flip")}</button></div></div><article class="prob-card-box"><div class="flip-container"><div class="flip-card"><div class="flip-face flip-face--front"><div class="prob-card__body"><h3 class="prob-title">${e(p.title)}</h3>${p.tags?.length ? `<div class="tag-row">${p.tags.map((t) => `<button type="button" class="tag-chip" data-tag="${e(t)}">${e(t)}</button>`).join("")}</div>` : ""}<div class="prob-card__text bank-body math-content" data-body="${id}"><div class="skeleton" style="height:56px"></div></div></div></div><div class="flip-face flip-face--back" inert><div class="meta-back"><div class="meta-back-chips">${chips}</div>${backActions ? `<div class="actions">${backActions}</div>` : ""}</div></div></div></div><div class="prob-card__solution"><div class="solution-inner" data-solution="${id}"></div></div></article></div>`;
  }
  async function paintSolution(row, node) {
    const d = await fetchDetail(row),
      c = d.content,
      g = d.grading || {},
      images = await resolveImages(
        { ...c.questionAssetBindings, ...g.solutionAssetBindings },
        { kind: "problem", id: d.problemId, revisionId: d.revisionId },
      ),
      correct = (c.options || []).find((o) => o.id === g.correctOptionId),
      answer = correct
        ? latexHTML(correct.textLatex, images)
        : e((g.acceptedAnswers || []).join(", "));
    node.innerHTML = `<div class="solution-content"><div class="solution-header-group"><h4 class="solution-title">Answer</h4></div>${answer ? `<div class="math-content">${answer}</div>` : '<p class="muted">No answer recorded.</p>'}</div>${g.explanationLatex ? `<div class="solution-content"><div class="solution-header-group"><h4 class="solution-title">Solution</h4></div><div class="math-content">${latexHTML(g.explanationLatex, images)}</div></div>` : ""}`;
    await typeset(node);
  }
  const closePopovers = (except) =>
    list.querySelectorAll(".action-popover.is-open").forEach((n) => n !== except && n.classList.remove("is-open"));
  const onStars = () =>
    list.querySelectorAll(".action-btn--star").forEach((b) => {
      const on = isStarred(problemRef(b.closest("[data-card]").dataset.card));
      b.classList.toggle("is-active", on);
      b.dataset.tooltip = b.ariaLabel = on ? "Remove star" : "Star";
    });
  document.addEventListener("stars-changed", onStars);
  onLeave(() => document.removeEventListener("stars-changed", onStars));
  loadStars().catch(() => {});
  async function copyText(text, ok) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const t = document.createElement("textarea");
      t.value = text;
      document.body.append(t);
      t.select();
      document.execCommand("copy");
      t.remove();
    }
    message(root, ok, "success");
  }
  async function latexOf(row) {
    const d = await fetchDetail(row),
      c = d.content,
      g = d.grading || {};
    return toLatex(
      [
        {
          points: c.defaultPoints ?? 1,
          statement: c.statementLatex,
          type: c.type,
          options: (c.options || []).map((o) => ({ text: o.textLatex, correct: o.id === g.correctOptionId })),
          answer: (g.acceptedAnswers || [])[0],
          solution: g.explanationLatex,
        },
      ],
      row.title,
    );
  }
  list.addEventListener("click", (ev) => {
    const t = ev.target.closest("button");
    if (!t || !list.contains(t)) return closePopovers();
    if (t.dataset.tag) return setTag(t.dataset.tag);
    if (t.dataset.resetFilters !== undefined) {
      q = "";
      starOnly = false;
      filter = {};
      root.querySelector("form").reset();
      return load();
    }
    const card = t.closest("[data-card]");
    const id = card?.dataset.card,
      row = rows.find((r) => r.id === id);
    if (!row) return;
    if (t.hasAttribute("data-pop")) {
      const pop = t.parentElement.querySelector(".action-popover"),
        open = !pop.classList.contains("is-open");
      closePopovers();
      pop.classList.toggle("is-open", open);
      return;
    }
    if (!t.closest(".popover-wrapper")) closePopovers();
    if (t.hasAttribute("data-flip")) {
      const flipped = card.querySelector(".flip-card").classList.toggle("is-flipped");
      t.classList.toggle("is-active", flipped);
      t.dataset.tooltip = t.ariaLabel = flipped ? "Back" : "Details";
      card.querySelector(".flip-face--front").inert = flipped;
      card.querySelector(".flip-face--back").inert = !flipped;
    } else if (t.hasAttribute("data-edit"))
      busy(t, () => quickEdit(row, { onSaved: () => { redraw(row.id); message(root, "Saved as a new revision.", "success"); } }), root);
    else if (t.hasAttribute("data-history"))
      busy(t, () => history(row, { canRestore: mine({ row }), onSaved: () => { redraw(row.id); message(root, "Version restored.", "success"); } }), root);
    else if (t.hasAttribute("data-fork"))
      busy(
        t,
        async () => {
          const copy = await api("forkProblem", { problemId: row.id, revisionId: row.latestRevisionId });
          message(root, "Copy created in your bank.", "success");
          if (view === "mine") await load();
          else go(`problem-edit.html?id=${copy.problemId}`);
        },
        root,
      );
    else if (t.hasAttribute("data-solve")) {
      const open = card.classList.toggle("is-expanded");
      t.classList.toggle("is-active", open);
      const node = card.querySelector("[data-solution]");
      if (open && !node.children.length)
        paintSolution(row, node).catch(() => (node.textContent = "Solution unavailable."));
    } else if (t.hasAttribute("data-star"))
      toggleStar({ kind: "problem", problemId: id, title: row.title }).catch((error) =>
        message(root, error.message || "Could not update star."),
      );
    else if (t.hasAttribute("data-copy-link"))
      copyText(t.previousElementSibling.value, "Link copied.");
    else if (t.hasAttribute("data-copy-latex"))
      busy(t, async () => copyText(await latexOf(row), "LaTeX copied."), root);
    else if (t.hasAttribute("data-download"))
      busy(
        t,
        async () => {
          const a = document.createElement("a");
          a.href = URL.createObjectURL(new Blob([await latexOf(row)], { type: "text/x-tex" }));
          a.download = (row.title || "problem").replace(/[^\w.-]+/g, "_") + ".tex";
          a.click();
          URL.revokeObjectURL(a.href);
        },
        root,
      );
  });
  function paintCard(id) {
    const row = rows.find((p) => p.id === id);
    const card = list.querySelector(`[data-card="${CSS.escape(id)}"]`);
    if (!row || !card) return;
    const shared = row.bankVisibility === "teachers";
    const chip = card.querySelector("[data-vis]");
    if (chip) chip.textContent = visLabel(shared);
    const t = card.querySelector("[data-share]");
    if (t) {
      t.textContent = visLabel(shared);
      t.setAttribute("aria-pressed", shared);
    }
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
    const visibility = panel.querySelector("#bulk-vis").value;
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
  const difficultyRank = { easy: 0, medium: 1, hard: 2 };
  function matches(p) {
    if (starOnly && !isStarred(problemRef(p.id))) return false;
    if (!q) return true;
    const statement = resolved.get(p.id + ":" + p.latestRevisionId)?.content?.statementLatex;
    const text = [p.title, p.subject, p.difficulty, ...(p.tags || []), p.excerpt, statement]
      .join(" ")
      .toLowerCase();
    return q
      .toLowerCase()
      .split(/\s+/)
      .every((w) => text.includes(w));
  }
  function ordered(items) {
    const copy = items.filter(matches);
    const time = (p) => Date.parse(p.updatedAt) || 0;
    const by = {
      new: (x, y) => time(y) - time(x),
      old: (x, y) => time(x) - time(y),
      title: (x, y) => String(x.title).localeCompare(String(y.title)),
      difficulty: (x, y) =>
        (difficultyRank[String(x.difficulty).toLowerCase()] ?? 9) -
        (difficultyRank[String(y.difficulty).toLowerCase()] ?? 9),
    };
    return copy.sort(by[sort]);
  }
  function paintFilters() {
    const bar = root.querySelector("#filter-bar"),
      active = [
        filter.tag && ["tag", "Tag: " + filter.tag],
        filter.subject && ["subject", "Subject: " + filter.subject],
        q && ["q", "Search: " + q],
        starOnly && ["starred", "Starred only"],
      ].filter(Boolean);
    bar.hidden = !active.length;
    bar.innerHTML = active
      .map(([k, label]) => `<button type="button" class="tag-chip is-active" data-clear="${k}">${e(label)} ×</button>`)
      .join("");
  }
  function render() {
    const shown = ordered(rows);
    list.innerHTML = shown.length
      ? shown.map(cardHtml).join("")
      : empty(
          rows.length ? "No matches" : "No problems found",
          rows.length
            ? "Try a different search or clear a filter."
            : view === "shared"
              ? "Problems shared by teachers will appear here."
              : "Create a problem or import a LaTeX quiz.",
          rows.length
            ? '<button type="button" class="button secondary" data-reset-filters>Clear filters</button>'
            : view === "mine"
              ? linkButton("New problem", "problem-edit.html", "primary", "plus")
              : "",
        );
    paintFilters();
    bindCards(list);
  }
  async function setTag(tag) {
    filter = { tag };
    root.querySelector('[name="subject"]').value = "";
    await load();
  }
  const needAll = () => !!q || starOnly;
  let loadToken = 0;
  async function load(cursor) {
    const first = !cursor;
    if (first) {
      loadToken++;
      rows = [];
      list.innerHTML = loading();
    }
    const base = {
      view: view === "trash" ? "mine" : view,
      lifecycle: view === "trash" ? "trashed" : "active",
      ...filter,
    };
    let next = cursor,
      fresh = [];
    const stars = needAll() || view !== "trash" ? loadStars().catch(() => {}) : null;
    if (needAll()) {
      for (let page = 0; page < 5; page++) {
        const result = await api("listProblems", { ...base, limit: 100, ...(next ? { cursor: next } : {}) });
        fresh.push(...result.items);
        next = result.nextCursor;
        if (!next) break;
      }
    } else {
      if (first) {
        const token = ++loadToken;
        await apiSWR("listProblems", { ...base, limit: 12 }, async (data, stale) => {
          if (!stale) await stars;
          if (token !== loadToken) return;
          rows = [...data.items];
          render();
          setPage(data.nextCursor);
        });
        return;
      }
      const result = await api("listProblems", { ...base, limit: 12, cursor });
      fresh = result.items;
      next = result.nextCursor;
    }
    await stars;
    rows.push(...fresh);
    render();
    setPage(next);
  }
  function bindCards(scope) {
    scope.querySelectorAll("[data-select]").forEach(
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
    scope.querySelectorAll("[data-body]:not(.ready)").forEach((n) => seen.observe(n));
    scope.querySelectorAll("[data-share]").forEach(
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
    for (const kind of ["trash", "restore"])
      scope.querySelectorAll("[data-" + kind + "]").forEach(
        (b) =>
          (b.onclick = () =>
            busy(
              b,
              async () => {
                const row = rows.find((p) => p.id === b.dataset[kind]);
                const result = await api(
                  kind === "trash" ? "trashProblem" : "restoreProblem",
                  { problemId: row.id, expectedVersion: row.version },
                );
                if (kind === "trash")
                  toast("Moved to Trash", {
                    label: "Undo",
                    onAction: async () => {
                      await api("restoreProblem", {
                        problemId: row.id,
                        expectedVersion: result.version,
                      });
                      await load();
                    },
                  });
                selected.delete(row.id);
                tray();
                await load();
              },
              root,
            )),
      );
  }
  function redraw(id) {
    const row = rows.find((p) => p.id === id),
      card = list.querySelector(`[data-card="${CSS.escape(id)}"]`);
    if (!row || !card) return;
    const flipped = card.querySelector(".flip-card")?.classList.contains("is-flipped");
    card.insertAdjacentHTML("afterend", cardHtml(row));
    card.remove();
    const next = list.querySelector(`[data-card="${CSS.escape(id)}"]`);
    if (flipped) next.querySelector("[data-flip]").click();
    bindCards(next);
    if (selected.has(id)) selected.get(id).title = row.title;
  }
  bindForm(root.querySelector("form"), async (form) => {
    const subject = String(form.get("subject") || "").trim();
    q = String(form.get("q") || "").trim();
    sort = form.get("sort");
    starOnly = form.get("starred") === "on";
    filter = subject ? { subject } : {};
    await load();
  });
  root.querySelector("#filter-bar").addEventListener("click", (ev) => {
    const k = ev.target.closest("[data-clear]")?.dataset.clear,
      form = root.querySelector("form");
    if (!k) return;
    if (k === "tag") filter = {};
    if (k === "subject") (filter = {}), (form.subject.value = "");
    if (k === "q") (q = ""), (form.q.value = "");
    if (k === "starred") (starOnly = false), (form.starred.checked = false);
    load();
  });
  root.querySelector('[name="sort"]').onchange = (ev) => {
    sort = ev.target.value;
    render();
  };
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
