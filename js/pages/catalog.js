import { api, apiSWR } from "../services/api.js";
import {
  pageHead,
  quizCard,
  empty,
  bindForm,
  loading,
  pagination,
  message
} from "../components/ui.js";
export async function mount(root, session) {
  let view = "public";
  root.innerHTML =
    pageHead(
      "Quizzes",
      "Choose a quiz, check its details and start when you’re ready.",
    ) +
    `<div class="tabs" role="tablist" aria-label="Quiz collections"><button role="tab" aria-selected="true" data-view="public">Public quizzes</button>${session.user ? '<button role="tab" aria-selected="false" data-view="available">Available to me</button>' : ""}</div><form class="toolbar"><label class="field catalog-search"><span>Title starts with</span><input name="search" type="search" placeholder="Search quiz titles…" maxlength="200"></label><label class="field"><span>Subject</span><input name="subject" placeholder="Any subject" maxlength="80"></label><button class="button primary">Search</button></form><div data-message></div><div class="grid" id="quiz-list"></div>`;
  const list = root.querySelector("#quiz-list"),
    form = root.querySelector("form");
  let filter = {},
    loadId = 0;
  const setPage = pagination(list, load);
  async function load(cursor = null) {
    if (!cursor) list.innerHTML = loading();
    try {
      const action =
          view === "public" ? "listPublicQuizzes" : "listAvailableQuizzes",
        params = {
          ...(view === "public" ? filter : {}),
          limit: 12,
          ...(cursor ? { cursor } : {}),
        },
        paint = (result) => {
          list.innerHTML = "";
          list.insertAdjacentHTML(
            "beforeend",
            result.items.map((q) => quizCard(q)).join(""),
          );
          if (!list.children.length)
            list.innerHTML = empty(
              view === "public"
                ? "No matching quizzes"
                : "No approved quizzes yet",
              view === "public"
                ? "Try another title or subject."
                : "Quizzes you are approved for will appear here.",
            );
          setPage(result.nextCursor);
        };
      if (!cursor) {
        const stamp = ++loadId;
        await apiSWR(action, params, (r) => stamp === loadId && paint(r));
        return;
      }
      const result = await api(action, params);
      list.insertAdjacentHTML(
        "beforeend",
        result.items.map((q) => quizCard(q)).join(""),
      );
      setPage(result.nextCursor);
    } catch (error) {
      list.innerHTML = "";
      message(root, error.message);
    }
  }
  bindForm(form, async (values) => {
    filter = Object.fromEntries(
      [...values.entries()].filter(([, v]) => v.trim()),
    );
    await load();
  });
  root.querySelectorAll("[data-view]").forEach(
    (button) =>
      (button.onclick = async () => {
        view = button.dataset.view;
        root
          .querySelectorAll("[data-view]")
          .forEach((b) =>
            b.setAttribute("aria-selected", String(b === button)),
          );
        form.hidden = view !== "public";
        await load();
      }),
  );
  await load();
}
