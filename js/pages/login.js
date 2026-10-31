import { go } from "../core/router.js";
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
  message,
  e
} from "../components/ui.js";
export async function mount(root, session) {
  const destination = safeReturnURL(
    new URLSearchParams(location.search).get("returnTo"),
  );
  if (session.user) {
    go(destination, { replace: true });
    return;
  }
  let mode = "login";
  function render() {
    root.innerHTML = `<div class="auth-layout"><aside class="auth-scene" aria-hidden="true"><svg viewBox="0 0 400 220"><line x1="0" y1="110" x2="400" y2="110" class="ax"/><line x1="70" y1="10" x2="70" y2="210" class="ax"/><circle cx="70" cy="110" r="60" class="uc"/><g class="rad"><line x1="70" y1="110" x2="130" y2="110" class="ray"/><circle cx="130" cy="110" r="6" class="pt"/></g><path d="M70 110 Q 110 30 150 110 T 230 110 T 310 110 T 390 110" class="wave"/><circle r="6" class="pt trace"/></svg><p>Every great proof begins with a single step.</p><span class="scene-eq">e<sup>iθ</sup> = cos θ + i sin θ</span></aside><section class="panel"><div class="auth-intro"><h1>${mode === "login" ? "Sign in" : mode === "register" ? "Create an account" : "Reset your password"}</h1><p>${mode === "register" ? "Your account starts with student access." : mode === "reset" ? "We’ll send a reset link to your email." : "Continue to your quizzes and results."}</p></div><div data-message></div>${mode !== "reset" ? '<button class="button google-button" id="google"><span class="google-letter" aria-hidden="true">G</span>Continue with Google</button><div class="divider">or use email</div>' : ""}<form class="auth-form">${mode === "register" ? field("Name", "name", "text", "", 'required maxlength="100" autocomplete="name"') : ""}${field("Email address", "email", "email", "", 'required autocomplete="email" maxlength="254"')}${mode !== "reset" ? field("Password", "password", "password", "", 'required minlength="8" autocomplete="' + (mode === "register" ? "new-password" : "current-password") + '"') : ""}<button class="button primary">${mode === "login" ? "Sign in" : mode === "register" ? "Create account" : "Send reset link"}</button></form>${mode === "login" ? '<div class="auth-foot"><button class="button ghost" id="reset">Forgot password?</button></div>' : ""}<div class="auth-foot">${mode === "login" ? 'New here? <button class="button ghost" id="switch">Create an account</button>' : '<button class="button ghost" id="switch">Back to sign in</button>'}</div></section></div>`;
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
      go(destination, { replace: true });
    });
    action(root, "#google", async () => {
      await loginWithGoogle();
      go(destination, { replace: true });
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
