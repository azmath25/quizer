import { api } from "../services/api.js";
import { resolveImages } from "../services/assets.js";
import { validateMetadata, validateProblem } from "../../shared/schema.js";
import { sheet, e, busy, message, field, textarea, select, date, icon } from "./ui.js";
import { problemPreview, typeset, clearMath } from "./math-content.js";

const CONTENT_KEYS = ["type", "answerMode", "statementLatex", "options", "defaultPoints", "questionAssetBindings"],
  GRADING_KEYS = ["correctOptionId", "acceptedAnswers", "tolerance", "explanationLatex", "rubricLatex", "solutionAssetBindings"],
  pick = (source, keys) => Object.fromEntries(keys.map((k) => [k, structuredClone(source[k])])),
  ctx = (d) => ({ kind: "problem", id: d.problemId, revisionId: d.revisionId }),
  tagList = (text) => String(text || "").split(",").map((t) => t.trim()).filter(Boolean);

// Quick edit: change the visible parts of a problem and see the rendered result while typing.
export async function quickEdit(row, { onSaved }) {
  const d = await api("getProblem", { problemId: row.id, revisionId: row.latestRevisionId }),
    content = pick(d.content, CONTENT_KEYS),
    grading = pick(d.grading, GRADING_KEYS),
    images = await resolveImages({ ...content.questionAssetBindings, ...grading.solutionAssetBindings }, ctx(d)),
    choice = content.type === "choice",
    manual = content.answerMode === "manual";
  const options = choice
    ? `<fieldset class="stack"><legend class="muted small">Choices · select the correct one</legend>${content.options
        .map(
          (o, i) =>
            `<div class="choice-editor"><input type="radio" name="correct" value="${e(o.id)}" ${o.id === grading.correctOptionId ? "checked" : ""} aria-label="Choice ${i + 1} is correct"><textarea data-option="${e(o.id)}" rows="2" aria-label="Choice ${i + 1}">${e(o.textLatex)}</textarea></div>`,
        )
        .join("")}</fieldset>`
    : manual
      ? ""
      : textarea("Accepted answers · one per line", "acceptedAnswers", grading.acceptedAnswers.join("\n"), 'rows="2"');
  const { node, close } = sheet({
    title: "Quick edit",
    wide: true,
    body: `<form id="quick-edit" class="quick-edit"><div class="stack">${field("Title", "title", "text", row.title, 'required maxlength="200"')}<div class="form-grid">${field("Subject", "subject", "text", row.subject || "", 'maxlength="80"')}${field("Difficulty", "difficulty", "text", row.difficulty || "", 'maxlength="40"')}</div>${field("Tags · comma separated", "tags", "text", (row.tags || []).join(", "))}${textarea("Statement · LaTeX", "statementLatex", content.statementLatex, 'required rows="6"')}${options}${textarea("Solution", "explanationLatex", grading.explanationLatex || "", 'rows="3"')}${field("Points", "defaultPoints", "number", content.defaultPoints, 'min="0.00000001" max="1000" step="any" required')}</div><div class="quick-edit__preview"><div class="muted small">Live preview</div><div id="qe-preview"></div></div></form><div data-message></div>`,
    footer: `<button type="button" class="button ghost" data-close-btn>Cancel</button><button type="submit" form="quick-edit" class="button primary">Save new revision</button>`,
  });
  node.querySelector("[data-close-btn]").onclick = close;
  const form = node.querySelector("#quick-edit"),
    preview = node.querySelector("#qe-preview");
  const build = () => {
    const f = new FormData(form),
      c = { ...content, statementLatex: f.get("statementLatex"), defaultPoints: Number(f.get("defaultPoints")) },
      g = { ...grading, explanationLatex: f.get("explanationLatex") ?? "" };
    if (choice) {
      c.options = content.options.map((o) => ({ ...o, textLatex: form.querySelector(`[data-option="${CSS.escape(o.id)}"]`).value }));
      g.correctOptionId = f.get("correct");
    } else if (!manual) g.acceptedAnswers = String(f.get("acceptedAnswers")).split("\n").map((s) => s.trim()).filter(Boolean);
    return {
      metadata: {
        title: f.get("title"),
        subject: f.get("subject"),
        difficulty: f.get("difficulty"),
        tags: tagList(f.get("tags")),
        bankVisibility: row.bankVisibility,
      },
      content: c,
      grading: g,
    };
  };
  let timer;
  const draw = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const v = build();
      clearMath(preview);
      preview.innerHTML = problemPreview(v.content, null, images);
      await typeset(preview);
    }, 250);
  };
  form.addEventListener("input", draw);
  draw();
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    await busy(
      ev.submitter,
      async () => {
        const v = build();
        validateMetadata(v.metadata);
        validateProblem(v.content, v.grading);
        const r = await api("saveProblemRevision", { problemId: row.id, expectedVersion: row.version, ...v });
        Object.assign(row, v.metadata, {
          version: r.version,
          latestRevisionId: r.revisionId,
          revisionNumber: (row.revisionNumber || 1) + 1,
          updatedAt: new Date().toISOString(),
        });
        close();
        onSaved(row);
      },
      node,
    );
  });
}

