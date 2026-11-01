import {
  e,
  icon,
  date,
  empty,
  toast,
  confirmDialog,
  dialog,
  badge,
} from "../components/ui.js";
import { snip } from "../components/snip.js";
import { onLeave, go } from "../core/router.js";
import { askAssistant } from "../services/ai.js";
import * as chats from "../services/chats.js";

const OPEN_KEY = "mathquiz.aiSidebar";
const statusTone = {
  queued: "",
  running: "blue",
  succeeded: "green",
  failed: "red",
};
const statusText = {
  queued: "Queued",
  running: "Running",
  succeeded: "Done",
  failed: "Failed",
};

export async function mount(root) {
  const params = new URLSearchParams(location.search);
  let chatList = [],
    jobs = [],
    current = null,
    jobId = params.get("job"),
    chatId = params.get("chat"),
    busy = false,
    timer = null;
  const collapsed = () => localStorage.getItem(OPEN_KEY) === "0";

  root.innerHTML = `<section class="ai-page ${collapsed() ? "is-collapsed" : ""}">
    <aside class="ai-side" aria-label="Chats">
      <div class="ai-side-head"><button type="button" class="button primary small" data-new>${icon("plus")}<span>New chat</span></button>
      <button type="button" class="icon-button" data-toggle aria-label="Collapse chat list" aria-expanded="true">${icon("arrow")}</button></div>
      <nav class="ai-chats" data-chats></nav>
    </aside>
    <div class="ai-main" data-main></div>
  </section>`;
  const page = root.querySelector(".ai-page"),
    main = root.querySelector("[data-main]"),
    listNode = root.querySelector("[data-chats]"),
    toggle = root.querySelector("[data-toggle]");

  const syncToggle = () => {
    const c = page.classList.contains("is-collapsed");
    toggle.setAttribute("aria-expanded", String(!c));
    toggle.setAttribute(
      "aria-label",
      c ? "Show chat list" : "Collapse chat list",
    );
  };
  syncToggle();
  toggle.onclick = () => {
    page.classList.toggle("is-collapsed");
    localStorage.setItem(
      OPEN_KEY,
      page.classList.contains("is-collapsed") ? "0" : "1",
    );
    syncToggle();
  };

  const url = () => {
    const q = chatId ? `?chat=${chatId}` : jobId ? `?job=${jobId}` : "";
    history.replaceState(null, "", "ai.html" + q);
  };
  const renderList = () => {
    listNode.innerHTML = chatList.length
      ? chatList
          .map(
            (c) =>
              `<div class="ai-chat-row ${c.id === chatId ? "is-active" : ""}"><button type="button" class="ai-chat-open" data-open="${e(c.id)}" title="${e(c.title)}"><strong>${e(c.title)}</strong><small>${e(date(c.updatedAt))}</small></button><button type="button" class="icon-button" data-del="${e(c.id)}" aria-label="Delete chat ${e(c.title)}">${icon("trash")}</button></div>`,
          )
          .join("")
      : `<p class="muted small ai-side-empty">No chats yet.</p>`;
  };
  async function refreshList() {
    chatList = (await chats.listChats()).items;
    renderList();
  }

  async function create() {
    try {
      chatId = await chats.newChat();
      jobId = null;
      await refreshList();
      await openChat(chatId);
    } catch (error) {
      toast(error.message || "Could not create the chat.", { tone: "error" });
    }
  }
  async function closeView() {
    chatId = jobId = current = null;
    url();
    renderList();
    await showHome();
  }

  async function openChat(id) {
    chatId = id;
    jobId = null;
    url();
    renderList();
    main.innerHTML = `<p class="muted ai-pad">Loading…</p>`;
    try {
      current = await chats.getChat(id);
    } catch (error) {
      chatId = null;
      url();
      return showHome(error.message);
    }
    drawChat();
  }

  function msgHtml(m) {
    const files = m.files?.length
      ? `<div class="ai-files">${m.files.map((f) => `<span class="ai-chip">${e(f)}</span>`).join("")}</div>`
      : "";
    const job = m.jobId
      ? `<p><button type="button" class="button secondary small" data-job="${e(m.jobId)}">View extraction status</button></p>`
      : "";
    return `<div class="ai-msg ${m.role === "user" ? "user" : "assistant"}"><p>${e(m.text).replace(/\n/g, "<br>")}</p>${files}${job}</div>`;
  }
  function drawChat(thinking = false) {
    main.innerHTML = `<header class="ai-chat-head"><h2>${e(current.chat.title)}</h2>
      <button type="button" class="icon-button" data-close aria-label="Close chat">${icon("close")}</button></header>
      <div class="ai-log" data-log>${current.messages.length ? current.messages.map(msgHtml).join("") : `<p class="muted">Ask a question, snip a problem, or attach a PDF or image to extract problems.</p>`}${thinking ? `<div class="ai-msg assistant"><p class="ai-typing" aria-label="Thinking"><i></i><i></i><i></i></p></div>` : ""}</div>
      <form class="ai-composer" data-form><div class="ai-row">
        <label class="ai-attach" title="Attach PDF or image" aria-label="Attach PDF or image">${icon("upload")}<input type="file" accept="application/pdf,image/*" data-file hidden></label>
        <button type="button" class="ai-attach" data-snip title="Snip the screen and ask" aria-label="Snip the screen and ask">${icon("search")}</button>
        <textarea rows="1" name="q" placeholder="Ask a question…" aria-label="Message"></textarea>
        <button class="button primary" type="submit">Send</button></div></form>`;
    const log = main.querySelector("[data-log]");
    log.scrollTop = log.scrollHeight;
  }

  async function post(messages) {
    const saved = await chats.addMessages(chatId, messages);
    current.messages.push(...messages);
    current.chat.title = saved.title;
    const row = chatList.find((c) => c.id === chatId);
    if (row) row.title = saved.title;
    renderList();
  }
  async function send(text, files = []) {
    if (busy || (!text && !files.length)) return;
    busy = true;
    try {
      await post([{ role: "user", text, files: files.map((f) => f.name) }]);
      drawChat(true);
      const reply = await askAssistant({ prompt: text, files });
      await post([{ role: "assistant", text: reply.reply }]);
    } catch (error) {
      toast(error.message || "Something went wrong.", { tone: "error" });
    }
    busy = false;
    drawChat();
  }
  async function attach(file) {
    if (!file) return;
    if (file.type === "application/pdf" || file.type.startsWith("image/")) {
      const mine = chatId;
      try {
        toast(`Uploading ${file.name}…`, { timeout: 2500 });
        const { jobId: id } = await chats.queueExtraction(file, {
          chatId: mine,
        });
        await post([
          { role: "user", text: "", files: [file.name] },
          {
            role: "assistant",
            text: "Queued for extraction. You will be notified when it is ready.",
            jobId: id,
          },
        ]);
        drawChat();
        toast("Extraction queued.", {
          label: "View",
          onAction: () => openJob(id),
        });
        poll();
      } catch (error) {
        toast(error.message || "Upload failed.", { tone: "error" });
      }
    } else toast("Attach a PDF or an image.", { tone: "error" });
  }

  function jobRow(j) {
    return `<button type="button" class="ai-job" data-job="${e(j.jobId)}"><span><strong>${e(j.name)}</strong><small>${e(date(j.createdAt))}${j.stage && j.status === "running" ? " · " + e(j.stage) : ""}</small></span>${badge(statusText[j.status] || j.status, statusTone[j.status])}</button>`;
  }
  async function showHome(note = "") {
    main.innerHTML = `<div class="ai-home">
      ${note ? `<p class="notice">${e(note)}</p>` : ""}
      ${empty("Start a conversation", "Chats are saved so you can come back to them.", `<button type="button" class="button primary" data-new>${icon("plus")}<span>New chat</span></button>`)}
      <section class="panel ai-jobs" aria-labelledby="jobs-h"><div class="ai-jobs-head"><h2 id="jobs-h">Queued and running jobs</h2><button type="button" class="icon-button" data-refresh aria-label="Refresh jobs">${icon("refresh")}</button></div><div data-jobs><p class="muted">Loading…</p></div></section></div>`;
    await loadJobs();
  }
  async function loadJobs() {
    try {
      jobs = (await chats.listJobs()).items;
    } catch {
      jobs = [];
    }
    const node = main.querySelector("[data-jobs]");
    if (!node) return;
    const live = jobs.filter((j) => ["queued", "running"].includes(j.status)),
      past = jobs.filter((j) => !live.includes(j));
    node.innerHTML = jobs.length
      ? (live.length
          ? `<h3 class="small muted">In progress</h3>${live.map(jobRow).join("")}`
          : "") +
        (past.length
          ? `<h3 class="small muted">Recent</h3>${past.map(jobRow).join("")}`
          : "")
      : `<p class="muted">No jobs yet. Attach a PDF or image in a chat to extract problems.</p>`;
  }

  async function openJob(id) {
    jobId = id;
    chatId = null;
    url();
    renderList();
    main.innerHTML = `<p class="muted ai-pad">Loading…</p>`;
    let j;
    try {
      j = await chats.getResult(id);
    } catch (error) {
      jobId = null;
      url();
      return showHome(error.message);
    }
    if (jobId !== id) return;
    seen = j.status;
    const body =
      j.status === "succeeded"
        ? `<p>${j.result.problemCount} problem${j.result.problemCount === 1 ? "" : "s"} found in “${e(j.result.title)}”. Review them before saving.</p><div class="ai-job-actions"><button class="button primary" data-import="bank">Review in Bulk problem upload</button><button class="button secondary" data-import="quiz">Review in Quiz upload</button></div>`
        : j.status === "failed"
          ? `<p class="notice error">${e(j.error?.message || "The extraction failed.")}</p>`
          : `<p>${j.status === "queued" ? "Waiting in the queue." : "Working: " + e(j.stage || "processing")}…</p><p class="muted small">You can leave this page. We will notify you when it is done.</p>`;
    main.innerHTML = `<header class="ai-chat-head"><h2>${e(j.name)} ${badge(statusText[j.status] || j.status, statusTone[j.status])}</h2><button type="button" class="icon-button" data-close aria-label="Close">${icon("close")}</button></header><div class="ai-pad">${body}${j.chatId ? `<p><button type="button" class="button ghost small" data-chat="${e(j.chatId)}">Open the chat</button></p>` : ""}</div>`;
    main.dataset.result = JSON.stringify(
      j.result ? { title: j.result.title, latex: j.result.latex } : null,
    );
    if (["queued", "running"].includes(j.status)) poll();
  }

  let seen = "";
  function poll() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (document.hidden) return poll();
      try {
        if (jobId) {
          const j = await chats.getResult(jobId);
          if (j.status !== seen && jobId) await openJob(jobId);
          else if (["queued", "running"].includes(j.status)) poll();
        } else if (!chatId) {
          await loadJobs();
          if (jobs.some((j) => ["queued", "running"].includes(j.status)))
            poll();
        }
      } catch {}
    }, 4000);
  }
  onLeave(() => clearTimeout(timer));

  root.addEventListener("click", async (ev) => {
    const t = ev.target.closest("button");
    if (!t) return;
    if (t.matches("[data-new]")) return create();
    if (t.matches("[data-close]")) return closeView();
    if (t.matches("[data-refresh]")) return loadJobs();
    if (t.dataset.open) return openChat(t.dataset.open);
    if (t.dataset.chat) return openChat(t.dataset.chat);
    if (t.dataset.job) return openJob(t.dataset.job);
    if (t.matches("[data-snip]")) {
      const file = await snip();
      if (file) {
        if (!(await confirmShot(file))) return;
        await send(
          main.querySelector("textarea")?.value.trim() ||
            "What is this problem asking, and how do I solve it?",
          [file],
        );
      }
      return;
    }
    if (t.dataset.import) {
      const result = JSON.parse(main.dataset.result || "null");
      if (result) go(chats.importResult(result, t.dataset.import === "bank"));
      return;
    }
    if (t.dataset.del) {
      const id = t.dataset.del;
      if (
        !(await confirmDialog(
          "Delete this chat?",
          "The chat and its messages will be permanently deleted.",
          "Delete",
        ))
      )
        return;
      try {
        await chats.deleteChat(id);
        chatList = chatList.filter((c) => c.id !== id);
        if (id === chatId) await closeView();
        else renderList();
        toast("Chat deleted.");
      } catch (error) {
        toast(error.message || "Could not delete.", { tone: "error" });
      }
    }
  });
  root.addEventListener("submit", (ev) => {
    if (!ev.target.matches("[data-form]")) return;
    ev.preventDefault();
    const q = ev.target.q;
    const text = q.value.trim();
    q.value = "";
    send(text);
  });
  root.addEventListener("keydown", (ev) => {
    if (ev.target.matches("textarea") && ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      ev.target.form.requestSubmit();
    }
  });
  root.addEventListener("change", (ev) => {
    if (!ev.target.matches("[data-file]")) return;
    const file = ev.target.files[0];
    ev.target.value = "";
    attach(file);
  });

  await refreshList().catch((error) =>
    toast(error.message || "Could not load chats.", { tone: "error" }),
  );
  if (chatId) await openChat(chatId);
  else if (jobId) await openJob(jobId);
  else {
    await showHome();
    poll();
  }
}

// Shows the snip so the teacher can confirm before it is sent.
async function confirmShot(file) {
  const src = URL.createObjectURL(file);
  const result = await dialog({
    title: "Ask about this snip?",
    body: `<img class="ai-shot" src="${src}" alt="Your snip">`,
    confirm: "Send",
  });
  URL.revokeObjectURL(src);
  return !!result;
}
