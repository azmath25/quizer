import {
  loginWithEmail,
  loginWithGoogle,
  createAccount,
  resetPassword,
} from "../firebase-client.js";
import { safeReturnURL } from "../core/navigation.js";
import {
  field,
  bindForm,
  action,
  notice,
  message,
  e,
} from "../components/ui.js";
export async function mount(root, session) {
  const destination = safeReturnURL(
    new URLSearchParams(location.search).get("returnTo"),
  );
  if (session.user) {
    location.replace(destination);
    return;
  }
  let mode = "login";
  function render() {
    root.innerHTML = `<div class="auth-layout"><section class="panel"><div class="auth-intro"><h1>${mode === "login" ? "Sign in" : mode === "register" ? "Create an account" : "Reset your password"}</h1><p>${mode === "register" ? "Your account starts with student access." : mode === "reset" ? "We’ll send a reset link to your email." : "Continue to your quizzes and results."}</p></div><div data-message></div>${mode !== "reset" ? '<button class="button google-button" id="google"><span class="google-letter" aria-hidden="true">G</span>Continue with Google</button><div class="divider">or use email</div>' : ""}<form class="auth-form">${mode === "register" ? field("Name", "name", "text", "", 'required maxlength="100" autocomplete="name"') : ""}${field("Email address", "email", "email", "", 'required autocomplete="email" maxlength="254"')}${mode !== "reset" ? field("Password", "password", "password", "", 'required minlength="8" autocomplete="' + (mode === "register" ? "new-password" : "current-password") + '"') : ""}<button class="button primary">${mode === "login" ? "Sign in" : mode === "register" ? "Create account" : "Send reset link"}</button></form>${mode === "login" ? '<div class="auth-foot"><button class="button ghost" id="reset">Forgot password?</button></div>' : ""}<div class="auth-foot">${mode === "login" ? 'New here? <button class="button ghost" id="switch">Create an account</button>' : '<button class="button ghost" id="switch">Back to sign in</button>'}</div></section></div>`;
    bindForm(root.querySelector("form"), async (data) => {
      if (mode === "reset") {
        await resetPassword(data.get("email"));
        message(
          root.querySelector(".panel"),
          "If that account exists, a password reset link has been sent.",
          "success",
        );
        return;
      }
      if (mode === "register")
        await createAccount(
          data.get("name"),
          data.get("email"),
          data.get("password"),
        );
      else await loginWithEmail(data.get("email"), data.get("password"));
      location.replace(destination);
    });
    action(root, "#google", async () => {
      await loginWithGoogle();
      location.replace(destination);
    });
    root.querySelector("#switch").onclick = () => {
      mode = mode === "login" ? "register" : "login";
      render();
    };
    if (root.querySelector("#reset"))
      root.querySelector("#reset").onclick = () => {
        mode = "reset";
        render();
      };
  }
  render();
}
