import { getSession } from "../firebase-client.js";
import {
  canUseMimoTeacherChat, mimoChatErrorMessage, sendTeacherChatMessage,
} from "../services/mimo-chat.js";
import {
  prepareFloatingAssistantRequest, isUncertainAssistantError,
} from "../services/floating-assistant-chat.js";
import { renderChatMarkdown, typesetChatMarkdown } from "./ai-chat-markdown.js";
import { e, dialog, confirmDialog, toast } from "./ui.js";
import { snipPageContent } from "./page-snip.js";
import { snip } from "./snip.js";
import { typeset } from "./math-content.js";

const KEY = "mathquiz.assistant.mimo.v1";
let root, log, form, input, fileList, state, pendingFiles, busy;
let mountedUid = null, generation = 0;
let disposeDock = () => {};

const fresh = () => ({ open: false, messages: [] });
const load = () => {
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY + "." + mountedUid));
    if (!saved || !Array.isArray(saved.messages)) return fresh();
    const messages = saved.messages.slice(-60).filter(m =>
      m && ["user", "assistant"].includes(m.role) && typeof m.text === "string"
    ).map(m => ({
      role: m.role, text: m.text.slice(0, 14000),
      confirmed: m.confirmed === true,
      error: m.error === true,
      runId: typeof m.runId === "string" ? m.runId.slice(0, 128) : null,
      requestId: typeof m.requestId === "string" ? m.requestId.slice(0, 100) : null,
    }));
    // A reload can interrupt a billable request. Never silently imply that an
    // unanswered message failed or resend it without reconciliation.
    const last = messages.at(-1);
    if (last?.role === "user" && !last.confirmed && last.requestId) {
      messages.push({
        role: "assistant", error: true, confirmed: false,
        text: "The previous Mimo request was interrupted in this browser. " +
          "It may have reached the model; do not resend automatically. " +
          "Request reference: " + last.requestId,
      });
    }
    return {open: saved.open === true, messages: messages.slice(-60)};
  } catch { return fresh(); }
};
const save = () => {
  if (!mountedUid || !state) return;
  try { sessionStorage.setItem(KEY + "." + mountedUid, JSON.stringify(state)); }
  catch { /* local history is optional; the AI request must not be retried */ }
};

