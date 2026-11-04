// PROD1: opt-in server-only bank/import composition, NOT an active endpoint.
// Connects only an explicitly verified SAT QUIZ Neon branch; never Mimo.
// Publishing/attempts MUST NOT be switched to this runtime until trusted
// draft-source and private-bundle adapters pass real-cloud acceptance.
import {assert} from "../../shared/schema.js";
import {createSatQuizNeonSql,SAT_QUIZ_NEON} from "../neon/sat-quiz-live-sql.js";
import {createQuizerNeonReadRepository} from "../neon/repository.js";
import {createQuizerNeonWriteRepository} from "../neon/write-repository.js";
import {createQuizerNeonActionGateway} from "../neon/action-gateway.js";
import {createQuizerNeonBankMutations} from "../neon/bank-mutations.js";
import {createFirestoreBankMutationCoordinator}
  from "../neon/firebase-bank-coordinator.js";
import {createQuizerImportCoordinator} from "../neon/import-coordinator.js";
import {createQuizerNeonOrchestrator} from "../neon/orchestrator.js";
import {createQuizerBankCompatibility} from "../neon/bank-compat.js";
import {createProd1FirebaseBankPorts} from "./firebase-bank-ports.js";

const BANK=new Set(["getProblem","listProblemRevisions","listProblems",
  "createProblem","saveProblemRevision","forkProblem","setProblemSharing",
  "trashProblem","restoreProblem","bulkUpdateProblems"]);
export const PROD1_BANK_ACTIONS=Object.freeze([...BANK]);
export function createProd1BankRuntime({
  enabled=false,firebaseProjectId="",db,connectionString,
  cursorSecret="",legacyDispatch,createPool,
}={}){
  if(enabled!==true)return Object.freeze({
    enabled:false,handle:async()=>({disabled:true}),
    close:async()=>{},
  });
  assert(firebaseProjectId===SAT_QUIZ_NEON.firebaseProject&&
    typeof cursorSecret==="string"&&cursorSecret.length>=32,
    "FAILED_PRECONDITION","Prod1 project and private bank cursor key required.");
  const firebase=createProd1FirebaseBankPorts({
    enabled:true,db,legacyDispatch});
  const sql=createSatQuizNeonSql({
    enabled:true,firebaseProject:firebaseProjectId,
    connectionString,createPool});
  const read=createQuizerNeonReadRepository(sql);
  const writer=createQuizerNeonWriteRepository({
    enabled:true,sql,verifyAssets:firebase.verifyAssets});
  const gateway=createQuizerNeonActionGateway({
    enabled:true,writer,resolveFirebaseActor:firebase.resolveFirebaseActor,
    readFirebaseImportJob:firebase.readFirebaseImportJob});
  const mutations=createQuizerNeonBankMutations({
    enabled:true,sql,verifyAssetCopy:firebase.verifyAssetCopy});
  const coordinator=createFirestoreBankMutationCoordinator({
    enabled:true,db});
  const compat=createQuizerBankCompatibility({
    enabled:true,resolveFirebaseActor:firebase.resolveFirebaseActor,
    resolveOrigin:firebase.resolveProblemOrigin,
    legacy:{handle:firebase.legacyHandle,
      listHeaders:firebase.legacyListHeaders},
    neonReader:read,neonGateway:gateway,bankMutations:mutations,
    coordinator,cursorSecret});
  const imports=createQuizerNeonOrchestrator({
    enabled:true,gateway,coordinator:createQuizerImportCoordinator({
      enabled:true,db})});
  return Object.freeze({
    enabled:true,
    supportedActions:Object.freeze([...BANK,"importProblemBatch"]),
    async handle(action,auth,request){
      assert(request?.action===action&&request?.apiVersion===2,
        "INVALID_FIELDS","Invalid PROD1 action envelope.");
      // Refuse draft/quiz/publish/student action until its full adapter has
      // been explicitly approved. Nothing silently falls back after SQL error.
      if(BANK.has(action))return compat.handle(action,auth,request);
      if(action==="importProblemBatch")
        return imports.handle(action,auth,request);
      assert(false,"INVALID_FIELDS","Prod1 bank does not own this action.");
    },
    read,
    close:()=>sql.close(),
  });
}
