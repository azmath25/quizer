// QN11.4: default-OFF authenticated bank compatibility adapter.
// NOT installed in live Firebase dispatch; legacy is an injected trusted port.
// Never fall back to Firestore because Neon is unavailable.
import {createHmac,timingSafeEqual} from "node:crypto";
import {NeonContractError,requireTeacher,requireId} from "./contracts.js";
import {fingerprint} from "./write-repository.js";
import {fields} from "../../shared/schema.js";

const fail=(reason,message)=>{throw new NeonContractError(reason,message);};
const ACTION_FIELDS=Object.freeze({
  getProblem:["problemId","revisionId"],
  listProblemRevisions:["problemId","limit","cursor"],
  listProblems:["view","lifecycle","search","subject","difficulty","tag","limit","cursor"],
  createProblem:["metadata","content","grading"],
  saveProblemRevision:["problemId","expectedVersion","metadata","content","grading"],
  forkProblem:["problemId","revisionId","title"],
  setProblemSharing:["problemId","expectedVersion","visibility"],
  trashProblem:["problemId","expectedVersion","visibility"],
  restoreProblem:["problemId","expectedVersion","visibility"],
  bulkUpdateProblems:["problemIds","subject","difficulty","addTags","removeTags","visibility"],
});
const MUTATIONS=new Set(["createProblem","saveProblemRevision","forkProblem",
  "setProblemSharing","trashProblem","restoreProblem","bulkUpdateProblems"]);
const ORIGINS=new Set(["neon_revision","firestore_legacy"]);
const unsafe=k=>["__proto__","prototype","constructor"].includes(k);
function secureCursor(secret,payload){
  const msg=Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac=createHmac("sha256",secret).update(msg).digest("base64url");
  return msg+"."+mac;
}
function parseCursor(secret,token,scope){
  if(!token)return null;
  if(typeof token!=="string"||token.length>3000 ||
    !/^[\w-]+\.[\w-]+$/.test(token))
    fail("INVALID_FIELDS","Invalid bank cursor.");
  const [msg,mac]=token.split(".");
  const expected=createHmac("sha256",secret).update(msg).digest();
  const given=Buffer.from(mac,"base64url");
  if(given.length!==expected.length||!timingSafeEqual(given,expected))
    fail("INVALID_FIELDS","Invalid bank cursor.");
  let data;
  try{data=JSON.parse(Buffer.from(msg,"base64url").toString("utf8"));}
  catch{fail("INVALID_FIELDS","Invalid bank cursor.");}
  if(data.v!==1||data.scope!==scope||!data.after)
    fail("INVALID_FIELDS","Bank cursor belongs to a different search.");
  requireId(data.after.problemId);
  if(data.after.updatedAt!==undefined &&
    !Number.isFinite(Date.parse(data.after.updatedAt)))
    fail("INVALID_FIELDS","Invalid bank cursor time.");
  if(data.after.searchTitle!==undefined &&
    (typeof data.after.searchTitle!=="string"||data.after.searchTitle.length>200))
    fail("INVALID_FIELDS","Invalid bank cursor title.");
  return data.after;
}
function revisionAfter(secret,token,scope){
  if(!token)return null;
  if(typeof token!=="string"||token.length>3000 ||
    !/^[\\w-]+\\.[\\w-]+$/.test(token))
    fail("INVALID_FIELDS","Invalid revision cursor.");
  const [msg,mac]=token.split(".");
  const expected=createHmac("sha256",secret).update(msg).digest();
  const supplied=Buffer.from(mac,"base64url");
  if(supplied.length!==expected.length||
    !timingSafeEqual(supplied,expected))
    fail("INVALID_FIELDS","Invalid revision cursor.");
  let data;
  try{data=JSON.parse(Buffer.from(msg,"base64url").toString("utf8"));}
  catch{fail("INVALID_FIELDS","Invalid revision cursor.");}
  if(data?.v!==1||data.scope!==scope||
    typeof data.after?.createdAt!=="string"||
    !Number.isFinite(Date.parse(data.after.createdAt)))
    fail("INVALID_FIELDS","Revision cursor scope or time changed.");
  requireId(data.after.revisionId,"revision cursor ID");
  return data.after;
}
function normalizedList(r){
  const view=r.view??"mine",lifecycle=r.lifecycle??"active";
  if(!["mine","shared"].includes(view) ||
    !["active","trashed"].includes(lifecycle))
    fail("INVALID_FIELDS","Invalid bank filter.");
  const limit=r.limit??25;
  if(!Number.isInteger(limit)||limit<1||limit>100)
    fail("INVALID_FIELDS","Page size must be 1–100.");
  const params={view,lifecycle,limit};
  for(const [k,max] of [["search",200],["subject",80],["difficulty",40],["tag",60]]){
    if(r[k]!==undefined&& (typeof r[k]!=="string" ||r[k].length>max))
      fail("INVALID_FIELDS","Invalid bank filter.");
    params[k]=r[k]??"";
  }
  if(["subject","difficulty","tag"].filter(k=>params[k]).length>1)
    fail("INVALID_FIELDS","Use only one optional bank field filter.");
  return params;
}
function visible(row,actor,p){
  if(!row||typeof row!=="object"||unsafe(row.id))return false;
  if(p.view==="mine"&&(row.ownerId!==actor.uid||
    row.lifecycle!==p.lifecycle))return false;
  if(p.view==="shared"&&(row.bankVisibility!=="teachers"||
    row.lifecycle!=="active"))return false;
  if(p.subject&&row.subject!==p.subject)return false;
  if(p.difficulty&&row.difficulty!==p.difficulty)return false;
  if(p.tag&&!(row.tags??[]).includes(p.tag))return false;
  if(p.search&&!(row.searchTitle??row.title?.toLowerCase()??"")
    .startsWith(p.search.toLowerCase()))return false;
  return true;
}
const ordered=(row,search)=>search
  ? [row.searchTitle??row.title?.toLowerCase()??"",row.id??row.problemId]
  : [Date.parse(row.updatedAt),row.id??row.problemId];
