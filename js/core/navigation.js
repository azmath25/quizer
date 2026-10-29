const allowed = new Set([
  "index.html",
  "quizzes.html",
  "login.html",
  "profile.html",
  "activity.html",
  "teaching.html",
  "quiz-manage.html",
  "problems.html",
  "problem-edit.html",
  "upload.html",
  "quiz.html",
  "results.html",
  "access.html",
  "admin.html",
  "guide.html",
]);
export function safeReturnURL(value, current = location.href) {
  const base = new URL(".", current),
    fallback = new URL("profile.html", base).href;
  try {
    const url = new URL(value || "profile.html", base);
    if (
      url.origin !== base.origin ||
      !url.pathname.startsWith(base.pathname) ||
      !allowed.has(url.pathname.slice(base.pathname.length)) ||
      url.username ||
      url.password ||
      url.pathname.endsWith("/login.html")
    )
      return fallback;
    return url.href;
  } catch {
    return fallback;
  }
}
export const route = (file, params = {}) =>
  file + (Object.keys(params).length ? "?" + new URLSearchParams(params) : "");
export const loginURL = () =>
  route("login.html", {
    returnTo:
      location.pathname.split("/").at(-1) + location.search + location.hash,
  });
