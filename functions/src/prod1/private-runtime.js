// PROD1: private-bundle + Neon development composition against real Firebase
// Admin ports. Remains UNMOUNTED from live Firebase api/jobs until E2E staging,
// legacy draft/publish compatibility and rollback gates are accepted.
import {assert,id} from "../../shared/schema.js";
import {requireTeacher} from "../neon/contracts.js";
import {createProd1FirebaseBankPorts} from "./firebase-bank-ports.js";
import {createProd1LegacyPublicationSource}
  from "./legacy-publication-source.js";
import {createQuizerStagedPrivateRuntime}
  from "../bundles/private-staging-runtime.js";

export function createProd1PublicationIdentityPort({
  db,authFor,resolveFirebaseActor,
}={}){
  assert(db?.doc&&typeof authFor==="function"&&
    typeof resolveFirebaseActor==="function",
    "FAILED_PRECONDITION","Trusted production publication identity port required.");
  return async({plan})=>{
    assert(plan?.jobId&&plan?.quizId&&plan?.revisionId&&
      plan?.ownerId&&plan?.leaseOwner,
      "RESOURCE_UNAVAILABLE","Missing trusted publication plan.");
    const [jobSnap,quizSnap]=await Promise.all([
      db.doc("jobs/"+id(plan.jobId)).get(),
      db.doc("quizzes/"+id(plan.quizId)).get(),
    ]);
    const job=jobSnap.exists?jobSnap.data():null,
      quiz=quizSnap.exists?quizSnap.data():null;
    assert(job?.kind==="publish_quiz"&&
      job.status==="running"&&
      job.leaseOwner===plan.leaseOwner&&
      job.targetId===plan.quizId&&
      job.input?.revisionId===plan.revisionId&&
      job.requestedBy===plan.ownerId&&
      quiz?.ownerId===plan.ownerId&&
      quiz.publishingJobId===plan.jobId,
      "JOB_LEASE","Publication lease or ownership changed.");
    const trustedAuth=await authFor(id(plan.ownerId));
    assert(trustedAuth?.uid===plan.ownerId&&trustedAuth?.token,
      "AUTH_REQUIRED","Trusted Firebase publication identity required.");
    return requireTeacher(await resolveFirebaseActor(trustedAuth));
  };
}

export function createProd1PrivateRuntime({
  enabled=false,firebaseProjectId="",db,bucket,authFor,
  bankRuntime,legacyDispatch,legacyActions=[],
}={}){
  if(enabled!==true)return Object.freeze({enabled:false,
    handle:async()=>({disabled:true}),close:async()=>{}});
  assert(firebaseProjectId==="sat-quiz-fd317"&&db?.doc&&
    typeof db.runTransaction==="function"&&bucket?.file&&
    typeof authFor==="function"&&bankRuntime?.enabled===true&&
    typeof bankRuntime.read?.getProblemForTeacher==="function"&&
    typeof bankRuntime.buildFullRuntime==="function"&&
    typeof legacyDispatch==="function"&&
    Array.isArray(legacyActions),
    "FAILED_PRECONDITION","Trusted Firebase Admin/bank ports required.");
  const firebase=createProd1FirebaseBankPorts({
    enabled:true,db,legacyDispatch});
  const resolvePublicationActor=createProd1PublicationIdentityPort({
    db,authFor,resolveFirebaseActor:firebase.resolveFirebaseActor});
  const verifyPublicationAssets=async({actor,assetIds=[]})=>
    firebase.verifyAssets({actor,assetIds});
  const legacySource=createProd1LegacyPublicationSource({
    enabled:true,db,resolvePublicationActor,
    verifyAssets:verifyPublicationAssets});
  const privateRuntime=createQuizerStagedPrivateRuntime({
    enabled:true,db,bucket,authFor,neonReader:bankRuntime.read,
    resolvePublicationActor,verifyPublicationAssets,
    resolveLegacyPublication:legacySource.resolve,
    // Absent shared-asset grant callback is deliberately fail-closed.
    authorizeSharedAsset:null,
    legacyHandle:firebase.legacyHandle,
  });
  const gateway=bankRuntime.buildFullRuntime({
    privateRuntime,legacyActions});
  return Object.freeze({
    enabled:true,actionCounts:gateway.actionCounts,
    handle:gateway.handle,
    runPrivateJob:gateway.runPrivateJob,
    recoveryAudit:privateRuntime.recoveryAudit,
    close:bankRuntime.close,
  });
}
