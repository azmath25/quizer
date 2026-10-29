import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".tex": "text/plain; charset=utf-8",
};
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost"),
      file = path.resolve(
        root,
        "." +
          decodeURIComponent(
            url.pathname.endsWith("/")
              ? url.pathname + "index.html"
              : url.pathname,
          ),
      );
    if (
      !file.startsWith(root + path.sep) &&
      file !== path.join(root, "index.html")
    )
      throw new Error();
    if (!(await stat(file)).isFile()) throw new Error();
    res.writeHead(200, {
      "Content-Type": types[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
});
const port = Number(process.env.PORT || 4173);
server.listen(port, "0.0.0.0", () =>
  console.log(`Local: http://localhost:${port}`),
);
