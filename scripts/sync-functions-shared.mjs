import { cp, mkdir, rm } from "node:fs/promises";
const root = new URL("../", import.meta.url);
await rm(new URL("functions/shared/", root), { recursive: true, force: true });
await mkdir(new URL("functions/shared/", root), { recursive: true });
await cp(new URL("shared/", root), new URL("functions/shared/", root), {
  recursive: true,
});
console.log("Shared backend modules synchronized.");
