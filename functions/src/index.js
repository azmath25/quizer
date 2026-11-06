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
import { TeacherChatError } from "./mimo/teacher-chat.js";
import { createAiHub, aiHubErrorCode } from "./mimo/ai-hub.js";
initializeApp();
const db = getFirestore();

// P1-B: reviewed release approval AND an explicit project-pinned runtime flag
// are both required. Bind both secrets statically: Firebase loads dotenv
// values at runtime, not reliably during source analysis/deploy option evaluation.
// The getters below are invoked only for hybrid routes, never at module scope.
const PROD1_ACTIVE=isProd1Enabled({
  releaseApproved:PROD1_RELEASE_APPROVED,
});
const NEON_URL=defineSecret("QUIZER_NEON_DATABASE_URL");
const BANK_CURSOR_KEY=defineSecret("QUIZER_BANK_CURSOR_KEY");
const QUIZER_MIMO_PROJECT_KEY=defineSecret("QUIZER_MIMO_PROJECT_KEY");
const PROD1_BOUND_SECRETS=[NEON_URL,BANK_CURSOR_KEY];
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


/**
 * Isolated opt-in integration. Only this new callable binds the Mimo secret.
 * No changes to existing api/processJob/scheduledMaintenance deployments.
 */
export const mimoTeacherChat = onCall(
  {
    region: REGION,
    memory: "256MiB",
    timeoutSeconds: 120,
    maxInstances: 2,
    enforceAppCheck: ENFORCE_APP_CHECK,
    secrets: [QUIZER_MIMO_PROJECT_KEY, NEON_URL],
  },
  async (request) => {
    try {
      const handler = createAiHub({
        db, projectKey: QUIZER_MIMO_PROJECT_KEY.value(),
        databaseUrl: NEON_URL.value(),
      });
      return await handler({auth: request.auth, data: request.data});
    } catch (error) {
      const hubReason = aiHubErrorCode(error);
      if (error instanceof TeacherChatError || hubReason) {
        const code = {
          AUTH_REQUIRED: "unauthenticated",
          EMAIL_UNVERIFIED: "permission-denied",
          ROLE_REQUIRED: "permission-denied",
          INVALID_FIELDS: "invalid-argument",
          REQUEST_ID_CONFLICT: "already-exists",
          RATE_LIMITED: "resource-exhausted",
          MIMO_RATE_LIMITED: "resource-exhausted",
          MIMO_PROJECT_NOT_AUTHORIZED: "failed-precondition",
          MIMO_WORKFLOW_OR_RUN_NOT_FOUND: "failed-precondition",
          MIMO_NOT_CONFIGURED: "failed-precondition",
          MIMO_OUTCOME_UNKNOWN: "unavailable",
          MIMO_NOT_COMPLETED: "unavailable",
          MIMO_INVALID_RESPONSE: "unavailable",
          MIMO_UNAVAILABLE: "unavailable",
          THREAD_NOT_FOUND: "not-found",
          DOCUMENT_NOT_FOUND: "not-found",
          DOCUMENT_NOT_READY: "failed-precondition",
          REQUEST_ID_CONFLICT: "already-exists",
          MEMORY_NOT_CONFIGURED: "failed-precondition",
        }[hubReason || error.code] || "internal";
        // Only fixed, predeclared codes, never upstream error bodies or secrets.
        const reason = hubReason || error.code;
        throw new HttpsError(code, reason, {reason});
      }
      console.error("mimo_teacher_chat_internal_failure");
      throw new HttpsError("internal", "Teacher chat is temporarily unavailable.");
    }
  },
);
