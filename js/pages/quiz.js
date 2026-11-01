import { scrollBehavior } from "../core/device.js";
import { go, onLeave, onLeaveGuard } from "../core/router.js";
import { api } from "../services/api.js";
import {
  loadStars,
  isStarred,
  toggleStar,
  itemRef,
} from "../services/stars.js";
import { loadImages } from "../services/assets.js";
import {
  saveRecovery,
  loadRecovery,
  clearRecovery,
} from "../services/recovery.js";
import { getSession } from "../firebase-client.js";
import {
  pageHead,
  linkButton,
  loading,
  empty,
  e,
  badge,
  date,
  duration,
  points,
  notice,
  action,
  busy,
  message,
  dialog,
  confirmDialog,
  icon,
} from "../components/ui.js";
import { latexHTML, typeset, clearMath } from "../components/math-content.js";
import { loginURL } from "../core/navigation.js";
export async function mount(root, session) {
  const params = new URLSearchParams(location.search),
    attemptId = params.get("attempt"),
    quizId = params.get("id");
  if (attemptId) {
    if (!session.user) {
      go(loginURL(), { replace: true });
      return;
    }
    return runner(root, await api("getAttempt", { attemptId }), session);
  }
  if (!quizId) {
    root.innerHTML =
      pageHead("Choose a quiz") +
      empty(
        "No quiz selected",
        "Browse the available quizzes to get started.",
        linkButton("Browse quizzes", "quizzes.html"),
      );
    return;
  }
  const q = await api("getQuizOverview", { quizId });
  const labels = {
    AUTH_REQUIRED: "Sign in to start",
    EMAIL_UNVERIFIED: "Verify your email first",
    ACCOUNT_DISABLED: "Account disabled",
    ACCESS_PENDING: "Awaiting teacher approval",
    ACCESS_DECLINED: "Your request was declined",
    ACCESS_REVOKED: "Access has been revoked",
    QUIZ_NOT_OPEN: "This quiz has not opened yet",
    QUIZ_CLOSED: "This quiz has closed",
    ATTEMPT_LIMIT: "No attempts remaining",
    ROLE_REQUIRED: "Teacher approval required",
    RESOURCE_UNAVAILABLE: "This quiz is not available for new attempts",
  };
  root.innerHTML = `<div class="quiz-overview"><div class="page-heading">${linkButton("All quizzes", "quizzes.html", "ghost")}</div><section class="panel flush"><div class="overview-header">${badge(q.subject || "Mathematics", "blue")} ${badge(q.accessMode === "approval" ? "Teacher approval" : "Open access")}<h1>${e(q.title)}</h1><p>${e(q.description)}</p><p>By ${e(q.ownerDisplayName || "Teacher")}</p></div><div class="overview-body"><div class="quiz-facts"><div><strong>${q.questionCount ?? "—"}</strong><span>Problems</span></div><div><strong>${q.totalPoints === null ? "—" : points(q.totalPoints)}</strong><span>Points</span></div><div><strong>${duration(q.durationSeconds)}</strong><span>Time limit</span></div></div>${q.opensAt || q.closesAt ? `<p class="muted small">${q.opensAt ? "Opens " + date(q.opensAt) : ""}${q.closesAt ? " · Closes " + date(q.closesAt) : ""}</p>` : ""}<p class="muted small">${q.maxAttempts === null ? "Unlimited attempts" : `${q.maxAttempts + q.extraAttempts} attempts allowed · ${q.attemptCount} used`}</p>${q.reason ? notice(labels[q.reason] || "You cannot start this quiz right now.", q.reason === "ACCESS_PENDING" ? "info" : "warning") : ""}<div data-message></div><div class="actions">${q.activeAttemptId ? linkButton("Resume attempt", `quiz.html?attempt=${q.activeAttemptId}`, "primary", "arrow") : !session.user ? linkButton("Sign in", loginURL(), "primary") : q.canStart ? '<button class="button primary" id="start">Start quiz</button>' : q.canRequest ? '<button class="button primary" id="request-access">Request access</button>' : q.reason === "EMAIL_UNVERIFIED" ? linkButton("Open profile", "profile.html", "primary") : ""}${session.user ? linkButton("My attempts", "activity.html", "secondary") : ""}${q.canManage ? linkButton("Manage quiz", `quiz-manage.html?id=${quizId}`, "secondary") : ""}</div><hr><p class="muted small">Your answers are saved during the quiz. The quiz’s teacher can see saved responses, results and the times responses were changed. Written responses require teacher marking.</p></div></section></div>`;
  action(root, "#start", async () => {
    const confirm = await dialog({
      title: "Start this quiz?",
      body: `<p>${q.questionCount} problems · ${duration(q.durationSeconds)}. ${q.durationSeconds ? "The timer begins immediately and continues if you leave the page." : ""}</p><p class="muted small">The teacher can see your saved responses and change times.</p>`,
      confirm: "Start quiz",
    });
    if (!confirm) return;
    const attempt = await api("startAttempt", { quizId });
    history.replaceState(null, "", `quiz.html?attempt=${attempt.attemptId}`);
    await runner(root, attempt, session);
  });
  action(root, "#request-access", async () => {
    const values = await dialog({
      title: "Request quiz access",
      body: '<label class="field"><span>Message to the teacher (optional)</span><textarea name="message" maxlength="500" rows="3"></textarea></label>',
      confirm: "Send request",
    });
    if (!values) return;
    await api("requestQuizAccess", { quizId, message: values.get("message") });
    location.reload();
  });
}
async function runner(root, initial, session) {
  let a = initial;
  if (a.status !== "active") {
    go(`results.html?id=${a.attemptId}`, { replace: true });
    return;
  }
  const attemptId = a.attemptId,
    uid = session.user.uid,
    epoch = getSession().epoch;
  let viewSequence = 0,
    navigating = false;
  let index = a.settings.allowBack ? a.uiState.currentIndex : a.currentFrontier,
    answers = new Map(),
    pending = new Map(),
    saving = null,
    inflight = null,
    debounce,
    timer,
    stopped = false,
    conflict = false,
    lastSend = 0;
  const flagged = new Set(a.uiState.flaggedItemIds);
  let flagChain = Promise.resolve();
  let serverBase = Date.parse(a._serverTime),
    basePerf = performance.now(),
    lastWarning = 0;
  root.innerHTML = `<div class="runner-top"><div class="runner-title"><h1>${e(a.quizTitle)}</h1><p>Attempt ${a.ordinal}${a.attemptKind === "retry_incorrect" ? " · Retry incorrect problems" : ""}</p></div><div class="timer" id="timer" aria-label="Time remaining">${icon("clock")}<span>—</span></div></div><div class="progress-track"><span id="quiz-progress"></span></div><div class="sr-only" aria-live="polite" id="timer-announcement"></div><div data-message></div><div class="runner-layout"><div><section class="panel runner-question" id="question-panel">${loading()}</section><div class="runner-footer"><button class="button secondary" id="previous">Previous</button><span class="save-indicator" id="save-status" role="status">Restoring answers…</span><button class="button primary" id="next">Next problem ${icon("arrow")}</button></div><div class="actions" id="save-actions" hidden><button class="button secondary" id="retry-save">Retry saving</button><button class="button secondary" id="resolve-conflict" hidden>Review conflicting answer</button></div></div><aside class="panel runner-sidebar"><h2>Problems</h2><p id="answered-count"></p><div class="question-grid" id="question-grid"></div><p>Blue: answered · flag icon: flagged</p><p class="kbd-hint"><kbd>←</kbd> <kbd>→</kbd> move · <kbd>1</kbd>–<kbd>4</kbd> choose · <kbd>F</kbd> flag · <kbd>S</kbd> star</p><div class="flag-list" id="flag-list"></div><button class="button primary" id="submit">Submit quiz</button><button class="button ghost" id="abandon">Leave and end attempt</button></aside></div>`;
  const question = root.querySelector("#question-panel"),
    saveStatus = root.querySelector("#save-status");
  function saveLabel(text, failed = false) {
    saveStatus.textContent = text;
    saveStatus.classList.toggle("danger-text", failed);
    root.querySelector("#save-actions").hidden = !failed;
  }
  function clock() {
    serverBase = Date.parse(a._serverTime);
    basePerf = performance.now();
  }
  function remember() {
    if (pending.size)
      saveRecovery(uid, attemptId, {
        answerVersion: a.answerVersion,
        changes: [...pending].map(([itemId, p]) => ({ itemId, ...p })),
      });
    else clearRecovery(uid, attemptId);
  }
  function grid() {
    root.querySelector("#answered-count").textContent =
      `${a.answeredCount} of ${a.order.length} saved answers`;
    root.querySelector("#question-grid").innerHTML = a.order
      .map(
        (itemId, i) =>
          `<button type="button" data-index="${i}" class="${i === index ? "current " : ""}${answers.get(itemId)?.value?.trim() || a.answeredItemIds?.includes(itemId) ? "answered " : ""}${flagged.has(itemId) ? "flagged" : ""}" aria-label="Problem ${i + 1}${flagged.has(itemId) ? ", flagged" : ""}" ${!a.settings.allowBack && i !== a.currentFrontier ? "disabled" : ""}>${i + 1}</button>`,
      )
      .join("");
    const flagList = root.querySelector("#flag-list");
    flagList.hidden = !flagged.size;
    flagList.innerHTML = flagged.size
      ? `<strong>Flagged</strong>${a.order.map((id, i) => (flagged.has(id) ? `<button type="button" class="button ghost small" data-index="${i}">${icon("flag")}Problem ${i + 1}</button>` : "")).join("")}`
      : "";
    root
      .querySelectorAll("[data-index]")
      .forEach(
        (b) =>
          (b.onclick = () =>
            busy(b, () => navigate(Number(b.dataset.index)), root)),
      );
    root
      .querySelector("#quiz-progress")
      .style.setProperty(
        "--progress",
        `${((index + 1) / a.order.length) * 100}%`,
      );
    root.querySelector("#previous").disabled =
      !a.settings.allowBack || index === 0;
    root.querySelector("#next").textContent =
      index === a.order.length - 1 ? "Review & submit" : "Next problem";
  }
  const itemCache = new Map(),
    ready = new Set();
  function seedItem(item) {
    itemCache.set(item.itemId, Promise.resolve(item));
    ready.add(item.itemId);
  }
  function fetchItem(itemId) {
    if (!itemCache.has(itemId))
      itemCache.set(
        itemId,
        api("getAttemptQuestions", { attemptId, itemIds: [itemId] }).then(
          (r) => {
            ready.add(itemId);
            return r.items[0];
          },
          (err) => {
            itemCache.delete(itemId);
            throw err;
          },
        ),
      );
    return itemCache.get(itemId);
  }
  const imagesReady = new Set();
  const ctx = { kind: "attempt", id: attemptId };
  function fetchBatch(ids) {
    const batch = api("getAttemptQuestions", { attemptId, itemIds: ids });
    batch.catch(() => {});
    for (const id of ids) {
      const p = batch.then((r) => {
        const item = r.items.find((i) => i.itemId === id);
        if (!item) throw new Error("Problem not returned.");
        ready.add(id);
        return item;
      });
      p.catch(() => itemCache.delete(id));
      itemCache.set(id, p);
    }
  }
  // Fetch every other problem in a few batched calls, then download their images in the background.
  let warming = false;
  async function warmAll() {
    if (warming || !a.settings.allowBack) return;
    warming = true;
    const near = a.order
      .map((id, i) => [id, Math.abs(i - index)])
      .sort((x, y) => x[1] - y[1])
      .map(([id]) => id);
    const missing = near.filter((id) => !itemCache.has(id));
    for (let i = 0; i < missing.length; i += 20)
      fetchBatch(missing.slice(i, i + 20));
    const queue = [...near];
    const worker = async () => {
      while (queue.length && !stopped) {
        const id = queue.shift();
        try {
          const item = await fetchItem(id);
          if (
            Object.keys(item.questionAssetBindings).length &&
            !imagesReady.has(id)
          ) {
            await loadImages(item.questionAssetBindings, ctx);
            imagesReady.add(id);
          }
        } catch {}
      }
    };
    await Promise.all([worker(), worker()]);
  }
  async function showQuestion() {
    if (stopped) return;
    const view = ++viewSequence;
    const itemId = a.order[index];
    if (!ready.has(itemId)) question.innerHTML = loading("Loading problem…");
    const item = await fetchItem(itemId);
    if (getSession().epoch !== epoch) return;
    warmAll();
    if (!pending.has(itemId) && !answers.has(itemId))
      answers.set(itemId, item.answer);
    const current =
      pending.get(itemId)?.value ?? answers.get(itemId)?.value ?? "";
    if (
      view === viewSequence &&
      Object.keys(item.questionAssetBindings).length &&
      !imagesReady.has(itemId)
    )
      question.innerHTML = loading("Loading images…");
    const images = await loadImages(item.questionAssetBindings, ctx);
    imagesReady.add(itemId);
    const options = (a.optionOrder[itemId] ?? []).map((id) =>
      item.options.find((o) => o.id === id),
    );
    if (view !== viewSequence || stopped) return;
    clearMath(question);
    question.innerHTML = `<div class="question-meta"><strong>PROBLEM ${index + 1} OF ${a.order.length}</strong><div class="actions"><span>${points(item.points)} points</span><button class="button ghost small" id="star" type="button" aria-label="Star this problem" aria-pressed="${isStarred(itemRef(a.quizId, itemId))}">${starLabel(isStarred(itemRef(a.quizId, itemId)))}</button><button class="button ghost small" id="flag" type="button" aria-label="Flag this problem for review" aria-pressed="${flagged.has(itemId)}">${flagLabel(flagged.has(itemId))}</button></div></div><div class="math-content">${latexHTML(item.statementLatex, images)}</div>${item.type === "choice" ? `<fieldset class="choices"><legend class="sr-only">Choose one answer</legend>${options.map((o, i) => `<label class="choice"><input name="answer" type="radio" value="${e(o.id)}" ${current === o.id ? "checked" : ""}><span class="choice-letter">${String.fromCharCode(65 + i)}</span><div class="math-content">${latexHTML(o.textLatex, images)}</div></label>`).join("")}<button class="button ghost small" type="button" id="clear-answer">Clear selection</button></fieldset>` : `<div class="answer-area"><label class="field"><span>${item.answerMode === "manual" ? "Your written response" : "Your answer"}</span>${item.answerMode === "manual" ? `<textarea id="answer-text" maxlength="10000" rows="6" placeholder="Write your reasoning. LaTeX is supported.">${e(current)}</textarea>` : `<input id="answer-text" value="${e(current)}" maxlength="500" autocomplete="off" placeholder="Enter a number, expression or short answer">`}</label><div class="answer-preview math-content" id="answer-preview"></div><p class="muted small">${item.answerMode === "manual" ? "This response is marked by your teacher." : "Fractions and arithmetic expressions are accepted."}</p></div>`}`;
    function change(value) {
      const base = answers.get(itemId) ?? { revision: 0, value: "" };
      if (
        value === base.value &&
        !inflight?.payload.changes.some((c) => c.itemId === itemId)
      )
        pending.delete(itemId);
      else pending.set(itemId, { value, expectedRevision: base.revision });
      remember();
      saveLabel(pending.size ? "Unsaved changes…" : "All changes saved");
      grid();
      clearTimeout(debounce);
      debounce = setTimeout(
        () => flush().catch(() => {}),
        Math.max(800, 1000 - (Date.now() - lastSend)),
      );
    }
    question
      .querySelectorAll("[name=answer]")
      .forEach((n) => (n.onchange = () => change(n.value)));
    question.querySelector("#clear-answer")?.addEventListener("click", () => {
      question
        .querySelectorAll("[name=answer]")
        .forEach((n) => (n.checked = false));
      change("");
    });
    const input = question.querySelector("#answer-text");
    if (input) {
      const preview = () => {
        const node = question.querySelector("#answer-preview");
        clearMath(node);
        node.innerHTML = latexHTML(input.value);
        typeset(node);
      };
      input.oninput = () => {
        change(input.value);
        preview();
      };
      input.onblur = () => flush().catch(() => {});
      preview();
    }
    const flagBtn = question.querySelector("#flag");
    flagBtn.onclick = () => {
      const on = !flagged.has(itemId);
      on ? flagged.add(itemId) : flagged.delete(itemId);
      flagBtn.setAttribute("aria-pressed", String(on));
      flagBtn.innerHTML = flagLabel(on);
      grid();
      queueFlags();
    };
    const starBtn = question.querySelector("#star");
    starBtn.onclick = () =>
      toggleStar({
        kind: "quizItem",
        attemptId,
        quizId: a.quizId,
        itemId,
        title: `Problem ${index + 1} · ${a.quizTitle}`,
      }).catch((error) =>
        saveLabel(error.message || "Could not update star.", true),
      );
    await typeset(question);
    grid();
    if (!pending.size)
      saveLabel(
        a.lastSavedAt
          ? "Saved " + new Date(a.lastSavedAt).toLocaleTimeString()
          : "Ready",
      );
  }
  async function flush() {
    clearTimeout(debounce);
    if (stopped || getSession().epoch !== epoch) return;
    if (saving) {
      await saving;
      if (pending.size) return flush();
      return;
    }
    if (!pending.size && !inflight) return;
    if (conflict)
      throw new Error("Review the conflicting response before continuing.");
    saving = (async () => {
      if (!inflight)
        inflight = {
          requestId: crypto.randomUUID(),
          payload: {
            attemptId,
            expectedAnswerVersion: a.answerVersion,
            changes: [...pending]
              .slice(0, 20)
              .map(([itemId, change]) => ({ itemId, ...change })),
          },
        };
      saveLabel("Saving…");
      lastSend = Date.now();
      try {
        const result = await api(
          "saveAnswers",
          inflight.payload,
          inflight.requestId,
        );
        for (const confirmed of result.confirmed) {
          const sent = inflight.payload.changes.find(
            (c) => c.itemId === confirmed.itemId,
          );
          answers.set(confirmed.itemId, {
            value: sent.value,
            revision: confirmed.revision,
            updatedAt: confirmed.savedAt,
          });
          const next = pending.get(confirmed.itemId);
          if (next?.value === sent.value) pending.delete(confirmed.itemId);
          else if (next)
            pending.set(confirmed.itemId, {
              ...next,
              expectedRevision: confirmed.revision,
            });
        }
        a.answerVersion = result.answerVersion;
        a.answeredCount = result.answeredCount;
        a.answeredItemIds = result.answeredItemIds;
        a.lastSavedAt = result.savedAt;
        inflight = null;
        remember();
        saveLabel(pending.size ? "New changes waiting…" : "All changes saved");
        grid();
      } catch (error) {
        const reason = error.details?.reason ?? error.reason;
        if (reason === "VERSION_CONFLICT") {
          conflict = true;
          root.querySelector("#resolve-conflict").hidden = false;
          saveLabel(
            "Another tab changed your answers. Review the conflict.",
            true,
          );
        } else if (["ATTEMPT_EXPIRED", "ATTEMPT_FROZEN"].includes(reason)) {
          saveLabel("Time ended. Only confirmed answers will be marked.", true);
          await checkExpiry();
        } else saveLabel("Not saved. Check your connection and retry.", true);
        throw error;
      }
    })();
    try {
      await saving;
    } finally {
      saving = null;
    }
    if (pending.size) return flush();
  }
  const flagLabel = (on) =>
    icon("flag") + `<span class="btn-text">${on ? "Flagged" : "Flag"}</span>`;
  const starLabel = (on) =>
    icon("star") + `<span class="btn-text">${on ? "Starred" : "Star"}</span>`;
  function queueFlags() {
    flagChain = flagChain
      .catch(() => {})
      .then(() => api("saveAttemptUiState", { attemptId, flags: [...flagged] }))
      .then((state) => {
        a.uiState = { ...a.uiState, version: state.version };
      })
      .catch((error) =>
        saveLabel(error.message || "Could not save the flag. Try again.", true),
      );
  }
  document.addEventListener("stars-changed", syncStar);
  function syncStar() {
    const b = question.querySelector("#star");
    if (!b || !a.order[index]) return;
    const on = isStarred(itemRef(a.quizId, a.order[index]));
    b.setAttribute("aria-pressed", String(on));
    b.innerHTML = starLabel(on);
  }
  loadStars().catch(() => {});
  let syncChain = Promise.resolve();
  function syncNavigation(target) {
    const run = async () => {
      const [, state] = await Promise.all([
        flush(),
        api("navigateAttempt", { attemptId, targetIndex: target }),
      ]);
      a.currentFrontier = state.currentFrontier;
      a.uiState = { ...state.uiState, flaggedItemIds: [...flagged] };
      if (state.item) seedItem(state.item);
    };
    const result = syncChain.catch(() => {}).then(run);
    syncChain = result;
    return result;
  }
  async function navigate(target) {
    if (target === index || navigating) return;
    navigating = true;
    try {
      const sync = syncNavigation(target);
      if (ready.has(a.order[target])) {
        // Problem already loaded: show it now and let the server catch up.
        const previous = index;
        index = target;
        showQuestion().catch(() => {});
        sync.catch((error) => {
          if (index !== target) return;
          index = previous;
          showQuestion().catch(() => {});
          saveLabel(error.message || "Could not change problem.", true);
        });
      } else {
        await sync;
        index = target;
        await showQuestion();
      }
      question.scrollIntoView({ block: "start", behavior: scrollBehavior() });
    } finally {
      navigating = false;
    }
  }
  async function submit() {
    await flush();
    const remaining = a.order.length - a.answeredCount;
    const yes = await dialog({
      title: "Submit your quiz?",
      body: `<p>${a.answeredCount} answered · ${remaining} unanswered.</p><p>After submission, you cannot change your answers.</p>`,
      confirm: "Submit quiz",
    });
    if (!yes) return;
    const result = await api("submitAttempt", { attemptId });
    stopped = true;
    clearInterval(timer);
    clearRecovery(uid, attemptId);
    window.removeEventListener("beforeunload", unload);
    go(`results.html?id=${attemptId}`, { replace: true });
  }
  let checking = false;
  async function checkExpiry() {
    if (checking || stopped) return;
    checking = true;
    try {
      a = await api("getAttempt", { attemptId });
      clock();
      if (a.status !== "active") {
        stopped = true;
        clearInterval(timer);
        pending.clear();
        inflight = null;
        clearRecovery(uid, attemptId);
        window.removeEventListener("beforeunload", unload);
        go(`results.html?id=${attemptId}`, { replace: true });
      }
    } finally {
      checking = false;
    }
  }
  function tick() {
    if (stopped) return;
    const seconds = a.deadlineAt
      ? Math.max(
          0,
          Math.ceil(
            (Date.parse(a.deadlineAt) -
              (serverBase + performance.now() - basePerf)) /
              1000,
          ),
        )
      : null;
    const timerNode = root.querySelector("#timer");
    if (!timerNode) return;
    timerNode.querySelector("span").textContent =
      seconds === null
        ? "Untimed"
        : `${Math.floor(seconds / 60)
            .toString()
            .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
    timerNode.classList.toggle("urgent", seconds !== null && seconds <= 60);
    timerNode.classList.toggle(
      "warn",
      seconds !== null && seconds > 60 && seconds <= 300,
    );
    if (seconds !== null && seconds <= 60 && lastWarning !== 1) {
      root.querySelector("#timer-announcement").textContent =
        "Less than one minute remains.";
      lastWarning = 1;
    }
    if (seconds === 0)
      checkExpiry().catch(() =>
        saveLabel("Reconnecting to confirm the deadline…", true),
      );
  }
  const unload = (event) => {
    if (pending.size || inflight) {
      event.preventDefault();
      event.returnValue = "";
    }
  };
  const visibility = () => {
    if (document.hidden) flush().catch(() => {});
    else checkExpiry().catch(() => {});
  };
  const sessionCleared = () => {
    stopped = true;
    clearInterval(timer);
    clearTimeout(debounce);
    pending.clear();
  };
  window.addEventListener("beforeunload", unload);
  document.addEventListener("visibilitychange", visibility);
  document.addEventListener("session-cleared", sessionCleared, { once: true });
  onLeaveGuard(() => !stopped && (pending.size > 0 || !!inflight));
  const press = (sel) => {
    const b = root.querySelector(sel);
    if (b && !b.disabled) b.click();
  };
  const keys = (event) => {
    if (stopped || event.metaKey || event.ctrlKey || event.altKey) return;
    if (document.querySelector("dialog[open]")) return;
    if (event.target.closest?.("input:not([type=radio]), textarea, select"))
      return;
    const k = event.key.toLowerCase();
    if (k === "arrowright") press("#next");
    else if (k === "arrowleft") press("#previous");
    else if (k === "f") press("#flag");
    else if (k === "s") press("#star");
    else if (/^[1-9]$/.test(k)) {
      const radio = root.querySelectorAll("input[name=answer]")[Number(k) - 1];
      if (radio) radio.click();
    } else return;
    event.preventDefault();
  };
  document.addEventListener("keydown", keys);
  let touch;
  const swipeStart = (event) => {
    touch = event.target.closest("input, textarea, .math-content img")
      ? null
      : event.changedTouches[0];
  };
  const swipeEnd = (event) => {
    if (!touch || document.documentElement.dataset.input !== "touch") return;
    const dx = event.changedTouches[0].clientX - touch.clientX,
      dy = event.changedTouches[0].clientY - touch.clientY;
    touch = null;
    if (Math.abs(dx) > 90 && Math.abs(dx) > Math.abs(dy) * 2)
      press(dx < 0 ? "#next" : "#previous");
  };
  const panel = root.querySelector("#question-panel");
  panel.addEventListener("touchstart", swipeStart, { passive: true });
  panel.addEventListener("touchend", swipeEnd, { passive: true });
  onLeave(() => {
    document.removeEventListener("keydown", keys);
    stopped = true;
    clearInterval(timer);
    clearTimeout(debounce);
    window.removeEventListener("beforeunload", unload);
    document.removeEventListener("visibilitychange", visibility);
    document.removeEventListener("session-cleared", sessionCleared);
    document.removeEventListener("stars-changed", syncStar);
  });
  action(root, "#previous", () => navigate(index - 1));
  action(root, "#next", () =>
    index === a.order.length - 1 ? submit() : navigate(index + 1),
  );
  action(root, "#submit", submit);
  action(root, "#retry-save", flush);
  action(root, "#resolve-conflict", async () => {
    const fresh = await api("getAttempt", { attemptId });
    const changes = [...pending];
    const savedAnswers = new Map();
    for (let i = 0; i < changes.length; i += 20) {
      const reply = await api("getAttemptQuestions", {
        attemptId,
        itemIds: changes.slice(i, i + 20).map(([id]) => id),
      });
      reply.items.forEach((item) => savedAnswers.set(item.itemId, item.answer));
    }
    const result = await dialog({
      title: "Another tab saved a response",
      body:
        changes
          .map(
            ([id, mine]) =>
              `<h3>Problem ${a.order.indexOf(id) + 1}</h3><p class="muted small">Server response</p><pre>${e(savedAnswers.get(id)?.value || "(empty)")}</pre><p class="muted small">Your unsaved response</p><pre>${e(mine.value || "(empty)")}</pre>`,
          )
          .join("") +
        `<p>Keep my responses replaces these saved responses with your text. Cancel leaves both unchanged.</p>`,
      confirm: "Keep my responses",
    });
    if (!result) return;
    a = fresh;
    clock();
    for (const [id, mine] of changes) {
      const saved = savedAnswers.get(id);
      answers.set(id, saved);
      pending.set(id, { value: mine.value, expectedRevision: saved.revision });
    }
    inflight = null;
    conflict = false;
    root.querySelector("#resolve-conflict").hidden = true;
    remember();
    await flush();
  });
  action(root, "#abandon", async () => {
    if (
      !(await confirmDialog(
        "End this attempt?",
        "This uses an attempt. You can view saved responses, but cannot resume it.",
        "End attempt",
      ))
    )
      return;
    await flush();
    await api("abandonAttempt", { attemptId });
    stopped = true;
    clearInterval(timer);
    pending.clear();
    clearRecovery(uid, attemptId);
    window.removeEventListener("beforeunload", unload);
    go(`results.html?id=${attemptId}`, { replace: true });
  });
  const recovery = loadRecovery(uid, attemptId);
  if (recovery?.changes?.length) {
    const valid =
      recovery.answerVersion === a.answerVersion &&
      (!a.deadlineAt || Date.parse(a.deadlineAt) > Date.parse(a._serverTime));
    if (
      valid &&
      (await dialog({
        title: "Restore unsaved text?",
        body: "<p>This tab kept text that was not yet confirmed by the server. Restore it and try saving now?</p>",
        confirm: "Restore text",
      }))
    ) {
      pending = new Map(
        recovery.changes.map((c) => [
          c.itemId,
          { value: c.value, expectedRevision: c.expectedRevision },
        ]),
      );
    } else clearRecovery(uid, attemptId);
  }
  await showQuestion();
  timer = setInterval(tick, 1000);
  tick();
  if (pending.size) await flush().catch(() => {});
}
