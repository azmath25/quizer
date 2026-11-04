// STG2.6 — synthetic backup/reset/recovery rehearsal, FIRESTORE EMULATOR ONLY.
// Never targets Quizer staging/production Firebase or any Neon database.
import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {initializeApp,getApps}
  from "../../functions/node_modules/firebase-admin/lib/esm/app/index.js";
import {getFirestore}
  from "../../functions/node_modules/firebase-admin/lib/esm/firestore/index.js";

const PROJECT="demo-mathquiz-v2";
assert(process.env.FIRESTORE_EMULATOR_HOST,
  "STG2.6 reset test requires a Firestore emulator");
const app=getApps().find(a=>a.name==="stg2-reset") ??
  initializeApp({projectId:PROJECT},"stg2-reset");
assert.equal(app.options.projectId,PROJECT);
const db=getFirestore(app);
const namespace="stg2reset_"+randomUUID().replaceAll("-","_");
assert(/^stg2reset_[A-Za-z0-9_]{8,64}$/.test(namespace));
const root="stg2Synthetic/"+namespace+"/records/";
const names=["problem","quiz","attempt"];
const original={
  problem:{id:"prb_synthetic",statement:"1+1=?",answer:"2",
    fixtureKind:"STG2_EMULATOR_ONLY"},
  quiz:{id:"quiz_synthetic",title:"Discardable quiz",
    fixtureKind:"STG2_EMULATOR_ONLY"},
  attempt:{id:"att_synthetic",student:"student_synthetic",
    score:2,fixtureKind:"STG2_EMULATOR_ONLY"},
};

function reference(name){
  assert(names.includes(name),"Unknown synthetic fixture record");
  const p=root+name;
  assert(p.startsWith(root) && !p.includes(".."),
    "Reset scope escaped synthetic namespace");
  return db.doc(p);
}
async function readAll(){
  const pairs=await Promise.all(names.map(async name=>{
    const snap=await reference(name).get();
    return [name,snap.exists?snap.data():null];
  }));
  return Object.fromEntries(pairs);
}
async function clearSyntheticRecords(){
  const batch=db.batch();
  for(const name of names)batch.delete(reference(name));
  await batch.commit();
}

test("STG2.6 backup/restore rehearsal works only with disposable emulator fixtures",async()=>{
  // Every fixture is uniquely named and strictly under stg2Synthetic/.
  let batch=db.batch();
  for(const name of names)batch.create(reference(name),original[name]);
  await batch.commit();

  const backup=await readAll();
  assert.deepEqual(backup,original);
  for(const record of Object.values(backup))
    assert.equal(record.fixtureKind,"STG2_EMULATOR_ONLY");

  await clearSyntheticRecords();
  assert.deepEqual(await readAll(),{
    problem:null,quiz:null,attempt:null,
  },"synthetic reset should leave no fixture records");

  // Restore is CREATE-ONLY, so it never overwrites newer legitimate state.
  batch=db.batch();
  for(const name of names)batch.create(reference(name),backup[name]);
  await batch.commit();
  assert.deepEqual(await readAll(),backup,
    "restored synthetic state must match its checkpoint exactly");

  // Replay/restore on occupied data is refused instead of overwriting.
  await assert.rejects((async()=>{
    const duplicate=db.batch();
    duplicate.create(reference("attempt"),backup.attempt);
    return duplicate.commit();
  })());

  await clearSyntheticRecords();
  assert.deepEqual(await readAll(),{
    problem:null,quiz:null,attempt:null,
  },"final fixture cleanup should affect only the test namespace");
});
