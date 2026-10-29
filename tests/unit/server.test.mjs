import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";

test("Local server serves pages, ES modules and CSS, and rejects sibling paths", async () => {
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const child = spawn(process.execPath, ["scripts/serve.mjs"], {
    cwd: new URL("../../", import.meta.url),
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await Promise.race([
      once(child.stdout, "data"),
      once(child, "exit").then(() => {
        throw new Error("Server stopped before listening");
      }),
    ]);
    for (const [route, type] of [
      ["/", "text/html"],
      ["/profile.html", "text/html"],
      ["/js/app.js", "text/javascript"],
      ["/assets/css/tokens.css", "text/css"],
    ]) {
      const response = await fetch(`http://127.0.0.1:${port}${route}`);
      assert.equal(response.status, 200, route);
      assert.ok(response.headers.get("content-type").startsWith(type), route);
      assert.ok((await response.text()).length > 0, route);
    }
    const missing = await fetch(
      `http://127.0.0.1:${port}/%2e%2e%2fpackage.json`,
    );
    assert.equal(missing.status, 404);
  } finally {
    child.kill();
    await once(child, "exit");
  }
});
