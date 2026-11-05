import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {QUIZER_MIGRATIONS,inspectQuizerMigrationPlan}
  from "../../scripts/staging/quizer-migration-gate.mjs";
const identity=Object.freeze({
  projectId:"soft-grass-35754518",
  parentBranchId:"br-wispy-night-b9ug6kub",
  branchId:"br-sweet-rice-b9ehdv9i",
  branchName:"stg1b-disposable-2026-11-04",
  database:"quizer",defaultBranch:false,primary:false,
});
const rows=QUIZER_MIGRATIONS.map(({version,gitBlob})=>
  ({version,gitBlob,status:"applied"}));
const inspect=(props={})=>inspectQuizerMigrationPlan({
  identity,applied:[],...props});
test("STG1 migration gate validates exact pinned repo bytes with no SQL actions",()=>{
  const plan=inspect();
  assert.equal(plan.pending.length,2);
  assert.equal(plan.applied.length,0);
  assert.equal(plan.safeToExecute,false);
  assert.equal("execute" in plan,false);
  assert.equal("connectionString" in plan,false);
  assert.deepEqual(plan.pending.map(x=>x.version),[1,2]);
});
test("STG1 migration ledger only accepts an ordered immutable prefix",()=>{
  assert.deepEqual(inspect({applied:[rows[0]]}).pending.map(x=>x.version),[2]);
  assert.deepEqual(inspect({applied:rows}).pending,[]);
  assert.match(inspect({applied:rows}).nextGate,/Verify role login/);
  for(const applied of [
    [rows[1]], [{...rows[0],gitBlob:"f".repeat(40)}],
    [{...rows[0],status:"running"}], [rows[0],rows[0]],
    [rows[0],{...rows[1],version:3}],
    [...rows,{version:3,gitBlob:"f".repeat(40),status:"applied"}],
  ])assert.throws(()=>inspect({applied}),/ledger/i);
});
test("STG1 planner forbids default Neon branch, any other project and credentials",()=>{
  for(const id of [
    {...identity,projectId:"other-project"},
    {...identity,branchId:identity.parentBranchId},
    {...identity,defaultBranch:true},
    {...identity,primary:true},
    {...identity,database:"mimo"},
    {...identity,branchName:"prod"},
  ])assert.throws(()=>inspect({identity:id}),/verified disposable/i);
  assert.throws(()=>inspect({identity,applied:null}),/ledger/);
});
test("STG1 planner fails if checked-in migration bytes drift or are unavailable",()=>{
  assert.throws(()=>inspect({readBytes:()=>Buffer.from("DROP DATABASE mimo")}),
    /source drift/);
  assert.throws(()=>inspect({readBytes:()=>null}),/nonbinary/);
  assert.throws(()=>inspect({readBytes:()=>{throw Error("missing");}}),/missing/);
});
test("STG1 migration gate imports no drivers, network or write-capable adapters",()=>{
  const src=readFileSync(new URL(
    "../../scripts/staging/quizer-migration-gate.mjs",import.meta.url),"utf8");
  assert.doesNotMatch(src,/from ["'](?:pg|postgres|firebase-admin|https|node:net)["']/);
  assert.doesNotMatch(src,/\b(client\.query|pool\.connect|fetch\(|process\.env|createPool|DROP SCHEMA)\b/);
});
