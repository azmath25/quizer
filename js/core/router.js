const css = (...names) => names.map((n) => `assets/css/pages/${n}.css`);
export const routes = {
  "index.html": ["home", "Home", css("home", "reports")],
  "quizzes.html": ["catalog", "Quizzes", css("catalog")],
  "login.html": ["login", "Sign in", css("account")],
  "profile.html": ["profile", "Profile", css("account")],
  "activity.html": ["activity", "My activity", css("reports")],
  "teaching.html": ["teaching", "Teaching", css("reports")],
  "quiz-manage.html": ["quiz-manage", "Manage quiz", css("reports")],
  "problems.html": ["problems", "Problem bank", css("editor")],
  "problem-edit.html": ["problem-edit", "Edit problem", css("editor")],
  "upload.html": ["quiz-editor", "Quiz editor", css("editor", "quiz")],
  "quiz.html": ["quiz", "Quiz", css("quiz")],
  "results.html": ["results", "Results", css("quiz")],
  "access.html": ["access", "Request access", css("account")],
  "admin.html": ["admin", "Administration", css("admin", "reports")],
  "guide.html": ["guide", "LaTeX guide", css("editor")],
};
const base = new URL(".", location.href);
let render = null,
  token = 0,
  lastHref = location.href,
  cleanups = [],
  guards = [];
const modules = new Map();

export const fileOf = (url) =>
  url.pathname.slice(base.pathname.length) || "index.html";
export function resolve(href) {
  try {
    const url = new URL(href, location.href);
    if (
      url.origin !== base.origin ||
      !url.pathname.startsWith(base.pathname) ||
      !routes[fileOf(url)]
    )
      return null;
    return url;
  } catch {
    return null;
  }
}
export const isStale = (t) => t !== token;
export const onLeave = (fn) => cleanups.push(fn);
export const onLeaveGuard = (fn) => guards.push(fn);
export const loadModule = (file) => {
  if (!modules.has(file))
    modules.set(
      file,
      import(`../pages/${routes[file][0]}.js`).catch((error) => {
        modules.delete(file);
        throw error;
      }),
    );
  return modules.get(file);
};
export function prefetch(href) {
  const url = resolve(href);
  if (url) loadModule(fileOf(url)).catch(() => {});
}
function leave() {
  const fns = cleanups;
  cleanups = [];
  guards = [];
  document.querySelectorAll("dialog[open]").forEach((d) => d.close());
  for (const fn of fns)
    try {
      fn();
    } catch {}
}
async function ensureCSS(hrefs) {
  const wanted = new Set(hrefs.map((h) => new URL(h, base).href)),
    links = [...document.querySelectorAll("link[data-route-css]")],
    have = new Set(links.map((l) => l.href));
  await Promise.all(
    [...wanted]
      .filter((h) => !have.has(h))
      .map(
        (href) =>
          new Promise((done) => {
            const l = document.createElement("link");
            l.rel = "stylesheet";
            l.href = href;
            l.dataset.routeCss = "";
            l.onload = l.onerror = done;
            document.head.append(l);
            setTimeout(done, 3000);
          }),
      ),
  );
  for (const l of links) if (!wanted.has(l.href)) l.remove();
}
async function show(file, t) {
  const [page, title, styles] = routes[file];
  await ensureCSS(styles);
  if (isStale(t)) return;
  document.body.dataset.page = page;
  document.title = `${title} · Math Quiz`;
  document.dispatchEvent(new Event("route-changed"));
  await render(page, file, t);
}
export function currentGuardOk() {
  return !guards.some((g) => g()) || confirm("Leave this page? Unsaved changes will be lost.");
}
export async function go(href, { replace = false } = {}) {
  const url = resolve(href);
  if (!url || !render) {
    location[replace ? "replace" : "assign"](href);
    return;
  }
  if (!currentGuardOk()) return;
  leave();
  const t = ++token;
  history[replace ? "replaceState" : "pushState"](null, "", url.href);
  lastHref = url.href;
  scrollTo(0, 0);
  await show(fileOf(url), t);
}
export async function startRouter(renderPage) {
  render = renderPage;
  const first = fileOf(new URL(location.href));
  for (const l of document.querySelectorAll('link[href*="css/pages/"]'))
    l.dataset.routeCss = "";
  document.addEventListener("click", (event) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const a = event.target.closest?.("a[href]");
    if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download"))
      return;
    const url = resolve(a.href);
    if (!url) return;
    const here = new URL(location.href);
    if (fileOf(url) === fileOf(here) && url.search === here.search) return;
    lastHref = here.href;
    event.preventDefault();
    go(url.href);
  });
  const warm = (event) => {
    const a = event.target.closest?.("a[href]");
    if (a) prefetch(a.href);
  };
  document.addEventListener("pointerover", warm, { passive: true });
  document.addEventListener("touchstart", warm, { passive: true });
  addEventListener("popstate", () => {
    const url = resolve(location.href);
    if (!url) return location.reload();
    if (!currentGuardOk()) {
      history.pushState(null, "", lastHref);
      return;
    }
    leave();
    lastHref = location.href;
    show(fileOf(url), ++token);
  });
  await show(first, ++token);
}
