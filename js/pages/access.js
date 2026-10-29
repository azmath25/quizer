import { api } from "../services/api.js";
import {
  pageHead,
  empty,
  linkButton,
  e,
  textarea,
  bindForm,
  notice,
} from "../components/ui.js";
import { loginURL } from "../core/navigation.js";
export async function mount(root, session) {
  const token = new URLSearchParams(location.search).get("token");
  if (!token) throw new Error("This access link is incomplete.");
  const quiz = await api("resolveJoinLink", { token });
  root.innerHTML = `<div class="narrow">${pageHead("Request quiz access")}<section class="panel"><h2>${e(quiz.title)}</h2><p class="muted">By ${e(quiz.ownerDisplayName)}</p><hr><p>The teacher must approve your request before you can start.</p>${session.user ? `<form class="stack">${textarea("Message to the teacher (optional)", "message", "", 'maxlength="500" rows="4"')}<div data-message></div><button class="button primary">Request access</button></form>` : linkButton("Sign in to request access", loginURL())}</section></div>`;
  if (session.user)
    bindForm(root.querySelector("form"), async (data) => {
      const result = await api("requestQuizAccess", {
        quizId: quiz.quizId,
        token,
        message: data.get("message"),
      });
      root.querySelector("form").innerHTML =
        notice(
          result.accessStatus === "approved"
            ? "You already have access."
            : "Your request is awaiting teacher approval.",
          "success",
        ) + linkButton("View quiz", `quiz.html?id=${quiz.quizId}`, "secondary");
    });
}
