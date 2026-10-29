import test from "node:test";
import assert from "node:assert/strict";
import {
  parseFirebaseConfig,
  resolveFirebaseConfig,
  canPublish,
  canCreateQuiz,
  safeReturnURL,
} from "./legacy/fixtures/firebase-core.js";
import {
  createCloudRepository,
  isCloudId,
  normalizedMetadata,
  MAX_CLOUD_BYTES,
} from "./legacy/fixtures/cloud-repository.js";
import { validateQuiz, makeAttempt } from "../js/core.js";

const config = {
  apiKey: "AIzaPublicExample123456789",
  authDomain: "quiz-demo.firebaseapp.com",
  projectId: "quiz-demo",
  appId: "1:123:web:456",
};
const sample = () =>
  validateQuiz({
    schemaVersion: 1,
    id: "local-quiz",
    title: "Arithmetic",
    questions: [
      { id: "q1", type: "open", prompt: "$2+2$", answers: ["4"], points: 2 },
    ],
  });
const cloudId = "cloud-abcdefghijklmnopqrst";
function mock({
  user = { uid: "teacher-one", displayName: "Teacher", emailVerified: true },
  role = "teacher",
  batchError = false,
} = {}) {
  const docs = new Map(),
    log = [],
    auth = { currentUser: user };
  const stamp = { toMillis: () => 1700000000000 };
  if (user && role) docs.set(`roles/${user.uid}`, { role });
  const snapshot = (path) => ({
    id: path.split("/").at(-1),
    exists: () => docs.has(path),
    data: () => docs.get(path),
  });
  const f = {
    doc(parent, ...parts) {
      return parts.length
        ? { path: parts.join("/") }
        : {
            path: `${parent.path}/abcdefghijklmnopqrst`,
            id: "abcdefghijklmnopqrst",
          };
    },
    collection: (_db, ...parts) => ({ path: parts.join("/") }),
    getDoc: async (ref) => {
      log.push(["get", ref.path]);
      return snapshot(ref.path);
    },
    getDocFromServer: async (ref) => f.getDoc(ref),
    setDoc: async (ref, value) => {
      log.push(["set", ref.path]);
      docs.set(ref.path, value);
    },
    updateDoc: async (ref, value) =>
      docs.set(ref.path, { ...docs.get(ref.path), ...value }),
    writeBatch() {
      const writes = [];
      return {
        set: (ref, value) => writes.push(["set", ref.path, value]),
        delete: (ref) => writes.push(["delete", ref.path]),
        commit: async () => {
          log.push(["commit", writes]);
          if (batchError) throw new Error("Commit failed");
          for (const [kind, path, value] of writes)
            kind === "set" ? docs.set(path, value) : docs.delete(path);
        },
      };
    },
    serverTimestamp: () => stamp,
    where: (...args) => ({ where: args }),
    limit: (n) => ({ limit: n }),
    orderBy: (...args) => ({ orderBy: args }),
    query: (collection, ...constraints) => ({ ...collection, constraints }),
    getDocs: async (query) => {
      log.push(["query", query]);
      return {
        docs: [...docs.keys()]
          .filter(
            (path) =>
              path.startsWith(query.path + "/") &&
              path.split("/").length === query.path.split("/").length + 1,
          )
          .filter((path) =>
            query.constraints.every(
              (c) => !c.where || docs.get(path)[c.where[0]] === c.where[2],
            ),
          )
          .map(snapshot),
      };
    },
  };
  return {
    auth,
    docs,
    log,
    f,
    repo: createCloudRepository({ auth, db: {}, firestoreSDK: f }),
  };
}

