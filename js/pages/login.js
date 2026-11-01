import { go, onLeave } from "../core/router.js";
import {
  loginWithEmail,
  loginWithGoogle,
  createAccount,
  resetPassword,
} from "../firebase-client.js";
import { safeReturnURL } from "../core/navigation.js";
import { field, bindForm, action, message, e } from "../components/ui.js";
// One angle drives the circle point, the guide and the curve, so y = sin(θ) holds exactly.
function startScene(root) {
  stopScene?.();
  const svg = root.querySelector(".auth-scene svg");
  if (!svg) return;
  const $ = (id) => svg.querySelector(id),
    CX = 70,
    CY = 110,
    R = 60,
    X0 = 150,
    SPAN = 240,
    TURNS = 1.5,
    SPEED = 1.1;
  const wave = $("#sc-wave"),
    ray = $("#sc-ray"),
    guide = $("#sc-guide"),
    p = $("#sc-p"),
    head = $("#sc-head");
  const draw = (t) => {
    const x = CX + R * Math.cos(t),
      y = CY - R * Math.sin(t);
    ray.setAttribute("x2", x);
    ray.setAttribute("y2", y);
    p.setAttribute("cx", x);
    p.setAttribute("cy", y);
    guide.setAttribute("x2", X0);
    guide.setAttribute("y1", y);
    guide.setAttribute("y2", y);
    head.setAttribute("cy", y);
    let d = "";
    for (let i = 0; i <= 120; i++) {
      const u = i / 120;
      d += `${i ? "L" : "M"}${(X0 + u * SPAN).toFixed(1)} ${(CY - R * Math.sin(t - u * TURNS * 2 * Math.PI)).toFixed(1)}`;
    }
    wave.setAttribute("d", d);
  };
  draw(Math.PI / 6);
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  let frame,
    last = performance.now(),
    t = Math.PI / 6;
  const tick = (now) => {
    if (!svg.isConnected) return;
    t += Math.min(0.05, (now - last) / 1000) * SPEED;
    last = now;
    if (!document.hidden) draw(t);
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  stopScene = () => cancelAnimationFrame(frame);
}
let stopScene = null;
export async function mount(root, session) {
  const destination = safeReturnURL(
    new URLSearchParams(location.search).get("returnTo"),
  );
  if (session.user) {
    go(destination, { replace: true });
    return;
  }
  let mode = "login";
  onLeave(() => stopScene?.());
  function render() {
    root.innerHTML = `<div class="auth-layout"><aside class="auth-scene" aria-hidden="true"><svg viewBox="0 0 400 220"><line x1="0" y1="110" x2="400" y2="110" class="ax"/><line x1="70" y1="10" x2="70" y2="210" class="ax"/><line x1="150" y1="30" x2="150" y2="190" class="ax"/><circle cx="70" cy="110" r="60" class="uc"/><line class="ray" id="sc-ray" x1="70" y1="110" x2="130" y2="110"/><line class="guide" id="sc-guide" x1="130" y1="110" x2="150" y2="110"/><path class="wave" id="sc-wave" d=""/><circle class="pt" id="sc-p" cx="130" cy="110" r="5"/><circle class="pt" id="sc-head" cx="150" cy="110" r="5"/></svg><p>Every great proof begins with a single step.</p><span class="scene-eq">e<sup>iθ</sup> = cos θ + i sin θ</span></aside><section class="panel"><div class="auth-intro"><h1>${mode === "login" ? "Sign in" : mode === "register" ? "Create an account" : "Reset your password"}</h1><p>${mode === "register" ? "Your account starts with student access." : mode === "reset" ? "We’ll send a reset link to your email." : "Continue to your quizzes and results."}</p></div><div data-message></div>${mode !== "reset" ? '<button class="button google-button" id="google"><span class="google-letter" aria-hidden="true">G</span>Continue with Google</button><div class="divider">or use email</div>' : ""}<form class="auth-form">${mode === "register" ? field("Name", "name", "text", "", 'required maxlength="100" autocomplete="name"') : ""}${field("Email address", "email", "email", "", 'required autocomplete="email" maxlength="254"')}${mode !== "reset" ? field("Password", "password", "password", "", 'required minlength="8" autocomplete="' + (mode === "register" ? "new-password" : "current-password") + '"') : ""}<button class="button primary">${mode === "login" ? "Sign in" : mode === "register" ? "Create account" : "Send reset link"}</button></form>${mode === "login" ? '<div class="auth-foot"><button class="button ghost" id="reset">Forgot password?</button></div>' : ""}<div class="auth-foot">${mode === "login" ? 'New here? <button class="button ghost" id="switch">Create an account</button>' : '<button class="button ghost" id="switch">Back to sign in</button>'}</div></section></div>`;
    startScene(root);
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
