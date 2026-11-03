// QN10.2: STAGED Firestore publication coordinator.
// Not imported by the active worker and disabled until the QN10.3 cutover.
// Storage/Neon IO MUST execute outside transact() retry callbacks.
import { transact, manage, requireRole, hash, millis } from "../domain/runtime.js";
import { projectCatalog } from "../api/quizzes.js";
import { assert, id } from "../../shared/schema.js";
import { validatePublishedBundleManifest } from "./published-bundle.js";

function checkOwner(c, job, quiz) {
  requireRole(c.actor, "teacher");
  manage(c.actor, quiz);
  assert(job.requestedBy === c.actor.uid &&
    quiz.ownerId === job.requestedBy,
    "RESOURCE_UNAVAILABLE", "Publication owner mismatch.");
}
function checkJob(job,jobId,quizId,revisionId) {
  assert(job && job.kind === "publish_quiz" &&
    job.targetId === quizId &&
    job.input?.revisionId === revisionId &&
    job.input?.bundleMode === "private_bundle_v1" &&
    job.input?.sources?.length >= 1,
    "FAILED_PRECONDITION", "Bundle-ready publication job required.");
}
export function createFirestoreBundlePublicationStore({
  enabled = false, db, authFor,
} = {}) {
  if(enabled!==true)
    return Object.freeze({enabled:false,
      load:async()=>({disabled:true}),
      activate:async()=>({disabled:true})});
  assert(db && typeof db.runTransaction==="function" &&
    typeof db.doc==="function" && typeof authFor==="function",
    "INVALID_FIELDS","Trusted Firebase publication store required.");

  async function callerForJob(jobId) {
    const snapshot=await db.doc("jobs/"+id(jobId,"job ID")).get();
    const doc=snapshot.exists?snapshot.data():null;
    assert(doc?.requestedBy && typeof doc.requestedBy==="string",
      "RESOURCE_UNAVAILABLE","Publication job unavailable.");
    // Auth is provided only by trusted Firebase Admin identity lookup.
    return authFor(doc.requestedBy);
  }
  async function load(jobId) {
    id(jobId,"job ID");
    const auth=await callerForJob(jobId);
    return transact(db,"job.bundle.preflight",jobId+"-preflight",async c=>{
      const job=await c.get("jobs/"+jobId);
      const quizId=id(job.targetId,"quiz ID"),
        revisionId=id(job.input?.revisionId,"revision ID");
      checkJob(job,jobId,quizId,revisionId);
      const quiz=await c.get("quizzes/"+quizId);
      checkOwner(c,job,quiz);
      const revision=await c.get("quizzes/"+quizId+"/revisions/"+revisionId);
      if(job.status==="succeeded") {
        assert(revision.state==="ready" && revision.bundle,
          "RESOURCE_UNAVAILABLE","Completed publication lacks verified bundle.");
        validatePublishedBundleManifest(revision.bundle,quizId,revisionId);
        return {completed:true,jobId,quizId,revisionId,
          manifest:revision.bundle};
      }
      assert(job.status==="running" &&
        typeof job.leaseOwner==="string" && job.leaseOwner.length>0 &&
        job.leaseExpiresAt && millis(job.leaseExpiresAt)>millis(c.now),
        "JOB_LEASE","Publication lease expired or held by another worker.");
      assert(quiz.lifecycle==="active" &&
        quiz.publishingJobId===jobId &&
        revision.state==="building" &&
        revision.publicationJobId===jobId,
        "FAILED_PRECONDITION","Published state changed.");
      const draft=await c.get("quizzes/"+quizId+"/drafts/current");
      assert(job.input.draftVersion===draft.version &&
        quiz.draftVersion===draft.version &&
        revision.sourceDraftVersion===draft.version,
        "VERSION_CONFLICT","Draft version changed.");
      const sources=job.input.sources;
      assert(hash({draft,sources})===revision.manifestHash &&
        revision.itemCount===sources.length &&
        Array.isArray(revision.itemOrder) &&
        revision.itemOrder.length===sources.length &&
        sources.every((source,index)=>
          source.itemId===revision.itemOrder[index]),
        "VERSION_CONFLICT","Pinned source manifest mismatch.");
      return {
        jobId,quizId,revisionId,
        leaseOwner:job.leaseOwner,
        jobInputHash:hash(job.input),
        revisionManifestHash:revision.manifestHash,
        previousPublishedRevisionId:quiz.publishedRevisionId??null,
        expectedQuizVersion:quiz.version,
        sourceDraftVersion:draft.version,
        sources,revision,
      };
    },auth);
  }

  async function activate({plan,manifest}) {
    assert(plan && typeof plan==="object" && plan.jobId,
      "INVALID_FIELDS","Missing verified publication preflight.");
    validatePublishedBundleManifest(manifest,plan.quizId,plan.revisionId);
    const auth=await callerForJob(plan.jobId);
    return transact(db,"job.bundle.activate",plan.jobId+"-bundle-finish",
      async c=>{
        const job=await c.get("jobs/"+plan.jobId);
        const quiz=await c.get("quizzes/"+plan.quizId);
        const path="quizzes/"+plan.quizId+"/revisions/"+plan.revisionId;
        const revision=await c.get(path);
        checkJob(job,plan.jobId,plan.quizId,plan.revisionId);
        checkOwner(c,job,quiz);
        // An acknowledged activation may be retried. Never republish an older
        // revision over a subsequently published version.
        if(job.status==="succeeded") {
          assert(revision.state==="ready" &&
            revision.bundle?.sha256===manifest.sha256 &&
            revision.bundle?.generation===manifest.generation &&
            revision.bundle?.storagePath===manifest.storagePath,
            "VERSION_CONFLICT","Completed publication bundle changed.");
          return {alreadyPublished:true};
        }
        const draft=await c.get("quizzes/"+plan.quizId+"/drafts/current");
        assert(job.status==="running" &&
          job.leaseOwner===plan.leaseOwner &&
          job.leaseExpiresAt && millis(job.leaseExpiresAt)>millis(c.now),
          "JOB_LEASE","Publication lease no longer owned.");
        assert(quiz.lifecycle==="active" &&
          quiz.publishingJobId===plan.jobId &&
          (quiz.publishedRevisionId??null)===plan.previousPublishedRevisionId &&
          quiz.version===plan.expectedQuizVersion &&
          quiz.draftVersion===draft.version &&
          draft.version===plan.sourceDraftVersion &&
          job.input.draftVersion===draft.version &&
          revision.state==="building" &&
          revision.publicationJobId===plan.jobId &&
          revision.manifestHash===plan.revisionManifestHash &&
          hash(job.input)===plan.jobInputHash,
          "VERSION_CONFLICT","Publication changed before activation.");
        assert(quiz.closesAt || ![
          revision.settings.scoreRelease,
          revision.settings.solutionRelease,
        ].includes("afterClose"),
        "INVALID_FIELDS","Closing time is required for after-close release.");
        assert(revision.itemCount===manifest.itemCount &&
          revision.totalPoints===manifest.totalPoints,
          "VERSION_CONFLICT","Bundle does not match frozen publication.");
        const ready={...revision,state:"ready",bundle:manifest,readyAt:c.now};
        const next={...quiz,publishedRevisionId:plan.revisionId,
          lastPublishedRevisionId:plan.revisionId,publishingJobId:null,
          publishedAt:c.now,updatedAt:c.now,version:quiz.version+1};
        c.set(path,ready);
        c.set("quizzes/"+plan.quizId,next);
        await projectCatalog(c,plan.quizId,next,ready);
        c.set("jobs/"+plan.jobId,{
          ...job,status:"succeeded",leaseOwner:null,leaseExpiresAt:null,
          completedAt:c.now,updatedAt:c.now,error:null,
          progress:{...(job.progress??{}),stage:"Complete",
            processed:revision.itemCount,total:revision.itemCount},
          result:{quizId:plan.quizId,revisionId:plan.revisionId,
            privateBundleVerified:true},
        });
        c.audit("quiz.published","quiz",plan.quizId,{
          quizId:plan.quizId,quizOwnerId:quiz.ownerId,
        });
        return {activated:true};
      },auth);
  }

  return Object.freeze({enabled:true,load,activate});
}
