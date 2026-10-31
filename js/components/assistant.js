import { go } from "../core/router.js";
import { askAssistant, toLatex, AI_CONNECTED } from "../services/ai.js";
import { e, dialog, confirmDialog } from "./ui.js";
import { latexHTML, typeset } from "./math-content.js";

const KEY = "mathquiz.assistant";
const HANDOFF = "mathquiz.aiImport";
let root, log, form, input, fileList, state, pendingFiles, busy;

const load = () => {
  try {
    return JSON.parse(sessionStorage.getItem(KEY)) ?? { open: false, messages: [] };
  } catch {
    return { open: false, messages: [] };
  }
};
const save = () => sessionStorage.setItem(KEY, JSON.stringify(state));

export function mountAssistant(session) {
  const allowed = !!session?.capabilities?.teach;
  if (!allowed) {
    root?.remove();
    root = null;
    return;
  }
  if (root) return;
  if (!document.querySelector("link[data-ai-css]")) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "assets/css/assistant.css?v=3";
    link.dataset.aiCss = "";
    document.head.append(link);
  }
  state = load();
  pendingFiles = [];
  root = document.createElement("div");
  root.id = "ai-assistant";
  root.innerHTML = `<button class="ai-fab" type="button" aria-label="Open AI assistant" aria-expanded="false"><span aria-hidden="true">✦</span><span class="ai-fab-text">Assistant</span></button><aside class="ai-panel" role="dialog" aria-label="AI assistant" hidden><header class="ai-head"><div><strong>Problem assistant</strong><span class="ai-tag">${AI_CONNECTED ? "Beta" : "Preview"}</span></div><div class="ai-head-actions"><button class="icon-button" type="button" data-ai="reset" aria-label="Clear conversation" title="Clear conversation">↺</button><button class="icon-button" type="button" data-ai="close" aria-label="Close assistant">✕</button></div></header><div class="ai-log" aria-live="polite"></div><form class="ai-composer"><div class="ai-files"></div><div class="ai-row"><label class="ai-attach" title="Attach a PDF, image or .tex file"><span aria-hidden="true">📎</span><span class="sr-only">Attach files</span><input type="file" multiple accept=".pdf,.tex,image/png,image/jpeg,image/webp" hidden></label><textarea rows="1" placeholder="Ask, or attach a PDF of problems…" aria-label="Message"></textarea><button class="button primary small" type="submit">Send</button></div></form></aside>`;
  document.body.append(root);
  log = root.querySelector(".ai-log");
  form = root.querySelector("form");
  input = form.querySelector("textarea");
  fileList = root.querySelector(".ai-files");
  const fab = root.querySelector(".ai-fab"),
    panel = root.querySelector(".ai-panel");
  const setOpen = (open) => {
    state.open = open;
    panel.hidden = !open;
    fab.setAttribute("aria-expanded", String(open));
    root.classList.toggle("is-open", open);
    save();
    if (open) input.focus({ preventScroll: true });
  };
  fab.onclick = () => setOpen(!state.open);
  root.querySelector("[data-ai=close]").onclick = () => setOpen(false);
  root.querySelector("[data-ai=reset]").onclick = async () => {
    if (
      state.messages.length &&
      !(await confirmDialog(
        "Clear this conversation?",
        "Extracted problems in the chat will be discarded.",
        "Clear",
      ))
    )
      return;
    state.messages = [];
    save();
    render();
  };
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.open) setOpen(false);
  });
  form.querySelector("input[type=file]").onchange = (event) => {
    for (const file of event.target.files)
      if (file.size <= 20971520) pendingFiles.push(file);
    event.target.value = "";
    drawFiles();
  };
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    send({ prompt: input.value.trim(), files: pendingFiles });
  });
  log.addEventListener("click", onLogClick);
  render();
  setOpen(state.open);
}

function drawFiles() {
  fileList.innerHTML = pendingFiles
    .map(
      (f, i) =>
        `<span class="ai-chip">${e(f.name)}<button type="button" data-rm="${i}" aria-label="Remove ${e(f.name)}">✕</button></span>`,
    )
    .join("");
  fileList.querySelectorAll("[data-rm]").forEach(
    (b) =>
      (b.onclick = () => {
        pendingFiles.splice(Number(b.dataset.rm), 1);
        drawFiles();
      }),
  );
}

async function send({ prompt, files = [], demo = false }) {
  if (busy || (!prompt && !files.length && !demo)) return;
  busy = true;
  state.messages.push({
    role: "user",
    text: demo ? "Try a demo extraction" : prompt,
    files: files.map((f) => f.name),
  });
  pendingFiles = [];
  input.value = "";
  input.style.height = "auto";
  drawFiles();
  save();
  render(true);
  try {
    const result = await askAssistant({ prompt, files, demo });
    state.messages.push({
      role: "assistant",
      text: result.reply,
      batch: result.problems.length
        ? { id: crypto.randomUUID(), title: result.title ?? "AI import", problems: result.problems }
        : null,
    });
  } catch (error) {
    state.messages.push({
      role: "assistant",
      text: error.message || "Something went wrong.",
      error: true,
    });
  }
  busy = false;
  save();
  render();
}

