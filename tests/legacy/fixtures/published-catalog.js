import { validateQuiz, totalPoints } from "../../../shared/legacy-core.js";

const FILE_PATTERN = /^[a-zA-Z0-9_-]+\.quiz\.json$/;
const CACHE_MS = 60_000;

/** Standard public GitHub Pages sites identify their source repository in the URL. */
export function repositoryForPages(pageURL) {
  const url = new URL(pageURL);
  const host = url.hostname.match(/^([a-zA-Z0-9-]+)\.github\.io$/);
  if (!host) return null;
  const owner = host[1];
  const directory = new URL("./", url).pathname.split("/").filter(Boolean);
  return { owner, repo: directory[0] || `${owner}.github.io`, branch: "main" };
}

export function quizMetadata(quiz, file) {
  const { id, title, description, subject, difficulty, durationMinutes } = quiz;
  return {
    id,
    file,
    title,
    description,
    subject,
    difficulty,
    durationMinutes,
    questionCount: quiz.questions.length,
    points: totalPoints(quiz),
    openCount: quiz.questions.filter((q) => q.type === "open").length,
    choiceCount: quiz.questions.filter((q) => q.type === "choice").length,
  };
}

async function json(fetcher, url, headers) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetcher(String(url), {
      cache: "no-cache",
      signal: controller.signal,
      ...(headers ? { headers } : {}),
    });
    if (!response.ok)
      throw new Error(`Could not load ${new URL(url).pathname}.`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/** File-only hosting: local manifest everywhere; automatic discovery on public Pages. */
export async function readPublishedCatalog({
  pageURL = globalThis.location?.href,
  fetcher = globalThis.fetch,
  cache,
  now = Date.now(),
} = {}) {
  if (cache === undefined) {
    try {
      cache = globalThis.localStorage;
    } catch {
      cache = null;
    }
  }
  const base = new URL("./", pageURL);
  const repository = repositoryForPages(pageURL);
  const manifestPromise = json(fetcher, new URL("quizzes/index.json", base))
    .then((data) =>
      Array.isArray(data.quizzes)
        ? data.quizzes.filter(
            (q) => q && FILE_PATTERN.test(q.file) && typeof q.id === "string",
          )
        : null,
    )
    .catch(() => null);

  if (!repository) {
    const manifest = await manifestPromise;
    if (manifest === null)
      throw new Error("The quiz catalog could not be loaded.");
    return manifest;
  }

  const { owner, repo, branch } = repository;
  const key = `axiom-published-v1:${owner}/${repo}:${branch}`;
  try {
    const saved = JSON.parse(cache?.getItem(key) || "null");
    if (saved?.expiresAt > now && Array.isArray(saved.quizzes)) {
      await manifestPromise;
      return saved.quizzes;
    }
  } catch {
    /* Storage is optional; publication never depends on it. */
  }

  const endpoint = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/quizzes?ref=${encodeURIComponent(branch)}`;
  let entries;
  try {
    entries = await json(fetcher, endpoint, {
      Accept: "application/vnd.github+json",
    });
    if (!Array.isArray(entries))
      throw new Error("Invalid repository directory.");
  } catch {
    const manifest = await manifestPromise;
    if (manifest === null)
      throw new Error(
        "The quiz catalog could not be loaded. Try again shortly.",
      );
    return manifest;
  }

  const manifest = (await manifestPromise) || [];
  const files = entries
    .filter((entry) => entry.type === "file" && FILE_PATTERN.test(entry.name))
    .slice(0, 500);
  const metadata = new Array(files.length);
  let cursor = 0;
  async function worker() {
    while (cursor < files.length) {
      const index = cursor++,
        file = files[index].name;
      try {
        const quiz = validateQuiz(
          await json(fetcher, new URL(`quizzes/${file}`, base)),
        );
        metadata[index] = quizMetadata(quiz, file);
      } catch {
        // A Pages deployment may lag behind the repository commit for a moment.
        metadata[index] = manifest.find((q) => q.file === file) || null;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, files.length) }, worker));
  const seen = new Set();
  const quizzes = metadata.filter((q) => {
    if (!q || seen.has(q.id)) return false;
    seen.add(q.id);
    return true;
  });
  const order = manifest.map((q) => q.id);
  quizzes.sort((a, b) => {
    const ai = order.indexOf(a.id),
      bi = order.indexOf(b.id);
    return (ai < 0 ? 1e6 : ai) - (bi < 0 ? 1e6 : bi);
  });
  try {
    cache?.setItem(key, JSON.stringify({ expiresAt: now + CACHE_MS, quizzes }));
  } catch {}
  return quizzes;
}
