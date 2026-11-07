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
import { createTeacherChat, TeacherChatError } from "./mimo/teacher-chat.js";
import { createExtractionService, ExtractionError } from "./mimo/extraction.js";
import {createBatchService} from "./mimo/batch.js";
import {createAiHub,aiHubErrorCode} from "./mimo/ai-hub.js";
import {sharedAiMemoryStore} from "./mimo/memory-store.js";
import {createMemoryCompactor} from "./mimo/compact-memory.js";
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
 * Quizer's existing teacher-only Mimo callable, source-controlled without
 * touching quiz APIs. This deploys separately from the document frontend.
 * Firebase deployment is NOT performed by GitHub Pages publication.
 */
export const mimoTeacherChat = onCall(
  {
    region: REGION,
    memory: "256MiB",
    timeoutSeconds: 120,
    maxInstances: 2,
    enforceAppCheck: ENFORCE_APP_CHECK,
    secrets: [QUIZER_MIMO_PROJECT_KEY],
  },
  async (request) => {
    try {
      return await createTeacherChat({
        db, projectKey: QUIZER_MIMO_PROJECT_KEY.value(),
      })({auth: request.auth, data: request.data});
    } catch (error) {
      if (error instanceof TeacherChatError) {
        const reason = error.code;
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
        }[reason] || "internal";
        throw new HttpsError(code, reason, {reason});
      }
      console.error("mimo_teacher_chat_internal_failure");
      throw new HttpsError("internal","Teacher chat is temporarily unavailable.");
    }
  },
);


/**
 * Quizer document extraction: file bytes travel via authenticated Firebase callable.
 * All Mimo project credentials and workflow choices are server-side.
 */
const extractionSecrets=[QUIZER_MIMO_PROJECT_KEY];
const extractionErrors={
  AUTH_REQUIRED:"unauthenticated", EMAIL_UNVERIFIED:"permission-denied",
  ROLE_REQUIRED:"permission-denied", INVALID_FIELDS:"invalid-argument",
  REQUEST_ID_CONFLICT:"already-exists", RATE_LIMITED:"resource-exhausted",
  INVALID_PAGE_NUMBER:"invalid-argument", JOB_NOT_FOUND:"not-found",
  JOB_NOT_READY:"failed-precondition",
  MIMO_PROJECT_NOT_AUTHORIZED:"failed-precondition",
  MIMO_NOT_CONFIGURED:"failed-precondition",
  MIMO_NOT_FOUND:"not-found", MIMO_CONFLICT:"aborted",
  MIMO_RATE_LIMITED:"resource-exhausted", MIMO_RUN_FAILED:"unavailable",
  MIMO_OUTCOME_UNKNOWN:"unavailable", MIMO_UPSTREAM_UNAVAILABLE:"unavailable",
  MIMO_REQUEST_REJECTED:"failed-precondition",
  MIMO_INVALID_EXTRACTION:"failed-precondition",
  MIMO_INVALID_RESPONSE:"unavailable",
  INVALID_FIGURE_ASSET:"failed-precondition",
  REVIEW_VERSION_CONFLICT:"aborted",REVIEW_INCOMPLETE:"failed-precondition",
};
async function extractionAction(action,request) {
  try {
    const bridge=createExtractionService({db,projectKey:QUIZER_MIMO_PROJECT_KEY.value()});
    return await bridge[action]({auth:request.auth,data:request.data});
  } catch (error) {
    if (error instanceof ExtractionError) {
      throw new HttpsError(extractionErrors[error.code]||"internal",
        error.code,{reason:error.code});
    }
    console.error("mimo_extraction_internal_failure");
    throw new HttpsError("internal","Document extraction is temporarily unavailable.");
  }
}
export const mimoExtractStart=onCall({
  region:REGION,memory:"512MiB",timeoutSeconds:120,maxInstances:2,
  enforceAppCheck:ENFORCE_APP_CHECK,secrets:extractionSecrets,
},request=>extractionAction("start",request));
export const mimoExtractStatus=onCall({
  region:REGION,memory:"256MiB",timeoutSeconds:120,maxInstances:2,
  enforceAppCheck:ENFORCE_APP_CHECK,secrets:extractionSecrets,
},request=>extractionAction("status",request));
export const mimoExtractImage=onCall({
  region:REGION,memory:"256MiB",timeoutSeconds:120,maxInstances:2,
  enforceAppCheck:ENFORCE_APP_CHECK,secrets:extractionSecrets,
},request=>extractionAction("image",request));
export const mimoExtractList=onCall({
  region:REGION,memory:"256MiB",timeoutSeconds:60,maxInstances:2,
  enforceAppCheck:ENFORCE_APP_CHECK,secrets:extractionSecrets,
},request=>extractionAction("list",request));