function compare(a,b,search){
  const x=ordered(a,search),y=ordered(b,search);
  const first=x[0]===y[0]?0:x[0]<y[0]?-1:1;
  return first*(search?1:-1)||
    ((x[1]===y[1])?0:(x[1]<y[1]?-1:1))*(search?1:-1);
}
function checkCursorAfter(row,after,search){
  if(!after)return true;
  const marker=search?
    {id:after.problemId,searchTitle:after.searchTitle}:
    {id:after.problemId,updatedAt:after.updatedAt};
  return compare(row,marker,search)>0;
}
export function createQuizerBankCompatibility({
  enabled=false,resolveFirebaseActor,resolveOrigin,legacy,
  neonReader,neonGateway,bankMutations,coordinator,cursorSecret,
}={}){
  if(enabled!==true)return Object.freeze({
    enabled:false,handle:async()=>({disabled:true}),
  });
  if(typeof resolveFirebaseActor!=="function"||
    typeof resolveOrigin!=="function"||
    typeof legacy?.handle!=="function"||
    typeof legacy?.listHeaders!=="function"||
    typeof neonReader?.getProblemForTeacher!=="function"||
    typeof neonReader?.listProblemHeaders!=="function"||
    typeof neonReader?.listProblemRevisions!=="function"||
    !neonGateway?.enabled || !bankMutations?.enabled ||
    typeof bankMutations?.mutate!=="function" ||
    !coordinator?.enabled ||
    ["prepare","recordEffect","finalize"].some(k=>
      typeof coordinator[k]!=="function") ||
    !(typeof cursorSecret==="string"&&cursorSecret.length>=32))
    throw Error("QN11.4 requires trusted bank ports, a fenced coordinator and cursor secret.");
  async function originOf(problemId,actor){
    const origin=await resolveOrigin({problemId:requireId(problemId),actor});
    if(!ORIGINS.has(origin))
      fail("RESOURCE_UNAVAILABLE","Unknown or unverified problem provenance.");
    return origin;
  }
  async function route(action,actor,auth,r){
    if(action==="listProblems"){
      const p=normalizedList(r);
      const scope=fingerprint({actor:actor.uid,...p,limit:undefined});
      const after=parseCursor(cursorSecret,r.cursor,scope);
      const opts={actor,...p,after,limit:p.limit+1};
      // Two independently authorized stores, both must support the same
      // global exclusive keyset cursor. No catch/fallback on Neon outage.
      const [old,neon]=await Promise.all([
        legacy.listHeaders(opts),
        neonReader.listProblemHeaders(opts),
      ]);
      if(!Array.isArray(old?.items)||!Array.isArray(neon?.items))
        fail("FAILED_PRECONDITION","Incomplete bank source page.");
      const seen=new Set();
      const items=[...old.items,...neon.items].filter(row=>
        visible(row,actor,p)&&checkCursorAfter(row,after,!!p.search));
      for(const row of items){
        const problemId=requireId(row.id??row.problemId);
        if(seen.has(problemId))
          fail("VERSION_CONFLICT","Duplicate problem ID across sources.");
        seen.add(problemId);
      }
      items.sort((a,b)=>compare(a,b,!!p.search));
      const page=items.slice(0,p.limit);
      const last=page.at(-1);
      return {items:page,nextCursor:items.length>p.limit?secureCursor(
        cursorSecret,{v:1,scope,after:p.search
          ? {searchTitle:ordered(last,true)[0],problemId:last.id??last.problemId}
          : {updatedAt:new Date(ordered(last,false)[0]).toISOString(),
              problemId:last.id??last.problemId}}):null};
    }
    if(action==="getProblem"||action==="listProblemRevisions"){
      const origin=await originOf(r.problemId,actor);
      if(origin==="firestore_legacy")return legacy.handle(action,auth,r);
      if(action==="getProblem")return neonReader.getProblemForTeacher({
        actor,problemId:r.problemId,revisionId:r.revisionId??null});
      const limit=r.limit??25;
      if(!Number.isInteger(limit)||limit<1||limit>100)
        fail("INVALID_FIELDS","Invalid revision page size.");
      const scope=fingerprint({
        actorUid:actor.uid,action,problemId:r.problemId,limit});
      const page=await neonReader.listProblemRevisions({
        actor,problemId:r.problemId,limit,
        after:revisionAfter(cursorSecret,r.cursor,scope)});
      return {items:page.items,nextCursor:page.next?secureCursor(
        cursorSecret,{v:1,scope,after:page.next}):null};
    }
    if(MUTATIONS.has(action)){
      if(action!=="createProblem"){
        const targets=action==="bulkUpdateProblems"?r.problemIds:[r.problemId];
        if(!Array.isArray(targets)||!targets.length||targets.length>50)
          fail("INVALID_FIELDS","Invalid problem selection.");
        const origins=await Promise.all(targets.map(id=>originOf(id,actor)));
        if(origins.every(x=>x==="firestore_legacy"))
          return legacy.handle(action,auth,r);
        if(origins.some(x=>x!=="neon_revision"))
          fail("FAILED_PRECONDITION","Mixed legacy/Neon bulk writes are not atomic.");
      }
      if(typeof r.requestId!=="string"||
        !/^[A-Za-z0-9_-]{16,100}$/.test(r.requestId))
        fail("INVALID_FIELDS","A unique request ID is required.");
      const hash=fingerprint(r);
      const claim=await coordinator.prepare({action,auth,
        requestId:r.requestId,payloadHash:hash});
      if(claim?.status==="complete")return claim.result;
      if(claim?.status!=="prepared"||typeof claim.token!=="string"||
        claim.token.length<16)
        fail("FAILED_PRECONDITION","No durable bank mutation fence.");
      const result=["createProblem","saveProblemRevision"].includes(action)
        ? await neonGateway.handle(action,auth,r)
        : await bankMutations.mutate({actor,action,requestId:r.requestId,
            request:Object.fromEntries(Object.entries(r).filter(([k])=>
              !["apiVersion","action","requestId"].includes(k)))});
      await coordinator.recordEffect({action,auth,requestId:r.requestId,
        payloadHash:hash,token:claim.token,result});
      return coordinator.finalize({action,auth,requestId:r.requestId,
        payloadHash:hash,token:claim.token,result});
    }
    fail("INVALID_FIELDS","Unknown staged bank action.");
  }
  return Object.freeze({
    enabled:true,
    async handle(action,auth,request){
      if(!Object.hasOwn(ACTION_FIELDS,action))
        fail("INVALID_FIELDS","Unknown bank action.");
      fields(request,["apiVersion","action","requestId",...ACTION_FIELDS[action]]);
      if(request.apiVersion!==2||request.action!==action)
        fail("INVALID_FIELDS","Invalid callable action envelope.");
      if(!auth?.uid||!auth?.token)
        fail("AUTH_REQUIRED","Verified Firebase callable identity required.");
      const actor=requireTeacher(await resolveFirebaseActor(auth));
      return route(action,actor,auth,request);
    },
  });
}
