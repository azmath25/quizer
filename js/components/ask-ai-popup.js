import { askAssistant, AI_CONNECTED } from "../services/ai.js";

// A dedicated, in-page popup. It never navigates into the teacher/admin Studio.
// Context must already be authorized and visible on the calling page.
let active = null;
const STYLE_ID = "quizer-ask-ai-popup-style";

function installStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
  .qa-overlay{position:fixed;inset:0;z-index:1100;background:rgba(8,25,40,.45);display:flex;align-items:center;justify-content:center;padding:16px}
  .qa-window{width:min(570px,100%);max-height:min(740px,calc(100dvh - 32px));display:flex;flex-direction:column;overflow:hidden;background:var(--surface,#fff);color:var(--ink,#1b3246);border:1px solid var(--line,#ddd);border-radius:17px;box-shadow:0 20px 70px rgba(0,0,0,.2)}
  .qa-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border-bottom:1px solid var(--line,#ddd)}
  .qa-head strong{font-size:15px}.qa-close{border:0;background:transparent;color:inherit;font-size:23px;line-height:1;padding:5px;cursor:pointer}
  .qa-log{flex:1;min-height:130px;overflow:auto;display:flex;flex-direction:column;gap:11px;padding:16px;white-space:pre-wrap;overflow-wrap:anywhere}
  .qa-entry{padding:11px 13px;border-radius:12px;line-height:1.5;font-size:13px;background:var(--soft,#f1f5f9)}
  .qa-entry.user{margin-left:12%;background:var(--wash,#e8f6fb)}.qa-entry.system{font-size:12px;color:var(--muted,#667)}
  .qa-context{font-size:12px;color:var(--muted,#667);padding:8px 16px;border-bottom:1px solid var(--line,#ddd)}
  .qa-form{border-top:1px solid var(--line,#ddd);padding:12px 16px;display:flex;gap:8px;align-items:end}
  .qa-form textarea{resize:vertical;min-height:44px;max-height:145px;flex:1;width:100%;border:1px solid var(--line,#ddd);border-radius:10px;padding:10px;background:var(--surface,#fff);color:inherit;font:inherit}
  .qa-form button{padding:12px;border-radius:10px;border:0;background:var(--accent,#0281af);color:#fff;font-weight:700;cursor:pointer}
  @media(max-width:600px){.qa-overlay{align-items:flex-end;padding:0}.qa-window{max-height:calc(100dvh - env(safe-area-inset-top,0px) - 12px);height:min(85dvh,740px);border-radius:18px 18px 0 0}.qa-form{padding-bottom:max(12px,env(safe-area-inset-bottom))}}
  `;
  document.head.append(style);
}

export function openAskAIPopup({ title = "Ask AI", context = "" } = {}) {
  installStyle();
  active?.close();
  const overlay = document.createElement("div");
  overlay.className = "qa-overlay";
  const panel = document.createElement("section");
  panel.className = "qa-window";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", String(title));
  const head = document.createElement("header");
  head.className = "qa-head";
  const name = document.createElement("strong");
  name.textContent = title;
  const closeButton = document.createElement("button");
  closeButton.className = "qa-close";
  closeButton.type = "button";
  closeButton.textContent = "×";
  closeButton.setAttribute("aria-label", "Close AI chat");
  head.append(name, closeButton);
  const hint = document.createElement("div");
  hint.className = "qa-context";
  hint.textContent = AI_CONNECTED
    ? "Ask questions about the selected result."
    : "AI preview — live answers are not connected yet.";
  const log = document.createElement("div");
  log.className = "qa-log";
  log.setAttribute("aria-live", "polite");
  const form = document.createElement("form");
  form.className = "qa-form";
  const input = document.createElement("textarea");
  input.setAttribute("aria-label", "Ask AI a question");
  input.placeholder = "Explain this problem, my answer, or how to improve…";
  input.maxLength = 3000;
  const send = document.createElement("button");
  send.type = "submit";
  send.textContent = "Send";
  form.append(input, send);
  panel.append(head, hint, log, form);
  overlay.append(panel);
  document.body.append(overlay);
  const previousFocus = document.activeElement;
  const append = (role, value) => {
    const row = document.createElement("div");
    row.className = "qa-entry " + role;
    row.textContent = value;
    log.append(row);
    log.scrollTop = log.scrollHeight;
  };
  append("system", "Context: " + String(title).slice(0, 140) +
    ". Only information visible on this page is shared when you send a message.");
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    overlay.remove();
    document.removeEventListener("keydown", onKeydown);
    previousFocus?.focus?.();
    if (active?.close === close) active = null;
  }
  function onKeydown(event) {
    if (event.key === "Escape") { event.preventDefault(); close(); }
    if (event.key === "Tab") {
      const controls = [closeButton, input, send];
      const index = controls.indexOf(document.activeElement);
      if (event.shiftKey && index === 0) { event.preventDefault(); send.focus(); }
      else if (!event.shiftKey && index === controls.length - 1) {
        event.preventDefault(); closeButton.focus();
      }
    }
  }
  active = { close };
  closeButton.onclick = close;
  overlay.addEventListener("click", (event) => { if (event.target === overlay) close(); });
  document.addEventListener("keydown", onKeydown);
  input.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault(); form.requestSubmit();
    }
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const question = input.value.trim();
    if (!question || closed) return;
    append("user", question);
    input.value = "";
    send.disabled = true;
    try {
      const reply = await askAssistant({
        prompt: "Use only the authorized page context below. Do not assume hidden answers or grading keys.\n\n" +
          String(context).slice(0, 8000) + "\n\nQuestion: " + question,
      });
      if (!closed) append("assistant", String(reply.reply || "No reply available."));
    } catch (error) {
      if (!closed) append("system", error?.message || "AI request failed.");
    } finally {
      if (!closed) { send.disabled = false; input.focus(); }
    }
  });
  input.focus();
  return { close };
}
