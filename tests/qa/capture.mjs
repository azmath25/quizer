// Capture real emulator API responses for read-only visual QA when Java cannot
// run inside the managed preview process. No production data is used.
import { seed } from "../../scripts/seed-emulators.mjs";
import { getFirestore } from "../../functions/node_modules/firebase-admin/lib/esm/firestore/index.js";
import { getStorage } from "../../functions/node_modules/firebase-admin/lib/esm/storage/index.js";
import { dispatch } from "../../functions/src/router.js";
import { writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
const seeded = await seed(),
  db = getFirestore(),
  out = { sessions: {}, calls: {}, assets: {}, seeded };
const people = {
  teacher: {
    uid: "qa_teacher",
    email: "teacher@example.test",
    name: "Maya Chen",
  },
  student: {
    uid: "qa_student",
    email: "student@example.test",
    name: "Alex Morgan",
  },
  admin: {
    uid: "qa_admin",
    email: "admin@example.test",
    name: "Site administrator",
  },
  guest: null,
};
for (const [role, person] of Object.entries(people)) {
  const actor = person
    ? {
        uid: person.uid,
        token: { email: person.email, email_verified: true, name: person.name },
      }
    : null;
  out.calls[role] = {};
  const call = async (action, input = {}) => {
    const reply = await dispatch(db, actor, {
      apiVersion: 2,
      action,
      requestId: randomUUID(),
      ...input,
    });
    const scope =
      input.quizId ?? input.problemId ?? input.attemptId ?? "default";
    (out.calls[role][action] ??= {})[scope] = reply;
    return reply.data;
  };
  if (person) {
    const session = await call("getSessionInfo");
    out.sessions[role] = {
      ...session,
      user: {
        uid: person.uid,
        email: person.email,
        emailVerified: true,
        displayName: person.name,
      },
    };
  } else
    out.sessions[role] = {
      user: null,
      profile: null,
      role: "student",
      accountStatus: "active",
      capabilities: { teach: false, admin: false },
    };
  for (const action of [
    "getDashboard",
    "listPublicQuizzes",
    ...(person
      ? [
          "listMyAttempts",
          "listMyApplications",
          "listAvailableQuizzes",
          "listMyNotifications",
        ]
      : []),
    ...(["teacher", "admin"].includes(role)
      ? [
          "listMyQuizzes",
          "listProblems",
          "getUploadUsage",
          "listTeacherRequests",
          "listTeacherAttempts",
        ]
      : []),
    ...(role === "admin" ? ["listUsers", "listActivity", "listJobs"] : []),
  ]) {
    try {
      await call(action);
    } catch (error) {
      console.log("Optional capture:", action, error.message);
    }
  }
  if (role === "admin")
    await call("adminListContent", { type: "quizzes" }).catch(() => {});
  for (const q of seeded.quizzes) {
    try {
      await call("getQuizOverview", { quizId: q.id });
    } catch {}
    if (!["teacher", "admin"].includes(role)) continue;
    const draft = await call("getQuizDraft", { quizId: q.id });
    await call("getQuizDraftItems", {
      quizId: q.id,
      itemIds: draft.draft.itemOrder,
    });
    await call("listQuizRevisions", { quizId: q.id });
    await call("listQuizAttempts", { quizId: q.id });
    await call("getQuizHistory", { quizId: q.id });
    await call("listAccessRequests", { quizId: q.id });
    await call("listJoinLinks", { quizId: q.id });
    await call("getQuizStatistics", {
      quizId: q.id,
      revisionId: q.revisionId,
    }).catch(() => {});
    for (const slot of draft.items)
      await call("getProblem", { problemId: slot.problemId });
  }
  if (person)
    await call(role === "admin" ? "getAdminAttempt" : "getAttemptResult", {
      attemptId: seeded.attemptId,
    });
}
const student = people.student,
  actor = {
    uid: student.uid,
    token: { email: student.email, email_verified: true, name: student.name },
  };
const started = (
  await dispatch(db, actor, {
    apiVersion: 2,
    action: "startAttempt",
    requestId: randomUUID(),
    quizId: seeded.quizzes[0].id,
  })
).data;
const active = await dispatch(db, actor, {
  apiVersion: 2,
  action: "getAttempt",
  attemptId: started.attemptId,
});
const items = await dispatch(db, actor, {
  apiVersion: 2,
  action: "getAttemptQuestions",
  attemptId: started.attemptId,
  itemIds: active.data.order,
});
out.calls.student.getAttempt = { [started.attemptId]: active };
out.calls.student.getAttemptQuestions = { [started.attemptId]: items };
out.seeded.activeAttemptId = started.attemptId;
out.calls.student.getDashboard.default = await dispatch(db, actor, {
  apiVersion: 2,
  action: "getDashboard",
});
const assets = await db
  .collection("assets")
  .where("status", "==", "ready")
  .get();
await mkdir(new URL("./generated-images/", import.meta.url), {
  recursive: true,
});
for (const asset of assets.docs) {
  const data = asset.data(),
    [bytes] = await getStorage().bucket().file(data.storagePath).download();
  const name = asset.id + ".png";
  await writeFile(
    new URL("./generated-images/" + name, import.meta.url),
    bytes,
  );
  out.assets[asset.id] = "/tests/qa/generated-images/" + name;
}
await writeFile(
  new URL("./generated.json", import.meta.url),
  JSON.stringify(out),
);
console.log("Captured emulator responses for visual QA.");
