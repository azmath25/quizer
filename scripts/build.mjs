import { cp, mkdir, rm, readdir, writeFile } from "node:fs/promises";
const root = new URL("../", import.meta.url),
  dist = new URL("dist/", root);
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const name of (await readdir(root)).filter((n) => n.endsWith(".html")))
  await cp(new URL(name, root), new URL(name, dist));
for (const name of ["assets", "js", "shared", "examples"])
  await cp(new URL(name + "/", root), new URL(name + "/", dist), {
    recursive: true,
    filter: (source) => !source.endsWith(".local.js"),
  });
await writeFile(new URL(".nojekyll", dist), "");
console.log(
  "Built static app in dist/. Backend and private data are excluded.",
);
