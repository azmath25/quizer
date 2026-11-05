#!/usr/bin/env node
// Quizer P4: BOUNDED, READ-ONLY Firestore <-> Neon source audit.
// Safe for Cloud Shell ONLY after explicit project/role verification.
// Does not repair, write, migrate, deploy, log protected answer keys or
// request downloadable private bundle URLs. Defaults to THREE quizzes.
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
import {classifyQuizSourceReferences}
  from "../../functions/src/neon/reference-reconciliation.js";

const requireAdmin=createRequire(new URL("../../functions/package.json",import.meta.url));
const {initializeApp,applicationDefault,getApps}=requireAdmin("firebase-admin/app");
const {getFirestore,FieldPath}=requireAdmin("firebase-admin/firestore");
const {Pool}=requireAdmin("pg");
const PROJECT="sat-quiz-fd317";
const HOST="ep-ancient-voice-b9jua9ew-pooler.c-7.eu-central-1.aws.neon.tech";
const limit=Number(process.argv.find(x=>x.startsWith("--limit="))
  ?.slice("--limit=".length)??3);
const includeIds=process.argv.includes("--include-ids");
const anon=v=>includeIds?v:
  createHash("sha256").update(String(v)).digest("hex").slice(0,12);
if(!Number.isInteger(limit)||limit<1||limit>20)throw Error("--limit must be 1–20");
if(process.env.GOOGLE_CLOUD_PROJECT!==PROJECT &&
   process.env.GCLOUD_PROJECT!==PROJECT)
  throw Error("STOP: Wrong Google Cloud project.");
const connectionString=process.env.QUIZER_NEON_DATABASE_URL;
if(typeof connectionString!=="string"||!connectionString)
  throw Error("Missing QUIZER_NEON_DATABASE_URL secret in environment.");
const uri=new URL(connectionString);
if(uri.hostname!==HOST||decodeURIComponent(uri.username)!=="quizer_app"||
   uri.pathname!=="/quizer"||!uri.password)
  throw Error("STOP: wrong Neon host/database/least-privilege role.");
if(!getApps().length)
  initializeApp({credential:applicationDefault(),projectId:PROJECT});
const db=getFirestore(),pool=new Pool({connectionString,max:1,
  connectionTimeoutMillis:5000,idleTimeoutMillis:5000});
let pgClient;
const counts={scannedQuizzes:0,scannedSlots:0,firestoreReads:0,
  neonQueries:0,unresolved:0,uncertain:0,overlap:0};
