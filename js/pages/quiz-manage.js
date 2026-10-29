import { api, waitForJob } from "../services/api.js";
import {
  pageHead,
  linkButton,
  empty,
  loading,
  e,
  badge,
  date,
  points,
  field,
  select,
  textarea,
  bindForm,
  action,
  busy,
  message,
  confirmDialog,
  dialog,
  pagination,
  timezone,
  icon,
} from "../components/ui.js";
import {
  attemptRows,
  attemptTable,
  activityRows,
} from "../components/reports.js";
const localTime = (value) => {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
export async function mount(root) {
  const quizId = new URLSearchParams(location.search).get("id");
  if (!quizId) throw new Error("A quiz ID is required.");
  let data = await api("getQuizDraft", { quizId }),
    quiz = data.quiz,
    draft = data.draft,
    tab = location.hash.slice(1) || "content";
  const shareURL = new URL(`quiz.html?id=${quizId}`, location.href).href;
  root.innerHTML =
    pageHead(
      quiz.title,
      `Manage quiz · ${quiz.visibility === "public" ? "Public" : "Private"} · ${quiz.accessMode === "open" ? "Open access" : "Teacher approval"}`,
      linkButton("View quiz", `quiz.html?id=${quizId}`, "secondary") +
        linkButton("Edit draft", `upload.html?id=${quizId}`, "primary"),
    ) +
    `<div class="tabs" role="tablist" aria-label="Quiz management">${["content", "access", "results", "history"].map((t) => `<button role="tab" data-tab="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join("")}</div><div data-message></div><div id="manage-panel"></div>`;
  const panel = root.querySelector("#manage-panel");
  async function refresh() {
    data = await api("getQuizDraft", { quizId });
    quiz = data.quiz;
    draft = data.draft;
  }
  async function progress(jobId) {
    message(root, "Processing…", "info");
    const result = await waitForJob(jobId, (j) =>
      message(
        root,
        `${j.progress.stage}: ${j.progress.processed} / ${j.progress.total}`,
        "info",
      ),
    );
    message(root, "Completed.", "success");
    await refresh();
    return result;
  }
  async function showContent() {
    panel.innerHTML = `<div class="workspace-grid"><div class="stack"><section class="panel"><div class="section-head"><h2>Content</h2>${badge(quiz.lifecycle === "trashed" ? "Trash" : quiz.publishedRevisionId ? "Published" : "Draft", quiz.publishedRevisionId ? "green" : "")}</div><p class="muted">${e(draft.description || "No description added.")}</p><div class="stat-grid"><div class="stat"><strong>${draft.itemOrder.length}</strong><span>Problems in draft</span></div><div class="stat"><strong>${points(data.items.reduce((s, i) => s + i.points, 0))}</strong><span>Total points</span></div><div class="stat"><strong>${draft.settings.durationSeconds ? Math.round(draft.settings.durationSeconds / 60) : "∞"}</strong><span>Minutes</span></div><div class="stat"><strong>${draft.version}</strong><span>Draft version</span></div></div><hr><p class="muted small">Students take the published version. Save and publish your draft when it is ready.</p><div class="actions">${linkButton("Edit problems and settings", `upload.html?id=${quizId}`, "secondary")}<button class="button primary" id="publish" ${quiz.lifecycle === "trashed" || quiz.publishingJobId ? "disabled" : ""}>Publish draft</button></div>${quiz.publishingJobId ? `<div class="notice">A publication or copy is processing.<div class="actions"><button class="button secondary" id="check-job">Check progress</button><button class="button secondary" id="retry-job">Retry failed job</button><button class="button ghost" id="cancel-job">Cancel failed job</button></div></div>` : ""}</section><section class="panel"><div class="section-head"><h2>Published revisions</h2></div><div id="revisions">${loading()}</div></section></div><aside class="stack"><section class="panel"><h2>Quiz link</h2><p class="muted small">The link stays the same after you edit or publish a revision.</p><p class="link-output">${e(shareURL)}</p><button class="button secondary" id="copy-link">Copy quiz link</button></section><section class="panel"><h2>Manage content</h2><div class="stack"><button class="button secondary" id="duplicate">Duplicate as a private quiz</button><button class="button secondary" id="backup" ${!quiz.publishedRevisionId ? "disabled" : ""}>Export published backup</button>${quiz.publishedRevisionId ? '<button class="button secondary" id="unpublish">Unpublish</button>' : ""}<button class="button ${quiz.lifecycle === "trashed" ? "primary" : "secondary"}" id="trash">${quiz.lifecycle === "trashed" ? "Restore as private" : "Move to Trash"}</button></div><div id="export-download"></div><p class="muted small">Trash keeps versions and student results. Restored quizzes require approval.</p></section></aside></div>`;
    action(panel, "#copy-link", async () => {
      await navigator.clipboard.writeText(shareURL);
      message(root, "Quiz link copied.", "success");
    });
    action(panel, "#publish", async () => {
      if (
        !(await dialog({
          title: "Publish this draft?",
          body: `<p>${draft.itemOrder.length} problems will be published as ${quiz.visibility}, ${quiz.accessMode === "approval" ? "with teacher approval" : "with open access"}. Existing attempts keep their current version.</p>`,
          confirm: "Publish",
        }))
      )
        return;
      const job = await api("publishQuiz", {
        quizId,
        expectedVersion: quiz.version,
        expectedDraftVersion: draft.version,
      });
      await progress(job.jobId);
      await showContent();
    });
    action(panel, "#check-job", async () => {
      await progress(quiz.publishingJobId);
      await showContent();
    });
    action(panel, "#retry-job", async () => {
      await api("retryJob", { jobId: quiz.publishingJobId });
      await progress(quiz.publishingJobId);
      await showContent();
    });
    action(panel, "#cancel-job", async () => {
      await api("cancelJob", { jobId: quiz.publishingJobId });
      await refresh();
      await showContent();
    });
    action(panel, "#duplicate", async () => {
      const job = await api("duplicateQuiz", {
        quizId,
        expectedVersion: quiz.version,
      });
      await progress(job.jobId);
      location.href = `upload.html?id=${job.quizId}`;
    });
    action(panel, "#unpublish", async () => {
      if (
        !(await confirmDialog(
          "Unpublish this quiz?",
          "New attempts will stop. Existing attempts and results are retained.",
          "Unpublish",
        ))
      )
        return;
      await api("unpublishQuiz", { quizId, expectedVersion: quiz.version });
      await refresh();
      await showContent();
    });
    action(panel, "#trash", async () => {
      const restore = quiz.lifecycle === "trashed";
      if (
        !restore &&
        !(await confirmDialog(
          "Move quiz to Trash?",
          "New attempts will stop. Student results and saved versions are retained.",
          "Move to Trash",
        ))
      )
        return;
      await api(restore ? "restoreQuiz" : "trashQuiz", {
        quizId,
        expectedVersion: quiz.version,
      });
      await refresh();
      await showContent();
    });
    action(panel, "#backup", async () => {
      const job = await api("exportQuizBackup", { quizId });
      await progress(job.jobId);
      const file = await api("getExportLink", { jobId: job.jobId });
      panel.querySelector("#export-download").innerHTML =
        `<a class="button primary" href="${e(file.url)}" download="${e(file.filename)}" rel="noreferrer">Download backup ZIP</a>`;
    });
    const revisions = await api("listQuizRevisions", { quizId, limit: 25 });
    panel.querySelector("#revisions").innerHTML = revisions.items.length
      ? revisions.items
          .map(
            (v) =>
              `<div class="list-row"><div class="row-main"><h3>Revision ${v.revisionNumber} ${badge(v.state, v.id === quiz.publishedRevisionId ? "green" : "")}</h3><p>${v.itemCount} problems · ${points(v.totalPoints)} points · ${date(v.createdAt)}</p></div>${v.id === quiz.publishedRevisionId ? badge("Live", "blue") : ""}</div>`,
          )
          .join("")
      : empty("No published versions yet");
  }
  async function showAccess() {
    panel.innerHTML = `<div class="workspace-grid"><div class="stack"><section class="panel"><div class="panel-title"><h2>Visibility and availability</h2></div><form id="policy-form" class="stack"><div class="form-grid">${select(
      "Visibility",
      "visibility",
      [
        ["private", "Private"],
        ["public", "Public"],
      ],
      quiz.visibility,
    )}${select(
      "Participation",
      "accessMode",
      [
        ["approval", "Teacher approval"],
        ["open", "Open to signed-in users"],
      ],
      quiz.accessMode,
    )}${field("Opens at", "opensAt", "datetime-local", localTime(quiz.opensAt))}${field("Closes at", "closesAt", "datetime-local", localTime(quiz.closesAt))}${field("Attempts per student", "maxAttempts", "number", quiz.maxAttempts ?? "", 'min="1" max="10000" placeholder="Blank = unlimited"')}</div><p class="muted small">Times use ${e(timezone())}. Private quizzes require approval. Changes apply to new attempts.</p><div data-message></div><div><button class="button primary">Save access settings</button></div></form></section><section class="panel"><div class="section-head"><h2>Participants and requests</h2></div><div class="toolbar">${select(
      "Status",
      "status",
      [
        ["pending", "Pending requests"],
        ["approved", "Approved"],
        ["declined", "Declined"],
        ["revoked", "Revoked"],
        ["", "All participants"],
      ],
      "pending",
    )}<button class="button secondary" id="bulk-approve">Approve selected</button><button class="button secondary" id="bulk-decline">Decline selected</button></div><div id="participants"></div></section></div><aside class="stack"><section class="panel"><h2>Request link</h2><p class="muted small">Share a private request link so students can apply. The link does not grant access.</p><button class="button primary" id="join-link">Create request link</button><div id="join-output"></div><div id="join-links"></div></section><section class="panel"><h2>Grant access directly</h2><p class="muted small">The student must already have an account.</p><form id="grant-form" class="stack">${field("Exact email address", "email", "email", "", "required")}<button class="button secondary">Find registered student</button><div data-message></div></form><div id="lookup-result"></div></section></aside></div>`;
    bindForm(panel.querySelector("#policy-form"), async (form) => {
      await api("setQuizAccessPolicy", {
        quizId,
        expectedVersion: quiz.version,
        visibility: form.get("visibility"),
        accessMode: form.get("accessMode"),
        opensAt: form.get("opensAt")
          ? new Date(form.get("opensAt")).toISOString()
          : null,
        closesAt: form.get("closesAt")
          ? new Date(form.get("closesAt")).toISOString()
          : null,
        maxAttempts: form.get("maxAttempts")
          ? Number(form.get("maxAttempts"))
          : null,
      });
      await refresh();
      message(
        panel.querySelector("#policy-form"),
        "Access settings saved.",
        "success",
      );
    });
    let participants = [],
      status = "pending";
    const list = panel.querySelector("#participants"),
      setPage = pagination(list, loadParticipants);
    async function loadParticipants(cursor) {
      const result = await api("listAccessRequests", {
        quizId,
        ...(status ? { status } : {}),
        limit: 25,
        ...(cursor ? { cursor } : {}),
      });
      if (!cursor) {
        participants = [];
        list.innerHTML = "";
      }
      participants.push(...result.items);
      list.insertAdjacentHTML(
        "beforeend",
        result.items
          .map(
            (p) =>
              `<div class="list-row"><input type="checkbox" data-pick="${e(p.uid)}" aria-label="Select ${e(p.displayName || p.uid)}"><div class="row-main"><h3>${e(p.displayName || p.uid)}</h3><p>${e(p.email)} · ${date(p.requestedAt || p.updatedAt)}</p>${p.requestMessage ? `<p class="access-message">${e(p.requestMessage)}</p>` : ""}${badge(p.accessStatus)} <small class="muted">${p.attemptCount} attempts · ${p.extraAttempts} extra</small></div><div class="actions">${p.accessStatus !== "approved" ? `<button class="button secondary small" data-decision="approve" data-uid="${e(p.uid)}">Approve</button>` : ""}${p.accessStatus === "pending" ? `<button class="button ghost small" data-decision="decline" data-uid="${e(p.uid)}">Decline</button>` : ""}${p.accessStatus === "approved" ? `<button class="button ghost small" data-decision="revoke" data-uid="${e(p.uid)}">Revoke</button><button class="button ghost small" data-extra="${e(p.uid)}">+ Attempt</button>` : ""}${["declined", "revoked"].includes(p.accessStatus) ? `<button class="button ghost small" data-decision="reopen" data-uid="${e(p.uid)}">Reopen</button>` : ""}</div></div>`,
          )
          .join(""),
      );
      if (!participants.length)
        list.innerHTML = empty("No participants in this view");
      setPage(result.nextCursor);
      list.querySelectorAll("[data-decision]").forEach(
        (b) =>
          (b.onclick = () =>
            busy(
              b,
              async () => {
                const p = participants.find((p) => p.uid === b.dataset.uid);
                const values = await dialog({
                  title: b.textContent + " access",
                  body: textarea(
                    "Reason (optional)",
                    "reason",
                    "",
                    'maxlength="500"',
                  ),
                  confirm: b.textContent,
                });
                if (!values) return;
                await api("decideQuizAccess", {
                  quizId,
                  targetUid: p.uid,
                  decision: b.dataset.decision,
                  expectedVersion: p.version,
                  reason: values.get("reason"),
                });
                await loadParticipants();
              },
              panel,
            )),
      );
      list.querySelectorAll("[data-extra]").forEach(
        (b) =>
          (b.onclick = () =>
            busy(
              b,
              async () => {
                const p = participants.find((p) => p.uid === b.dataset.extra),
                  values = await dialog({
                    title: "Grant extra attempts",
                    body:
                      field(
                        "Extra attempts",
                        "delta",
                        "number",
                        1,
                        'required min="1" max="100"',
                      ) +
                      textarea(
                        "Reason",
                        "reason",
                        "",
                        'required maxlength="500"',
                      ),
                    confirm: "Grant",
                  });
                if (!values) return;
                await api("addAttemptAllowance", {
                  quizId,
                  targetUid: p.uid,
                  delta: Number(values.get("delta")),
                  expectedVersion: p.version,
                  reason: values.get("reason"),
                });
                await loadParticipants();
              },
              panel,
            )),
      );
    }
    panel.querySelector("[name=status]").onchange = async (event) => {
      status = event.target.value;
      await loadParticipants();
    };
    for (const decision of ["approve", "decline"])
      action(panel, "#bulk-" + decision, async () => {
        const ids = [...list.querySelectorAll("[data-pick]:checked")].map(
          (n) => n.dataset.pick,
        );
        if (!ids.length) throw new Error("Select at least one participant.");
        const result = await api("bulkDecideQuizAccess", {
          quizId,
          decisions: ids.map((uid) => ({
            targetUid: uid,
            decision,
            expectedVersion: participants.find((p) => p.uid === uid).version,
            reason: "",
          })),
        });
        message(
          panel,
          `${result.results.filter((x) => x.ok).length} updated. ${result.results.filter((x) => !x.ok).length} could not be changed.`,
          result.results.some((x) => !x.ok) ? "warning" : "success",
        );
        await loadParticipants();
      });
    action(panel, "#join-link", async () => {
      const result = await api("createJoinLink", { quizId });
      const url = new URL(`access.html?token=${result.token}`, location.href)
        .href;
      panel.querySelector("#join-output").innerHTML =
        `<p class="link-output">${e(url)}</p><p class="muted small">Expires ${date(result.expiresAt)}</p><button class="button secondary" id="copy-join">Copy request link</button>`;
      action(panel, "#copy-join", async () => {
        await navigator.clipboard.writeText(url);
        message(root, "Request link copied.", "success");
      });
      await loadLinks();
    });
    async function loadLinks() {
      const links = await api("listJoinLinks", { quizId });
      panel.querySelector("#join-links").innerHTML = links.items
        .map(
          (l) =>
            `<div class="list-row"><div class="row-main"><p>Created ${date(l.createdAt)}</p><small>${l.revokedAt ? "Revoked" : "Expires " + date(l.expiresAt)}</small></div>${!l.revokedAt ? `<button class="button ghost small" data-revoke-link="${e(l.id)}">Revoke</button>` : ""}</div>`,
        )
        .join("");
      panel.querySelectorAll("[data-revoke-link]").forEach(
        (b) =>
          (b.onclick = () =>
            busy(
              b,
              async () => {
                await api("revokeJoinLink", {
                  quizId,
                  linkId: b.dataset.revokeLink,
                });
                await loadLinks();
              },
              panel,
            )),
      );
    }
    bindForm(panel.querySelector("#grant-form"), async (values) => {
      const { user } = await api("lookupParticipant", {
        quizId,
        exactEmail: values.get("email"),
      });
      const output = panel.querySelector("#lookup-result");
      output.innerHTML = user
        ? `<p>${e(user.displayName)} · ${e(user.email)}</p><button class="button primary" id="grant-access">Approve student</button>`
        : '<p class="muted small">No registered account with that email was found.</p>';
      action(output, "#grant-access", async () => {
        await api("grantQuizAccess", { quizId, targetUid: user.uid });
        output.innerHTML = '<p class="notice success">Access granted.</p>';
        await loadParticipants();
      });
    });
    await loadParticipants();
    await loadLinks();
  }
  async function showResults() {
    const revisions = await api("listQuizRevisions", { quizId, limit: 100 });
    const ready = revisions.items.filter((r) => r.state === "ready");
    panel.innerHTML = `<section class="panel"><div class="section-head"><h2>Results</h2><button class="button secondary" id="export-csv">Export CSV</button></div><form class="toolbar" id="result-filter">${select("Revision", "revisionId", [["", "All revisions"], ...ready.map((v) => [v.id, `Revision ${v.revisionNumber}`])], "")}<button class="button primary">Apply</button></form><div id="statistics" class="report-stats"></div><div id="export-download"></div><div id="attempts">${attemptTable()}</div></section>`;
    let revisionId = "",
      rows = [];
    const list = panel.querySelector("#attempts"),
      setPage = pagination(list, load);
    async function load(cursor) {
      const result = await api("listQuizAttempts", {
        quizId,
        ...(revisionId ? { revisionId } : {}),
        limit: 25,
        ...(cursor ? { cursor } : {}),
      });
      if (!cursor) {
        rows = [];
        list.innerHTML = attemptTable();
      }
      rows.push(...result.items);
      list
        .querySelector("tbody")
        .insertAdjacentHTML("beforeend", attemptRows(result.items));
      if (!rows.length)
        list.innerHTML = empty(
          "No submissions yet",
          "Students’ saved attempts will appear here.",
        );
      setPage(result.nextCursor);
    }
    async function stats() {
      const selected = revisionId || quiz.publishedRevisionId;
      if (!selected) {
        panel.querySelector("#statistics").innerHTML = "";
        return;
      }
      const s = await api("getQuizStatistics", {
        quizId,
        revisionId: selected,
      });
      panel.querySelector("#statistics").innerHTML = `<div class="stat-grid">${[
        [s.uniqueParticipants, "Students"],
        [s.completed, "Completed"],
        [s.pending, "Needs marking"],
        [
          s.averagePercentage === null
            ? "—"
            : points(s.averagePercentage) + "%",
          "Average final score",
        ],
      ]
        .map(
          ([n, label]) =>
            `<div class="stat"><strong>${n}</strong><span>${label}</span></div>`,
        )
        .join(
          "",
        )}</div><p class="muted small">${revisionId ? "Selected" : "Current published"} revision · ${s.finalCount} fully marked standard attempts in the average · ${date(s.asOf)}</p>`;
    }
    bindForm(panel.querySelector("#result-filter"), async (values) => {
      revisionId = values.get("revisionId");
      await load();
      await stats();
    });
    action(panel, "#export-csv", async () => {
      const job = await api("exportQuizResults", {
        quizId,
        ...(revisionId ? { revisionId } : {}),
      });
      await progress(job.jobId);
      const file = await api("getExportLink", { jobId: job.jobId });
      panel.querySelector("#export-download").innerHTML =
        `<p><a class="button primary" href="${e(file.url)}" download="${e(file.filename)}" rel="noreferrer">Download CSV</a></p>`;
    });
    await load();
    await stats();
  }
  async function showHistory() {
    panel.innerHTML =
      '<section class="panel"><h2>Quiz activity</h2><div class="history-feed"></div></section>';
    const list = panel.querySelector(".history-feed"),
      setPage = pagination(list, load);
    async function load(cursor) {
      const result = await api("getQuizHistory", {
        quizId,
        limit: 25,
        ...(cursor ? { cursor } : {}),
      });
      if (!cursor) list.innerHTML = "";
      list.insertAdjacentHTML("beforeend", activityRows(result.items));
      if (!result.items.length && !cursor)
        list.innerHTML = empty("No activity recorded");
      setPage(result.nextCursor);
    }
    await load();
  }
  async function show(value) {
    tab = ["content", "access", "results", "history"].includes(value)
      ? value
      : "content";
    root
      .querySelectorAll("[data-tab]")
      .forEach((b) =>
        b.setAttribute("aria-selected", String(b.dataset.tab === tab)),
      );
    panel.innerHTML = loading();
    await {
      content: showContent,
      access: showAccess,
      results: showResults,
      history: showHistory,
    }[tab]();
  }
  root
    .querySelectorAll("[data-tab]")
    .forEach(
      (b) => (b.onclick = () => busy(b, () => show(b.dataset.tab), root)),
    );
  await show(tab);
}