function render(thinking = false) {
  const welcome = `<div class="ai-msg assistant"><p>Hi! Attach a PDF of problems and I will turn it into problems you can save as a quiz or add to your bank.</p><div class="ai-suggest"><button type="button" data-ai="demo">Try a demo extraction</button><button type="button" data-ai="how">How it works</button></div></div>`;
  log.innerHTML =
    (state.messages.length ? "" : welcome) +
    state.messages
      .map((m, i) => {
        if (m.role === "user")
          return `<div class="ai-msg user"><p>${e(m.text || "")}</p>${m.files?.length ? `<div class="ai-files">${m.files.map((f) => `<span class="ai-chip">${e(f)}</span>`).join("")}</div>` : ""}</div>`;
        return `<div class="ai-msg assistant ${m.error ? "error" : ""}"><p>${e(m.text)}</p>${m.batch ? batchCard(m.batch, i) : ""}</div>`;
      })
      .join("") +
    (thinking
      ? `<div class="ai-msg assistant"><p class="ai-typing" aria-label="Thinking"><i></i><i></i><i></i></p></div>`
      : "");
  log.scrollTop = log.scrollHeight;
}

function batchCard(batch, index) {
  const total = batch.problems.reduce((s, p) => s + (Number(p.points) || 0), 0);
  return `<div class="ai-result" data-batch="${index}"><div class="ai-result-head"><strong>${batch.problems.length} problem${batch.problems.length === 1 ? "" : "s"} found</strong><span>${total} points</span></div><ul class="ai-result-list">${batch.problems
    .slice(0, 3)
    .map((p) => `<li>${e(p.statement.replace(/\$/g, "").slice(0, 70))}</li>`)
    .join("")}${batch.problems.length > 3 ? `<li class="muted">+ ${batch.problems.length - 3} more</li>` : ""}</ul><div class="ai-result-actions"><button class="button primary small" data-act="quiz">Save as quiz</button><button class="button secondary small" data-act="see">See problems</button><button class="button ghost small" data-act="discard">Discard</button></div><div class="ai-result-more"><button data-act="bank">Add to bank</button><button data-act="copy">Copy LaTeX</button><button data-act="download">Download .tex</button><button data-act="again">Regenerate</button></div></div>`;
}

function handoff(batch, problems, bank) {
  sessionStorage.setItem(
    HANDOFF,
    JSON.stringify({ title: batch.title, source: toLatex(problems, batch.title) }),
  );
  go(bank ? "upload.html?bank=1" : "upload.html");
}

async function onLogClick(event) {
  const demo = event.target.closest("[data-ai=demo]");
  if (demo) return send({ demo: true });
  if (event.target.closest("[data-ai=how]")) {
    state.messages.push({
      role: "assistant",
      text: "1) Attach a PDF or images. 2) I extract each problem with its answer. 3) Review them, then save as a quiz, add to your bank, or discard. Nothing is saved until you confirm.",
    });
    save();
    return render();
  }
  const button = event.target.closest("[data-act]"),
    card = event.target.closest("[data-batch]");
  if (!button || !card) return;
  const message = state.messages[Number(card.dataset.batch)],
    batch = message.batch;
  switch (button.dataset.act) {
    case "quiz":
      return handoff(batch, batch.problems, false);
    case "bank":
      return handoff(batch, batch.problems, true);
    case "see":
      return review(batch);
    case "discard":
      if (
        await confirmDialog(
          "Discard these problems?",
          "They will be removed from the conversation.",
          "Discard",
        )
      ) {
        message.batch = null;
        message.text += " (Discarded)";
        save();
        render();
      }
      return;
    case "copy":
      await navigator.clipboard?.writeText(toLatex(batch.problems, batch.title));
      button.textContent = "Copied ✓";
      return;
    case "download": {
      const url = URL.createObjectURL(
        new Blob([toLatex(batch.problems, batch.title)], { type: "text/plain" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "problems.tex";
      a.click();
      URL.revokeObjectURL(url);
      return;
    }
    case "again":
      return send({ demo: true });
  }
}

async function review(batch) {
  const body = `<div class="ai-review">${batch.problems
    .map(
      (p, i) =>
        `<label class="panel bank-card ai-review-card"><div class="bank-select"><span class="subject">Problem ${i + 1} · ${p.points} pt</span><input type="checkbox" name="pick" value="${i}" checked></div><div class="math-content">${latexHTML(p.statement)}</div>${p.type === "choice" ? `<ol class="preview-options">${(p.options ?? []).map((o) => `<li>${o.correct ? "✓ " : ""}${latexHTML(o.text)}</li>`).join("")}</ol>` : p.answer ? `<p class="muted small">Answer: ${latexHTML("$" + p.answer + "$")}</p>` : ""}</label>`,
    )
    .join("")}</div>`;
  const pending = dialog({
    title: "Review extracted problems",
    body: body + `<p class="muted small">Untick problems you do not want. Selected problems are saved as a quiz.</p>`,
    confirm: "Save selected as quiz",
  });
  const node = document.querySelector("dialog.dialog:last-of-type .ai-review");
  if (node) typeset(node);
  const values = await pending;
  if (!values) return;
  const picked = values.getAll("pick").map(Number);
  if (!picked.length) return;
  handoff(batch, picked.map((i) => batch.problems[i]), false);
}