const findings=[];
const readBatch=async refs=>{
  if(!refs.length)return[];
  counts.firestoreReads+=refs.length;
  return db.getAll(...refs);
};
try{
  pgClient=await pool.connect();
  const attested=await pgClient.query(
    "SELECT current_database() AS db,current_user AS role");
  if(attested.rows[0]?.db!=="quizer"||
      attested.rows[0]?.role!=="quizer_app")
    throw Error("STOP: unexpected SQL database or role.");
  await pgClient.query("BEGIN READ ONLY");
  const quizzes=await db.collection("quizzes")
    .orderBy(FieldPath.documentId()).limit(limit).get();
  counts.firestoreReads+=quizzes.size;
  for(const q of quizzes.docs){
    const quizId=q.id,quiz=q.data();
    const [draftSnap]=await readBatch([db.doc(
      "quizzes/"+quizId+"/drafts/current")]);
    if(!draftSnap.exists)continue;
    const draft=draftSnap.data();
    if(!Array.isArray(draft.itemOrder)||draft.itemOrder.length>500)
      throw Error("Invalid draft item order.");
    const refs=draft.itemOrder.map(id=>
      db.doc("quizzes/"+quizId+"/draftItems/"+id));
    const items=[];
    for(let i=0;i<refs.length;i+=50)
      items.push(...await readBatch(refs.slice(i,i+50)));
    const slots=items.map((snap,index)=>({
      ...(snap.exists?snap.data():{}),
      itemId:draft.itemOrder[index],quizId,
    }));
    const uniquePins=new Map();
    for(const slot of slots)
      if(slot.problemId&&slot.problemRevisionId)
        uniquePins.set(JSON.stringify([slot.problemId,slot.problemRevisionId]),{
          problemId:slot.problemId,problemRevisionId:slot.problemRevisionId,
        });
    const pins=[...uniquePins.values()];
    const neon=[];
    for(let i=0;i<pins.length;i+=100){
      const part=pins.slice(i,i+100);
      const placeholders=part.map((_,j)=>`($${2*j+1},$${2*j+2})`).join(",");
      const params=part.flatMap(x=>[x.problemId,x.problemRevisionId]);
      const sql="SELECT r.problem_id,r.revision_id FROM "+
        "quizer.problem_revisions r WHERE "+
        "(r.problem_id,r.revision_id) IN ("+placeholders+")";
      const result=await pgClient.query(sql,params);
      counts.neonQueries++;
      neon.push(...result.rows.map(x=>({
        problemId:x.problem_id,problemRevisionId:x.revision_id,
      })));
    }
    const neonKey=new Set(neon.map(p=>
      JSON.stringify([p.problemId,p.problemRevisionId])));
    const absent=pins.filter(p=>!neonKey.has(
      JSON.stringify([p.problemId,p.problemRevisionId])));
    const legacy=[];
    for(let i=0;i<absent.length;i+=50){
      const batch=absent.slice(i,i+50);
      const revs=await readBatch(batch.map(p=>db.doc(
        "problems/"+p.problemId+"/revisions/"+p.problemRevisionId)));
      revs.forEach((snap,index)=>{
        if(snap.exists)legacy.push(batch[index]);
      });
    }
    // A former protected/private publication may contain an archived
    // revision that no longer has its own live bank reference. Mark UNKNOWN,
    // not MISSING, unless it can be inspected under the same authorization.
    const prev=quiz.publishedRevisionId??quiz.lastPublishedRevisionId;
    const prior=prev?(await readBatch([
      db.doc("quizzes/"+quizId+"/revisions/"+prev)]))[0]:null;
    const priorPrivate=Boolean(prior?.exists&&prior.data()?.bundle);
    const snapshotPins=[];
    const previousRef=slots.filter(s=>s.reuseFromQuizRevisionId);
    for(let i=0;i<previousRef.length;i+=50){
      const group=previousRef.slice(i,i+50);
      const revs=await readBatch(group.map(x=>db.doc(
        "quizzes/"+quizId+"/revisions/"+
        x.reuseFromQuizRevisionId+"/items/"+x.itemId)));
      revs.forEach((v,index)=>{
        if(v.exists)snapshotPins.push({
          quizId,revisionId:group[index].reuseFromQuizRevisionId,
          itemId:group[index].itemId,
        });
      });
    }
    const result=classifyQuizSourceReferences({
      slots:slots.map(s=>({
        ...s,privateBundleCandidate:priorPrivate&&
          Boolean(s.reuseFromQuizRevisionId),
      })),neonPins:neon,firebasePins:legacy,snapshotPins,
    });
    counts.scannedQuizzes++;
    counts.scannedSlots+=result.counts.total;
    counts.unresolved+=result.counts.missing+result.counts.invalid;
    counts.uncertain+=result.counts.privateBundleUnknown;
    counts.overlap+=result.counts.conflict;
    if(result.counts.missing||result.counts.invalid||
       result.counts.privateBundleUnknown||result.counts.conflict)
      findings.push({quiz:anon(quizId),counts:result.counts,
        items:result.anomalies.slice(0,10).map(x=>({
          kind:x.kind,slot:anon(x.slot?.itemId),
        }))});
  }
  await pgClient.query("COMMIT");
  const report={mode:"READ_ONLY",firebaseProject:PROJECT,
    database:"quizer",neonRole:"quizer_app",limit,
    counts,findings,complete:quizzes.size<limit};
  console.log(JSON.stringify(report,null,2));
  if(counts.unresolved||counts.overlap||counts.uncertain)
    process.exitCode=3; // audit requires human review; no repairs
}catch(error){
  if(pgClient)try{await pgClient.query("ROLLBACK");}catch{}
  console.error("Read-only reconciliation stopped:",error?.message||"error");
  process.exitCode=2;
}finally{
  pgClient?.release();
  await pool.end();
}
