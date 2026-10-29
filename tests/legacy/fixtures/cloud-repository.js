import {
  validateQuiz,
  imageReferences,
  resolveAsset,
  gradeAttempt,
  elapsedSeconds,
} from "../../../shared/legacy-core.js";
import { quizMetadata } from "./published-catalog.js";
import { getFirebaseServices, getSession } from "./firebase-client.js";

// Firestore documents are limited to 1 MiB. Keep room for field names and metadata.
export const MAX_CLOUD_BYTES = 900_000;
export function isCloudId(id) {
  return /^cloud-[A-Za-z0-9_-]{10,90}$/.test(String(id));
}
const milliseconds = (value) =>
  typeof value?.toMillis === "function"
    ? value.toMillis()
    : Number(value?.seconds ? value.seconds * 1000 : value) || 0;
export function normalizedMetadata(data) {
  return {
    ...data,
    source: "firebase",
    local: false,
    updatedAt: milliseconds(data.updatedAt),
    createdAt: milliseconds(data.createdAt),
  };
}

export function createCloudRepository(c) {
  const { auth, db, firestoreSDK: f } = c;
  const metaRef = (id) => f.doc(db, "quizzes", id);
  const contentRef = (id) => f.doc(db, "quizzes", id, "content", "main");
  async function authorize() {
    const user = auth.currentUser;
    if (!user) throw new Error("Sign in before uploading.");
    if (!user.emailVerified)
      throw new Error("Verify your email before uploading quizzes.");
    const role = await f.getDocFromServer(f.doc(db, "roles", user.uid));
    if (auth.currentUser?.uid !== user.uid)
      throw new Error("The account changed. Sign in again before uploading.");
    if (!role.exists() || !["teacher", "admin"].includes(role.data().role))
      throw new Error(
        "Upload permission has not been enabled for this account.",
      );
    return user;
  }
  async function metadata(id) {
    if (!isCloudId(id)) throw new Error("Invalid quiz ID.");
    const snapshot = await f.getDoc(metaRef(id));
    if (!snapshot.exists())
      throw new Error("This quiz was removed or is unavailable.");
    return normalizedMetadata({ ...snapshot.data(), id });
  }
  async function ownSnapshot(id, user) {
    if (!isCloudId(id)) throw new Error("Invalid quiz ID.");
    const snapshot = await f.getDocFromServer(metaRef(id));
    if (!snapshot.exists())
      throw new Error("This quiz was removed or is unavailable.");
    if (snapshot.data().ownerId !== user.uid)
      throw new Error("Only the quiz owner can change it.");
    return snapshot.data();
  }
  async function listPublished() {
    const query = f.query(
      f.collection(db, "quizzes"),
      f.where("status", "==", "published"),
      f.limit(200),
    );
    const result = await f.getDocs(query);
    return result.docs
      .map((doc) => normalizedMetadata({ ...doc.data(), id: doc.id }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }
  async function listOwn() {
    if (!auth.currentUser) return [];
    const query = f.query(
      f.collection(db, "quizzes"),
      f.where("ownerId", "==", auth.currentUser.uid),
      f.limit(200),
    );
    const result = await f.getDocs(query);
    return result.docs
      .map((doc) => normalizedMetadata({ ...doc.data(), id: doc.id }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }
  async function loadQuiz(id) {
    await metadata(id);
    const snapshot = await f.getDoc(contentRef(id));
    if (!snapshot.exists()) throw new Error("The quiz content is unavailable.");
    const json = snapshot.data().json;
    if (
      typeof json !== "string" ||
      new TextEncoder().encode(json).length > MAX_CLOUD_BYTES
    )
      throw new Error("The quiz content is invalid.");
    const quiz = validateQuiz(JSON.parse(json));
    if (quiz.id !== id)
      throw new Error("The quiz content and its catalog entry do not match.");
    return quiz;
  }
  async function uploadQuiz({
    quiz: input,
    status = "published",
    existingId = null,
  }) {
    const user = await authorize();
    if (!["draft", "published"].includes(status))
      throw new Error("Choose Published or Private draft.");
    const previous = existingId ? await ownSnapshot(existingId, user) : null;
    const id = existingId || `cloud-${f.doc(f.collection(db, "quizzes")).id}`;
    const quiz = validateQuiz({ ...input, id });
    const missing = imageReferences(quiz).filter(
      (name) => !resolveAsset(quiz.assets, name),
    );
    if (missing.length)
      throw new Error(
        `Attach the missing images first: ${missing.join(", ")}.`,
      );
    const json = JSON.stringify(quiz),
      sizeBytes = new TextEncoder().encode(json).length;
    if (sizeBytes > MAX_CLOUD_BYTES)
      throw new Error(
        "The quiz must be under 900 KB to upload. Compress its images or split it into smaller quizzes. You can still export the original file.",
      );
    if (auth.currentUser?.uid !== user.uid)
      throw new Error("The account changed. Sign in again before uploading.");
    const data = {
      ...quizMetadata(quiz, `${id}.quiz.json`),
      ownerId: user.uid,
      ownerName: (user.displayName || "").slice(0, 100),
      status,
      sizeBytes,
      createdAt: previous ? previous.createdAt : f.serverTimestamp(),
      updatedAt: f.serverTimestamp(),
    };
    // Both documents commit together: a failed write leaves the old quiz intact.
    const batch = f.writeBatch(db);
    batch.set(metaRef(id), data);
    batch.set(contentRef(id), { json, updatedAt: f.serverTimestamp() });
    await batch.commit();
    return normalizedMetadata({ ...data, id });
  }
  async function setStatus(id, status) {
    if (!["draft", "published"].includes(status))
      throw new Error("Invalid visibility.");
    const user = await authorize();
    await ownSnapshot(id, user);
    await f.updateDoc(metaRef(id), { status, updatedAt: f.serverTimestamp() });
  }
  async function removeQuiz(id) {
    const user = await authorize();
    await ownSnapshot(id, user);
    const batch = f.writeBatch(db);
    batch.delete(contentRef(id));
    batch.delete(metaRef(id));
    await batch.commit();
  }
  async function saveResult(quiz, attempt, expectedOwner = null) {
    const user = auth.currentUser;
    if (!user) throw new Error("Sign in to save results to an account.");
    if (expectedOwner && user.uid !== expectedOwner)
      throw new Error("The account changed before the result could be saved.");
    if (!attempt.submittedAt)
      throw new Error("Submit the quiz before syncing a result.");
    const graded = gradeAttempt(quiz, attempt);
    const data = {
      quizId: quiz.id,
      quizTitle: quiz.title,
      attemptId: attempt.id,
      startedAt: attempt.startedAt,
      submittedAt: attempt.submittedAt,
      timedOut: Boolean(attempt.timedOut),
      timeTakenSeconds: elapsedSeconds(attempt),
      score: graded.score,
      possible: graded.possible,
      correct: graded.correct,
      incorrect: graded.incorrect,
      skipped: graded.skipped,
      pending: graded.pending,
      partial: graded.partial,
      answers: attempt.answers,
      manualScores: attempt.manualScores || {},
      answersOmitted: false,
      updatedAt: f.serverTimestamp(),
    };
    if (
      new TextEncoder().encode(JSON.stringify({ ...data, updatedAt: null }))
        .length > 800_000
    ) {
      data.answers = {};
      data.manualScores = {};
      data.answersOmitted = true;
    }
    await f.setDoc(f.doc(db, "users", user.uid, "attempts", attempt.id), data);
    return data;
  }
  async function results() {
    if (!auth.currentUser) return [];
    const q = f.query(
      f.collection(db, "users", auth.currentUser.uid, "attempts"),
      f.orderBy("submittedAt", "desc"),
      f.limit(30),
    );
    const response = await f.getDocs(q);
    return response.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
  }
  return {
    metadata,
    listPublished,
    listOwn,
    loadQuiz,
    uploadQuiz,
    setStatus,
    removeQuiz,
    saveResult,
    results,
  };
}
export async function cloudRepository() {
  return createCloudRepository(await getFirebaseServices());
}
export const firebaseIsConfigured = () =>
  !["unconfigured", "error"].includes(getSession().status);