export function mountAssistant(session) {
  const allowed = !!session?.capabilities?.teach && canUseMimoTeacherChat(session);
  if (!allowed) {
    generation++;
    disposeDock();
    disposeDock = () => {};
    root?.remove();
    root = null;
    mountedUid = null;
    state = null;
    pendingFiles = [];
    busy = false;
    return;
  }
  if (root && mountedUid === session.user.uid) return;
  if (root) {
    generation++;
    disposeDock();
    root.remove();
    root = null;
  }
  mountedUid = session.user.uid;
  generation++;
  if (!document.querySelector("link[data-ai-css]")) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "assets/css/assistant.css?v=17";
    link.dataset.aiCss = "";
    document.head.append(link);
  }
  state = load();
  pendingFiles = [];
  busy = false;
  root = document.createElement("div");
  root.id = "ai-assistant";
  root.innerHTML = `<div class="ai-dock" aria-label="Floating assistant toolbar"><button class="ai-dock-handle" type="button" aria-label="Move assistant toolbar; arrow keys also work" title="Drag to move · arrow keys to reposition">⠿</button><button class="ai-fab" type="button" aria-label="Open AI assistant" aria-expanded="false"><span aria-hidden="true">✦</span><span class="ai-fab-text">Assistant</span></button><button class="ai-fab ai-snip-fab" type="button" aria-label="Snip visible page text or mathematics" title="Select page text and LaTeX · no screen sharing">✂</button><button class="ai-fab ai-pixel-fab" type="button" aria-label="Crop browser-tab screenshot" title="Visual snip · browser tab permission required">▣</button></div><aside class="ai-panel" role="dialog" aria-label="AI assistant" hidden><header class="ai-head"><div><strong>Teacher AI assistant</strong><span class="ai-tag">Mimo · Live</span></div><div class="ai-head-actions"><button class="icon-button" type="button" data-ai="snip-page" aria-label="Snip visible page text or mathematics" title="Snip page content · no permission">✂</button><button class="icon-button" type="button" data-ai="snip" aria-label="Crop browser-tab screenshot" title="Visual snip · browser tab permission">▣</button><button class="icon-button" type="button" data-ai="reset" aria-label="Clear conversation" title="Clear conversation">↺</button><button class="icon-button" type="button" data-ai="close" aria-label="Close assistant">✕</button></div></header><span class="ai-grip ai-grip--w" data-grip="w" role="separator" aria-orientation="vertical" aria-label="Resize width (drag or use arrow keys, double-click to reset)" tabindex="0"></span><span class="ai-grip ai-grip--n" data-grip="n" role="separator" aria-orientation="horizontal" aria-label="Resize height (drag or use arrow keys, double-click to reset)" tabindex="0"></span><span class="ai-grip ai-grip--nw" data-grip="nw" aria-hidden="true"></span><div class="ai-log" aria-live="polite"></div><form class="ai-composer"><div class="ai-files"></div><div class="ai-row"><label class="ai-attach" title="Stage a local file (not supported by text chat yet)"><span aria-hidden="true">📎</span><span class="sr-only">Attach files</span><input type="file" multiple accept=".pdf,.tex,image/png,image/jpeg,image/webp" hidden></label><textarea rows="1" placeholder="Ask a mathematical question…" maxlength="3000" aria-label="Message"></textarea><button class="button primary small" type="submit">Send</button></div><p class="ai-footnote">Connected to Mimo for text chat. Images, PDFs and screenshots stay local and cannot be sent yet.</p></form></aside>`;
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
  disposeDock = initDockDrag(root.querySelector(".ai-dock"));
  const appendClip = async () => {
    try {
      const clipped = await snipPageContent();
      if (!clipped) {
        toast("No visible text found there. For diagrams, use Visual snip.", { tone: "info" });
        return;
      }
      const accepted = await dialog({
        title: "Add selected page material?",
        body: '<p class="muted small">Review the exact text and math extracted from your selection. Nothing is submitted automatically.</p><pre class="ai-clip-preview">' +
          e(clipped) + '</pre>',
        confirm: "Add to message",
      });
      if (!accepted) return;
      setOpen(true);
      input.value = [input.value.trim(), "Selected material:\n" + clipped]
        .filter(Boolean).join("\n\n");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.focus({ preventScroll: true });
    } catch (error) {
      toast(error?.message || "Could not select page material.", { tone: "error" });
    }
  };
  const appendPixel = async () => {
    document.documentElement.classList.add("ai-capture-in-progress");
    try {
      const file = await snip();
      if (!file) return;
      if (file.size > 20971520) {
        toast("Image is too large to attach (20 MB limit).", { tone: "error" });
        return;
      }
      pendingFiles.push(file);
      drawFiles();
      setOpen(true);
      toast("Screenshot staged locally. Image sending is not yet available in text chat.", { tone: "info" });
    } catch (error) {
      toast(error?.message || "Visual snip unavailable. Use the text snip instead.", { tone: "error" });
    } finally {
      document.documentElement.classList.remove("ai-capture-in-progress");
    }
  };
  root.querySelector(".ai-snip-fab").onclick = appendClip;
  root.querySelector(".ai-pixel-fab").onclick = appendPixel;
  root.querySelector('[data-ai="snip-page"]').onclick = appendClip;
  root.querySelector('[data-ai="snip"]').onclick = appendPixel;
  fab.onclick = () => setOpen(!state.open);
  root.querySelector("[data-ai=close]").onclick = () => setOpen(false);
  root.querySelector("[data-ai=reset]").onclick = async () => {
    if (busy) return;
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
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing && !busy) {
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

async function send({ prompt, files = [] }) {
  if (busy) return;
  const message = String(prompt || "").trim();
  if (!message && !files.length) return;
  if (files.length) {
    toast("Text chat cannot read attached images or PDFs yet. Remove the files to send your text; attachments stay local.", {tone:"info"});
    return;
  }
  if (!canUseMimoTeacherChat(getSession())) {
    toast("Verified teacher access is needed. Refresh your session before sending.", {tone:"error"});
    return;
  }
  let payload;
  const requestId = crypto.randomUUID();
  try {
    payload = prepareFloatingAssistantRequest({
      message, messages: state.messages, requestId,
    });
  } catch (error) {
    toast(error.message, {tone:"error"});
    return;
  }
  const myGeneration = generation, myOwner = mountedUid;
  const oldDraft = input.value;
  const row = {role:"user", text:message, confirmed:false, requestId};
  state.messages.push(row);
  busy = true;
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  // The submitted message appears in chat immediately. Keep this field free
  // for a fresh draft while the pending request is running.
  input.value = "";
  form.setAttribute("aria-busy","true");
  save();
  render(true);
  try {
    // A single server-authorized Firebase callable, exactly as in Ask AI.
    // No automatic retry: an uncertain response may already be billable.
    const response = await sendTeacherChatMessage(payload);
    if (generation !== myGeneration || mountedUid !== myOwner || !root ||
        !canUseMimoTeacherChat(getSession())) return;
    row.confirmed = true;
    state.messages.push({
      role:"assistant", text:response.reply, confirmed:true,
      runId:response.runId || null,
    });
    // Never wipe a new draft typed while waiting.
  } catch (error) {
    if (generation !== myGeneration || mountedUid !== myOwner || !root) return;
    const uncertain = isUncertainAssistantError(error);
    // Restore the failed submission only if no newer draft was started.
    if (!input.value) input.value = oldDraft;
    state.messages.push({
      role:"assistant", error:true, confirmed:false,
      text:mimoChatErrorMessage(error) +
        (uncertain ? "\nRequest reference: " + requestId : ""),
    });
  } finally {
    if (generation === myGeneration && mountedUid === myOwner && root) {
      busy = false;
      submit.disabled = false;
      input.readOnly = false;
      form.removeAttribute("aria-busy");
      save();
      render();
      input.focus({preventScroll:true});
    }
  }
}

function render(thinking = false) {
  const welcome = `<div class="ai-msg assistant"><p>Ask me to explain mathematics, check reasoning, or work through a problem. This chat uses the same real Mimo service as Ask AI in Quizer.</p><p class="ai-limitation">Text only for now. Use scissors to add visible text. Images and PDFs are not uploaded by this chat.</p><div class="ai-suggest"><button type="button" data-ai="how">How chat works</button></div></div>`;
  log.innerHTML =
    (state.messages.length ? "" : welcome) +
    state.messages.map((m, i) => {
      if (m.role === "user")
        return `<div class="ai-msg user"><p>${e(m.text)}</p><button type="button" class="ai-copy-msg" data-ai="copy-msg" data-i="${i}" aria-label="Copy your message">Copy</button></div>`;
      return `<div class="ai-msg assistant ${m.error ? "error" : ""}"><div class="ai-rich" data-ai-rich="${i}"></div><button type="button" class="ai-copy-msg" data-ai="copy-msg" data-i="${i}" aria-label="Copy assistant message">Copy</button></div>`;
    }).join("") +
    (thinking
      ? `<div class="ai-msg assistant" role="status"><p class="ai-typing" aria-label="Mimo is thinking"><i></i><i></i><i></i></p></div>`
      : "");
  for (const node of log.querySelectorAll("[data-ai-rich]")) {
    const message = state.messages[Number(node.dataset.aiRich)];
    if (message) renderChatMarkdown(node, message.text);
  }
  if (typeof typeset === "function") void typesetChatMarkdown(log,typeset);
  log.scrollTop = log.scrollHeight;
}

async function onLogClick(event) {
  const copy = event.target.closest("[data-ai=copy-msg]");
  if (copy) {
    const index=Number(copy.dataset.i);
    const message=Number.isInteger(index)?state.messages[index]:null;
    if (!message) return;
    try {
      await navigator.clipboard.writeText(message.text);
      copy.textContent="Copied";
    } catch {
      toast("Copy unavailable. Select the message text to copy it.",{tone:"info"});
    }
    return;
  }
  if (event.target.closest("[data-ai=how]")) {
    state.messages.push({
      role:"assistant", confirmed:false,
      text:"This assistant uses Quizer Firebase Authentication and the existing teacher-only Mimo chat workflow. You can ask follow-up questions; only completed exchanges are used as history. The existing chat quota is 4 requests per minute and 250 per UTC day. Scissors can select visible text, but file and screenshot processing is a separate feature.",
    });
    save();
    render();
  }
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
    if (w != null) panel.style.setProperty("--ai-w", clamp(w, l.minW, l.maxW) + "px");
    if (h != null) panel.style.setProperty("--ai-h", clamp(h, l.minH, l.maxH) + "px");
  };
  const saveSize = () => {
    const r = panel.getBoundingClientRect();
    try {
      localStorage.setItem(SIZE_KEY, JSON.stringify({ w: Math.round(r.width), h: Math.round(r.height) }));
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
        apply(mode.includes("w") ? start.width + (x0 - m.clientX) : null, mode.includes("n") ? start.height + (y0 - m.clientY) : null);
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
        dir = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[ev.key];
      if (!dir || (mode === "w" && !dir[0]) || (mode === "n" && !dir[1])) return;
      ev.preventDefault();
      apply(dir[0] ? r.width + dir[0] : null, dir[1] ? r.height + dir[1] : null);
      saveSize();
    });
  });
  addEventListener("resize", () => {
    const r = panel.getBoundingClientRect();
    if (panel.style.getPropertyValue("--ai-w") || panel.style.getPropertyValue("--ai-h")) apply(r.width, r.height);
  });
}

