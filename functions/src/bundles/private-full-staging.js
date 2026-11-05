// QN11.6.5 — fully composed DEFAULT-OFF trusted bank/import/private router.
// It is a DEVELOPMENT-ONLY assembly contract and intentionally unmounted
// from existing Firebase endpoints. Real SQL/Storage credentials are NEVER
// supplied here by browser input or read from environment at import time.
import {assert} from "../../shared/schema.js";
import {createQuizerBankCompatibility} from "../neon/bank-compat.js";
import {createFirestoreBankMutationCoordinator}
  from "../neon/firebase-bank-coordinator.js";
import {createQuizerImportCoordinator}
  from "../neon/import-coordinator.js";
import {createQuizerNeonOrchestrator}
  from "../neon/orchestrator.js";
import {createQuizerStagedIntegratedGateway}
  from "./private-staged-gateway.js";
export function createQuizerStagedFullRuntime({
  enabled=false,db,neonReader,neonGateway,bankMutations,
  resolveFirebaseActor,resolveProblemOrigin,
  privateRuntime,legacyHandle,legacyListHeaders,
  legacyActionNames=[],cursorSecret,
}={}){
  if(enabled!==true)return Object.freeze({
    enabled:false,handle:async()=>({disabled:true}),
    runPrivateJob:async()=>({disabled:true})});
  assert(db?.doc&&typeof db.runTransaction==="function" &&
    neonGateway?.enabled===true &&
    neonGateway.replaySafeEdits===true &&
    bankMutations?.enabled===true &&
    typeof neonReader?.getProblemForTeacher==="function" &&
    typeof neonReader?.listProblemHeaders==="function" &&
    typeof neonReader?.listProblemRevisions==="function" &&
    typeof resolveFirebaseActor==="function" &&
    typeof resolveProblemOrigin==="function" &&
    privateRuntime?.enabled===true &&
    typeof legacyHandle==="function" &&
    typeof legacyListHeaders==="function" &&
    typeof cursorSecret==="string"&&cursorSecret.length>=32,
    "INVALID_FIELDS","Trusted read/write, actor and legacy ports required.");
  const bankCoordinator=createFirestoreBankMutationCoordinator({
    enabled:true,db});
  const importCoordinator=createQuizerImportCoordinator({
    enabled:true,db});
  const importGateway=createQuizerNeonOrchestrator({
    enabled:true,gateway:neonGateway,coordinator:importCoordinator});
  const bankCompat=createQuizerBankCompatibility({
    enabled:true,resolveFirebaseActor,resolveOrigin:resolveProblemOrigin,
    legacy:{handle:legacyHandle,listHeaders:legacyListHeaders},
    neonReader,neonGateway,bankMutations,
    coordinator:bankCoordinator,cursorSecret,
  });
  const router=createQuizerStagedIntegratedGateway({
    enabled:true,bankCompat,importGateway,privateRuntime,
    legacyActions:legacyActionNames,legacyHandle,
  });
  return Object.freeze({...router,enabled:true,
    // Only a server-side readiness harness may inspect these ports;
    // no active API, production database, export of credentials or warm-up.
    capabilities:Object.freeze({bankMutationReceipts:true,
      boundedImportReceipts:true,privateBundleServing:true,
      pinnedLegacyRouting:true}),
  });
}
