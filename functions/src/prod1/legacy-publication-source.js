// PROD1-P0: trusted, read-only Firestore source adapter for private bundles.
// Legacy quiz slots can be frozen alongside Neon slots without writing keys
// into job documents. No Firestore transactions contain Neon/Storage IO.
import {assert,id,validateProblem,assetIds}
  from "../../shared/schema.js";
import {fingerprint} from "../neon/write-repository.js";
import {requireTeacher} from "../neon/contracts.js";

const CONTENT=["type","answerMode","statementLatex","options",
  "defaultPoints","questionAssetBindings"];
const GRADING=["correctOptionId","acceptedAnswers","tolerance",
  "explanationLatex","rubricLatex","solutionAssetBindings"];
const ownedOrShared=(actor,problem)=>
  problem&&(problem.ownerId===actor.uid||actor.role==="admin"||
    (problem.bankVisibility==="teachers"&&problem.lifecycle==="active"));
export function normalizeProd1LegacySource(content,grading,{points}={}){
  assert(content&&grading,"RESOURCE_UNAVAILABLE",
    "Pinned legacy problem revision unavailable.");
  const sanitized=Object.fromEntries(CONTENT
    .filter(k=>Object.hasOwn(content,k))
    .map(k=>[k,content[k]]));
  if(sanitized.defaultPoints==null&&points!=null)
    sanitized.defaultPoints=points;
  const secret=Object.fromEntries(GRADING
    .filter(k=>Object.hasOwn(grading,k))
    .map(k=>[k,grading[k]]));
  return validateProblem(sanitized,secret);
}
export function createProd1LegacyPublicationSource({
  enabled=false,db,resolvePublicationActor,verifyAssets,
}={}){
  if(enabled!==true)return Object.freeze({enabled:false,
    preflight:async()=>({disabled:true}),
    resolve:async()=>({disabled:true})});
  assert(db?.doc&&typeof resolvePublicationActor==="function"&&
    typeof verifyAssets==="function",
    "FAILED_PRECONDITION","Trusted legacy source adapters required.");
  const get=async path=>{
    const snap=await db.doc(path).get();
    return snap.exists?snap.data():null;
  };
  async function load({actor,quizId,slot,source=null,
    retainedRevisionId=null}={}){
    requireTeacher(actor);
    const q=id(quizId),problemId=id(slot?.problemId),
      revisionId=id(slot?.problemRevisionId),
      itemId=id(slot?.itemId);
    // Never let a client decide which revision or snapshot to load.
    const marker=source?.pathType??null;
    assert(marker===null||marker==="problem"||marker==="snapshot",
      "RESOURCE_UNAVAILABLE","Unknown legacy source marker.");
    const problem=await get("problems/"+problemId);
    const canRead=ownedOrShared(actor,problem)&&
      problem?.lifecycle==="active";
    if((marker===null&&canRead)||marker==="problem"){
      assert(canRead,"RESOURCE_UNAVAILABLE",
        "Legacy problem was revoked before publishing.");
      const p="problems/"+problemId+"/revisions/"+revisionId;
      const [content,grading]=await Promise.all([
        get(p),get(p+"/grading/main"),
      ]);
      const normalized=normalizeProd1LegacySource(content,grading);
      return {...normalized,problemId,problemRevisionId:revisionId,
        contentHash:fingerprint(normalized),
        source:{kind:"firestore_legacy",pathType:"problem",
          problemId,problemRevisionId:revisionId}};
    }
    const saved=id(source?.publishedRevisionId??retainedRevisionId,
      "retained published revision");
    // Retained snapshots are allowed only for an already-published slot
    // belonging to a quiz the author owns, not arbitrary file paths.
    const quiz=await get("quizzes/"+q);
    assert(quiz&&(quiz.ownerId===actor.uid||actor.role==="admin")&&
      [quiz.publishedRevisionId,quiz.lastPublishedRevisionId].includes(saved),
      "RESOURCE_UNAVAILABLE","Retained publication unavailable.");
    const root="quizzes/"+q+"/revisions/"+saved;
    const [revision,item,grading]=await Promise.all([
      get(root),get(root+"/items/"+itemId),get(root+"/grading/"+itemId),
    ]);
    assert(revision?.state==="ready"&&!revision.bundle&&
      item?.problemId===problemId&&
      item?.problemRevisionId===revisionId,
      "RESOURCE_UNAVAILABLE",
      "Pinned retained legacy item cannot be verified.");
    const normalized=normalizeProd1LegacySource(item,grading,
      {points:slot.points});
    return {...normalized,problemId,problemRevisionId:revisionId,
      contentHash:fingerprint(normalized),
      source:{kind:"firestore_legacy",pathType:"snapshot",
        problemId,problemRevisionId:revisionId,
        publishedRevisionId:saved,itemId}};
  }
  async function checkAssets({actor,plan,slot,loaded}){
    const refs=assetIds(loaded.content,loaded.grading);
    assert(await verifyAssets({
      actor,plan,problemId:slot.problemId,
      problemRevisionId:slot.problemRevisionId,assetIds:refs,
    })===true,"RESOURCE_UNAVAILABLE",
    "Legacy question/solution assets no longer authorized.");
  }
  async function preflight({actor,quizId,slot,
    retainedRevisionId=null}={}){
    const loaded=await load({actor,quizId,slot,retainedRevisionId});
    await checkAssets({actor,slot,loaded});
    return loaded;
  }
  async function resolve({problemId,problemRevisionId,source,plan}={}){
    id(problemId);id(problemRevisionId);
    assert(plan?.jobId&&plan?.leaseOwner&&plan?.quizId&&
      Array.isArray(plan.sources)&&plan.sources.length>=1&&
      plan.sources.length<=500,
      "JOB_LEASE","Trusted publication plan required.");
    const pinned=plan.sources.filter(s=>s.source?.kind==="firestore_legacy"&&
      s.problemId===problemId&&s.problemRevisionId===problemRevisionId&&
      s.source?.pathType===source?.pathType);
    assert(pinned.length>0 &&
      /^[0-9a-f]{64}$/.test(pinned[0].contentHash)&&
      pinned.every(s=>s.contentHash===pinned[0].contentHash),
      "VERSION_CONFLICT","Pinned legacy source changed.");
    const actor=requireTeacher(await resolvePublicationActor({plan}));
    const slot=pinned[0],loaded=await load({
      actor,quizId:plan.quizId,slot,source:slot.source,
    });
    assert(loaded.contentHash===slot.contentHash&&
      JSON.stringify(loaded.source)===JSON.stringify(slot.source),
      "VERSION_CONFLICT","Frozen legacy revision changed.");
    await checkAssets({actor,plan,slot,loaded});
    return {problemId,problemRevisionId,
      content:loaded.content,grading:loaded.grading};
  }
  return Object.freeze({enabled:true,preflight,resolve});
}
