import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  readPublishedCatalog,
  repositoryForPages,
  quizMetadata,
} from "./legacy/fixtures/published-catalog.js";

const quiz = JSON.parse(
  await readFile(
    new URL("./fixtures/quizzes/algebra-essentials.quiz.json", import.meta.url),
    "utf8",
  ),
);
const pageURL = "https://azmath25.github.io/sat-quiz/index.html";
const oldEntry = quizMetadata(quiz, "algebra-essentials.quiz.json");
const reply = (data, status = 200) =>
  new Response(JSON.stringify(data), { status });

test("identifies project and user Pages repositories, without assuming a custom-domain source", () => {
  assert.deepEqual(repositoryForPages(pageURL), {
    owner: "azmath25",
    repo: "sat-quiz",
    branch: "main",
  });
  assert.deepEqual(
    repositoryForPages("https://azmath25.github.io/quiz.html?id=a"),
    { owner: "azmath25", repo: "azmath25.github.io", branch: "main" },
  );
  assert.equal(repositoryForPages("http://localhost:4173/index.html"), null);
  assert.equal(repositoryForPages("https://math.example/index.html"), null);
});

test("static hosting uses the bundled catalog without any GitHub requests", async () => {
  const requests = [];
  const result = await readPublishedCatalog({
    pageURL: "http://localhost:4173/index.html",
    cache: null,
    fetcher: async (url) => {
      requests.push(url);
      return reply({ quizzes: [oldEntry] });
    },
  });
  assert.deepEqual(result, [oldEntry]);
  assert.deepEqual(requests, ["http://localhost:4173/quizzes/index.json"]);
});

test("a new single quiz file is discovered even when the bundled catalog has not been updated", async () => {
  const added = { ...quiz, id: "weekly-01", title: "Weekly quiz" };
  const requests = [];
  const result = await readPublishedCatalog({
    pageURL,
    cache: null,
    fetcher: async (url) => {
      requests.push(url);
      if (url.includes("api.github.com"))
        return reply([
          { type: "file", name: "algebra-essentials.quiz.json" },
          { type: "file", name: "weekly-01.quiz.json" },
          { type: "file", name: "index.json" },
          { type: "file", name: "../unsafe.quiz.json" },
        ]);
      if (url.endsWith("index.json")) return reply({ quizzes: [oldEntry] });
      if (url.endsWith("weekly-01.quiz.json")) return reply(added);
      return reply(quiz);
    },
  });
  assert.deepEqual(
    result.map((q) => q.id),
    [quiz.id, "weekly-01"],
  );
  assert.equal(result[1].questionCount, 6);
  assert.equal(result[1].points, 15);
  assert.ok(
    requests.includes(
      "https://api.github.com/repos/azmath25/sat-quiz/contents/quizzes?ref=main",
    ),
  );
  assert.ok(
    requests.includes(
      "https://azmath25.github.io/sat-quiz/quizzes/weekly-01.quiz.json",
    ),
  );
  assert.ok(!requests.some((url) => url.includes("unsafe")));
});

test("public API rate limits fall back to the bundled catalog", async () => {
  const result = await readPublishedCatalog({
    pageURL,
    cache: null,
    fetcher: async (url) =>
      url.includes("api.github.com")
        ? reply({ message: "rate limited" }, 403)
        : reply({ quizzes: [oldEntry] }),
  });
  assert.deepEqual(result, [oldEntry]);
});

test("a short metadata cache avoids repeated repository queries across pages", async () => {
  const values = new Map();
  const cache = {
    getItem: (k) => values.get(k),
    setItem: (k, v) => values.set(k, v),
  };
  let queries = 0;
  const fetcher = async (url) => {
    if (url.includes("api.github.com")) {
      queries++;
      return reply([{ type: "file", name: "algebra-essentials.quiz.json" }]);
    }
    return url.endsWith("index.json")
      ? reply({ quizzes: [oldEntry] })
      : reply(quiz);
  };
  await readPublishedCatalog({ pageURL, fetcher, cache, now: 100 });
  const second = await readPublishedCatalog({
    pageURL,
    fetcher,
    cache,
    now: 500,
  });
  assert.equal(queries, 1);
  assert.deepEqual(second, [oldEntry]);
  await readPublishedCatalog({ pageURL, fetcher, cache, now: 61_000 });
  assert.equal(queries, 2);
});

test("invalid quiz files are ignored and removed files disappear from discovery", async () => {
  const result = await readPublishedCatalog({
    pageURL,
    cache: null,
    fetcher: async (url) => {
      if (url.includes("api.github.com"))
        return reply([{ type: "file", name: "broken.quiz.json" }]);
      return url.endsWith("index.json")
        ? reply({ quizzes: [oldEntry] })
        : reply({ schemaVersion: 999 });
    },
  });
  assert.deepEqual(result, []);
});
