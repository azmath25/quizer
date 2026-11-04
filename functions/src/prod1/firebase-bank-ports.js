// PROD1: trusted Firebase-side adapters for the staged Quizer bank.
// Not an endpoint and not imported by the active production dispatcher.
// All public user/role data are obtained from Firebase Admin, not request JSON.
import {assert,id} from "../../shared/schema.js";
import {requireTeacher} from "../neon/contracts.js";

const MAX_ASSET_REFS=200;

const iso=value => {
  const v=value?.toDate?.()??value;
  const date=v instanceof Date?v:new Date(v);
  assert(Number.isFinite(date.getTime()),"FAILED_PRECONDITION",
    "Invalid legacy bank timestamp.");
  return date.toISOString();
};

export function createProd1FirebaseBankPorts({
  enabled=false,db,legacyDispatch,
}={}){
  if(enabled!==true)return Object.freeze({enabled:false});
  assert(db?.doc&&db?.collection&&typeof db.runTransaction==="function"&&
    typeof legacyDispatch==="function","FAILED_PRECONDITION",
    "Trusted Firebase Admin and legacy dispatcher required.");
  const get=async path=>{
    const snapshot=await db.doc(path).get();
    return snapshot.exists?snapshot.data():null;
  };
  const resolveFirebaseActor=async auth=>{
    assert(auth?.uid&&auth?.token&&typeof auth.token==="object"&&
      !Array.isArray(auth.token),"AUTH_REQUIRED",
      "A verified Firebase callable user is required.");
    const uid=id(auth.uid);
    const role=await get("roles/"+uid);
    const user=await get("users/"+uid);
    return Object.freeze({
      uid,
      role:role?.role??"student",
      accountStatus:role?.accountStatus??"active",
      roleVersion:role?.version??0,
      emailVerified:auth.token.email_verified===true,
      displayName:user?.displayName??auth.token.name??"",
    });
  };
  const verifyAssets=async ({actor,assetIds=[]})=>{
    requireTeacher(actor);
    assert(Array.isArray(assetIds)&&assetIds.length<=MAX_ASSET_REFS&&
      assetIds.every(a=>typeof a==="string"),
      "INVALID_FIELDS","Too many or invalid asset references.");
    for(const assetId of new Set(assetIds)){
      const asset=await get("assets/"+id(assetId));
      // The initial PROD1 writer only accepts author-owned ready images or
      // source files. Shared assets need a separately tested live grant gate.
      assert(asset&&asset.ownerId===actor.uid&&asset.status==="ready"&&
        ["image","source"].includes(asset.kind),
        "RESOURCE_UNAVAILABLE","Asset unavailable or not authorized.");
    }
    return true;
  };
  const verifyAssetCopy=async ({actor,assetIds=[]})=>
    verifyAssets({actor,assetIds});
  const readFirebaseImportJob=async ({actor,jobId})=>{
    requireTeacher(actor);
    const job=await get("jobs/"+id(jobId));
    assert(job?.kind==="import"&&job.requestedBy===actor.uid&&
      job.status==="running","RESOURCE_UNAVAILABLE",
      "Import job unavailable.");
    return job;
  };
  const resolveProblemOrigin=async ({actor,problemId})=>{
    requireTeacher(actor);
    // Only a real retained Firestore problem takes the legacy route. A SQL
    // failure is never interpreted as a reason to write to Firestore.
    const legacy=await get("problems/"+id(problemId));
    return legacy?"firestore_legacy":"neon_revision";
  };
  const legacyHandle=async (action,auth,request)=>{
    assert(request?.action===action&&request?.apiVersion===2,
      "INVALID_FIELDS","Invalid legacy action.");
    const answer=await legacyDispatch(db,auth,request);
    assert(answer?.apiVersion===2&&Object.hasOwn(answer,"data"),
      "FAILED_PRECONDITION","Invalid legacy Firebase response.");
    return answer.data;
  };
  const legacyListHeaders=async ({
    actor,view="mine",lifecycle="active",search="",tag="",
    subject="",difficulty="",limit=25,after=null,
  }={})=>{
    requireTeacher(actor);
    assert(["mine","shared"].includes(view)&&
      ["active","trashed"].includes(lifecycle)&&
      Number.isInteger(limit)&&limit>=1&&limit<=101&&
      typeof search==="string"&&search.length<=200,
      "INVALID_FIELDS","Invalid bank search.");
    const byTitle=!!search.trim(),dir=byTitle?"asc":"desc";
    let q=db.collection("problems");
    if(view==="mine")q=q.where("ownerId","==",actor.uid)
      .where("lifecycle","==",lifecycle);
    else q=q.where("bankVisibility","==","teachers")
      .where("lifecycle","==","active");
    if(subject)q=q.where("subject","==",subject);
    if(difficulty)q=q.where("difficulty","==",difficulty);
    if(tag)q=q.where("tags","array-contains",tag);
    if(byTitle){
      const prefix=search.trim().toLowerCase();
      q=q.where("searchTitle",">=",prefix)
        .where("searchTitle","<",prefix+"\uf8ff");
    }
    // Explicit document-ID secondary ordering makes an equal-timestamp
    // cursor deterministic across both SQL and Firestore.
    q=q.orderBy(byTitle?"searchTitle":"updatedAt",dir)
      .orderBy("__name__",dir);
    if(after){
      id(after.problemId,"legacy cursor problem ID");
      const pivot=byTitle?after.searchTitle:new Date(after.updatedAt);
      if(!byTitle)assert(Number.isFinite(pivot.getTime()),"INVALID_FIELDS",
        "Invalid bank cursor timestamp.");
      q=q.startAfter(pivot,after.problemId);
    }
    const result=await q.limit(limit).get();
    const items=result.docs.map(d=>{
      const p=d.data();
      return {
        id:d.id,problemId:d.id,ownerId:p.ownerId,
        ownerDisplayName:p.ownerDisplayName??"",
        title:p.title,searchTitle:p.searchTitle??p.title?.toLowerCase()??"",
        subject:p.subject,difficulty:p.difficulty,tags:p.tags??[],
        bankVisibility:p.bankVisibility,lifecycle:p.lifecycle,
        latestRevisionId:p.latestRevisionId,
        revisionNumber:p.revisionNumber,version:p.version,
        updatedAt:iso(p.updatedAt),
      };
    });
    return {items};
  };
  return Object.freeze({enabled:true,resolveFirebaseActor,verifyAssets,
    verifyAssetCopy,readFirebaseImportJob,resolveProblemOrigin,
    legacyHandle,legacyListHeaders});
}