// History: browse earlier revisions and restore one as a new revision (history is never rewritten).
export async function history(row, { onSaved, canRestore }) {
  const { node, close } = sheet({
    title: `Versions · ${row.title}`,
    wide: true,
    body: `<div class="history"><ol class="history__list" id="rev-list"><li class="muted">Loading…</li></ol><div class="history__view"><div id="rev-preview" class="muted">Select a version to preview it.</div><div class="actions" id="rev-actions"></div></div></div><div data-message></div>`,
  });
  const listNode = node.querySelector("#rev-list"),
    view = node.querySelector("#rev-preview"),
    actions = node.querySelector("#rev-actions");
  const page = await api("listProblemRevisions", { problemId: row.id, limit: 50 }),
    items = [...page.items].sort((a, b) => b.revisionNumber - a.revisionNumber);
  listNode.innerHTML = items
    .map(
      (r) =>
        `<li><button type="button" class="history__item" data-rev="${e(r.id)}"><strong>v${r.revisionNumber}</strong><span class="muted small">${e(date(r.createdAt))}</span>${r.id === row.latestRevisionId ? '<span class="meta-tag">current</span>' : ""}</button></li>`,
    )
    .join("");
  listNode.addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-rev]");
    if (!b) return;
    listNode.querySelectorAll("[data-rev]").forEach((n) => n.classList.toggle("is-active", n === b));
    actions.innerHTML = "";
    const d = await api("getProblem", { problemId: row.id, revisionId: b.dataset.rev }),
      images = await resolveImages({ ...d.content.questionAssetBindings, ...d.grading.solutionAssetBindings }, ctx(d));
    clearMath(view);
    view.innerHTML = problemPreview(d.content, d.grading, images);
    await typeset(view);
    if (canRestore && d.revisionId !== row.latestRevisionId) {
      actions.innerHTML = `<button type="button" class="button primary" id="restore-rev">${icon("restore")}Restore v${d.content.revisionNumber}</button>`;
      actions.querySelector("#restore-rev").onclick = (click) =>
        busy(
          click.currentTarget,
          async () => {
            const r = await api("saveProblemRevision", {
              problemId: row.id,
              expectedVersion: row.version,
              metadata: {
                title: row.title,
                subject: row.subject || "",
                difficulty: row.difficulty || "",
                tags: row.tags || [],
                bankVisibility: row.bankVisibility,
              },
              content: pick(d.content, CONTENT_KEYS),
              grading: pick(d.grading, GRADING_KEYS),
            });
            Object.assign(row, {
              version: r.version,
              latestRevisionId: r.revisionId,
              revisionNumber: (row.revisionNumber || 1) + 1,
              updatedAt: new Date().toISOString(),
            });
            close();
            onSaved(row);
          },
          node,
        );
    }
  });
  if (items[0]) listNode.querySelector("[data-rev]").click();
}

// Bulk edit metadata of owned problems in one request. Empty fields mean "leave unchanged".
export function bulkEdit(rows, { onSaved }) {
  const { node, close } = sheet({
    title: `Edit ${rows.length} problem${rows.length === 1 ? "" : "s"}`,
    body: `<form id="bulk-edit" class="stack"><p class="muted small">Only filled fields are changed.</p>${field("Subject", "subject", "text", "", 'maxlength="80" placeholder="Leave unchanged"')}${field("Difficulty", "difficulty", "text", "", 'maxlength="40" placeholder="Leave unchanged"')}${field("Add tags · comma separated", "addTags", "text", "")}${field("Remove tags · comma separated", "removeTags", "text", "")}${select("Visible to", "visibility", [["", "Leave unchanged"], ["private", "Only me"], ["teachers", "All teachers"]], "")}</form><div data-message></div>`,
    footer: `<button type="button" class="button ghost" data-close-btn>Cancel</button><button type="submit" form="bulk-edit" class="button primary">Apply to ${rows.length}</button>`,
  });
  node.querySelector("[data-close-btn]").onclick = close;
  node.querySelector("#bulk-edit").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget),
      req = { problemIds: rows.map((r) => r.id) };
    for (const k of ["subject", "difficulty"]) if (String(f.get(k)).trim()) req[k] = String(f.get(k)).trim();
    if (tagList(f.get("addTags")).length) req.addTags = tagList(f.get("addTags"));
    if (tagList(f.get("removeTags")).length) req.removeTags = tagList(f.get("removeTags"));
    if (f.get("visibility")) req.visibility = f.get("visibility");
    if (Object.keys(req).length === 1) return message(node, "Choose at least one change.", "info");
    await busy(
      ev.submitter,
      async () => {
        const r = await api("bulkUpdateProblems", req),
          remove = new Set(req.removeTags || []);
        for (const row of rows) {
          if (req.subject) row.subject = req.subject;
          if (req.difficulty) row.difficulty = req.difficulty;
          if (req.visibility) row.bankVisibility = req.visibility;
          if (req.addTags || req.removeTags)
            row.tags = [...new Set([...(row.tags || []).filter((t) => !remove.has(t)), ...(req.addTags || [])])];
          row.version = r.versions[row.id];
        }
        close();
        onSaved(rows);
      },
      node,
    );
  });
}
