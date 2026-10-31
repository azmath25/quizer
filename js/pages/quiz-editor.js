import { go, onLeave, onLeaveGuard } from "../core/router.js";
import { readBackup, backupQuiz, backupRecord } from "../services/backup.js";
import { readLegacyDeviceQuizzes } from "../migration/legacy-device.js";
import { drafts, draftBanner } from "../services/drafts.js";
import { api, waitForJob } from "../services/api.js";
import { uploadAsset, resolveImages } from "../services/assets.js";
import { parseLatex } from "../../shared/latex-parser.js";
import { validateQuiz, imageReferences } from "../../shared/legacy-core.js";
import {
  fromLegacyQuestion,
  validateProblem,
  DEFAULT_SETTINGS,
} from "../../shared/schema.js";
import {
  pageHead,
  linkButton,
  field,
  textarea,
  select,
  checkbox,
  bindForm,
  action,
  busy,
  message,
  e,
  empty,
  loading,
  points,
  icon,
  dialog,
  toast,
} from "../components/ui.js";
import {
  problemPreview,
  typeset,
  clearMath,
  displayProblem,
} from "../components/math-content.js";
export async function mount(root) {
  const quizId = new URLSearchParams(location.search).get("id");
  if (quizId) return edit(root, quizId);
  return importPage(root);
}
async function importPage(root) {
  const bankOnly = new URLSearchParams(location.search).has("bank");
  let backupManifest = null;
  let parsed = null,
    warnings = [],
    fileName = "Imported quiz",
    sourceFile = null,
    files = new Map(),
    urls = {},
    importState = null;
  root.innerHTML =
    pageHead(
      bankOnly ? "Import problems to your bank" : "Create a quiz",
      bankOnly
        ? "Add problems to the bank without creating a quiz. Choose who can see them below."
        : "Import your problems, start with an empty draft, or choose from the bank.",
      linkButton("Problem bank", "problems.html", "secondary", "book"),
    ) +
    `<div class="tabs" role="tablist" aria-label="Creation method"><button aria-selected="true" role="tab" data-create="import">Import LaTeX / JSON</button><button aria-selected="false" role="tab" data-create="blank">Empty quiz</button></div><div data-message></div><div id="blank-panel" class="panel narrow" hidden><h2>Start a new quiz</h2><form id="blank-form" class="stack">${field("Quiz title", "title", "text", "", 'required maxlength="200"')}<p class="muted small">The quiz starts as a private draft. Add problems, set the time limit and publish when ready.</p><button class="button primary">Create private draft</button></form></div><div id="import-panel"><div class="tabs mobile-editor-tabs" role="tablist" aria-label="Import preview"><button aria-selected="true" data-import-tab="edit" role="tab">Import</button><button aria-selected="false" data-import-tab="preview" role="tab">Preview</button></div><div class="editor-grid" data-tab="edit"><div class="editor-panel"><section class="panel stack"><div class="drop-area">${icon("upload")}<h2>Upload your problem file</h2><p>Select a .tex, .quiz.json or backup .zip file and its images.</p><label class="field"><span class="sr-only">LaTeX, JSON and image files</span><input id="import-files" type="file" multiple accept=".tex,.json,.zip,image/png,image/jpeg,image/webp,image/gif"></label></div><div class="section-head"><h2>Or paste LaTeX</h2><a href="guide.html">Syntax guide ${icon("arrow")}</a></div><label class="field"><span>Source</span><textarea id="latex-source" class="source-input" spellcheck="false" placeholder="\\begin{problem}[points=2]&#10;What is $2+2$?&#10;\\answer{4}&#10;\\end{problem}"></textarea></label><div class="actions"><button class="button secondary" id="preview-source">Preview problems</button><button class="button ghost" id="load-example">Load example</button></div><div class="image-list" id="import-images"></div></section><section class="panel"><h2>Import details</h2>${bankOnly ? `<label class="field"><span>Bank visibility</span><select id="bank-visibility"><option value="private">Private (only me)</option><option value="teachers">Shared with teachers</option></select></label>` : ""}<p class="muted small">Preview first. Importing creates separate problems and image files in your Firebase workspace, plus a private quiz draft.</p><p class="muted small">Written answers without a key are marked by the teacher. LaTeX is parsed as text; external files and TeX commands are never executed.</p></section></div><aside class="panel editor-preview"><div class="section-head"><h2>Problem preview</h2><span class="muted small" id="preview-count"></span></div><div id="import-warnings"></div><div id="import-preview">${empty("Preview your problems", "Choose a file or paste LaTeX, then select Preview problems.")}</div></aside></div><div class="editor-actions"><span class="save-state" id="import-status">Nothing imported yet</span><button class="button primary" id="import-save" disabled>${bankOnly ? "Import to bank" : "Import to Firebase"}</button></div></div>`;
  const input = root.querySelector("#latex-source"),
    preview = root.querySelector("#import-preview"),
    status = root.querySelector("#import-status");
  if (bankOnly) {
    root.querySelector(".tabs[aria-label='Creation method']").hidden = true;
    root.querySelector("#blank-panel").hidden = true;
  }
  bindForm(root.querySelector("#blank-form"), async (values) => {
    const q = await api("createQuiz", { title: values.get("title") });
    go(`upload.html?id=${q.quizId}`);
  });
  root.querySelectorAll("[data-create]").forEach(
    (b) =>
      (b.onclick = () => {
        const blank = b.dataset.create === "blank";
        root.querySelector("#blank-panel").hidden = !blank;
        root.querySelector("#import-panel").hidden = blank;
        root
          .querySelectorAll("[data-create]")
          .forEach((n) => n.setAttribute("aria-selected", String(n === b)));
      }),
  );
  root.querySelectorAll("[data-import-tab]").forEach(
    (b) =>
      (b.onclick = () => {
        root.querySelector(".editor-grid").dataset.tab = b.dataset.importTab;
        root
          .querySelectorAll("[data-import-tab]")
          .forEach((n) => n.setAttribute("aria-selected", String(n === b)));
      }),
  );
  function clearParsed() {
    parsed = null;
    importState = null;
    root.querySelector("#import-save").disabled = true;
    status.textContent = "Source changed — preview again";
  }
  input.oninput = clearParsed;
  function addImages() {
    root.querySelector("#import-images").innerHTML = [...files.values()]
      .map(
        (f) =>
          `<div class="image-row"><img src="${e(urls[f.name])}" alt="${e(f.name)}"><code>${e(f.name)}</code><small>${Math.round(f.size / 1024)} KB</small></div>`,
      )
      .join("");
  }
  async function parse() {
    const source = input.value;
    if (!source.trim())
      throw new Error("Choose a file or paste some problems first.");
    warnings = [];
    if (source.trimStart().startsWith("{")) {
      const raw = JSON.parse(source);
      if (raw.schemaVersion === 2 && raw.kind === "math-quiz-backup") {
        backupManifest = raw;
        parsed = backupQuiz(raw);
      } else {
        backupManifest = null;
        for (const [i, q] of (raw.questions ?? []).entries()) {
          if (
            (q.prompt?.length ?? 0) > 30000 ||
            (q.explanation?.length ?? 0) > 30000 ||
            (q.options ?? []).some((o) => (o.text?.length ?? 0) > 10000)
          )
            throw new Error(`Problem ${i + 1} exceeds the text limit.`);
        }
        parsed = validateQuiz(raw);
        for (const [alias, data] of Object.entries(parsed.assets)) {
          if (files.has(alias)) continue;
          const match = data.match(/^data:(image\/[a-z]+);base64,(.*)$/s);
          if (!match) throw new Error("Unsupported embedded image: " + alias);
          const bytes = Uint8Array.from(
              atob(match[2].replace(/\s/g, "")),
              (c) => c.charCodeAt(0),
            ),
            file = new File([bytes], alias, { type: match[1] });
          if (file.size > 4194304)
            throw new Error(`Image ${alias} exceeds 4 MB.`);
          files.set(alias, file);
          urls[alias] = URL.createObjectURL(file);
        }
      }
    } else {
      backupManifest = null;
      const result = parseLatex(source, { filename: fileName });
      parsed = result.quiz;
      warnings = result.warnings;
    }
    const references = backupManifest
      ? Object.values(backupManifest.assets).map((a) => a.path)
      : imageReferences(parsed);
    const missing = references.filter(
      (name) =>
        !files.has(name) &&
        ![...files.keys()].some((k) => k === name.split("/").at(-1)),
    );
    if (missing.length) warnings.push("Images needed: " + missing.join(", "));
    const temp = Object.fromEntries(
      [...files.keys()].map((k) => [k, "ast_preview"]),
    );
    for (const [index, q] of parsed.questions.entries()) {
      const record = backupManifest
        ? backupRecord(backupManifest, index, temp)
        : fromLegacyQuestion(q, temp);
      try {
        if (!missing.length) validateProblem(record.content, record.grading);
      } catch (error) {
        throw new Error(`Problem ${index + 1}: ${error.message}`);
      }
    }
    clearMath(preview);
    preview.innerHTML = parsed.questions
      .map((q, i) => {
        const record = backupManifest
          ? backupRecord(backupManifest, i, temp)
          : fromLegacyQuestion(q, {});
        const imageMap = backupManifest
          ? Object.fromEntries(
              [
                ...Object.entries(
                  backupManifest.records[i].content.questionAssetBindings,
                ),
                ...Object.entries(
                  backupManifest.records[i].grading.solutionAssetBindings,
                ),
              ].map(([alias, id]) => [
                alias,
                urls[backupManifest.assets[id].path],
              ]),
            )
          : urls;
        return problemPreview(
          record.content,
          record.grading,
          imageMap,
          i,
          q.points,
        );
      })
      .join("");
    await typeset(preview);
    root.querySelector("#preview-count").textContent =
      `${parsed.questions.length} problems · ${points(parsed.questions.reduce((s, q) => s + q.points, 0))} points`;
    root.querySelector("#import-warnings").innerHTML = warnings
      .map((w) => `<p class="notice warning">${e(w)}</p>`)
      .join("");
    root.querySelector("#import-save").disabled = !!missing.length;
    status.textContent = missing.length
      ? "Add the missing images, then preview again"
      : "Preview ready — not saved yet";
    addImages();
    importState = null;
  }
  root.querySelector("#import-files").onchange = (event) =>
    busy(
      event.target,
      async () => {
        for (const file of event.target.files) {
          if (file.size > 20971520)
            throw new Error("Use source files smaller than 20 MB.");
          if (/\.zip$/i.test(file.name)) {
            const backup = await readBackup(file);
            input.value = JSON.stringify(backup.manifest, null, 2);
            fileName = backup.manifest.revision.title;
            sourceFile = null;
            for (const image of backup.files) {
              files.set(image.name, image);
              urls[image.name] = URL.createObjectURL(image);
            }
          } else if (/\.(tex|json)$/i.test(file.name)) {
            sourceFile = file;
            fileName = file.name;
            input.value = await file.text();
          } else if (
            ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
              file.type,
            )
          ) {
            if (file.size > 4194304)
              throw new Error("Images must be at most 4 MB.");
            files.set(file.name, file);
            if (urls[file.name]) URL.revokeObjectURL(urls[file.name]);
            urls[file.name] = URL.createObjectURL(file);
          } else throw new Error("Unsupported file: " + file.name);
        }
        clearParsed();
        addImages();
        if (input.value.trim()) await parse();
      },
      root,
    );
  action(root, "#preview-source", parse);
  const aiHandoff = sessionStorage.getItem("mathquiz.aiImport");
  if (aiHandoff) {
    sessionStorage.removeItem("mathquiz.aiImport");
    const h = JSON.parse(aiHandoff);
    input.value = h.source;
    fileName = h.title;
    sourceFile = null;
    busy(root.querySelector("#preview-source"), parse, root);
  }
  action(root, "#load-example", async () => {
    const response = await fetch("examples/algebra.tex");
    if (!response.ok) throw new Error("Could not load the example.");
    input.value = await response.text();
    fileName = "Algebra practice";
    sourceFile = null;
    await parse();
  });
  const legacy = await readLegacyDeviceQuizzes();
  if (legacy.length) {
    const section = document.createElement("section");
    section.className = "panel";
    section.innerHTML = `<details><summary>Import from the previous version (${legacy.length} quizzes)</summary><p class="muted small">Select a quiz that belongs to you. It will become a private Firebase draft. Existing browser copies are kept.</p><label class="field"><span>Previous quiz</span><select id="legacy-select">${legacy.map((q, i) => `<option value="${i}">${e(q.title)}</option>`).join("")}</select></label><button type="button" class="button secondary" id="load-legacy">Preview selected quiz</button></details>`;
    root.querySelector(".editor-panel").append(section);
    action(section, "#load-legacy", async () => {
      const q = legacy[Number(section.querySelector("select").value)];
      input.value = JSON.stringify(q, null, 2);
      sourceFile = null;
      fileName = q.title;
      await parse();
    });
  }
  action(root, "#import-save", async () => {
    if (!parsed) throw new Error("Preview the problems before importing.");
    const progress = (text) => {
      status.textContent = text;
    };
    importState ??= { assets: {}, sourceAssetId: null, jobId: null, done: 0 };
    try {
      for (const [alias, file] of files) {
        if (importState.assets[alias]) continue;
        importState.assets[alias] = await uploadAsset(file, (p) =>
          progress(`${alias}: ${p.stage} ${p.percent}%`),
        );
      }
      if (!importState.sourceAssetId) {
        const source = new File(
          [input.value],
          sourceFile?.name ||
            (input.value.trimStart().startsWith("{")
              ? "quiz.json"
              : "quiz.tex"),
          {
            type: input.value.trimStart().startsWith("{")
              ? "application/json"
              : "text/plain",
          },
        );
        importState.sourceAssetId = await uploadAsset(
          source,
          (p) => progress(`Source: ${p.stage}`),
          "source",
        );
      }
      if (!importState.jobId)
        importState.jobId = (
          await api("createImportJob", {
            name: parsed.title,
            sourceAssetId: importState.sourceAssetId,
            itemCount: parsed.questions.length,
            bankOnly,
          })
        ).jobId;
      // One bounded problem at a time makes partial imports recoverable and large math safe.
      for (let i = importState.done; i < parsed.questions.length; i++) {
        const q = parsed.questions[i],
          record = backupManifest
            ? backupRecord(backupManifest, i, importState.assets)
            : fromLegacyQuestion(q, importState.assets);
        record.metadata = {
          title: `${parsed.title} — ${i + 1}`,
          subject: parsed.subject,
          difficulty: parsed.difficulty,
          tags: [],
          bankVisibility: bankOnly
            ? root.querySelector("#bank-visibility").value
            : "private",
        };
        await api("importProblemBatch", {
          jobId: importState.jobId,
          records: [
            {
              importItemKey: "problem_" + i,
              originalQuestionId: q.id,
              ...record,
              points: q.points,
            },
          ],
        });
        importState.done = i + 1;
        progress(`Imported ${i + 1} of ${parsed.questions.length} problems`);
      }
      const q = await api("finishImportJob", {
        jobId: importState.jobId,
        title: parsed.title,
        description: parsed.description,
        settings: {
          ...DEFAULT_SETTINGS,
          ...(backupManifest ? backupManifest.revision.settings : {}),
          durationSeconds: parsed.durationMinutes * 60,
          shuffleQuestions: parsed.settings.shuffleQuestions,
          shuffleOptions: parsed.settings.shuffleOptions,
          allowBack: parsed.settings.allowBack,
          penalty: parsed.settings.penalty,
        },
        order: parsed.questions.map((_, i) => "problem_" + i),
      });
      progress("Saved to Firebase");
      go(bankOnly ? "problems.html" : `upload.html?id=${q.quizId}`);
    } catch (error) {
      progress("Import paused — retry to continue from the last saved problem");
      throw error;
    }
  });
}
async function edit(root, quizId) {
  let data = await api("getQuizDraft", { quizId }),
    draft = data.draft,
    quiz = data.quiz,
    slots = data.items.map((i) => ({ ...i })),
    order = [...draft.itemOrder],
    dirty = false,
    removed = new Set();
  root.innerHTML =
    pageHead(
      "Edit quiz",
      quiz.title,
      linkButton(
        "Manage access & results",
        `quiz-manage.html?id=${quizId}`,
        "secondary",
      ),
    ) +
    `<div data-message></div><div class="tabs mobile-editor-tabs" role="tablist"><button data-editor-tab="edit" aria-selected="true">Edit</button><button data-editor-tab="preview" aria-selected="false">Preview</button></div><form id="quiz-form"><div class="editor-grid" data-tab="edit"><div class="editor-panel"><section class="panel stack"><h2>Quiz details</h2>${field("Title", "title", "text", draft.title, 'required maxlength="200"')}${textarea("Description", "description", draft.description, 'maxlength="2000" rows="3"')}<div class="form-grid">${field("Subject", "subject", "text", draft.subject, 'maxlength="80"')}${field("Difficulty", "difficulty", "text", draft.difficulty, 'maxlength="40"')}</div></section><section class="panel"><div class="section-head"><h2>Problems</h2><a href="problems.html?quiz=${e(quizId)}">Add from bank ${icon("plus")}</a></div><div id="slots"></div><div class="actions">${linkButton("Create a problem", `problem-edit.html?returnTo=${encodeURIComponent("upload.html?id=" + quizId)}`, "secondary", "plus")}</div></section><section class="panel stack"><h2>Test settings</h2><div class="form-grid">${field("Time limit · minutes (0 = untimed)", "minutes", "number", draft.settings.durationSeconds / 60, 'min="0" max="1440" step="any" required')}${field("Wrong-answer penalty", "penalty", "number", draft.settings.penalty, 'min="0" max="1000" step="any" required')}</div>${checkbox("Shuffle problems", "shuffleQuestions", draft.settings.shuffleQuestions)}${checkbox("Shuffle answer choices", "shuffleOptions", draft.settings.shuffleOptions)}${checkbox("Allow returning to previous problems", "allowBack", draft.settings.allowBack)}<p class="muted small">Time limits are enforced by the server. Students cannot change them.</p></section><section class="panel stack"><h2>Results release</h2><div class="form-grid">${select(
      "Scores",
      "scoreRelease",
      [
        ["immediate", "After submission"],
        ["afterClose", "After closing time"],
        ["manual", "When I release them"],
      ],
      draft.settings.scoreRelease,
    )}${select(
      "Solutions",
      "solutionRelease",
      [
        ["immediate", "After submission"],
        ["afterClose", "After closing time"],
        ["manual", "When I release them"],
        ["never", "Never"],
      ],
      draft.settings.solutionRelease,
    )}</div><p class="muted small">Written answers remain provisional until marked. Set quiz closing time in Manage → Access when using after-close release.</p></section></div><aside class="panel editor-preview"><div class="section-head"><h2>Preview</h2><button type="button" class="button ghost small" id="refresh-preview">Refresh</button></div><div id="editor-preview"></div><button type="button" class="button secondary load-more" id="more-preview" hidden>More problems</button></aside></div><div class="editor-actions"><span class="save-state" id="save-state">Saved draft · version ${draft.version}</span><div class="actions"><button type="submit" class="button secondary" ${quiz.publishingJobId || quiz.lifecycle === "trashed" ? "disabled" : ""}>Save draft</button><button type="button" class="button primary" id="publish" ${quiz.publishingJobId || quiz.lifecycle === "trashed" ? "disabled" : ""}>Save & publish</button></div></div></form>`;
  const form = root.querySelector("#quiz-form"),
    saveState = root.querySelector("#save-state"),
    preview = root.querySelector("#editor-preview");
  let previewOffset = 0;
  const store = drafts(`quiz.${quizId}`),
    snapshot = () => ({
      fields: Object.fromEntries(
        [...form.elements]
          .filter((n) => n.name)
          .map((n) => [n.name, n.type === "checkbox" ? n.checked : n.value]),
      ),
      order,
      slots,
      removed: [...removed],
    }),
    markDirty = () => {
      dirty = true;
      saveState.textContent = "Unsaved changes (draft kept on this device)";
      store.save(snapshot);
    };
  const saved = store.read();
  if (saved)
    draftBanner(root.querySelector("[data-message]") ?? root, saved, {
      onDiscard: () => store.clear(),
      onRestore: (v) => {
        for (const [name, value] of Object.entries(v.fields)) {
          const n = form.elements[name];
          if (!n) continue;
          if (n.type === "checkbox") n.checked = value;
          else n.value = value;
        }
        order = v.order.filter((id) => v.slots.some((x) => x.itemId === id));
        slots = v.slots;
        removed = new Set(v.removed);
        markDirty();
        rows();
      },
    });
  form.addEventListener("input", markDirty);
  form.addEventListener("change", markDirty);
  const unload = (event) => {
    if (dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  };
  window.addEventListener("beforeunload", unload);
  onLeaveGuard(() => dirty);
  onLeave(() => window.removeEventListener("beforeunload", unload));
  function rows() {
    root.querySelector("#slots").innerHTML = order.length
      ? `<div class="bulk-bar" role="group" aria-label="Bulk points"><span class="muted small">All problems</span><input type="number" min="0.00000001" max="1000" step="any" value="1" id="bulk-points" aria-label="Points value"><button type="button" class="button secondary small" id="bulk-set">Set points</button><button type="button" class="button ghost small" id="bulk-scale">Multiply</button></div>` +
        order
          .map((itemId, index) => {
            const slot = slots.find((i) => i.itemId === itemId);
            return `<div class="slot-row" draggable="true" data-slot="${e(itemId)}"><span class="drag-handle" aria-hidden="true" title="Drag to reorder">⋮⋮</span><span class="number-tile">${index + 1}</span><div><a class="slot-title" href="problem-edit.html?id=${e(slot.problemId)}">Open problem</a><p class="slot-subtitle">${e(slot.problemId.slice(-8))} · saved revision</p></div><label class="field"><span class="sr-only">Points for problem ${index + 1}</span><input type="number" min="0.00000001" max="1000" step="any" value="${slot.points}" data-points="${e(itemId)}"></label><div class="slot-actions"><button type="button" class="icon-button" data-up="${e(itemId)}" aria-label="Move problem ${index + 1} up" ${index === 0 ? "disabled" : ""}>↑</button><button type="button" class="icon-button" data-down="${e(itemId)}" aria-label="Move problem ${index + 1} down" ${index === order.length - 1 ? "disabled" : ""}>↓</button><button type="button" class="icon-button" data-latest="${e(itemId)}" aria-label="Use latest problem revision">↻</button><button type="button" class="icon-button" data-duplicate-slot="${e(itemId)}" aria-label="Duplicate this slot">+</button><button type="button" class="icon-button" data-remove="${e(itemId)}" aria-label="Remove problem ${index + 1}">×</button></div></div>`;
          })
          .join("")
      : empty("No problems added", "Select problems from your bank.");
    const bulk = (fn) => {
      const v = Number(root.querySelector("#bulk-points")?.value);
      if (!(v > 0)) return;
      slots.forEach((slot) => {
        if (order.includes(slot.itemId))
          slot.points = Math.min(1000, Math.round(fn(slot.points, v) * 1e6) / 1e6);
      });
      markDirty();
      rows();
    };
    root
      .querySelector("#bulk-points")
      ?.addEventListener("input", (ev) => ev.stopPropagation());
    const setAll = root.querySelector("#bulk-set"),
      scaleAll = root.querySelector("#bulk-scale");
    if (setAll) setAll.onclick = () => bulk((_, v) => v);
    if (scaleAll) scaleAll.onclick = () => bulk((p, v) => p * v);
    const list = root.querySelector("#slots");
    let dragId = null;
    list.querySelectorAll("[data-slot]").forEach((row) => {
      row.ondragstart = (ev) => {
        if (ev.target.closest("input,button,a")) return ev.preventDefault();
        dragId = row.dataset.slot;
        row.classList.add("is-dragging");
        ev.dataTransfer.effectAllowed = "move";
      };
      row.ondragend = () => row.classList.remove("is-dragging");
      row.ondragover = (ev) => {
        if (dragId) ev.preventDefault();
      };
      row.ondrop = (ev) => {
        ev.preventDefault();
        const to = order.indexOf(row.dataset.slot),
          from = order.indexOf(dragId);
        if (from < 0 || to < 0 || from === to) return;
        order.splice(to, 0, order.splice(from, 1)[0]);
        dragId = null;
        markDirty();
        rows();
      };
    });
    root.querySelectorAll("[data-points]").forEach(
      (input) =>
        (input.oninput = () => {
          slots.find((i) => i.itemId === input.dataset.points).points = Number(
            input.value,
          );
          markDirty();
        }),
    );
    for (const direction of ["up", "down"])
      root.querySelectorAll("[data-" + direction + "]").forEach(
        (b) =>
          (b.onclick = () => {
            const index = order.indexOf(b.dataset[direction]),
              other = index + (direction === "up" ? -1 : 1);
            [order[index], order[other]] = [order[other], order[index]];
            markDirty();
            rows();
          }),
      );
    root.querySelectorAll("[data-remove]").forEach(
      (b) =>
        (b.onclick = () => {
          const id = b.dataset.remove,
            at = order.indexOf(id),
            slot = slots.find((i) => i.itemId === id),
            wasRemoved = removed.has(id);
          order = order.filter((i) => i !== id);
          if (!id.startsWith("new_")) removed.add(id);
          slots = slots.filter((i) => i.itemId !== id);
          markDirty();
          rows();
          toast("Problem removed", {
            label: "Undo",
            onAction: () => {
              if (order.includes(id)) return;
              order.splice(Math.min(at, order.length), 0, id);
              slots.push(slot);
              if (!wasRemoved) removed.delete(id);
              markDirty();
              rows();
            },
          });
        }),
    );
    root.querySelectorAll("[data-duplicate-slot]").forEach(
      (b) =>
        (b.onclick = () => {
          if (order.length >= 500) return;
          const slot = slots.find((i) => i.itemId === b.dataset.duplicateSlot),
            itemId = "new_" + crypto.randomUUID();
          slots.push({ ...slot, itemId });
          order.splice(order.indexOf(slot.itemId) + 1, 0, itemId);
          markDirty();
          rows();
        }),
    );
    root.querySelectorAll("[data-latest]").forEach(
      (b) =>
        (b.onclick = () =>
          busy(
            b,
            async () => {
              const slot = slots.find((i) => i.itemId === b.dataset.latest),
                p = await api("getProblem", { problemId: slot.problemId });
              if (p.revisionId === slot.problemRevisionId) {
                message(
                  root,
                  "This slot already uses the latest revision.",
                  "info",
                );
                return;
              }
              if (
                await dialog({
                  title: "Use latest problem revision?",
                  body: `<p>This will update this slot to revision ${p.content.revisionNumber} when you save. Published quizzes stay unchanged until you publish again.</p>`,
                  confirm: "Use latest",
                })
              ) {
                slot.problemRevisionId = p.revisionId;
                markDirty();
              }
            },
            root,
          )),
    );
  }
  function values() {
    const f = new FormData(form);
    return {
      title: f.get("title"),
      description: f.get("description"),
      subject: f.get("subject"),
      difficulty: f.get("difficulty"),
      settings: {
        durationSeconds: Math.round(Number(f.get("minutes")) * 60),
        penalty: Number(f.get("penalty")),
        shuffleQuestions: f.has("shuffleQuestions"),
        shuffleOptions: f.has("shuffleOptions"),
        allowBack: f.has("allowBack"),
        scoreRelease: f.get("scoreRelease"),
        solutionRelease: f.get("solutionRelease"),
      },
    };
  }
  async function save() {
    if (!form.reportValidity())
      throw new Error("Check the highlighted fields.");
    saveState.textContent = "Saving…";
    try {
      let version = draft.version,
        currentOrder = [...draft.itemOrder];
      const gone = [...removed];
      for (let i = 0; i < gone.length; i += 20) {
        const batch = gone.slice(i, i + 20);
        currentOrder = currentOrder.filter((id) => !batch.includes(id));
        const r = await api("saveQuizDraft", {
          quizId,
          expectedDraftVersion: version,
          removeItemIds: batch,
          itemOrder: currentOrder,
        });
        version = r.draftVersion;
        draft.version = version;
        draft.itemOrder = [...currentOrder];
        batch.forEach((id) => removed.delete(id));
      }
      const changed = slots.filter(
        (i) =>
          order.includes(i.itemId) &&
          (i.itemId.startsWith("new_") ||
            !data.items.some(
              (old) =>
                old.itemId === i.itemId &&
                old.points === i.points &&
                old.problemRevisionId === i.problemRevisionId,
            )),
      );
      for (let i = 0; i < changed.length; i += 20) {
        const batch = changed.slice(i, i + 20).map((slot) => ({
          ...(slot.itemId.startsWith("new_")
            ? { clientKey: slot.itemId }
            : { itemId: slot.itemId }),
          problemId: slot.problemId,
          problemRevisionId: slot.problemRevisionId,
          points: slot.points,
        }));
        const r = await api("saveQuizDraft", {
          quizId,
          expectedDraftVersion: version,
          upsertItems: batch,
        });
        version = r.draftVersion;
        draft.version = version;
        draft.itemOrder = r.itemOrder;
        for (const [client, itemId] of Object.entries(r.itemIdMap)) {
          slots.find((s) => s.itemId === client).itemId = itemId;
          order = order.map((id) => (id === client ? itemId : id));
        }
        currentOrder = r.itemOrder;
      }
      await api("saveQuizDraft", {
        quizId,
        expectedDraftVersion: version,
        patch: values(),
        itemOrder: order,
      });
      data = await api("getQuizDraft", { quizId });
      draft = data.draft;
      quiz = data.quiz;
      slots = data.items.map((i) => ({ ...i }));
      order = [...draft.itemOrder];
      dirty = false;
      store.clear();
      saveState.textContent = `Saved to Firebase · version ${draft.version}`;
      rows();
      return true;
    } catch (error) {
      saveState.textContent = "Save incomplete — retry to continue";
      throw error;
    }
  }
  async function previewPage(reset = true) {
    if (dirty)
      message(
        root,
        "Preview shows your last saved draft. Save first to include new changes.",
        "info",
      );
    if (reset) {
      previewOffset = 0;
      clearMath(preview);
      preview.innerHTML = "";
    }
    const ids = draft.itemOrder.slice(previewOffset, previewOffset + 5);
    if (!ids.length) {
      if (!previewOffset)
        preview.innerHTML = empty("Add problems to see a preview");
      return;
    }
    const result = await api("getQuizDraftItems", { quizId, itemIds: ids });
    for (const row of result.items) {
      const node = document.createElement("div");
      preview.append(node);
      await displayProblem(
        node,
        row.content,
        row.grading,
        { kind: "quiz_draft", id: quizId },
        previewOffset,
        row.points,
      );
      previewOffset++;
    }
    root.querySelector("#more-preview").hidden =
      previewOffset >= draft.itemOrder.length;
  }
  bindForm(form, async () => {
    await save();
    message(root, "Draft saved.", "success");
  });
  action(root, "#publish", async () => {
    await save();
    if (
      !(await dialog({
        title: "Publish quiz?",
        body: `<p>${order.length} problems · ${quiz.visibility} · ${quiz.accessMode === "approval" ? "Teacher approval required" : "Open access"}. Existing attempts keep their current revision.</p>`,
        confirm: "Publish",
      }))
    )
      return;
    const job = await api("publishQuiz", {
      quizId,
      expectedVersion: quiz.version,
      expectedDraftVersion: draft.version,
    });
    await waitForJob(
      job.jobId,
      (j) =>
        (saveState.textContent = `${j.progress.stage} ${j.progress.processed}/${j.progress.total}`),
    );
    dirty = false;
    go(`quiz-manage.html?id=${quizId}`);
  });
  action(root, "#refresh-preview", () => previewPage());
  action(root, "#more-preview", () => previewPage(false));
  root.querySelectorAll("[data-editor-tab]").forEach(
    (b) =>
      (b.onclick = () => {
        root.querySelector(".editor-grid").dataset.tab = b.dataset.editorTab;
        root
          .querySelectorAll("[data-editor-tab]")
          .forEach((n) => n.setAttribute("aria-selected", String(n === b)));
      }),
  );
  rows();
  await previewPage();
}
