// QN11.5: default-OFF server-side composition of the QN10 bundle pipeline
// and QN11.5 publication, student, grading, export, and image adapters.
// NOT imported into functions/src/router.js, jobs/worker.js or entrypoint.
// Only trusted Firebase Admin + Neon service ports, no new public endpoint.
import {assert,id} from "../../shared/schema.js";
import {requireRole} from "../domain/runtime.js";
import {createPrivateBundleStoragePort} from "./private-storage.js";
import {createFirestoreBundlePublicationStore} from "./firestore-publication-store.js";
import {createPinnedNeonPublicationResolver} from "./pinned-neon-source.js";
import {createPrivateBundlePublisher} from "./publish-writer.js";
import {createFirestoreSecureBundleService} from "./firestore-attempt-service.js";
import {createFirestorePrivateAttemptCommits} from "./private-attempt-commits.js";
import {createFirestorePrivateGradeFinalization} from "./private-grade-finalization.js";
import {createQuizerPrivateStartAndExport} from "./private-start-export.js";
import {createFirestorePrivateAttemptStart} from "./private-attempt-start.js";
import {createQuizerPrivateImageSigner} from "./private-image-signer.js";
import {createQuizerPrivateIntegration} from "./private-integration.js";

export function createQuizerStagedPrivateRuntime({
  enabled=false,db,bucket,authFor,neonReader,
  resolvePublicationActor,verifyPublicationAssets,
  preflightStart,commitStart,authorizeExport,verifyExportAssets,
  resolveImageScope,signImage,legacyHandle,
}={}){
  if(enabled!==true)return Object.freeze({enabled:false,
    handle:async()=>({disabled:true}),
    publishJob:async()=>({disabled:true}),
    gradeJobBatch:async()=>({disabled:true}),
    finalizeGradeJob:async()=>({disabled:true}),
    exportSource:async()=>({disabled:true})});
  assert(db?.doc&&db?.runTransaction&&bucket?.file&&
    typeof authFor==="function"&&
    typeof neonReader?.getProblemForTeacher==="function"&&
    [resolvePublicationActor,verifyPublicationAssets,
      authorizeExport,verifyExportAssets,
      resolveImageScope,signImage,legacyHandle].every(x=>typeof x==="function") &&
    ((preflightStart===undefined && commitStart===undefined) ||
      (typeof preflightStart==="function" &&
        typeof commitStart==="function")),
    "INVALID_FIELDS","Verified QN11.5 integration ports required.");
  const get=async path=>{
    const ref=await db.doc(path).get();
    return ref.exists?ref.data():null;
  };
  const resolveFirebaseActor=async verifiedAuth=>{
    assert(verifiedAuth?.uid&&verifiedAuth?.token&&
      typeof verifiedAuth.token==="object",
      "AUTH_REQUIRED","Verified Firebase callable auth required.");
    const uid=id(verifiedAuth.uid);
    const role=await get("roles/"+uid);
    return {uid,role:role?.role??"student",
      accountStatus:role?.accountStatus??"active",
      emailVerified:verifiedAuth.token.email_verified===true,
      roleVersion:role?.version??0};
  };
  async function loadAttemptWithRights({firebaseAuth,attemptId}){
    const actor=await resolveFirebaseActor(firebaseAuth);
    requireRole(actor,"user");
    const attempt=await get("attempts/"+id(attemptId));
    assert(attempt && (attempt.studentId===actor.uid ||
      (actor.emailVerified===true &&
        ["teacher","admin"].includes(actor.role) &&
        (attempt.quizOwnerId===actor.uid || actor.role==="admin"))),
      "RESOURCE_UNAVAILABLE","Attempt unavailable.");
    return {actor,attempt};
  }
  async function readKind(quizId,revisionId){
    const revision=await get("quizzes/"+id(quizId)+"/revisions/"+id(revisionId));
    assert(revision?.state==="ready",
      "RESOURCE_UNAVAILABLE","Pinned revision unavailable.");
    // Source provenance is based on the persisted verified manifest, never
    // a caller-provided marker or a database outage fallback.
    return revision.bundle?"private_bundle_v1":"firestore_legacy";
  }
  const resolveAttemptOrigin=async({firebaseAuth,attemptId,worker=false})=>{
    if(worker){
      const a=await get("attempts/"+id(attemptId));
      assert(a?.quizId&&a.quizRevisionId,"RESOURCE_UNAVAILABLE",
        "Grading attempt unavailable.");
      return readKind(a.quizId,a.quizRevisionId);
    }
    const {attempt}=await loadAttemptWithRights({firebaseAuth,attemptId});
    return readKind(attempt.quizId,attempt.quizRevisionId);
  };
  const resolveQuizOrigin=async({firebaseAuth,quizId,sourceAttemptId})=>{
    const actor=await resolveFirebaseActor(firebaseAuth);
    requireRole(actor,"verified");
    if(sourceAttemptId){
      const {attempt}=await loadAttemptWithRights({
        firebaseAuth,attemptId:sourceAttemptId});
      assert(attempt.studentId===actor.uid&&attempt.quizId===quizId,
        "RESOURCE_UNAVAILABLE","Retry source attempt unavailable.");
      return readKind(quizId,attempt.quizRevisionId);
    }
    const quiz=await get("quizzes/"+id(quizId));
    assert(quiz?.publishedRevisionId,"RESOURCE_UNAVAILABLE",
      "Published quiz unavailable.");
    return readKind(quizId,quiz.publishedRevisionId);
  };
  const storage=createPrivateBundleStoragePort({enabled:true,bucket});
  const publicationStore=createFirestoreBundlePublicationStore({
    enabled:true,db,authFor});
  const pinned=createPinnedNeonPublicationResolver({
    enabled:true,readRepository:neonReader,
    resolvePublicationActor,verifyAssets:verifyPublicationAssets});
  const publisher=createPrivateBundlePublisher({
    enabled:true,publicationStore,
    resolvePinnedRevision:args=>pinned.resolve(args),
    storage,
  });
  const secureAttempts=createFirestoreSecureBundleService({
    enabled:true,db,privateStorage:storage});
  const attemptCommits=createFirestorePrivateAttemptCommits({enabled:true,db});
  const gradeFinalization=createFirestorePrivateGradeFinalization({
    enabled:true,db});
  const trustedStart=(preflightStart&&commitStart)
    ? {preflightStart,commitStart}
    : createFirestorePrivateAttemptStart({enabled:true,db});
  const startExport=createQuizerPrivateStartAndExport({
    enabled:true,preflightStart:trustedStart.preflightStart,
    commitStart:trustedStart.commitStart,
    authorizeExport,verifyExportAssets,
    loadRevision:({quizId,revisionId})=>get(
      "quizzes/"+id(quizId)+"/revisions/"+id(revisionId)),
    readPrivateObject:args=>storage.readExact(args),
  });
  const images=createQuizerPrivateImageSigner({
    enabled:true,db,signImage});
  const facade=createQuizerPrivateIntegration({
    enabled:true,resolveFirebaseActor,resolveAttemptOrigin,
    resolveQuizOrigin,legacy:{handle:legacyHandle},
    secureAttempts,startExport,attemptCommits,gradeFinalization,publisher,
    resolveImageScope,signReadyAssets:images.signReadyAssets,
  });
  return Object.freeze({...facade,enabled:true});
}
