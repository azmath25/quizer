const CONFIG_FIELDS = [
  "apiKey",
  "authDomain",
  "projectId",
  "storageBucket",
  "messagingSenderId",
  "appId",
  "measurementId",
];
const REQUIRED = ["apiKey", "authDomain", "projectId", "appId"];

export function parseFirebaseConfig(input) {
  let value = input;
  if (typeof value === "string") {
    let text = value.trim();
    text = text
      .replace(/^(?:export\s+)?(?:const|let|var)\s+firebaseConfig\s*=\s*/, "")
      .replace(/;\s*$/, "");
    // Accept Firebase's standard configuration snippet, without evaluating JavaScript.
    text = text
      .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
      .replace(/,\s*([}\]])/g, "$1");
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error(
        "Paste the Firebase web configuration object, using double-quoted values.",
      );
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("A Firebase web configuration object is required.");
  if (
    ["private_key", "private_key_id", "client_email", "serviceAccount"].some(
      (k) => Object.hasOwn(value, k),
    ) ||
    value.type === "service_account"
  ) {
    throw new Error(
      "This is a service-account key. Use the public web-app configuration instead.",
    );
  }
  const config = {};
  for (const key of CONFIG_FIELDS)
    if (typeof value[key] === "string" && value[key].trim())
      config[key] = value[key].trim();
  const missing = REQUIRED.filter((key) => !config[key]);
  if (missing.length)
    throw new Error(`Missing configuration fields: ${missing.join(", ")}.`);
  if (
    !/^[a-zA-Z0-9_-]{10,}$/.test(config.apiKey) ||
    /YOUR_|REPLACE|PASTE/i.test(config.apiKey)
  )
    throw new Error("Enter your actual Firebase web API key.");
  if (!/^[a-z0-9-]+$/.test(config.projectId))
    throw new Error("Check the Firebase project ID.");
  if (
    !/^[a-zA-Z0-9.-]+$/.test(config.authDomain) ||
    (config.storageBucket && !/^[a-zA-Z0-9.-]+$/.test(config.storageBucket))
  )
    throw new Error(
      "Use the authDomain and storageBucket values without https:// or gs://.",
    );
  if (!/^[a-zA-Z0-9:_-]+$/.test(config.appId))
    throw new Error("Check the Firebase app ID.");
  return config;
}
export function resolveFirebaseConfig(siteConfig) {
  if (siteConfig && Object.keys(siteConfig).length)
    return { config: parseFirebaseConfig(siteConfig), source: "site" };
  return { config: null, source: "none" };
}
export function canCreateQuiz(session) {
  return session?.status === "unconfigured" || canPublish(session);
}
export function canPublish(session) {
  return (
    session?.status === "ready" &&
    Boolean(session.user?.emailVerified) &&
    ["teacher", "admin"].includes(session.role)
  );
}
export function safeReturnURL(input, pageURL) {
  const base = new URL("./", pageURL);
  try {
    const url = new URL(input || "index.html", base);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname))
      return new URL("index.html", base).href;
    const leaf = url.pathname.slice(base.pathname.length);
    if (
      !["index.html", "upload.html", "quiz.html", "login.html", ""].includes(
        leaf,
      )
    )
      return new URL("index.html", base).href;
    return url.href;
  } catch {
    return new URL("index.html", base).href;
  }
}
export function firebaseError(error) {
  const messages = {
    "auth/invalid-credential": "The email or password is incorrect.",
    "auth/user-not-found": "The email or password is incorrect.",
    "auth/wrong-password": "The email or password is incorrect.",
    "auth/email-already-in-use":
      "An account already uses this email. Sign in or reset the password.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/weak-password": "Use a stronger password with at least 8 characters.",
    "auth/too-many-requests":
      "Too many attempts. Wait a few minutes and try again.",
    "auth/popup-closed-by-user": "The sign-in window was closed.",
    "auth/cancelled-popup-request": "The sign-in window was closed.",
    "auth/popup-blocked":
      "Allow the sign-in popup and try again, or sign in with email.",
    "auth/unauthorized-domain":
      "Sign-in is not enabled for this website address. Contact the site owner.",
    "auth/operation-not-allowed":
      "This sign-in method is not available. Try another method.",
    "auth/network-request-failed":
      "Could not sign in. Check your connection and try again.",
    "auth/invalid-api-key": "Sign-in is unavailable. Contact the site owner.",
    "permission-denied":
      "Your account does not have permission for this action.",
    unavailable:
      "Shared quizzes are unavailable. Your local files are still available; try again shortly.",
  };
  return (
    messages[error?.code] || error?.message || "The request failed. Try again."
  );
}