/** Whole-document background jobs; all interactive actions enforce owner role. */
async function batchAction(action,request) {
  try {
    const service=createBatchService({db,projectKey:QUIZER_MIMO_PROJECT_KEY.value()});
    return await service[action]({auth:request.auth,data:request.data});
  }catch(error) {
    if(error instanceof ExtractionError)
      throw new HttpsError(extractionErrors[error.code]||"failed-precondition",
        error.code,{reason:error.code});
    console.error("mimo_batch_internal_failure");
    throw new HttpsError("internal","Background extraction is temporarily unavailable.");
  }
}
for (const [name,method,memory] of [
  ["mimoBatchStart","start","512MiB"],
  ["mimoBatchList","list","256MiB"],
  ["mimoBatchStatus","status","256MiB"],
  ["mimoBatchGetPage","getPage","256MiB"],
  ["mimoBatchImage","image","256MiB"],
]) {
  // See the statically exported functions below; this table documents the
  // corresponding action, but never dynamically constructs Firebase triggers.
  void name;void method;void memory;
}
const batchCallable=(action,memory="256MiB")=>onCall({
  region:REGION,memory,timeoutSeconds:120,maxInstances:2,
  enforceAppCheck:ENFORCE_APP_CHECK,secrets:extractionSecrets,
},request=>batchAction(action,request));
export const mimoBatchStart=batchCallable("start","512MiB");
export const mimoBatchList=batchCallable("list");
export const mimoBatchStatus=batchCallable("status");
export const mimoBatchGetPage=batchCallable("getPage");
export const mimoBatchImage=batchCallable("image");
export const mimoBatchReviewPage=batchCallable("reviewPage");
export const mimoBatchPrepared=batchCallable("prepared","512MiB");
export const mimoBatchSweep=onSchedule({
  schedule:"every 1 minutes",region:REGION,memory:"512MiB",
  timeoutSeconds:120,maxInstances:1,secrets:extractionSecrets,
},async()=>{
  try {
    await createBatchService({db,projectKey:QUIZER_MIMO_PROJECT_KEY.value()})
      .sweep(6);
  }catch {
    console.error("mimo_batch_sweep_unavailable");
  }
});

/**
 * Shared teacher AI hub: existing popup and AI Studio conversations use the
 * same owner-scoped Neon threads. No browser receives Neon or Mimo keys.
 * Keep old mimoTeacherChat available for previously deployed clients.
 */
const aiHubErrors={
  AUTH_REQUIRED:"unauthenticated",EMAIL_UNVERIFIED:"permission-denied",
  ROLE_REQUIRED:"permission-denied",INVALID_FIELDS:"invalid-argument",
  THREAD_NOT_FOUND:"not-found",DOCUMENT_NOT_FOUND:"not-found",
  DOCUMENT_NOT_READY:"failed-precondition",REQUEST_ID_CONFLICT:"already-exists",
  RATE_LIMITED:"resource-exhausted",MIMO_RATE_LIMITED:"resource-exhausted",
  MIMO_OUTCOME_UNKNOWN:"unavailable",MIMO_NOT_COMPLETED:"unavailable",
  MIMO_UNAVAILABLE:"unavailable",MIMO_INVALID_RESPONSE:"unavailable",
  MIMO_UPSTREAM_UNAVAILABLE:"unavailable",MIMO_PROJECT_NOT_AUTHORIZED:"failed-precondition",
  MEMORY_NOT_CONFIGURED:"failed-precondition",
  MEMORY_DB_PERMISSION_DENIED:"failed-precondition",
  MEMORY_DB_AUTH_FAILED:"unavailable",
  MEMORY_DB_SCHEMA_MISMATCH:"failed-precondition",
  MEMORY_DB_UNAVAILABLE:"unavailable",
};
export const mimoAiHub=onCall({
  region:REGION,memory:"512MiB",timeoutSeconds:120,maxInstances:2,
  enforceAppCheck:ENFORCE_APP_CHECK,
  secrets:[QUIZER_MIMO_PROJECT_KEY,NEON_URL],
},async request=>{
  try {
    return await createAiHub({db,projectKey:QUIZER_MIMO_PROJECT_KEY.value(),
      databaseUrl:NEON_URL.value()})({auth:request.auth,data:request.data});
  }catch(error) {
    const reason=aiHubErrorCode(error) ||
      (error instanceof TeacherChatError?error.code:null);
    if(reason)throw new HttpsError(aiHubErrors[reason]||"failed-precondition",
      reason,{reason});
    console.error("mimo_ai_hub_internal_failure");
    throw new HttpsError("internal","AI Studio is temporarily unavailable.");
  }
});

/**
 * Bound-cost asynchronous memory updater. One claimed conversation segment
 * per scheduled execution; no automatic retry after ambiguous provider calls.
 */
export const mimoAiMemorySweep=onSchedule({
  schedule:"every 5 minutes",region:REGION,memory:"256MiB",
  timeoutSeconds:120,maxInstances:1,
  secrets:[QUIZER_MIMO_PROJECT_KEY,NEON_URL],
},async()=>{
  try {
    const compact=createMemoryCompactor({
      store:sharedAiMemoryStore(NEON_URL.value()),
      projectKey:QUIZER_MIMO_PROJECT_KEY.value(),
    });
    const result=await compact();
    if(result.attention)console.warn("ai_memory_sweep_attention");
  }catch {
    console.error("ai_memory_sweep_unavailable");
  }
});
