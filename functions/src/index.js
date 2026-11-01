import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { dispatch } from "./router.js";
import { runJob } from "./jobs/worker.js";
import { sweep } from "./jobs/sweeper.js";
import { REGION, ENFORCE_APP_CHECK } from "./config.js";
initializeApp();
const db = getFirestore();
const errorCodes = {
  AUTH_REQUIRED: "unauthenticated",
  EMAIL_UNVERIFIED: "permission-denied",
  ACCOUNT_DISABLED: "permission-denied",
  ROLE_REQUIRED: "permission-denied",
  RESOURCE_UNAVAILABLE: "not-found",
  INVALID_FIELDS: "invalid-argument",
  VERSION_CONFLICT: "aborted",
  QUOTA_EXCEEDED: "resource-exhausted",
  RATE_LIMITED: "resource-exhausted",
};
export const api = onCall(
  {
    region: REGION,
    memory: "512MiB",
    timeoutSeconds: 120,
    maxInstances: 10,
    enforceAppCheck: ENFORCE_APP_CHECK,
  },
  async (request) => {
    try {
      return await dispatch(db, request.auth, request.data);
    } catch (error) {
      if (error.reason)
        throw new HttpsError(
          errorCodes[error.reason] ?? "failed-precondition",
          error.message,
          { reason: error.reason, ...error.details },
        );
      console.error("api_failed", {
        action: request.data?.action,
        code: error.code ?? "internal",
        message: String(error.message).slice(0, 300),
      });
      throw new HttpsError(
        "internal",
        "The request could not be completed. Please retry.",
      );
    }
  },
);
export const processJob = onDocumentWritten(
  {
    document: "jobs/{jobId}",
    region: REGION,
    memory: "1GiB",
    timeoutSeconds: 540,
    maxInstances: 5,
    retry: true,
  },
  async (event) => {
    const after = event.data?.after.data(),
      before = event.data?.before.data();
    if (after?.status === "queued" && before?.status !== "queued")
      await runJob(db, event.params.jobId);
  },
);
export const scheduledMaintenance = onSchedule(
  {
    schedule: "every 1 minutes",
    region: REGION,
    memory: "1GiB",
    timeoutSeconds: 540,
    maxInstances: 1,
  },
  () => sweep(db),
);
