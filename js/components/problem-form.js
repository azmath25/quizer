import { onLeave, onLeaveGuard } from "../core/router.js";
import { drafts, draftBanner } from "../services/drafts.js";
import { api } from "../services/api.js";
import { uploadAsset, resolveImages } from "../services/assets.js";
import { validateProblem, validateMetadata } from "../../shared/schema.js";
import {
  field,
  textarea,
  select,
  checkbox,
  e,
  bindForm,
  action,
  message,
  points,
  icon,
} from "./ui.js";
import { problemPreview, typeset, clearMath } from "./math-content.js";
export function blankProblem() {
  return {
    metadata: {
      title: "",
      subject: "",
      difficulty: "",
      tags: [],
      bankVisibility: "private",
    },
    content: {
      type: "open",
      answerMode: "auto",
      statementLatex: "",
      options: [],
      defaultPoints: 1,
      questionAssetBindings: {},
    },
    grading: {
      correctOptionId: null,
      acceptedAnswers: [""],
      tolerance: 0.000001,
      explanationLatex: "",
      rubricLatex: "",
      solutionAssetBindings: {},
    },
  };
}
export async function problemForm(
  root,
  { initial = blankProblem(), context = null, onSave, readOnly = false },
) {
  const m = initial.metadata,
    c = initial.content,
    g = initial.grading;
  let mode =
    c.type === "choice"
      ? "choice"
      : c.answerMode === "manual"
        ? "manual"
        : "auto";
  let choices = c.options.length
      ? structuredClone(c.options)
      : [
          { id: crypto.randomUUID(), textLatex: "" },
          { id: crypto.randomUUID(), textLatex: "" },
        ],
    correct = g.correctOptionId ?? choices[0].id;
  let questionBindings = { ...c.questionAssetBindings },
    solutionBindings = { ...g.solutionAssetBindings },
    images = {};
  if (context)
    images = await resolveImages(
      { ...questionBindings, ...solutionBindings },
      context,
    );
  root.innerHTML = `<div class="tabs mobile-editor-tabs" role="tablist" aria-label="Problem editor"><button role="tab" aria-selected="true" data-editor-tab="edit">Edit</button><button role="tab" aria-selected="false" data-editor-tab="preview">Preview</button></div><form id="problem-form"><div class="editor-grid" data-tab="edit"><div class="editor-panel"><section class="panel stack"><div class="section-head"><h2>Problem</h2></div><div class="form-grid">${field("Title", "title", "text", m.title, 'required maxlength="200"')}${select(
    "Response type",
    "mode",
    [
      ["choice", "Multiple choice"],
      ["auto", "Short answer"],
      ["manual", "Written response"],
    ],
    mode,
  )}${field("Subject", "subject", "text", m.subject, 'maxlength="80"')}${field("Difficulty", "difficulty", "text", m.difficulty, 'maxlength="40"')}</div>${textarea("Statement · LaTeX supported", "statementLatex", c.statementLatex, 'required maxlength="30000" rows="7"')}${field("Default points", "defaultPoints", "number", c.defaultPoints, 'required min="0.00000001" max="1000" step="any"')}<div id="choice-area"><label class="field"><span>Choices · select the correct answer</span></label><div class="choice-edit-list"></div><button type="button" class="button ghost" id="add-choice">${icon("plus")}Add choice</button></div><div id="auto-area" class="stack">${textarea("Accepted answers · one per line", "acceptedAnswers", g.acceptedAnswers.join("\n"), 'maxlength="15000" rows="3"')}${field("Numeric tolerance", "tolerance", "number", g.tolerance, 'min="0" max="1" step="any"')}<p class="muted small">Equivalent arithmetic such as 0.5 and 1/2 is accepted. Use written response for proofs and symbolic answers requiring a teacher.</p></div><div id="manual-area"><p class="notice">Written responses are marked by the teacher after submission.</p></div>${textarea("Solution · shown according to quiz release settings", "explanationLatex", g.explanationLatex, 'maxlength="30000" rows="4"')}${textarea("Marking rubric · teachers only", "rubricLatex", g.rubricLatex, 'maxlength="30000" rows="3"')}</section><section class="panel stack"><h2>Images</h2><p class="muted small">Upload PNG, JPEG, WebP or GIF. Images are stored separately and linked by filename.</p>${select(
    "Add image to",
    "imageTarget",
    [
      ["question", "Statement / choices"],
      ["solution", "Solution / rubric"],
    ],
    "question",
  )}<label class="field"><span>Image file · up to 4 MB</span><input id="problem-image" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></label><div class="image-list" id="image-list"></div><div data-image-status></div></section><section class="panel stack"><h2>Problem bank</h2>${field("Tags · comma separated", "tags", "text", m.tags.join(", "), 'maxlength="732"')}${select(
    "Sharing",
    "bankVisibility",
    [
      ["private", "Private — only you"],
      ["teachers", "Shared with teachers"],
    ],
    m.bankVisibility,
  )}<p class="muted small">Sharing lets other teachers reuse this problem. They cannot edit your original.</p></section></div><aside class="panel editor-preview"><div class="panel-title"><h2>Preview</h2></div><div id="problem-preview"></div></aside></div><div class="editor-actions"><span class="save-state" id="save-state">${initial.problemId ? "Saved revision " + initial.revisionNumber : "New problem"}</span><div class="actions"><button type="submit" class="button primary" ${readOnly ? "disabled" : ""}>Save problem</button></div></div><div data-message></div></form>`;
  const form = root.querySelector("#problem-form");
  let dirty = false;
  function collect() {
    const f = new FormData(form);
    return {
      metadata: {
        title: f.get("title"),
        subject: f.get("subject"),
        difficulty: f.get("difficulty"),
        tags: f
          .get("tags")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        bankVisibility: f.get("bankVisibility"),
      },
      content: {
        type: mode === "choice" ? "choice" : "open",
        answerMode: mode === "manual" ? "manual" : "auto",
        statementLatex: f.get("statementLatex"),
        options: mode === "choice" ? choices : [],
        defaultPoints: Number(f.get("defaultPoints")),
        questionAssetBindings: questionBindings,
      },
      grading: {
        correctOptionId: mode === "choice" ? correct : null,
        acceptedAnswers:
          mode === "auto"
            ? f
                .get("acceptedAnswers")
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean)
            : [],
        tolerance: Number(f.get("tolerance")),
        explanationLatex: f.get("explanationLatex"),
        rubricLatex: f.get("rubricLatex"),
        solutionAssetBindings: solutionBindings,
      },
    };
  }
  function preview() {
    const data = collect();
    const node = root.querySelector("#problem-preview");
    clearMath(node);
    node.innerHTML = problemPreview(data.content, data.grading, images);
    typeset(node);
  }
  const store = drafts(`problem.${initial.problemId ?? "new"}`);
  function changed() {
    dirty = true;
    root.querySelector("#save-state").textContent =
      "Unsaved changes (draft kept on this device)";
    if (!readOnly)
      store.save(() => ({
        mode,
        choices,
        correct,
        fields: Object.fromEntries(
          [...form.elements]
            .filter(
              (n) => n.name && !["file", "radio"].includes(n.type) && n.name !== "imageTarget",
            )
            .map((n) => [n.name, n.value]),
        ),
      }));
    preview();
  }
  function choiceRows() {
    root.querySelector(".choice-edit-list").innerHTML = choices
      .map(
        (o, i) =>
          `<div class="choice-editor"><input type="radio" name="correct" value="${e(o.id)}" aria-label="Choice ${i + 1} is correct" ${correct === o.id ? "checked" : ""}><textarea data-choice="${e(o.id)}" aria-label="Choice ${i + 1}" maxlength="10000">${e(o.textLatex)}</textarea><button type="button" class="icon-button" data-remove="${e(o.id)}" aria-label="Remove choice ${i + 1}" ${choices.length <= 2 ? "disabled" : ""}>${icon("close")}</button></div>`,
      )
      .join("");
    root.querySelectorAll("[data-choice]").forEach(
      (n) =>
        (n.oninput = () => {
          choices.find((o) => o.id === n.dataset.choice).textLatex = n.value;
          changed();
        }),
    );
    root.querySelectorAll("[name=correct]").forEach(
      (n) =>
        (n.onchange = () => {
          correct = n.value;
          changed();
        }),
    );
    root.querySelectorAll("[data-remove]").forEach(
      (n) =>
        (n.onclick = () => {
          choices = choices.filter((o) => o.id !== n.dataset.remove);
          if (!choices.some((o) => o.id === correct)) correct = choices[0].id;
          choiceRows();
          changed();
        }),
    );
  }
  function modeChanged() {
    mode = form.elements.mode.value;
    root.querySelector("#choice-area").hidden = mode !== "choice";
    root.querySelector("#auto-area").hidden = mode !== "auto";
    root.querySelector("#manual-area").hidden = mode !== "manual";
    preview();
  }
  function imageRows() {
    root.querySelector("#image-list").innerHTML = [
      ...Object.entries(questionBindings).map(([name, id]) => ({
        name,
        id,
        type: "question",
      })),
      ...Object.entries(solutionBindings).map(([name, id]) => ({
        name,
        id,
        type: "solution",
      })),
    ]
      .map(
        (a) =>
          `<div class="image-row">${images[a.name] ? `<img src="${e(images[a.name])}" alt="${e(a.name)}" referrerpolicy="no-referrer">` : ""}<code>\\includegraphics{${e(a.name)}}</code><button type="button" class="button ghost small" data-insert="${e(a.name)}" data-target="${a.type}">Insert</button></div>`,
      )
      .join("");
    root.querySelectorAll("[data-insert]").forEach(
      (b) =>
        (b.onclick = () => {
          const input =
            form.elements[
              b.dataset.target === "question"
                ? "statementLatex"
                : "explanationLatex"
            ];
          const text = `\n\\includegraphics{${b.dataset.insert}}\n`;
          input.setRangeText(
            text,
            input.selectionStart ?? input.value.length,
            input.selectionEnd ?? input.value.length,
            "end",
          );
          input.focus();
          changed();
        }),
    );
  }
  root.querySelector("#problem-image").onchange = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const status = root.querySelector("[data-image-status]");
    try {
      const otherBindings =
        form.elements.imageTarget.value === "question"
          ? solutionBindings
          : questionBindings;
      if (Object.hasOwn(otherBindings, file.name))
        throw new Error(
          "Rename this file before uploading: that filename is already used in the other image section.",
        );
      status.textContent = "Uploading…";
      const assetId = await uploadAsset(
        file,
        (p) => (status.textContent = p.stage + " " + p.percent + "%"),
      );
      const map = await resolveImages(
        { [file.name]: assetId },
        { kind: "owned_upload", id: assetId },
      );
      images = { ...images, ...map };
      if (form.elements.imageTarget.value === "question")
        questionBindings[file.name] = assetId;
      else solutionBindings[file.name] = assetId;
      imageRows();
      status.textContent =
        "Image uploaded. Insert its reference where needed, then save the problem.";
      changed();
    } catch (error) {
      status.textContent = error.message;
    } finally {
      event.target.value = "";
    }
  };
  root.querySelector("#add-choice").onclick = () => {
    if (choices.length >= 12) return;
    choices.push({ id: crypto.randomUUID(), textLatex: "" });
    choiceRows();
    changed();
  };
  form.addEventListener("input", (event) => {
    if (event.target.type !== "file") changed();
  });
  form.elements.mode.onchange = () => {
    modeChanged();
    changed();
  };
  root.querySelectorAll("[data-editor-tab]").forEach(
    (b) =>
      (b.onclick = () => {
        root.querySelector(".editor-grid").dataset.tab = b.dataset.editorTab;
        root
          .querySelectorAll("[data-editor-tab]")
          .forEach((x) => x.setAttribute("aria-selected", String(x === b)));
        preview();
      }),
  );
  const beforeUnload = (event) => {
    if (dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  };
  window.addEventListener("beforeunload", beforeUnload);
  onLeaveGuard(() => dirty);
  onLeave(() => window.removeEventListener("beforeunload", beforeUnload));
  bindForm(form, async () => {
    const data = collect();
    validateMetadata(data.metadata);
    validateProblem(data.content, data.grading);
    root.querySelector("#save-state").textContent = "Saving…";
    try {
      await onSave(data);
      dirty = false;
      store.clear();
      root.querySelector("#save-state").textContent = "Saved to Firebase";
      message(form, "Problem saved.", "success");
    } catch (error) {
      root.querySelector("#save-state").textContent = "Not saved";
      throw error;
    }
  });
  choiceRows();
  imageRows();
  modeChanged();
  const saved = readOnly ? null : store.read();
  if (saved)
    draftBanner(root, saved, {
      onDiscard: () => store.clear(),
      onRestore: (v) => {
        for (const [name, value] of Object.entries(v.fields))
          if (form.elements[name]) form.elements[name].value = value;
        choices = v.choices;
        correct = v.correct;
        choiceRows();
        modeChanged();
        changed();
      },
    });
  if (readOnly)
    form
      .querySelectorAll("input,select,textarea,button")
      .forEach((n) => (n.disabled = true));
  return {
    collect,
    clearDirty: () => {
      dirty = false;
    },
    destroy: () => window.removeEventListener("beforeunload", beforeUnload),
  };
}
