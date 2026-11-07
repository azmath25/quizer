import { getSession } from "../firebase-client.js";
import { canUseMimoTeacherChat, mimoChatErrorMessage, sendTeacherChatMessage } from "../services/mimo-chat.js";
import { renderChatMarkdown, typesetChatMarkdown } from "./ai-chat-markdown.js";
import { typeset } from "./math-content.js";

// One in-page assistant at a time. The browser talks only to the Firebase callable.
let active = null;
const STYLE_ID = "quizer-ask-ai-popup-style";

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const css = document.createElement("link");
  css.id = STYLE_ID;
  css.rel = "stylesheet";
  css.href = "assets/css/ask-ai-popup.css?v=1";
  document.head.append(css);
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function openAskAIPopup({ title = "Ask AI", context = "" } = {}) {
  active?.close();
  installStyles();
  const priorFocus = document.activeElement;
  const allowed = canUseMimoTeacherChat(getSession());
  const pageContext = String(context || "").slice(0, 4000);
  let history = [];
  let threadId = null;
  let pending = false;
  let closed = false;

  const overlay = element("div", "qa-overlay");
  const panel = element("section", "qa-window");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", "qa-popup-heading");
  panel.setAttribute("aria-describedby", "qa-popup-note");

  const head = element("header", "qa-head");
  const heading = element("div", "qa-heading");
  const name = element("strong", "qa-title", String(title).slice(0, 160));
  name.id = "qa-popup-heading";
  heading.append(name, element("span", "qa-subtitle",
    allowed ? "Mimo · Teacher assistant" : "Teacher assistant"));
  const headActions = element("div", "qa-actions");
  const newChat = element("button", "qa-action", "New Chat");
  newChat.type = "button";
  newChat.setAttribute("aria-label", "Start a new chat");
  const closeButton = element("button", "qa-action qa-close", "×");
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "Close AI chat");
  const openStudio = element("a", "qa-action", "AI Studio");
  openStudio.href = "ai.html";
  openStudio.setAttribute("aria-label", "Open saved conversations in AI Studio");
  headActions.append(newChat, openStudio, closeButton);
  head.append(heading, headActions);

  const note = element("p", "qa-note",
    allowed
      ? "Only the selected, visible page context is included. Do not share confidential grading keys."
      : "Live Mimo chat requires a signed-in, verified teacher or administrator.");
  note.id = "qa-popup-note";
  const log = element("div", "qa-log");
  log.setAttribute("role", "log");
  log.setAttribute("aria-label", "AI conversation");
  log.setAttribute("aria-live", "polite");
  log.setAttribute("aria-relevant", "additions text");

  const form = element("form", "qa-form");
  const compose = element("div", "qa-compose");
  const input = element("textarea", "qa-input");
  input.setAttribute("aria-label", "Chat message");
  input.placeholder = "Explain this problem or suggest a way to solve it…";
  input.maxLength = 3000;
  input.rows = 2;
  const send = element("button", "qa-send", "Send");
  send.type = "submit";
  send.disabled = !allowed;
  input.disabled = !allowed;
  newChat.disabled = !allowed;
  compose.append(input, send);
  const footer = element("div", "qa-footer");
  footer.append(element("span", "", "Enter to send · Shift+Enter for a new line"),
    element("span", "", "Teacher limit: 4/min · 250/day (UTC)"));
  form.append(compose, footer);

  panel.append(head, note, log, form);
  overlay.append(panel);
  document.body.append(overlay);

  const empty = () => {
    const welcome = element("div", "qa-empty");
    welcome.append(element("strong", "", allowed ? "How can I help?" : "Teacher access required"),
      element("span", "", allowed
        ? "Ask about the visible problem or quiz result. Follow-up questions stay in this chat until you start a new one."
        : "Sign in with a verified teacher or administrator account to use Mimo chat."));
    log.replaceChildren(welcome);
  };
  const scroll = () => { log.scrollTop = log.scrollHeight; };
  const addMessage = (role, text) => {
    if (log.querySelector(".qa-empty")) log.replaceChildren();
    const row = element("article", "qa-message " + role);
    const label = element("span", "qa-role", role === "user" ? "You" : "Mimo");
    const bubble = element("div", "qa-bubble");
    if (role === "assistant") {
      renderChatMarkdown(bubble, text);
      // Existing site MathJax is local and configured with restricted TeX packages.
      void typesetChatMarkdown(bubble,typeset);
    } else {
      bubble.textContent = text;
    }
    const copy = element("button", "qa-copy", "Copy message");
    copy.type = "button";
    copy.setAttribute("aria-label", "Copy " + (role === "user" ? "your" : "assistant") + " message");
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(String(text));
        copy.textContent = "Copied";
      } catch {
        copy.textContent = "Copy unavailable — select message text";
      }
    });
    row.append(label, bubble, copy);
    log.append(row);
    scroll();
    return row;
  };
  const addError = (message, requestId, uncertain = false) => {
    const node = element("div", "qa-error");
    node.setAttribute("role", "alert");
    node.append(element("strong", "", "Message not confirmed"),
      element("span", "", message));
    if (uncertain) node.append(element("div", "", "Request reference: " + requestId));
    log.append(node);
    scroll();
  };
  const focusables = () => [newChat, closeButton, input, send].filter(node => !node.disabled);

  function close() {
    if (closed) return;
    closed = true;
    overlay.remove();
    document.removeEventListener("keydown", onKeydown);
    priorFocus?.focus?.({preventScroll: true});
    if (active?.close === close) active = null;
  }
  function onKeydown(event) {
    if (closed) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Tab") {
      const controls = focusables();
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      } else if (!panel.contains(document.activeElement)) {
        event.preventDefault(); first.focus();
      }
    }
  }

  newChat.addEventListener("click", () => {
    if (pending || closed) return;
    history = [];
    threadId = null;
    openStudio.href = "ai.html";
    input.value = "";
    empty();
    input.focus();
  });
  closeButton.addEventListener("click", close);
  overlay.addEventListener("click", event => {
    if (event.target === overlay) close();
  });
  document.addEventListener("keydown", onKeydown);
  input.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing && !pending) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (pending || closed || !allowed) return;
    if (!canUseMimoTeacherChat(getSession())) {
      addError("Your teacher session changed. Sign in or refresh before continuing.", "");
      return;
    }
    const question = input.value.trim();
    if (!question) return;

    // Every intentional new submission gets a fresh request ID. Never retry automatically.
    const requestId = crypto.randomUUID();
    const submittedDraft = input.value;
    const row = addMessage("user", question);
    pending = true;
    send.disabled = true;
    newChat.disabled = true;
    input.value = ""; // submitted text is already shown in the conversation
    form.setAttribute("aria-busy", "true");
    const loading = element("div", "qa-pending", "Mimo is thinking");
    loading.setAttribute("role", "status");
    const dots = element("span", "qa-dots");
    dots.setAttribute("aria-hidden", "true");
    dots.append(element("i"), element("i"), element("i"));
    loading.append(dots);
    log.append(loading);
    scroll();

    try {
      const response = await sendTeacherChatMessage({
        message: question,
        context: pageContext,
        history: history.slice(-8),
        requestId,
        threadId,
      });
      if (closed) return;
      loading.remove();
      addMessage("assistant", response.reply);
      if (response.threadId) {
        threadId = response.threadId;
        openStudio.href = "ai.html?thread=" + encodeURIComponent(threadId);
      }
      if (!response.saved) addError("Reply received, but chat history could not be saved. Keep the answer.", requestId);
      history = [...history,
        {role: "user", content: question.slice(0, 1200)},
        {role: "assistant", content: response.reply.slice(0, 1200)}].slice(-8);
      // Preserve anything typed while waiting for Mimo.
    } catch (error) {
      if (closed) return;
      loading.remove();
      row.classList.add("failed");
      const reason = String(error?.details?.reason || "");
      const uncertain = reason === "MIMO_OUTCOME_UNKNOWN" ||
        ["deadline-exceeded", "unavailable", "unknown"].includes(
          String(error?.code || "").replace(/^functions\//, ""));
      addError(mimoChatErrorMessage(error), requestId, uncertain);
      if (!input.value) input.value = submittedDraft;
      // Never automatically retry a failed or uncertain request.
    } finally {
      pending = false;
      if (!closed) {
        input.readOnly = false;
        form.removeAttribute("aria-busy");
        send.disabled = false;
        newChat.disabled = false;
        input.focus();
      }
    }
  });

  empty();
  (allowed ? input : closeButton).focus();
  active = {close};
  return {close};
}
