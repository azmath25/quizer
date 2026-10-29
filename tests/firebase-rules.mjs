import fs from "node:fs/promises";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  serverTimestamp,
  updateDoc,
  writeBatch,
  deleteDoc,
} from "firebase/firestore";
const root =
  process.env.QUIZ_PROJECT_ROOT ||
  new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const env = await initializeTestEnvironment({
  projectId: "demo-mathquiz",
  firestore: {
    host: "127.0.0.1",
    port: 8080,
    rules: await fs.readFile(root + "/firebase/firestore.rules", "utf8"),
  },
});
let checks = 0;
const pass = async (p) => {
  await assertSucceeds(p);
  checks++;
};
const fail = async (p) => {
  await assertFails(p);
  checks++;
};
function equal(a, b) {
  if (a !== b) throw new Error(`Expected ${b}, got ${a}`);
  checks++;
}
try {
  const teacher = env.authenticatedContext("teacher-one", {
    email_verified: true,
  });
  const other = env.authenticatedContext("teacher-two", {
    email_verified: true,
  });
  const student = env.authenticatedContext("student-one", {
    email_verified: true,
  });
  const unverified = env.authenticatedContext("teacher-unverified", {
    email_verified: false,
  });
  const guest = env.unauthenticatedContext();
  await env.withSecurityRulesDisabled(async (c) => {
    for (const id of ["teacher-one", "teacher-two", "teacher-unverified"])
      await setDoc(doc(c.firestore(), "roles", id), { role: "teacher" });
  });
  await pass(getDoc(doc(teacher.firestore(), "roles", "teacher-one")));
  await fail(getDoc(doc(student.firestore(), "roles", "teacher-one")));
  await fail(
    setDoc(doc(student.firestore(), "roles", "student-one"), {
      role: "teacher",
    }),
  );
  const id = "cloud-abcdefghijklmnopqrst";
  const quiz = {
    id,
    file: id + ".quiz.json",
    title: "Test",
    description: "",
    subject: "Math",
    difficulty: "Mixed",
    durationMinutes: 10,
    questionCount: 1,
    points: 2,
    openCount: 1,
    choiceCount: 0,
    ownerId: "teacher-one",
    ownerName: "Teacher",
    status: "draft",
    sizeBytes: 20,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  const content = { json: '{"schemaVersion":1}', updatedAt: serverTimestamp() };
  const publish = async (context, metadata = quiz, value = content) => {
    const db = context.firestore(),
      batch = writeBatch(db);
    batch.set(doc(db, "quizzes", id), metadata);
    batch.set(doc(db, "quizzes", id, "content", "main"), value);
    await batch.commit();
  };
  await fail(publish(student, { ...quiz, ownerId: "student-one" }));
  await fail(publish(unverified, { ...quiz, ownerId: "teacher-unverified" }));
  await pass(publish(teacher));
  await pass(getDoc(doc(teacher.firestore(), "quizzes", id)));
  await pass(
    getDoc(doc(teacher.firestore(), "quizzes", id, "content", "main")),
  );
  await fail(getDoc(doc(guest.firestore(), "quizzes", id)));
  await fail(getDoc(doc(guest.firestore(), "quizzes", id, "content", "main")));
  await fail(getDoc(doc(other.firestore(), "quizzes", id, "content", "main")));
  await fail(
    updateDoc(doc(other.firestore(), "quizzes", id), {
      status: "published",
      updatedAt: serverTimestamp(),
    }),
  );
  await fail(
    updateDoc(doc(teacher.firestore(), "quizzes", id), {
      ownerId: "teacher-two",
      updatedAt: serverTimestamp(),
    }),
  );
  await fail(getDocs(collection(guest.firestore(), "quizzes")));
  await pass(
    getDocs(
      query(
        collection(teacher.firestore(), "quizzes"),
        where("ownerId", "==", "teacher-one"),
      ),
    ),
  );
  await fail(
    updateDoc(doc(teacher.firestore(), "quizzes", id, "content", "main"), {
      json: "changed",
      updatedAt: serverTimestamp(),
    }),
  );
  const before = (await getDoc(doc(teacher.firestore(), "quizzes", id))).data();
  await fail(
    publish(
      teacher,
      { ...before, title: "Must not commit", updatedAt: serverTimestamp() },
      { json: 42, updatedAt: serverTimestamp() },
    ),
  );
  equal(
    (await getDoc(doc(teacher.firestore(), "quizzes", id))).data().title,
    "Test",
  );
  await fail(
    publish(
      teacher,
      { ...before, updatedAt: serverTimestamp() },
      { json: "x".repeat(900001), updatedAt: serverTimestamp() },
    ),
  );
  await pass(
    updateDoc(doc(teacher.firestore(), "quizzes", id), {
      status: "published",
      updatedAt: serverTimestamp(),
    }),
  );
  await pass(getDoc(doc(guest.firestore(), "quizzes", id)));
  await pass(
    getDocs(
      query(
        collection(guest.firestore(), "quizzes"),
        where("status", "==", "published"),
      ),
    ),
  );
  await pass(getDoc(doc(guest.firestore(), "quizzes", id, "content", "main")));
  await fail(getDocs(collection(guest.firestore(), "quizzes", id, "content")));
  await fail(
    setDoc(doc(other.firestore(), "quizzes", id, "content", "main"), content),
  );
  await pass(
    updateDoc(doc(teacher.firestore(), "quizzes", id), {
      status: "draft",
      updatedAt: serverTimestamp(),
    }),
  );
  await fail(getDoc(doc(guest.firestore(), "quizzes", id, "content", "main")));
  const result = {
    quizId: id,
    quizTitle: "Test",
    attemptId: "attempt-one",
    startedAt: 1,
    submittedAt: 2,
    timedOut: false,
    timeTakenSeconds: 1,
    score: 2,
    possible: 2,
    correct: 1,
    incorrect: 0,
    skipped: 0,
    pending: 0,
    partial: 0,
    answers: { q1: "4" },
    manualScores: {},
    answersOmitted: false,
    updatedAt: serverTimestamp(),
  };
  await pass(
    setDoc(
      doc(
        student.firestore(),
        "users",
        "student-one",
        "attempts",
        "attempt-one",
      ),
      result,
    ),
  );
  await fail(
    getDoc(
      doc(
        teacher.firestore(),
        "users",
        "student-one",
        "attempts",
        "attempt-one",
      ),
    ),
  );
  await fail(
    setDoc(
      doc(guest.firestore(), "users", "student-one", "attempts", "attempt-one"),
      result,
    ),
  );
  await fail(
    setDoc(
      doc(
        student.firestore(),
        "users",
        "student-one",
        "attempts",
        "attempt-one",
      ),
      { ...result, score: 100 },
    ),
  );
  const batch = writeBatch(teacher.firestore());
  batch.delete(doc(teacher.firestore(), "quizzes", id, "content", "main"));
  batch.delete(doc(teacher.firestore(), "quizzes", id));
  await pass(batch.commit());
  equal(
    (await getDoc(doc(teacher.firestore(), "quizzes", id))).exists(),
    false,
  );
  await env.withSecurityRulesDisabled(async (c) =>
    deleteDoc(doc(c.firestore(), "roles", "teacher-one")),
  );
  await fail(publish(teacher));
  console.log(`PASS: ${checks} Firestore security checks`);
} finally {
  await env.cleanup();
}
