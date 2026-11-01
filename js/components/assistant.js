import { go } from "../core/router.js";
import { askAssistant, toLatex, AI_CONNECTED } from "../services/ai.js";
import { e, dialog, confirmDialog, toast } from "./ui.js";
import { snip } from "./snip.js";
import * as chats from "../services/chats.js";
import { latexHTML, typeset } from "./math-content.js";

const KEY = "mathquiz.assistant";
const HANDOFF = "mathquiz.aiImport";
let root, log, form, input, fileList, state, pendingFiles, busy;

const load = () => {
  try {
    return (
      JSON.parse(sessionStorage.getItem(KEY)) ?? { open: false, messages: [] }
    );
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
    link.href = "assets/css/assistant.css?v=4";
    link.dataset.aiCss = "";
    document.head.append(link);
  }
  state = load();
  pendingFiles = [];
  root = document.createElement("div");
  root.id = "ai-assistant";
  root.innerHTML = `<button class="ai-fab" type="button" aria-label="Open AI assistant" aria-expanded="false"><span aria-hidden="true">✦</span><span class="ai-fab-text">Assistant</span></button><aside class="ai-panel" role="dialog" aria-label="AI assistant" hidden><header class="ai-head"><div><strong>Problem assistant</strong><span class="ai-tag">${AI_CONNECTED ? "Beta" : "Preview"}</span></div><div class="ai-head-actions"><a class="icon-button" href="ai.html" data-ai="full" aria-label="Open full AI page" title="Open full AI page">⤢</a><button class="icon-button" type="button" data-ai="snip" aria-label="Snip the screen and ask" title="Snip the screen and ask">✂</button><button class="icon-button" type="button" data-ai="reset" aria-label="New chat" title="New chat">↺</button><button class="icon-button" type="button" data-ai="close" aria-label="Close assistant">✕</button></div></header><span class="ai-grip ai-grip--w" data-grip="w" role="separator" aria-orientation="vertical" aria-label="Resize width (drag or use arrow keys, double-click to reset)" tabindex="0"></span><span class="ai-grip ai-grip--n" data-grip="n" role="separator" aria-orientation="horizontal" aria-label="Resize height (drag or use arrow keys, double-click to reset)" tabindex="0"></span><span class="ai-grip ai-grip--nw" data-grip="nw" aria-hidden="true"></span><div class="ai-log" aria-live="polite"></div><form class="ai-composer"><div class="ai-files"></div><div class="ai-row"><label class="ai-attach" title="Attach a PDF, image or .tex file"><span aria-hidden="true">📎</span><span class="sr-only">Attach files</span><input type="file" multiple accept=".pdf,.tex,image/png,image/jpeg,image/webp" hidden></label><textarea rows="1" placeholder="Ask, or attach a PDF of problems…" aria-label="Message"></textarea><button class="button primary small" type="submit">Send</button></div></form></aside>`;
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
  initResize(panel);
  fab.onclick = () => setOpen(!state.open);
  root.querySelector("[data-ai=close]").onclick = () => setOpen(false);
  root.querySelector("[data-ai=reset]").onclick = () => {
    state.messages = [];
    state.chatId = null;
    save();
    render();
  };
  root.querySelector("[data-ai=full]").onclick = (event) => {
    event.preventDefault();
    go(state.chatId ? `ai.html?chat=${state.chatId}` : "ai.html");
  };
  root.querySelector("[data-ai=snip]").onclick = async () => {
    const file = await snip();
    if (file)
      send({
        prompt:
          input.value.trim() ||
          "What is this problem asking, and how do I solve it?",
        files: [file],
      });
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
  const first = state.messages.length - 1;
  pendingFiles = [];
  input.value = "";
  input.style.height = "auto";
  drawFiles();
  save();
  render(true);
  try {
    const sources = files.filter((f) => f.type === "application/pdf");
    const shots = files.filter((f) => f.type !== "application/pdf");
    for (const file of sources) {
      await ensureChat();
      const { jobId } = await chats.queueExtraction(file, {
        chatId: state.chatId,
      });
      state.messages.push({
        role: "assistant",
        text: `Queued “${file.name}” for extraction. You will be notified when it is ready.`,
        jobId,
      });
    }
    if (sources.length && !shots.length && !prompt) {
      busy = false;
      await persist(first);
      save();
      return render();
    }
    const result = await askAssistant({ prompt, files: shots, demo });
    state.messages.push({
      role: "assistant",
      text: result.reply,
      batch: result.problems.length
        ? {
            id: crypto.randomUUID(),
            title: result.title ?? "AI import",
            problems: result.problems,
          }
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
  await persist(first);
  save();
  render();
}

async function ensureChat() {
  if (!state.chatId) state.chatId = await chats.newChat();
  return state.chatId;
}

// Best-effort save of new messages so chats appear on the AI page.
async function persist(from) {
  try {
    await ensureChat();
    const fresh = state.messages.slice(from).filter((m) => !m.saved);
    for (let i = 0; i < fresh.length; i += 4) {
      const part = fresh
        .slice(i, i + 4)
        .map(({ role, text, files, batch, jobId }) => ({
          role,
          text: text || (files?.length ? "Attached " + files.join(", ") : ""),
          files,
          batch,
          jobId,
        }));
      await chats.addMessages(state.chatId, part);
      fresh.slice(i, i + 4).forEach((m) => (m.saved = true));
    }
  } catch (error) {
    if (!state.warned)
      toast("This chat could not be saved.", { tone: "error" });
    state.warned = true;
  }
}

function render(thinking = false) {
  const welcome = `<div class="ai-msg assistant"><p>Hi! Attach a PDF of problems and I will turn it into problems you can save as a quiz or add to your bank.</p><div class="ai-suggest"><button type="button" data-ai="demo">Try a demo extraction</button><button type="button" data-ai="how">How it works</button></div></div>`;
  log.innerHTML =
    (state.messages.length ? "" : welcome) +
    state.messages
      .map((m, i) => {
        if (m.role === "user")
          return `<div class="ai-msg user"><p>${e(m.text || "")}</p>${m.files?.length ? `<div class="ai-files">${m.files.map((f) => `<span class="ai-chip">${e(f)}</span>`).join("")}</div>` : ""}</div>`;
        return `<div class="ai-msg assistant ${m.error ? "error" : ""}"><p>${e(m.text)}</p>${m.jobId ? `<p><a class="button secondary small" href="ai.html?job=${e(m.jobId)}">View status</a></p>` : ""}${m.batch ? batchCard(m.batch, i) : ""}</div>`;
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
    .join(
      "",
    )}${batch.problems.length > 3 ? `<li class="muted">+ ${batch.problems.length - 3} more</li>` : ""}</ul><div class="ai-result-actions"><button class="button primary small" data-act="quiz">Save as quiz</button><button class="button secondary small" data-act="see">See problems</button><button class="button ghost small" data-act="discard">Discard</button></div><div class="ai-result-more"><button data-act="bank">Add to bank</button><button data-act="copy">Copy LaTeX</button><button data-act="download">Download .tex</button><button data-act="again">Regenerate</button></div></div>`;
}

function handoff(batch, problems, bank) {
  sessionStorage.setItem(
    HANDOFF,
    JSON.stringify({
      title: batch.title,
      source: toLatex(problems, batch.title),
    }),
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
      await navigator.clipboard?.writeText(
        toLatex(batch.problems, batch.title),
      );
      button.textContent = "Copied ✓";
      return;
    case "download": {
      const url = URL.createObjectURL(
        new Blob([toLatex(batch.problems, batch.title)], {
          type: "text/plain",
        }),
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
    body:
      body +
      `<p class="muted small">Untick problems you do not want. Selected problems are saved as a quiz.</p>`,
    confirm: "Save selected as quiz",
  });
  const node = document.querySelector("dialog.dialog:last-of-type .ai-review");
  if (node) typeset(node);
  const values = await pending;
  if (!values) return;
  const picked = values.getAll("pick").map(Number);
  if (!picked.length) return;
  handoff(
    batch,
    picked.map((i) => batch.problems[i]),
    false,
  );
}

const SIZE_KEY = "mathquiz.assistantSize";
function initResize(panel) {
  const limits = () => ({
    minW: 320,
    minH: 360,
    maxW: innerWidth - 32,
    maxH: innerHeight - 92,
  });
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const apply = (w, h) => {
    const l = limits();
    if (w != null)
      panel.style.setProperty("--ai-w", clamp(w, l.minW, l.maxW) + "px");
    if (h != null)
      panel.style.setProperty("--ai-h", clamp(h, l.minH, l.maxH) + "px");
  };
  const saveSize = () => {
    const r = panel.getBoundingClientRect();
    try {
      localStorage.setItem(
        SIZE_KEY,
        JSON.stringify({ w: Math.round(r.width), h: Math.round(r.height) }),
      );
    } catch {}
  };
  try {
    const s = JSON.parse(localStorage.getItem(SIZE_KEY) || "null");
    if (s) apply(s.w, s.h);
  } catch {}
  const reset = () => {
    panel.style.removeProperty("--ai-w");
    panel.style.removeProperty("--ai-h");
    try {
      localStorage.removeItem(SIZE_KEY);
    } catch {}
  };
  panel.querySelectorAll("[data-grip]").forEach((grip) => {
    const mode = grip.dataset.grip;
    grip.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      grip.setPointerCapture(ev.pointerId);
      const start = panel.getBoundingClientRect(),
        x0 = ev.clientX,
        y0 = ev.clientY;
      const move = (m) =>
        apply(
          mode.includes("w") ? start.width + (x0 - m.clientX) : null,
          mode.includes("n") ? start.height + (y0 - m.clientY) : null,
        );
      const up = () => {
        grip.removeEventListener("pointermove", move);
        grip.removeEventListener("pointerup", up);
        grip.removeEventListener("pointercancel", up);
        saveSize();
      };
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", up);
      grip.addEventListener("pointercancel", up);
    });
    grip.addEventListener("dblclick", reset);
    grip.addEventListener("keydown", (ev) => {
      const step = ev.shiftKey ? 80 : 24,
        r = panel.getBoundingClientRect(),
        dir = {
          ArrowLeft: [step, 0],
          ArrowRight: [-step, 0],
          ArrowUp: [0, step],
          ArrowDown: [0, -step],
        }[ev.key];
      if (!dir || (mode === "w" && !dir[0]) || (mode === "n" && !dir[1]))
        return;
      ev.preventDefault();
      apply(
        dir[0] ? r.width + dir[0] : null,
        dir[1] ? r.height + dir[1] : null,
      );
      saveSize();
    });
  });
  addEventListener("resize", () => {
    const r = panel.getBoundingClientRect();
    if (
      panel.style.getPropertyValue("--ai-w") ||
      panel.style.getPropertyValue("--ai-h")
    )
      apply(r.width, r.height);
  });
}
