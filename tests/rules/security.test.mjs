import test, { after, before } from "node:test";
import { readFile } from "node:fs/promises";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import {
  doc,
  setDoc,
  getDoc,
  collection,
  getDocs,
  query,
  limit,
  Timestamp,
} from "firebase/firestore";
import {
  ref,
  uploadBytes,
  getBytes,
  listAll,
  deleteObject,
} from "firebase/storage";
let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-mathquiz-v2",
    firestore: {
      rules: await readFile(
        new URL("../../firebase/firestore.rules", import.meta.url),
        "utf8",
      ),
    },
    storage: {
      rules: await readFile(
        new URL("../../firebase/storage.rules", import.meta.url),
        "utf8",
      ),
    },
  });
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, "roles/rule_teacher"), {
      role: "teacher",
      accountStatus: "active",
      version: 1,
    });
    await setDoc(doc(db, "roles/rule_student"), {
      role: "student",
      accountStatus: "active",
      version: 1,
    });
    await setDoc(doc(db, "roles/rule_disabled"), {
      role: "teacher",
      accountStatus: "disabled",
      version: 1,
    });
    await setDoc(doc(db, "users/rule_teacher"), { displayName: "Teacher" });
    await setDoc(doc(db, "catalog/rule_public"), { title: "Public overview" });
    await setDoc(doc(db, "quizzes/rule_private"), { ownerId: "rule_teacher" });
    await setDoc(doc(db, "quizzes/rule_private/revisions/r1/grading/i1"), {
      correctOptionId: "a",
    });
    await setDoc(doc(db, "attempts/rule_attempt"), {
      studentId: "rule_student",
    });
    await setDoc(doc(db, "assets/rule_asset"), {
      ownerId: "rule_teacher",
      status: "awaiting_upload",
      expectedBytes: 4,
      declaredContentType: "image/png",
      stagingPath: "staging/rule_teacher/rule_asset/original",
      expiresAt: Timestamp.fromMillis(Date.now() + 60000),
    });
  });
});
after(async () => env?.cleanup());
const context = (uid, verified = true) =>
  env.authenticatedContext(uid, { email_verified: verified });
test("Guests can read bounded public catalog; unbounded queries are denied", async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(db, "catalog/rule_public")));
  await assertSucceeds(getDocs(query(collection(db, "catalog"), limit(25))));
  await assertFails(getDocs(collection(db, "catalog")));
});
test("Private records, answer keys, raw attempts and histories reject direct reads", async () => {
  for (const uid of ["rule_student", "rule_teacher"]) {
    const db = context(uid).firestore();
    for (const p of [
      "quizzes/rule_private",
      "quizzes/rule_private/revisions/r1/grading/i1",
      "attempts/rule_attempt",
      "attempts/rule_attempt/answers/i1",
      "quizzes/rule_private/content/main",
    ])
      await assertFails(getDoc(doc(db, p)));
  }
});
test("No client can forge roles, quiz metadata, scores, access grants or audit", async () => {
  for (const uid of ["rule_student", "rule_teacher"])
    for (const p of [
      "roles/" + uid,
      "quizzes/rule_private",
      "attempts/rule_attempt",
      "quizzes/rule_private/participants/rule_student",
      "auditEvents/forged",
      "users/" + uid + "/attempts/forged",
    ])
      await assertFails(
        setDoc(doc(context(uid).firestore(), p), { role: "admin", score: 100 }),
      );
});
test("Only own profile and role are directly readable; profile writes are denied", async () => {
  const db = context("rule_teacher").firestore();
  await assertSucceeds(getDoc(doc(db, "roles/rule_teacher")));
  await assertSucceeds(getDoc(doc(db, "users/rule_teacher")));
  await assertFails(getDoc(doc(db, "roles/rule_student")));
  await assertFails(
    setDoc(doc(db, "users/rule_teacher"), { displayName: "Forged" }),
  );
});
test("Staging requires verified staff, matching reservation and immutable bytes", async () => {
  const bytes = Uint8Array.from([1, 2, 3, 4]),
    path = "staging/rule_teacher/rule_asset/original";
  await assertFails(
    uploadBytes(ref(context("rule_student").storage(), path), bytes, {
      contentType: "image/png",
    }),
  );
  await assertFails(
    uploadBytes(ref(context("rule_teacher", false).storage(), path), bytes, {
      contentType: "image/png",
    }),
  );
  await assertFails(
    uploadBytes(ref(context("rule_teacher").storage(), path), bytes, {
      contentType: "text/plain",
    }),
  );
  await assertFails(
    uploadBytes(
      ref(context("rule_teacher").storage(), path),
      new Uint8Array(5),
      { contentType: "image/png" },
    ),
  );
  await assertSucceeds(
    uploadBytes(ref(context("rule_teacher").storage(), path), bytes, {
      contentType: "image/png",
    }),
  );
  await assertFails(
    uploadBytes(ref(context("rule_teacher").storage(), path), bytes, {
      contentType: "image/png",
    }),
  );
  await assertFails(getBytes(ref(context("rule_teacher").storage(), path)));
  await assertFails(
    listAll(ref(context("rule_teacher").storage(), "staging/rule_teacher")),
  );
  await assertFails(deleteObject(ref(context("rule_teacher").storage(), path)));
  await assertFails(
    getBytes(
      ref(
        context("rule_teacher").storage(),
        "assets/rule_teacher/rule_asset/image.png",
      ),
    ),
  );
});
