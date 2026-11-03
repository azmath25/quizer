// QN11.2: off-by-default orchestration boundary for future Quizer bank actions.
// A durable Firebase coordinator MUST implement prepare/recordEffect/finalize.
// None of these callbacks may do Neon/Storage I/O inside runTransaction.
// This module is intentionally NOT imported into the active Firebase router.
import { fields, assert } from "../../shared/schema.js";
import { fingerprint } from "./write-repository.js";

const CONTRACT = Object.freeze({
  createProblem:["metadata","content","grading"],
  saveProblemRevision:["problemId","expectedVersion","metadata","content","grading"],
  importProblemBatch:["jobId","records"],
});
export function createQuizerNeonOrchestrator({
  enabled=false, gateway, coordinator,
}={}) {
  if (enabled !== true) return Object.freeze({
    enabled:false, handle:async()=>({disabled:true}),
  });
  if (!gateway?.enabled || gateway.replaySafeEdits !== true ||
      typeof gateway.handle !== "function" ||
      ["prepare","recordEffect","finalize"].some(k=>
        typeof coordinator?.[k] !== "function"))
    throw new Error("QN11 orchestration requires a replay-safe gateway and durable Firebase coordinator.");
  return Object.freeze({
    enabled:true,
    async handle(action, verifiedFirebaseAuth, request) {
      assert(Object.hasOwn(CONTRACT,action),"INVALID_FIELDS",
        "Unsupported staged bank action.");
      fields(request,["apiVersion","action","requestId",...CONTRACT[action]]);
      assert(request.apiVersion===2 && request.action===action &&
        typeof request.requestId==="string" &&
        /^[A-Za-z0-9_-]{16,100}$/.test(request.requestId),
        "INVALID_FIELDS","Invalid Firebase action envelope.");
      assert(verifiedFirebaseAuth?.uid && verifiedFirebaseAuth?.token &&
        typeof verifiedFirebaseAuth.token==="object",
        "AUTH_REQUIRED","Verified Firebase callable identity required.");
      // This digest is an opaque equality check, never the original protected
      // grading/source data. Never log an envelope or token.
      const payloadHash=fingerprint(request);
      // QN11.3: only non-sensitive per-item digests/points cross the Firebase
      // coordinator boundary. Problem content and protected grading remain in
      // the external Neon effect, never in coordinator documents.
      const expectedItems = action==="importProblemBatch" ? {
        jobId:request.jobId,
        items:request.records.map(row=>({
          importItemKey:row.importItemKey,payloadHash:fingerprint(row),
          points:row.points ?? row.content?.defaultPoints,
        })),
      } : undefined;
      // prepare MUST run a short Firebase transaction, verify actor, current
      // ownership/job/version and claim a durable operation keyed by UID+ID.
      const claim=await coordinator.prepare({
        action, auth:verifiedFirebaseAuth, requestId:request.requestId,
        payloadHash, expectedItems,
      });
      assert(claim && typeof claim==="object" && 
        (claim.status==="prepared" || claim.status==="complete"),
        "FAILED_PRECONDITION","Unverified Firebase operation claim.");
      if (claim.status==="complete") {
        assert(Object.hasOwn(claim,"result"),"FAILED_PRECONDITION",
          "Completed operation lacks a response receipt.");
        // prepare must authorize identical, already-completed requests too.
        return claim.result;
      }
      assert(typeof claim.token==="string" && claim.token.length>=16 &&
        claim.token.length<=128,
        "FAILED_PRECONDITION","Missing fenced operation token.");
      // This is OUTSIDE Firestore transaction retries. SQL write receipts must
      // return identical results if the SQL commit succeeded but ack was lost.
      const result=await gateway.handle(action,verifiedFirebaseAuth,request);
      // Persist successful external effect; failed acknowledgement is safely
      // replayable via PostgreSQL import/edit receipts.
      await coordinator.recordEffect({
        action, auth:verifiedFirebaseAuth, requestId:request.requestId,
        payloadHash, token:claim.token, result,
        jobId:action==="importProblemBatch" ? request.jobId : undefined,
      });
      // Finalize MUST recheck actor, job/quiz/draft versions and fence inside
      // Firebase transaction; never activate a stale/unauthorized operation.
      return coordinator.finalize({
        action, auth:verifiedFirebaseAuth, requestId:request.requestId,
        payloadHash, token:claim.token, result,
        jobId:action==="importProblemBatch" ? request.jobId : undefined,
      });
    },
  });
}
