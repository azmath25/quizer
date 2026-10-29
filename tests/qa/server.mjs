// Managed-browser QA bridge to REAL isolated Firebase emulators.
// This test-only server is excluded from the static build; never deploy it.
import http from "node:http";
import { spawn } from "node:child_process";
import { readFile, stat, appendFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
const root = fileURLToPath(new URL("../../", import.meta.url));
const project = "demo-mathquiz-v2";
let emulatorLog = "Launching Firebase CLI";
Object.assign(process.env, {
  GCLOUD_PROJECT: project,
  FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
  FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
  FIREBASE_STORAGE_EMULATOR_HOST: "127.0.0.1:9199",
  STORAGE_BUCKET: project + ".appspot.com",
});
const localEnv = { ...process.env };
for (const key of [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "http_proxy",
  "https_proxy",
  "ALL_PROXY",
  "all_proxy",
])
  delete localEnv[key];
localEnv.NODE_USE_ENV_PROXY = "0";
const emulators = spawn(
  process.execPath,
  [
    path.join(root, "node_modules/firebase-tools/lib/bin/firebase.js"),
    "emulators:start",
    "--project",
    project,
    "--only",
    "auth,firestore,storage",
  ],
  { cwd: root, env: localEnv, stdio: ["ignore", "pipe", "pipe"] },
);
emulators.stdout.on("data", (data) => {
  emulatorLog += data.toString();
  process.stdout.write(data);
  appendFile(path.join(root, "../qa-server.log"), data);
});
emulators.stderr.on("data", (data) => {
  emulatorLog += data.toString();
  process.stderr.write(data);
  appendFile(path.join(root, "../qa-server.log"), data);
});
emulators.on(
  "exit",
  (code, signal) => (emulatorLog += `\nCLI exited ${code} ${signal}`),
);
emulators.on("error", (e) => (emulatorLog += "\n" + e.message));
const { initializeApp } =
  await import("../../functions/node_modules/firebase-admin/lib/esm/app/index.js");
const { getAuth } =
  await import("../../functions/node_modules/firebase-admin/lib/esm/auth/index.js");
const { getFirestore } =
  await import("../../functions/node_modules/firebase-admin/lib/esm/firestore/index.js");
const { getStorage } =
  await import("../../functions/node_modules/firebase-admin/lib/esm/storage/index.js");
const { dispatch } = await import("../../functions/src/router.js");
const { runJob } = await import("../../functions/src/jobs/worker.js");
const { sweep } = await import("../../functions/src/jobs/sweeper.js");
initializeApp({ projectId: project, storageBucket: project + ".appspot.com" });
const db = getFirestore(),
  auth = getAuth(),
  sessions = new Map();
let ready = false,
  setupError = "";
(async () => {
  try {
    let available = false;
    for (let i = 0; i < 100; i++) {
      try {
        const data = await (
          await fetch("http://127.0.0.1:4400/emulators")
        ).json();
        if (data.auth && data.firestore && data.storage) {
          available = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!available) throw new Error("Emulators did not start");
    const { seed } = await import("../../scripts/seed-emulators.mjs");
    await seed();
    ready = true;
    console.log("QA fixtures ready");
  } catch (e) {
    setupError = e.message;
    emulatorLog += "\nSetup: " + e.stack;
    console.error(e);
  }
})();
function json(res, status, value) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(value));
}
async function body(req, max = 21 * 1024 * 1024) {
  const parts = [];
  let bytes = 0;
  for await (const part of req) {
    bytes += part.length;
    if (bytes > max) throw new Error("Payload too large");
    parts.push(part);
  }
  return Buffer.concat(parts);
}
async function actor(req) {
  const sid = String(req.headers.cookie || "").match(
      /(?:^|; )qaSession=([^;]+)/,
    )?.[1],
    token = sessions.get(sid);
  if (!token) return null;
  const decoded = await auth.verifyIdToken(token);
  return { uid: decoded.uid, token: decoded };
}
function rewrite(value) {
  if (typeof value === "string" && value.startsWith("http://127.0.0.1:9199/"))
    return "/__qa/storage" + value.slice("http://127.0.0.1:9199".length);
  if (Array.isArray(value)) return value.map(rewrite);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, rewrite(v)]),
    );
  return value;
}
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".tex": "text/plain; charset=utf-8",
};
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/__qa/status")
      return json(res, 200, {
        ready,
        error: setupError,
        log: emulatorLog.slice(-5000),
        executable: process.execPath,
        java: process.env.JAVA_HOME,
      });
    if (url.pathname.startsWith("/__qa/storage/")) {
      const upstream = await fetch(
        "http://127.0.0.1:9199" +
          url.pathname.slice("/__qa/storage".length) +
          url.search,
      );
      res.writeHead(upstream.status, {
        "Content-Type":
          upstream.headers.get("content-type") || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      return res.end(Buffer.from(await upstream.arrayBuffer()));
    }
    if (url.pathname.startsWith("/__qa/")) {
      if (!ready)
        return json(res, 503, {
          message:
            setupError ||
            "Starting isolated test services. Please retry shortly.",
        });
      const who = await actor(req),
        method = url.pathname.slice(6);
      if (method === "upload") {
        if (!who) throw new Error("Sign in required");
        const uploadPath = url.searchParams.get("path");
        if (!uploadPath?.startsWith(`staging/${who.uid}/`))
          throw new Error("Wrong owner");
        const assetId = uploadPath.split("/")[2];
        const asset = (await db.doc("assets/" + assetId).get()).data(),
          role = (await db.doc("roles/" + who.uid).get()).data();
        const bytes = await body(req);
        if (
          !["teacher", "admin"].includes(role?.role) ||
          role.accountStatus !== "active" ||
          !who.token.email_verified ||
          asset?.status !== "awaiting_upload" ||
          asset.expiresAt.toMillis() <= Date.now() ||
          bytes.length !== asset.expectedBytes ||
          req.headers["content-type"] !== asset.declaredContentType
        )
          throw new Error("Invalid upload");
        await getStorage()
          .bucket()
          .file(uploadPath)
          .save(bytes, {
            resumable: false,
            preconditionOpts: { ifGenerationMatch: 0 },
            metadata: { contentType: asset.declaredContentType },
          });
        return json(res, 200, { ok: true });
      }
      const input = JSON.parse((await body(req, 2e6)).toString() || "{}");
      if (method === "login" || method === "register") {
        if (method === "register")
          await auth.createUser({
            email: input.email,
            password: input.password,
            displayName: input.name,
            emailVerified: false,
          });
        const reply = await fetch(
          "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: input.email,
              password: input.password,
              returnSecureToken: true,
            }),
          },
        );
        const data = await reply.json();
        if (!reply.ok) throw new Error(data.error?.message || "Sign-in failed");
        const sid = randomUUID();
        sessions.set(sid, data.idToken);
        res.setHeader(
          "Set-Cookie",
          `qaSession=${sid}; Path=/; HttpOnly; SameSite=Strict`,
        );
        return json(res, 200, { ok: true });
      }
      if (method === "logout") {
        res.setHeader(
          "Set-Cookie",
          "qaSession=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0",
        );
        return json(res, 200, { ok: true });
      }
      if (method === "session") {
        if (!who)
          return json(res, 200, {
            user: null,
            profile: null,
            role: "student",
            accountStatus: "active",
            capabilities: { teach: false, admin: false },
          });
        const reply = await dispatch(db, who, {
          apiVersion: 2,
          action: "getSessionInfo",
        });
        return json(res, 200, {
          ...reply.data,
          user: {
            uid: who.uid,
            email: who.token.email,
            emailVerified: who.token.email_verified,
            displayName: reply.data.profile.displayName,
          },
        });
      }
      if (method === "api") {
        const reply = await dispatch(db, who, input);
        json(res, 200, rewrite(reply));
        if (reply.data?.jobId)
          runJob(db, reply.data.jobId).catch(console.error);
        return;
      }
      if (method === "reset" || method === "verify")
        return json(res, 200, { ok: true });
      return json(res, 404, { message: "Unknown QA endpoint" });
    }
    const route = url.pathname === "/" ? "/index.html" : url.pathname;
    const file =
      route === "/js/firebase-client.js"
        ? path.join(root, "tests/qa/client.js")
        : path.resolve(root, "." + decodeURIComponent(route));
    if (!file.startsWith(root) || !(await stat(file)).isFile())
      throw new Error("Not found");
    if (
      route.startsWith("/functions/") ||
      route.startsWith("/node_modules/") ||
      route.startsWith("/scripts/")
    )
      throw new Error("Private test resource");
    res.writeHead(200, {
      "Content-Type": types[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(await readFile(file));
  } catch (e) {
    json(res, 400, { message: e.message, code: e.code, reason: e.reason });
  }
});
const timer = setInterval(() => {
  if (ready) sweep(db).catch(console.error);
}, 30000);
for (const sig of ["SIGINT", "SIGTERM"])
  process.on(sig, () => {
    clearInterval(timer);
    emulators.kill("SIGINT");
    server.close(() => process.exit());
  });
server.listen(Number(process.env.PORT || 4173), "0.0.0.0", () =>
  console.log("QA frontend ready; waiting for emulator fixtures"),
);
