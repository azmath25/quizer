import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import { createProd1LiveRuntime } from "./prod1/live-factory.js";
import {
  createProd1EntrypointBridge,isProd1Enabled,
} from "./prod1/entrypoint-switch.js";
import { PROD1_RELEASE_APPROVED } from "./prod1/release-gate.js";
import { dispatch } from "./router.js";
import { runJob } from "./jobs/worker.js";
import { sweep } from "./jobs/sweeper.js";
import { REGION, ENFORCE_APP_CHECK } from "./config.js";
initializeApp();
const db = getFirestore();

// PROD1 remains hard OFF until a reviewed source change explicitly approves
// it. Environment settings cannot bypass that review. Unbound secrets are
// neither resolved nor required by the existing Firestore deployment.
const PROD1_ACTIVE=isProd1Enabled({
  releaseApproved:PROD1_RELEASE_APPROVED,
});
const NEON_URL=defineSecret("QUIZER_NEON_DATABASE_URL");
const BANK_CURSOR_KEY=defineSecret("QUIZER_BANK_CURSOR_KEY");
const PROD1_BOUND_SECRETS=PROD1_ACTIVE
  ? [NEON_URL,BANK_CURSOR_KEY]:[];
const prod1=createProd1EntrypointBridge({
  enabled:PROD1_ACTIVE,db,
  legacyDispatch:dispatch,
  legacyRunJob:runJob,
  runtimeFactory:createProd1LiveRuntime,
  readSecrets:()=>({
    databaseUrl:NEON_URL.value(),
    cursorKey:BANK_CURSOR_KEY.value(),
  }),
});
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
    secrets: PROD1_BOUND_SECRETS,
  },
  async (request) => {
    try {
      return await prod1.dispatch(request.auth, request.data);
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
    secrets: PROD1_BOUND_SECRETS,
  },
  async (event) => {
    const after = event.data?.after.data(),
      before = event.data?.before.data();
    if (after?.status === "queued" && before?.status !== "queued")
      await prod1.runJob(db, event.params.jobId);
  },
);
export const scheduledMaintenance = onSchedule(
  {
    schedule: "every 1 minutes",
    region: REGION,
    memory: "1GiB",
    timeoutSeconds: 540,
    maxInstances: 1,
    secrets: PROD1_BOUND_SECRETS,
  },
  () => sweep(db, {runJobImpl:prod1.runJob}),
);
