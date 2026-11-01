import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const pages = [
  "index",
  "quizzes",
  "login",
  "profile",
  "activity",
  "teaching",
  "quiz-manage",
  "problems",
  "problem-edit",
  "upload",
  "quiz",
  "results",
  "access",
  "admin",
  "guide",
  "ai",
  "settings",
];
const errors = [];
for (const page of pages) {
  const html = await readFile(path.join(root, page + ".html"), "utf8");
  for (const [, ref] of html.matchAll(
    /(?:src|href)="([^"#?]+)(?:[?#][^"]*)?"/g,
  )) {
    if (/^(https?:|data:)/.test(ref)) continue;
    try {
      await stat(path.resolve(root, ref));
    } catch {
      errors.push(`${page}.html → missing ${ref}`);
    }
  }
  if (/href="\//.test(html) || /src="\//.test(html))
    errors.push(`${page} uses root-relative paths`);
}
async function walk(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(p)));
    else files.push(p);
  }
  return files;
}
for (const file of [
  ...(await walk(path.join(root, "js"))),
  ...(await walk(path.join(root, "shared"))),
]) {
  if (!file.endsWith(".js")) continue;
  const source = await readFile(file, "utf8");
  for (const [, spec] of source.matchAll(
    /(?:from\s*|import\s*)["'](\.[^"']+)["']/g,
  )) {
    try {
      await stat(path.resolve(path.dirname(file), spec));
    } catch {
      errors.push(`${path.relative(root, file)} → missing ${spec}`);
    }
  }
  if (/BEGIN (?:RSA )?PRIVATE KEY/.test(source))
    errors.push("Private key found: " + file);
  if (/api.github.com\/repos|Save on device|On device/.test(source))
    errors.push("Legacy runtime fallback found: " + file);
}
for (const file of await walk(path.join(root, "shared"))) {
  const relative = path.relative(path.join(root, "shared"), file);
  try {
    if (
      (await readFile(file)).compare(
        await readFile(path.join(root, "functions/shared", relative)),
      )
    )
      errors.push("Shared mirror differs: " + relative);
  } catch {
    errors.push("Shared mirror missing: " + relative);
  }
}
if (errors.length) throw new Error(errors.join("\n"));
console.log(
  `${pages.length} routes, relative assets/imports and backend shared mirror verified.`,
);