const DOCK_KEY = "mathquiz.assistantDock";
// Move the whole floating toolbar by its handle, not by accidentally
// dragging an action button. There are no API calls in this interaction.
function initDockDrag(dock) {
  const handle = dock.querySelector(".ai-dock-handle");
  let dragging = null;
  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
  function place(x, y) {
    const rect = dock.getBoundingClientRect();
    x = clamp(x, 4, Math.max(4, innerWidth - rect.width - 4));
    y = clamp(y, 4, Math.max(4, innerHeight - rect.height - 4));
    Object.assign(dock.style, {
      left: x + "px", top: y + "px", right: "auto", bottom: "auto",
    });
    return { x, y };
  }
  function persist() {
    const rect = dock.getBoundingClientRect();
    try {
      localStorage.setItem(DOCK_KEY,
        JSON.stringify({ x: Math.round(rect.left), y: Math.round(rect.top) }));
    } catch {}
  }
  function reset() {
    for (const prop of ["left", "top", "right", "bottom"])
      dock.style.removeProperty(prop);
    try { localStorage.removeItem(DOCK_KEY); } catch {}
  }
  try {
    const saved = JSON.parse(localStorage.getItem(DOCK_KEY) || "null");
    if (Number.isFinite(saved?.x) && Number.isFinite(saved?.y))
      place(saved.x, saved.y);
  } catch {}
  const down = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const rect = dock.getBoundingClientRect();
    dragging = { id: event.pointerId, dx: event.clientX - rect.left,
      dy: event.clientY - rect.top };
    handle.setPointerCapture?.(event.pointerId);
  };
  const move = (event) => {
    if (!dragging || event.pointerId !== dragging.id) return;
    place(event.clientX - dragging.dx, event.clientY - dragging.dy);
  };
  const up = (event) => {
    if (!dragging || event.pointerId !== dragging.id) return;
    dragging = null;
    persist();
  };
  const keys = (event) => {
    const movements = {
      ArrowUp: [0, -1], ArrowDown: [0, 1],
      ArrowLeft: [-1, 0], ArrowRight: [1, 0],
    };
    const direction = movements[event.key];
    if (!direction) return;
    event.preventDefault();
    const rect = dock.getBoundingClientRect();
    const step = event.shiftKey ? 60 : 20;
    place(rect.left + direction[0] * step, rect.top + direction[1] * step);
    persist();
  };
  const fit = () => {
    if (!dock.style.left) return;
    const rect = dock.getBoundingClientRect();
    place(rect.left, rect.top);
  };
  handle.addEventListener("pointerdown", down);
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", up);
  handle.addEventListener("pointercancel", up);
  handle.addEventListener("keydown", keys);
  handle.addEventListener("dblclick", reset);
  window.addEventListener("resize", fit);
  return () => {
    window.removeEventListener("resize", fit);
    handle.removeEventListener("pointerdown", down);
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", up);
    handle.removeEventListener("pointercancel", up);
    handle.removeEventListener("keydown", keys);
    handle.removeEventListener("dblclick", reset);
  };
}
