// QN11.6.3 — bounded retention of published private-bundle image refs.
// 20 assets per Firestore transaction; no Neon or Storage calls in retries.
// Retention precedes publication activation. Failed publication may leave
// conservative refs; garbage collection is NOT part of this milestone.
import {assert,id,assetIds} from "../../shared/schema.js";
import {hash,transact,manage,requireRole,millis} from "../domain/runtime.js";
import {retainAssets} from "../domain/assets.js";
const BATCH=20;
const MAX_IDS=2000;
const SHA=/^[0-9a-f]{64}$/;
const validate=(plan)=>{
  assert(plan?.jobId && plan.quizId && plan.revisionId &&
    plan.leaseOwner && plan.jobInputHash &&
    plan.revisionManifestHash,
    "RESOURCE_UNAVAILABLE","Trusted publication plan required.");
  for(const key of ["jobId","quizId","revisionId"])id(plan[key]);
};
export function publishedAssetIds(items){
  assert(Array.isArray(items)&&items.length>=1&&items.length<=500,
    "INVALID_FIELDS","Published items must be bounded.");
  const ids=[...new Set(items.flatMap(i=>
    assetIds(i.content,i.grading)))].sort();
  assert(ids.length<=MAX_IDS,"INVALID_FIELDS",
    "Too many images in a single publication.");
  ids.forEach(x=>id(x,"image ID"));
  return ids;
}
export function createFirestorePublishedImageRetention({
  enabled=false,db,authFor,authorizeSharedAsset=null,
}={}){
  if(enabled!==true)return Object.freeze({enabled:false,
    ensureRetained:async()=>({disabled:true})});
  assert(db?.runTransaction&&db?.doc&&typeof authFor==="function",
    "INVALID_FIELDS","Trusted Firebase retention ports required.");
  async function ensureRetained({plan,items}={}){
    validate(plan);
    const ids=publishedAssetIds(items);
    const digest=hash(ids);
    const batches=Math.ceil(ids.length/BATCH);
    const auth=await authFor(id(plan.ownerId,"publication owner ID"));
    assert(auth?.uid,"AUTH_REQUIRED",
      "Trusted publication owner identity required.");
    const target="quizzes/"+plan.quizId+"/revisions/"+plan.revisionId;
    const prefix=target+"/assetRetentionBatches/";
    async function check(c){
      requireRole(c.actor,"teacher");
      const job=await c.get("jobs/"+plan.jobId);
      const quiz=await c.get("quizzes/"+plan.quizId);
      const revision=await c.get(target);
      manage(c.actor,quiz);
      assert(quiz.ownerId===c.actor.uid &&
        job.requestedBy===c.actor.uid &&
        job.kind==="publish_quiz" &&
        job.targetId===plan.quizId &&
        job.input?.revisionId===plan.revisionId &&
        job.status==="running" &&
        job.leaseOwner===plan.leaseOwner &&
        job.leaseExpiresAt && millis(job.leaseExpiresAt)>millis(c.now) &&
        hash(job.input)===plan.jobInputHash &&
        revision.state==="building" &&
        revision.publicationJobId===plan.jobId &&
        revision.manifestHash===plan.revisionManifestHash,
        "JOB_LEASE","Publication retention lease changed.");
      return {quiz,job,revision};
    }
    for(let index=0;index<batches;index++){
      const chunk=ids.slice(index*BATCH,(index+1)*BATCH);
      const chunkHash=hash(chunk);
      const receiptPath=prefix+String(index).padStart(4,"0");
      await transact(db,"bundle.asset.retain",
        plan.jobId+"-"+index,async c=>{
          const {quiz}=await check(c);
          const prior=await c.get(receiptPath,false);
          if(prior){
            assert(prior.jobId===plan.jobId &&
              prior.assetHash===digest && prior.chunkHash===chunkHash,
              "VERSION_CONFLICT","Retained image batch changed.");
            return {retained:true};
          }
          // An asset must be ready before any Firestore ref is established.
          // The trusted publication resolver previously verified sharing.
          // Admin/owner is rechecked per batch; an authorized shared image
          // can be pinned without pretending it is owned by this teacher.
          for(const assetId of chunk){
            const a=await c.get("assets/"+assetId);
            assert(a.kind==="image" && a.status==="ready" &&
              a.generation && SHA.test(a.sha256??""),
              "ASSET_NOT_READY","A published image was not ready.");
            // A source resolver's earlier permission check is NOT enough:
            // sharing may be revoked while private Storage bytes are written.
            // Shared-image checks MUST be trusted Firestore-only reads inside
            // this SAME transaction, not Neon/Storage/network calls.
            if(a.ownerId!==quiz.ownerId){
              assert(typeof authorizeSharedAsset==="function" &&
                await authorizeSharedAsset({
                  c,actor:c.actor,assetId,asset:a,target,
                  quizId:plan.quizId,revisionId:plan.revisionId,
                  jobId:plan.jobId,sourcePlan:plan,
                })===true,"RESOURCE_UNAVAILABLE",
                "Shared image permission was revoked before retention.");
            }
          }
          await retainAssets(c,chunk,target,quiz.ownerId,
            {authorizedCopy:true});
          c.set(receiptPath,{jobId:plan.jobId,
            assetHash:digest,chunkHash,assetIds:chunk,
            createdAt:c.now});
          return {retained:true};
        },auth);
    }
    await transact(db,"bundle.asset.retained",
      plan.jobId+"-complete",async c=>{
        const {revision}=await check(c);
        for(let index=0;index<batches;index++){
          const chunk=ids.slice(index*BATCH,(index+1)*BATCH);
          const row=await c.get(prefix+String(index).padStart(4,"0"));
          assert(row.jobId===plan.jobId &&
            row.assetHash===digest && row.chunkHash===hash(chunk),
            "VERSION_CONFLICT","Published image retention incomplete.");
        }
        const prior=revision.assetRetention;
        assert(!prior || (prior.jobId===plan.jobId &&
          prior.assetHash===digest && prior.assetCount===ids.length),
          "VERSION_CONFLICT","Published image retention changed.");
        c.set(target,{...revision,assetRetention:{
          jobId:plan.jobId,assetHash:digest,
          assetCount:ids.length,batches,completedAt:c.now,
        }});
      },auth);
    return {jobId:plan.jobId,assetHash:digest,
      assetCount:ids.length,batches};
  }
  return Object.freeze({enabled:true,ensureRetained});
}
