import { api } from "../services/api.js";
import { mountStarred } from "../components/starred.js";
import {
  resendVerification,
  reloadAccount,
  logout,
  refreshSession
} from "../firebase-client.js";
import { applyAppearance } from "../components/shell.js";
import {
  pageHead,
  field,
  select,
  bindForm,
  action,
  badge,
  e,
  message,
  linkButton,
  points,
} from "../components/ui.js";
export async function mount(root, session) {
  let profile = session.profile;
  root.innerHTML =
    pageHead("Profile", "Account details and appearance.") +
    `<div class="workspace-grid"><div class="stack"><section class="panel"><div class="profile-summary"><span class="avatar">${e(profile.displayName.slice(0, 1).toUpperCase())}</span><div><h2>${e(profile.displayName)}</h2><p>${e(profile.email)}</p><div class="profile-tags">${badge(session.role, "blue")}${badge(profile.emailVerified ? "Email verified" : "Email not verified", profile.emailVerified ? "green" : "amber")}</div></div></div><div data-message></div><form id="profile-form" class="stack">${field("Display name", "displayName", "text", profile.displayName, 'required maxlength="100"')}<div><button class="button primary">Save name</button></div></form>${!profile.emailVerified ? `<hr><p class="muted small">Verify your email to start quizzes or use teaching tools.</p><div class="actions"><button class="button secondary" id="verify">Send verification email</button><button class="button ghost" id="reload-account">I’ve verified my email</button></div>` : ""}<hr><details><summary>Account ID</summary><p class="muted small">An administrator can use this ID to grant teacher access.</p><p class="uid-block">${e(profile.uid)}</p><button class="button secondary" id="copy-uid">Copy ID</button></details></section><section class="panel" id="starred"><div class="panel-title"><h2>Starred problems</h2></div><div id="profile-stars"></div></section><section class="panel"><div class="panel-title"><h2>Quick tour</h2></div><p class="muted small">A short walkthrough of where things are.</p><button type="button" class="button secondary" id="replay-tour">Replay the tour</button></section><section class="panel" id="appearance"><div class="panel-title"><h2>Appearance</h2></div><form id="appearance-form" class="stack"><div class="form-grid">${select(
      "Theme",
      "theme",
      [
        ["light", "Light"],
        ["dark", "Dark"],
        ["system", "Use device setting"],
      ],
      profile.preferences.theme,
    )}${select(
      "Text size",
      "textScale",
      [
        ["1", "Standard"],
        ["1.125", "Large"],
        ["1.25", "Larger"],
      ],
      String(profile.preferences.textScale),
    )}</div><div class="appearance-preview"><h3>A clear space for mathematics</h3><p>Your preferred theme and text size apply throughout the app.</p></div><div data-message></div><div><button class="button primary">Save appearance</button></div></form></section></div><aside class="stack"><section class="panel"><h2>Your workspace</h2><div class="stack">${linkButton("My quizzes and results", "activity.html", "secondary")}${session.capabilities.teach ? linkButton("Teaching", "teaching.html", "secondary") + linkButton("Problem bank", "problems.html", "secondary") + linkButton("LaTeX guide", "guide.html", "secondary") : ""}${session.capabilities.admin ? linkButton("Administration", "admin.html", "secondary") : ""}</div></section>${session.capabilities.teach ? '<section class="panel"><h2>Uploaded files</h2><p class="muted small" id="usage">Loading storage usage…</p></section>' : ""}<section class="panel"><p class="muted small">Sign out when you finish on a shared device.</p><button class="button secondary" id="logout">Sign out</button></section></aside></div>`;
  bindForm(root.querySelector("#profile-form"), async (data) => {
    profile = await api("updateProfile", {
      displayName: data.get("displayName"),
      expectedVersion: profile.version,
    });
    await refreshSession();
    message(root.querySelector("#profile-form"), "Name saved.", "success");
  });
  bindForm(root.querySelector("#appearance-form"), async (data) => {
    const preferences = {
      theme: data.get("theme"),
      textScale: Number(data.get("textScale")),
    };
    profile = await api("updateProfile", {
      preferences,
      expectedVersion: profile.version,
    });
    applyAppearance(preferences);
    message(
      root.querySelector("#appearance-form"),
      "Appearance saved.",
      "success",
    );
  });
  mountStarred(root.querySelector("#profile-stars"));
  action(root, "#verify", async () => {
    await resendVerification();
    message(root, "Verification email sent.", "success");
  });
  action(root, "#reload-account", async () => {
    await reloadAccount();
    location.reload();
  });
  action(root, "#logout", logout);
  action(root, "#replay-tour", async () => {
    const { startTour } = await import("../components/tour.js?v=13");
    startTour(session, { force: true });
  });
  action(root, "#copy-uid", async () => {
    await navigator.clipboard.writeText(profile.uid);
    message(root, "Account ID copied.", "success");
  });
  if (session.capabilities.teach) {
    const usage = await api("getUploadUsage");
    root.querySelector("#usage").textContent =
      `${points(usage.finalizedBytes / 1048576)} MB used of ${points(usage.limitBytes / 1048576)} MB. Images are stored separately from quizzes.`;
  }
}
