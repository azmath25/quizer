// QN13-B — independent, TEST-ONLY release boundary assertions.
// Passing these tests cannot replace a real Quizer staging deployment.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createQuizerStagedFullRuntime}
  from "../../functions/src/bundles/private-full-staging.js";
import {createQuizerStagedPrivateRuntime}
  from "../../functions/src/bundles/private-staging-runtime.js";
import {createFirestoreBankMutationCoordinator}
  from "../../functions/src/neon/firebase-bank-coordinator.js";
import {createQuizerStagedRecoveryAudit}
  from "../../functions/src/bundles/private-recovery-audit.js";
import {createQuizerStagedIntegratedGateway}
  from "../../functions/src/bundles/private-staged-gateway.js";

const file=path=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");
test("QN13-B new bank/private/recovery runtime remains disabled without opt-in",async()=>{
  const factories=[
    createQuizerStagedFullRuntime(),
    createQuizerStagedPrivateRuntime(),
    createFirestoreBankMutationCoordinator(),
    createQuizerStagedRecoveryAudit(),
    createQuizerStagedIntegratedGateway(),
  ];
  assert(factories.every(f=>f.enabled===false));
  for(const f of factories){
    if(f.handle)assert.deepEqual(await f.handle(),{disabled:true});
    if(f.inspectExport)assert.deepEqual(await f.inspectExport(),
      {disabled:true});
  }
});
test("QN13-B active Functions endpoints must not import or invoke staged Neon gateway",()=>{
  const root=file("functions/src/index.js");
  const router=file("functions/src/router.js");
  const worker=file("functions/src/jobs/worker.js");
  const active=root+"\n"+router+"\n"+worker;
  for(const identifier of ["private-full-staging","private-staged-gateway",
    "private-staging-runtime","firebase-bank-coordinator",
    "private-recovery-audit","createQuizerSqlPort","quizerNeonConfig"])
    assert(!active.includes(identifier),identifier+" unexpectedly active");
  assert.match(root,/import \{ dispatch \} from "\.\/router\.js"/);
  assert.match(root,/import \{ runJob \} from "\.\/jobs\/worker\.js"/);
});
test("QN13-B client cannot access published private answer bundles directly",()=>{
  const storage=file("firebase/storage.rules");
  const firestore=file("firebase/firestore.rules");
  assert.match(storage,/match \/published-bundles\/v1\//);
  assert.match(storage,/match \/published-bundles\/v1\/[^]*?allow read, write: if false;/);
  assert.match(storage,/match \/\{allPaths=\*\*\} \{ allow read, write: if false; \}/);
  assert.match(firestore,/match \/\{document=\*\*\} \{ allow read, write: if false; \}/);
});
test("QN13-B SQL data model preserves append-only grading revision bodies",()=>{
  const sql=file("db/quizer/001_initial_schema.sql");
  const receipts=file("db/quizer/002_mutation_receipts_DISPOSABLE_ONLY.sql");
  assert.match(sql,/CREATE TRIGGER quizer_problem_revision_immutable/);
  assert.match(sql,/BEFORE UPDATE OR DELETE ON quizer\.problem_revisions/);
  assert.match(sql,/REVOKE ALL ON ALL TABLES IN SCHEMA quizer FROM PUBLIC;/);
  assert.match(receipts,/REVOKE ALL ON quizer\.mutation_receipts FROM PUBLIC;/);
  assert.match(receipts,/NEVER grant UPDATE or DELETE/);
});
test("QN13-B work-branch CI cannot deploy services or mutate databases",()=>{
  const workflow=file(".github/workflows/quizer-verify.yml");
  assert.match(workflow,/permissions:\s*\n  contents: read/);
  assert.match(workflow,/Unit regressions/);
  assert.match(workflow,/Emulator integration suite/);
  assert.match(workflow,/responsive quiz runner geometry/);
  assert(!/firebase deploy|gcloud run deploy|neonctl sql|supabase db push/.test(workflow));
  assert(!/id-token: write|contents: write/.test(workflow));
});
test("QN13-B private recovery must remain read-only and never delete objects",()=>{
  const inspector=createQuizerStagedRecoveryAudit();
  assert.equal(inspector.enabled,false);
  for(const key of ["remove","delete","cleanup","rollback","publish"])
    assert.equal(Object.hasOwn(inspector,key),false);
  const src=file("functions/src/bundles/private-recovery-audit.js");
  assert.match(src,/requireByteHash/);
  assert.match(src,/hashBytes\(bytes\)/);
  assert(!/\.delete\(|\.save\(|\.set\(/.test(src),
    "Recovery inspector may not mutate Firebase or Storage");
});
test("QN13-B App Check is configurable, not evidence of production enforcement",()=>{
  const config=file("functions/src/config.js");
  assert.match(config,/ENFORCE_APP_CHECK = process\.env\.ENFORCE_APP_CHECK === "true"/);
  // This is an explicit release gate, not a passing assertion that App Check
  // was enabled on a live Firebase deployment.
  const entry=file("functions/src/index.js");
  assert.match(entry,/enforceAppCheck: ENFORCE_APP_CHECK/);
});