test("site Firebase config connects directly without a Storage bucket or device configuration", () => {
  assert.deepEqual(
    parseFirebaseConfig(
      `const firebaseConfig = {apiKey: "${config.apiKey}", authDomain: "${config.authDomain}", projectId: "${config.projectId}", appId: "${config.appId}",};`,
    ),
    config,
  );
  assert.equal(
    resolveFirebaseConfig(config, "ignored-device-value").source,
    "site",
  );
  assert.equal(resolveFirebaseConfig({}, JSON.stringify(config)).config, null);
});
test("rejects private keys, placeholders, malformed configuration and executable snippets", () => {
  for (const value of [
    { ...config, private_key: "secret" },
    { ...config, client_email: "admin" },
    { ...config, apiKey: "YOUR_API_KEY" },
    { ...config, authDomain: "https://host" },
    { ...config, appId: undefined },
    "alert('run')",
    "{apiKey: globalThis.key}",
  ])
    assert.throws(() => parseFirebaseConfig(value));
});
test("only approved and verified accounts see the authoring controls once connected", () => {
  for (const role of ["teacher", "admin"]) {
    const session = { status: "ready", user: { emailVerified: true }, role };
    assert.equal(canPublish(session), true);
    assert.equal(canCreateQuiz(session), true);
  }
  for (const session of [
    { status: "connecting" },
    { status: "error" },
    { status: "ready", user: null },
    { status: "ready", user: { emailVerified: false }, role: "teacher" },
    { status: "ready", user: { emailVerified: true }, role: "student" },
  ]) {
    assert.equal(canPublish(session), false);
    assert.equal(canCreateQuiz(session), false);
  }
  assert.equal(canCreateQuiz({ status: "unconfigured" }), true);
  assert.equal(canPublish({ status: "unconfigured" }), false);
});
test("return URLs stay within the same GitHub Pages app and allowed pages", () => {
  const page = "https://example.github.io/math/login.html";
  assert.equal(
    safeReturnURL("quiz.html?id=abc", page),
    "https://example.github.io/math/quiz.html?id=abc",
  );
  for (const input of [
    "https://evil.example",
    "//evil.example",
    "javascript:alert(1)",
    "../other/login.html",
    "/math/js/firebase-config.js",
    "settings.html",
  ])
    assert.equal(
      safeReturnURL(input, page),
      "https://example.github.io/math/index.html",
    );
});
test("cloud IDs and timestamp normalization reject ambiguous IDs and preserve metadata", () => {
  assert.equal(isCloudId(cloudId), true);
  for (const id of ["local", "cloud-short", "cloud-abcdefghijkl/../x"])
    assert.equal(isCloudId(id), false);
  assert.equal(
    normalizedMetadata({ updatedAt: { toMillis: () => 123 } }).updatedAt,
    123,
  );
});
test("uploads recheck authentication, verification and current permission before any write", async () => {
  for (const options of [
    { user: null },
    { user: { uid: "student", emailVerified: false } },
    { role: "student" },
    { role: null },
  ]) {
    const c = mock(options);
    await assert.rejects(c.repo.uploadQuiz({ quiz: sample() }));
    assert.equal(
      c.log.some((row) => row[0] === "commit"),
      false,
    );
  }
});
test("approved upload commits catalog and self-contained content in one atomic batch", async () => {
  const c = mock(),
    data = await c.repo.uploadQuiz({ quiz: sample(), status: "draft" });
  assert.equal(data.id, cloudId);
  assert.equal(data.ownerId, "teacher-one");
  assert.equal(data.status, "draft");
  assert.equal(c.log.filter((row) => row[0] === "commit").length, 1);
  assert.equal(c.log.find((row) => row[0] === "commit")[1].length, 2);
  assert.equal(
    JSON.parse(c.docs.get(`quizzes/${cloudId}/content/main`).json).id,
    cloudId,
  );
  assert.equal((await c.repo.loadQuiz(cloudId)).questions[0].answers[0], "4");
});
test("failed batch creates neither metadata nor content, and failed replacements leave both intact", async () => {
  const c = mock({ batchError: true });
  await assert.rejects(c.repo.uploadQuiz({ quiz: sample() }));
  assert.equal(c.docs.has(`quizzes/${cloudId}`), false);
  assert.equal(c.docs.has(`quizzes/${cloudId}/content/main`), false);
  const previous = {
    ownerId: "teacher-one",
    title: "Original",
    createdAt: 123,
  };
  c.docs.set(`quizzes/${cloudId}`, previous);
  c.docs.set(`quizzes/${cloudId}/content/main`, { json: "old-content" });
  await assert.rejects(
    c.repo.uploadQuiz({ quiz: sample(), existingId: cloudId }),
  );
  assert.equal(c.docs.get(`quizzes/${cloudId}`), previous);
  assert.equal(
    c.docs.get(`quizzes/${cloudId}/content/main`).json,
    "old-content",
  );
});
test("replacing an owned upload preserves creation time and updates its content", async () => {
  const c = mock();
  await c.repo.uploadQuiz({ quiz: sample() });
  const createdAt = c.docs.get(`quizzes/${cloudId}`).createdAt;
  const updated = await c.repo.uploadQuiz({
    quiz: { ...sample(), title: "Updated" },
    existingId: cloudId,
  });
  assert.equal(updated.title, "Updated");
  assert.equal(c.docs.get(`quizzes/${cloudId}`).createdAt, createdAt);
  assert.equal(
    JSON.parse(c.docs.get(`quizzes/${cloudId}/content/main`).json).title,
    "Updated",
  );
});
test("other approved users cannot replace uploads; switching accounts invalidates authorization", async () => {
  const c = mock();
  await c.repo.uploadQuiz({ quiz: sample() });
  c.docs.get(`quizzes/${cloudId}`).ownerId = "another-teacher";
  await assert.rejects(
    c.repo.uploadQuiz({ quiz: sample(), existingId: cloudId }),
    /owner/,
  );
  const originalGet = c.f.getDoc;
  c.f.getDoc = async (ref) => {
    const result = await originalGet(ref);
    c.auth.currentUser = { uid: "changed", emailVerified: true };
    return result;
  };
  await assert.rejects(
    c.repo.uploadQuiz({ quiz: sample() }),
    /account changed/,
  );
});
test("missing assets and payloads over the Firestore-safe size are rejected before writes", async () => {
  const c = mock(),
    quiz = sample();
  quiz.questions[0].prompt = String.raw`\includegraphics{missing.png}`;
  await assert.rejects(c.repo.uploadQuiz({ quiz }), /missing images/);
  const large = sample();
  large.questions[0].prompt = String.raw`\includegraphics{big.png}`;
  large.assets = {
    "big.png": "data:image/png;base64," + "a".repeat(MAX_CLOUD_BYTES),
  };
  await assert.rejects(c.repo.uploadQuiz({ quiz: large }), /900 KB/);
  assert.equal(
    c.log.some((row) => row[0] === "commit"),
    false,
  );
});
test("published queries exclude drafts; owners see their drafts and deletion removes both documents", async () => {
  const c = mock();
  await c.repo.uploadQuiz({ quiz: sample(), status: "draft" });
  assert.equal((await c.repo.listPublished()).length, 0);
  assert.equal((await c.repo.listOwn()).length, 1);
  await c.repo.setStatus(cloudId, "published");
  assert.equal((await c.repo.listPublished()).length, 1);
  await c.repo.removeQuiz(cloudId);
  assert.equal(c.docs.has(`quizzes/${cloudId}`), false);
  assert.equal(c.docs.has(`quizzes/${cloudId}/content/main`), false);
});
test("a mismatched content ID is rejected instead of starting the wrong quiz", async () => {
  const c = mock();
  await c.repo.uploadQuiz({ quiz: sample() });
  c.docs.set(`quizzes/${cloudId}/content/main`, {
    json: JSON.stringify(sample()),
  });
  await assert.rejects(c.repo.loadQuiz(cloudId), /do not match/);
});
test("only completed results sync to the captured account, and oversized answers omit content safely", async () => {
  const c = mock(),
    quiz = sample(),
    attempt = makeAttempt(quiz, {}, 1000);
  await assert.rejects(c.repo.saveResult(quiz, attempt), /Submit/);
  attempt.submittedAt = 31000;
  attempt.answers.q1 = "4";
  await assert.rejects(
    c.repo.saveResult(quiz, attempt, "another-user"),
    /account changed/,
  );
  const result = await c.repo.saveResult(quiz, attempt, "teacher-one");
  assert.equal(result.score, 2);
  assert.equal(result.correct, 1);
  assert.equal(c.docs.has(`users/teacher-one/attempts/${attempt.id}`), true);
  attempt.answers.q1 = "a".repeat(810000);
  const big = await c.repo.saveResult(quiz, attempt);
  assert.equal(big.answersOmitted, true);
  assert.deepEqual(big.answers, {});
});
