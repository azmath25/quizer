// QN11.6.5 — default-OFF durable Firebase coordinator for SQL bank edits.
// This is an independent Firestore transaction port. Every Neon call MUST
// execute strictly BETWEEN prepare and recordEffect/finalize. No credentials
// or protected problem/answer content may be stored in operation receipts.
import {randomUUID} from "node:crypto";
import {assert,id} from "../../shared/schema.js";
import {transact,requireRole,millis} from "../domain/runtime.js";
import {fingerprint} from "./write-repository.js";

const ACTIONS=new Set(["createProblem","saveProblemRevision","forkProblem",
  "setProblemSharing","trashProblem","restoreProblem","bulkUpdateProblems"]);
const SECRET_FIELDS=new Set(["acceptedAnswers","correctOptionId",
  "explanationLatex","rubricLatex","solutionAssetBindings",
  "grading","content","statementLatex","sourceText","rawLatex"]);
function safeResult(result){
  assert(result && typeof result==="object" && !Array.isArray(result),
    "FAILED_PRECONDITION","Bank effect must return bounded metadata.");
  const json=JSON.stringify(result);
  assert(typeof json==="string"&&json.length<=65536,
    "FAILED_PRECONDITION","Oversized bank effect receipt.");
  const examine=(value,depth=0)=>{
    assert(depth<=12,"FAILED_PRECONDITION","Nested bank result is invalid.");
    if(Array.isArray(value))return value.forEach(v=>examine(v,depth+1));
    if(!value||typeof value!=="object")return;
    for(const [key,v] of Object.entries(value)){
      assert(!SECRET_FIELDS.has(key),"FAILED_PRECONDITION",
        "Protected grading/source fields cannot enter Firebase receipts.");
      examine(v,depth+1);
    }
  };
  examine(result);
  return result;
}
export function createFirestoreBankMutationCoordinator({
  enabled=false,db,leaseMs=120000,
}={}){
  if(enabled!==true)return Object.freeze({enabled:false,
    prepare:async()=>({disabled:true}),
    recordEffect:async()=>({disabled:true}),
    finalize:async()=>({disabled:true})});
  assert(db?.doc&&typeof db.runTransaction==="function"&&
    Number.isInteger(leaseMs)&&leaseMs>=30000&&leaseMs<=300000,
    "INVALID_FIELDS","Trusted Firebase bank transaction port required.");
  const path=(uid,requestId)=>
    "operations/"+id(uid)+"/bankMutations/"+id(requestId);
  const validate=(action,auth,requestId,payloadHash)=>{
    assert(ACTIONS.has(action),"INVALID_FIELDS","Unsupported bank mutation.");
    assert(auth?.uid&&auth?.token&&typeof auth.token==="object",
      "AUTH_REQUIRED","Verified Firebase caller required.");
    assert(typeof requestId==="string"&&
      /^[A-Za-z0-9_-]{16,100}$/.test(requestId) &&
      typeof payloadHash==="string"&&/^[0-9a-f]{64}$/.test(payloadHash),
      "INVALID_FIELDS","Invalid durable bank request fingerprint.");
  };
  const identity=(a,action,payloadHash)=>{
    assert(a?.action===action&&a?.payloadHash===payloadHash,
      "VERSION_CONFLICT","Bank request ID was reused with different content.");
  };
  const owned=(row,uid,token)=>{
    assert(row?.token===token&&row.ownerUid===uid&&
      typeof token==="string"&&token.length>=16,
      "VERSION_CONFLICT","Bank mutation fence changed.");
  };
  const current=(row,now)=>
    assert(row.until&&millis(row.until)>millis(now),
      "VERSION_CONFLICT","Bank mutation lease has expired.");
  async function prepare({action,auth,requestId,payloadHash}={}){
    validate(action,auth,requestId,payloadHash);
    return transact(db,"bank.neon.prepare",requestId,async c=>{
      requireRole(c.actor,"teacher");
      const docPath=path(c.actor.uid,requestId);
      const old=await c.get(docPath,false);
      if(old)identity(old,action,payloadHash);
      if(old?.status==="complete")return {status:"complete",
        result:old.result};
      const token=old?.status==="prepared"&&old.until&&
        millis(old.until)>millis(c.now)?old.token:randomUUID();
      const until=new Date(millis(c.now)+leaseMs);
      const next={ownerUid:c.actor.uid,action,payloadHash,
        token,status:old?.status==="effect_recorded"&&
          token===old.token?"effect_recorded":"prepared",
        ...(old?.result?{result:old.result}:{}),
        until,updatedAt:c.now};
      c.set(docPath,next);
      return {status:"prepared",token};
    },auth);
  }
  async function recordEffect({action,auth,requestId,payloadHash,
    token,result}={}){
    validate(action,auth,requestId,payloadHash);
    safeResult(result);
    return transact(db,"bank.neon.effect",requestId,async c=>{
      requireRole(c.actor,"teacher");
      const docPath=path(c.actor.uid,requestId);
      const row=await c.get(docPath);
      identity(row,action,payloadHash);
      if(row.status==="complete"){
        assert(fingerprint(row.result)===fingerprint(result),
          "VERSION_CONFLICT","Completed bank receipt mismatched SQL result.");
        return {alreadyRecorded:true};
      }
      owned(row,c.actor.uid,token);current(row,c.now);
      if(row.result)assert(fingerprint(row.result)===fingerprint(result),
        "VERSION_CONFLICT","Conflicting SQL effect on request replay.");
      c.set(docPath,{...row,status:"effect_recorded",
        result,updatedAt:c.now});
      return {recorded:true};
    },auth);
  }
  async function finalize({action,auth,requestId,payloadHash,
    token,result}={}){
    validate(action,auth,requestId,payloadHash);
    safeResult(result);
    return transact(db,"bank.neon.finish",requestId,async c=>{
      requireRole(c.actor,"teacher");
      const docPath=path(c.actor.uid,requestId);
      const row=await c.get(docPath);
      identity(row,action,payloadHash);
      if(row.status==="complete")return row.result;
      owned(row,c.actor.uid,token);current(row,c.now);
      assert(row.status==="effect_recorded"&&
        fingerprint(row.result)===fingerprint(result),
        "VERSION_CONFLICT","SQL effect receipt absent or changed.");
      c.set(docPath,{...row,status:"complete",
        result,completedAt:c.now,updatedAt:c.now});
      return row.result;
    },auth);
  }
  return Object.freeze({enabled:true,prepare,recordEffect,finalize});
}
