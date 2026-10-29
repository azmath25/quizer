// Read-only UI fixture preview. Never deploy; actual backend tests use emulators.
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const data = JSON.parse(
  await readFile(new URL("./generated.json", import.meta.url), "utf8"),
);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".tex": "text/plain",
};
const reply = (res, status, value) => {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(value));
};
http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      const role =
        String(req.headers.cookie || "").match(
          /(?:^|; )qaRole=(teacher|student|admin|guest)/,
        )?.[1] || "teacher";
      if (url.pathname === "/__qa/view") {
        const selected = url.searchParams.get("role") || role;
        if (!Object.hasOwn(data.sessions, selected))
          throw new Error("Invalid fixture role");
        res.setHeader(
          "Set-Cookie",
          `qaRole=${selected}; Path=/; SameSite=Strict`,
        );
        res.writeHead(302, { Location: "/index.html" });
        return res.end();
      }
      if (url.pathname === "/__qa/frame") {
        const width = Math.min(
          1400,
          Math.max(320, Number(url.searchParams.get("width")) || 390),
        );
        res.writeHead(200, { "Content-Type": "text/html" });
        return res.end(
          `<!doctype html><title>Mobile UI QA</title><style>body{margin:0;background:#dbe4f0;font:14px system-ui}header{padding:10px}iframe{display:block;margin:auto;border:0;width:${width}px;height:900px;background:white}</style><header>Read-only UI fixture · ${width}px</header><iframe title="App preview" src="${url.searchParams.get("page")?.replace(/[<>"']/g, "") || "/index.html"}"></iframe>`,
        );
      }
      if (url.pathname.startsWith("/__qa/")) {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const input = JSON.parse(Buffer.concat(chunks).toString() || "{}");
        if (url.pathname === "/__qa/session")
          return reply(res, 200, data.sessions[role]);
        if (url.pathname === "/__qa/logout") {
          res.setHeader("Set-Cookie", "qaRole=guest; Path=/; SameSite=Strict");
          return reply(res, 200, { ok: true });
        }
        if (url.pathname === "/__qa/login") {
          const selected = Object.keys(data.sessions).find(
            (r) => data.sessions[r].user?.email === input.email,
          );
          if (!selected || input.password !== "Testing123!")
            throw new Error("Use an emulator fixture account.");
          res.setHeader(
            "Set-Cookie",
            `qaRole=${selected}; Path=/; SameSite=Strict`,
          );
          return reply(res, 200, { ok: true });
        }
        if (url.pathname === "/__qa/api") {
          if (input.action === "getAssetLinks")
            return reply(res, 200, {
              apiVersion: 2,
              serverTime: new Date().toISOString(),
              data: {
                links: input.assetIds.map((assetId) => ({
                  assetId,
                  url: data.assets[assetId],
                  expiresAt: new Date(Date.now() + 120000).toISOString(),
                })),
              },
            });
          const map = data.calls[role][input.action],
            value =
              map?.[
                input.quizId ?? input.problemId ?? input.attemptId ?? "default"
              ];
          if (!value)
            throw new Error(
              "Read-only visual fixture: this action is tested separately against Firebase.",
            );
          const copy = structuredClone(value);
          copy.serverTime = new Date().toISOString();
          if (input.itemIds && copy.data.items)
            copy.data.items = copy.data.items.filter((i) =>
              input.itemIds.includes(i.itemId),
            );
          return reply(res, 200, copy);
        }
        throw new Error("Read-only visual fixture.");
      }
      const route = url.pathname === "/" ? "/index.html" : url.pathname;
      const file =
        route === "/js/firebase-client.js"
          ? path.join(root, "tests/qa/client.js")
          : path.resolve(root, "." + decodeURIComponent(route));
      if (!file.startsWith(root) || !(await stat(file)).isFile())
        throw new Error("Not found");
      res.writeHead(200, {
        "Content-Type": types[path.extname(file)] || "application/octet-stream",
        "Cache-Control": "no-cache",
      });
      res.end(await readFile(file));
    } catch (e) {
      reply(res, 400, { message: e.message });
    }
  })
  .listen(Number(process.env.PORT || 4173), "0.0.0.0");
