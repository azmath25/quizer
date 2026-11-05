// PROD1: prepare immutable Neon-only private publication on the server.
// The existing Firestore path remains authoritative for legacy-only quizzes.
// Mixed-source publication must fail closed until legacy-to-private snapshot
// support is implemented. Nothing here mounts a live Firebase endpoint.
import {assert,id,fields,number,assetIds,validateProblem} from "../../shared/schema.js";
import {hash} from "../domain/runtime.js";
import {fingerprint} from "../neon/write-repository.js";
import {requireTeacher} from "../neon/contracts.js";
import {isCurrentPublishedDraft} from "../bundles/publication-noop.js";

const ALLOWED=["apiVersion","action","requestId","quizId",
  "expectedDraftVersion","expectedVersion"];
const CONTENT=["type","answerMode","statementLatex","options",
  "defaultPoints","questionAssetBindings"];
const get=async(db,path)=>{
  const snapshot=await db.doc(path).get();
  return snapshot.exists?snapshot.data():null;
};
function itemData(raw){
  assert(raw?.itemId&&raw?.problemId&&raw?.problemRevisionId,
    "RESOURCE_UNAVAILABLE","Unusable draft slot.");
  return {itemId:id(raw.itemId),problemId:id(raw.problemId),
    problemRevisionId:id(raw.problemRevisionId),
    points:number(raw.points,"Points",0.00000001,1000)};
}
function normalizedSource(loaded){
  const c=Object.fromEntries(CONTENT
    .filter(k=>Object.hasOwn(loaded.content??{},k))
    .map(k=>[k,loaded.content[k]]));
  const {gradingVersion,...grading}=loaded.grading??{};
  assert(gradingVersion===undefined||gradingVersion===1,
    "VERSION_CONFLICT","Unsupported immutable grading version.");
  const normalized=validateProblem(c,grading);
  assert(loaded.content?.contentHash===fingerprint(normalized),
    "VERSION_CONFLICT","Pinned SQL content hash mismatch.");
  return normalized;
}
export function createProd1PublicationGateway({
  enabled=false,db,resolveActor,resolveOrigin,neonReader,
  verifyAssets,legacyDispatch,legacySource=null,
}={}){
  if(enabled!==true)return Object.freeze({enabled:false,
    publish:async()=>({disabled:true})});
  assert(db?.doc&&typeof db.runTransaction==="function"&&
    [resolveActor,resolveOrigin,neonReader?.getProblemForTeacher,
      verifyAssets,legacyDispatch].every(fn=>typeof fn==="function"),
    "FAILED_PRECONDITION","Trusted PROD1 publication ports required.");
  async function publish(auth,request){
    fields(request,ALLOWED);
    assert(request?.apiVersion===2&&request.action==="publishQuiz"&&
      typeof request.requestId==="string"&&
      /^[A-Za-z0-9_-]{16,100}$/.test(request.requestId),
      "INVALID_FIELDS","Invalid publish request.");
    const actor=requireTeacher(await resolveActor(auth));
    const quizId=id(request.quizId);
    const receiptPath="operations/"+actor.uid+"/requests/"+request.requestId;
    const requestHash=hash(request);
    // A successfully committed request is replayable even if the quiz
    // is now publishing, complete, or its draft version has advanced.
    // This fast path is Firebase-only and never incurs a second Neon read.
    const early=await get(db,receiptPath);
    if(early){
      assert(early.action==="publishQuiz"&&
        early.inputHash===requestHash,
        "VERSION_CONFLICT","Request ID reused for another operation.");
      const jobId=id(early.result?.jobId,"receipt job ID"),
        revisionId=id(early.result?.revisionId,"receipt revision ID");
      const job=await get(db,"jobs/"+jobId);
      assert(job?.kind==="publish_quiz"&&job.requestedBy===actor.uid&&
        job.targetId===quizId&&job.input?.revisionId===revisionId,
        "FAILED_PRECONDITION","Publication receipt job mismatch.");
      return {jobId,revisionId};
    }
    const [quiz,draft]=await Promise.all([
      get(db,"quizzes/"+quizId),
      get(db,"quizzes/"+quizId+"/drafts/current"),
    ]);
    assert(quiz?.ownerId===actor.uid&&quiz.lifecycle==="active"&&
      !quiz.publishingJobId&&quiz.version===request.expectedVersion&&
      draft?.version===request.expectedDraftVersion&&
      Array.isArray(draft.itemOrder)&&draft.itemOrder.length>=1&&
      draft.itemOrder.length<=500&&
      new Set(draft.itemOrder).size===draft.itemOrder.length,
      "VERSION_CONFLICT","Draft or publishing state changed.");
    assert(quiz.closesAt||![draft.settings?.scoreRelease,
      draft.settings?.solutionRelease].includes("afterClose"),
      "INVALID_FIELDS","Closing date required for after-close release.");
    // If the already-serving revision pins the same saved draft, a repeated
    // Publish must be a read-only no-op, before any Neon/source/storage work.
    // Recheck permissions and versions in a read-only Firestore transaction
    // so an in-flight draft edit never masquerades as an unchanged publish.
    if(quiz.publishedRevisionId){
      const oldId=id(quiz.publishedRevisionId);
      const published=await get(db,"quizzes/"+quizId+"/revisions/"+oldId);
      if(isCurrentPublishedDraft(quiz,draft,published)){
        const identical=await db.runTransaction(async tx=>{
          const read=async path=>{
            const snapshot=await tx.get(db.doc(path));
            return snapshot.exists?snapshot.data():null;
          };
          const [role,current,currentDraft,currentPublished]=await Promise.all([
            read("roles/"+actor.uid),read("quizzes/"+quizId),
            read("quizzes/"+quizId+"/drafts/current"),
            read("quizzes/"+quizId+"/revisions/"+oldId),
          ]);
          assert(role&&role.accountStatus!=="disabled"&&
            ["teacher","admin"].includes(role.role)&&
            current?.ownerId===actor.uid&&current?.lifecycle==="active"&&
            !current.publishingJobId&&
            current.version===request.expectedVersion&&
            currentDraft?.version===request.expectedDraftVersion,
            "VERSION_CONFLICT","Publication state changed.");
          return current.publishedRevisionId===oldId&&
            isCurrentPublishedDraft(current,currentDraft,currentPublished);
        });
        if(identical)return {unchanged:true,revisionId:oldId,jobId:null};
      }
    }
    const slots=[];
    // Bounded concurrency keeps initial 500-question publication from
    // opening hundreds of Firestore reads at once.
    for(let start=0;start<draft.itemOrder.length;start+=20){
      const group=draft.itemOrder.slice(start,start+20);
      const found=await Promise.all(group.map(itemId=>
        get(db,"quizzes/"+quizId+"/draftItems/"+id(itemId))));
      found.forEach((raw,index)=>{
        const slot=itemData(raw);
        assert(slot.itemId===group[index],
          "VERSION_CONFLICT","Draft item order changed.");
        slots.push(slot);
      });
    }
    const origins=[];
    for(const slot of slots){
      origins.push(await resolveOrigin({actor,problemId:slot.problemId}));
    }
    if(origins.every(x=>x==="firestore_legacy"))
      return (await legacyDispatch(db,auth,request)).data;
    assert(origins.every(x=>["neon_revision","firestore_legacy"].includes(x)),
      "RESOURCE_UNAVAILABLE","Unknown private publication source.");
    const needsLegacy=origins.includes("firestore_legacy");
    assert(!needsLegacy||typeof legacySource?.preflight==="function",
      "FAILED_PRECONDITION",
      "Mixed Firestore/Neon publication needs a trusted legacy source reader.");
    const sources=[];
    // A 500-question exam must not incur 500 serial round trips or fan
    // out all queries at once. Keep at most eight preflights in flight.
    for(let start=0;start<slots.length;start+=8){
      const group=await Promise.all(slots.slice(start,start+8)
        .map(async (slot,relativeIndex)=>{
          if(origins[start+relativeIndex]==="firestore_legacy"){
            const loaded=await legacySource.preflight({
              actor,quizId,slot,
              retainedRevisionId:quiz.publishedRevisionId??
                quiz.lastPublishedRevisionId??null});
            assert(loaded?.problemId===slot.problemId&&
              loaded?.problemRevisionId===slot.problemRevisionId&&
              loaded?.source?.kind==="firestore_legacy"&&
              /^[0-9a-f]{64}$/.test(loaded.contentHash),
              "RESOURCE_UNAVAILABLE","Trusted legacy pin unavailable.");
            return {...slot,contentHash:loaded.contentHash,
              source:loaded.source};
          }
          const loaded=await neonReader.getProblemForTeacher({
            actor,problemId:slot.problemId,
            revisionId:slot.problemRevisionId});
          assert(loaded?.problemId===slot.problemId&&
            loaded.revisionId===slot.problemRevisionId&&
            loaded.problem?.ownerId===actor.uid&&
            loaded.problem?.lifecycle==="active",
            "RESOURCE_UNAVAILABLE",
            "Only verified owner-owned Neon revisions may be privately published.");
          const normalized=normalizedSource(loaded);
          assert(await verifyAssets({actor,assetIds:assetIds(
            normalized.content,normalized.grading)})===true,
            "RESOURCE_UNAVAILABLE","Pinned publication assets unavailable.");
          return {...slot,contentHash:fingerprint(normalized),
            source:{kind:"neon_revision",problemId:slot.problemId,
              problemRevisionId:slot.problemRevisionId}};
        }));
      sources.push(...group);
    }
    const digest=requestHash;
    const jobId="job_"+hash("private:"+actor.uid+":"+request.requestId)
      .slice(0,28);
    const revisionId="qrv_"+hash("private:"+actor.uid+":"+
      request.requestId).slice(0,28);
    return db.runTransaction(async tx=>{
      const read=async path=>{
        const snap=await tx.get(db.doc(path));
        return snap.exists?snap.data():null;
      };
      const base="quizzes/"+quizId;
      const [receipt,role,current,currentDraft]=await Promise.all([
        read(receiptPath),read("roles/"+actor.uid),
        read(base),read(base+"/drafts/current"),
      ]);
      if(receipt){
        assert(receipt.action==="publishQuiz"&&
          receipt.inputHash===digest,"VERSION_CONFLICT",
          "Request ID reused for different publish.");
        return receipt.result;
      }
      assert(role&&role.accountStatus!=="disabled"&&
        ["teacher","admin"].includes(role.role)&&
        current?.ownerId===actor.uid&&
        current?.lifecycle==="active"&&!current.publishingJobId&&
        current.version===request.expectedVersion&&
        currentDraft?.version===request.expectedDraftVersion&&
        hash(currentDraft)===hash(draft),
        "VERSION_CONFLICT","Publication state changed after source preflight.");
      const now=new Date(),paths=slots.map(x=>
        base+"/draftItems/"+x.itemId);
      const seen=await Promise.all(paths.map(read));
      assert(seen.every((value,index)=>value&&
        value.itemId===slots[index].itemId&&
        value.problemId===slots[index].problemId&&
        value.problemRevisionId===slots[index].problemRevisionId&&
        value.points===slots[index].points)&&
        currentDraft.itemOrder.every((key,index)=>
          key===slots[index].itemId),
        "VERSION_CONFLICT","A pinned problem changed before publishing.");
      const prevId=current.publishedRevisionId??
        current.lastPublishedRevisionId??null;
      const last=prevId?await read(base+"/revisions/"+id(prevId)):null;
      const totalPoints=Math.round(sources.reduce(
        (sum,s)=>sum+s.points,0)*1e8)/1e8;
      const revision={
        schemaVersion:2,state:"building",
        revisionNumber:(last?.revisionNumber??0)+1,
        publicationJobId:jobId,sourceDraftVersion:currentDraft.version,
        title:currentDraft.title,description:currentDraft.description,
        subject:currentDraft.subject,difficulty:currentDraft.difficulty,
        settings:currentDraft.settings,itemOrder:currentDraft.itemOrder,
        itemCount:slots.length,totalPoints,
        manifestHash:hash({draft:currentDraft,sources}),
        createdBy:actor.uid,createdAt:now,readyAt:null,
      };
      const input={bundleMode:"private_bundle_v1",
        revisionId,draftVersion:currentDraft.version,sources};
      tx.set(db.doc(base+"/revisions/"+revisionId),revision);
      tx.set(db.doc(base),{...current,publishingJobId:jobId,
        version:current.version+1,updatedAt:now});
      tx.set(db.doc("jobs/"+jobId),{
        kind:"publish_quiz",targetId:quizId,input,
        requestedBy:actor.uid,actorRoleAtTime:role.role,
        requestId:request.requestId,status:"queued",
        progress:{processed:0,total:slots.length,stage:"Queued"},
        leaseOwner:null,leaseExpiresAt:null,retryCount:0,
        createdAt:now,updatedAt:now,completedAt:null,
        result:{},error:null});
      const result={jobId,revisionId};
      tx.set(db.doc(receiptPath),{
        action:"publishQuiz",inputHash:digest,result,createdAt:now});
      // Same transaction as the job and quiz pointer update.
      tx.set(db.doc("auditEvents/evt_"+hash(receiptPath+
        ":quiz.publishing").slice(0,28)),{
        actorId:actor.uid,actorRoleAtTime:role.role,
        action:"quiz.publishing",targetType:"quiz",targetId:quizId,
        quizId,quizOwnerId:current.ownerId,
        affectedUserId:null,changedFields:[],
        requestId:request.requestId,occurredAt:now,
      });
      return result;
    });
  }
  return Object.freeze({enabled:true,publish});
}
