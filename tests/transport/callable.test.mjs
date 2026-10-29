import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { initializeApp, deleteApp } from "firebase/app";
import {
  getAuth,
  connectAuthEmulator,
  signInWithEmailAndPassword,
} from "firebase/auth";
import {
  getFunctions,
  connectFunctionsEmulator,
  httpsCallable,
} from "firebase/functions";
import { createRequire } from "node:module";
import { once } from "node:events";
import { api as callable } from "../../functions/src/index.js";
import { runJob } from "../../functions/src/jobs/worker.js";
import { getAuth as adminAuth } from "../../functions/node_modules/firebase-admin/lib/esm/auth/index.js";
import { getFirestore } from "../../functions/node_modules/firebase-admin/lib/esm/firestore/index.js";
assert(
  process.env.FIREBASE_AUTH_EMULATOR_HOST &&
    process.env.FIRESTORE_EMULATOR_HOST,
);
const express = createRequire(
  new URL("../../functions/package.json", import.meta.url),
)("express");
test("Real Auth tokens reach the callable HTTP wrapper; roles and publication worker apply", async () => {
  const httpApp = express();
  httpApp.use(express.json());
  httpApp.post("/demo-mathquiz-v2/europe-west1/api", callable);
  const server = httpApp.listen(0, "127.0.0.1");
  await once(server, "listening");
  const app = initializeApp({
      projectId: "demo-mathquiz-v2",
      apiKey: "demo-key",
      appId: "demo-app",
    }),
    auth = getAuth(app),
    functions = getFunctions(app, "europe-west1");
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFunctionsEmulator(functions, "127.0.0.1", server.address().port);
  const call = async (action, data = {}) =>
    (
      await httpsCallable(
        functions,
        "api",
      )({ apiVersion: 2, action, requestId: randomUUID(), ...data })
    ).data.data;
  try {
    const publicData = await call("listPublicQuizzes");
    assert(Array.isArray(publicData.items));
    await assert.rejects(
      call("createQuiz", { title: "Unauthorized" }),
      (e) => e.code === "functions/unauthenticated",
    );
    await adminAuth().createUser({
      uid: "transport_teacher",
      email: "transport@example.test",
      emailVerified: true,
      password: "Testing123!",
    });
    await signInWithEmailAndPassword(
      auth,
      "transport@example.test",
      "Testing123!",
    );
    assert.equal((await call("getSessionInfo")).role, "student");
    await getFirestore()
      .doc("roles/transport_teacher")
      .set({ role: "teacher", accountStatus: "active", version: 2 });
    assert.equal((await call("getSessionInfo")).role, "teacher");
    const problem = await call("createProblem", {
      metadata: {
        title: "Transport check",
        subject: "Algebra",
        difficulty: "Practice",
        tags: [],
        bankVisibility: "private",
      },
      content: {
        type: "open",
        answerMode: "auto",
        statementLatex: "$1+1=?$",
        options: [],
        defaultPoints: 1,
        questionAssetBindings: {},
      },
      grading: {
        correctOptionId: null,
        acceptedAnswers: ["2"],
        tolerance: 0,
        explanationLatex: "$2$",
        rubricLatex: "",
        solutionAssetBindings: {},
      },
    });
    const quiz = await call("createQuiz", { title: "Callable publication" });
    const saved = await call("saveQuizDraft", {
      quizId: quiz.quizId,
      expectedDraftVersion: 1,
      upsertItems: [
        {
          clientKey: "one",
          problemId: problem.problemId,
          problemRevisionId: problem.revisionId,
          points: 1,
        },
      ],
      itemOrder: ["one"],
    });
    const publication = await call("publishQuiz", {
      quizId: quiz.quizId,
      expectedVersion: saved.version,
      expectedDraftVersion: saved.draftVersion,
    });
    assert(await runJob(getFirestore(), publication.jobId));
    let job;
    for (let i = 0; i < 40; i++) {
      job = await call("getJob", { jobId: publication.jobId });
      if (["failed", "succeeded"].includes(job.status)) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    assert.equal(job.status, "succeeded", JSON.stringify(job.error));
    await getFirestore()
      .doc("roles/transport_teacher")
      .update({ role: "student", version: 3 });
    await assert.rejects(
      call("createQuiz", { title: "Revoked" }),
      (e) => e.details.reason === "ROLE_REQUIRED",
    );
  } finally {
    await deleteApp(app);
    server.close();
  }
});
