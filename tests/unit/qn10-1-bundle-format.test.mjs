import test from "node:test";
import assert from "node:assert/strict";
import {
  BUNDLE_FORMAT, BUNDLE_CONTENT_TYPE, BUNDLE_ENCODING, MAX_BUNDLE_BYTES,
  BUNDLE_OBJECT_PREFIX, bundleStoragePath, canonicalBundleBytes,
  normalizePublishedBundle, preparePublishedBundle, makePublishedBundleManifest,
  validatePublishedBundleManifest, readPrivatePublishedBundle,
} from "../../functions/src/bundles/published-bundle.js";

const item=(i,overrides={})=>({
  itemId:"itm_"+i,problemId:"prb_"+i,problemRevisionId:"prv_"+i+"_2",
  points:2,
  content:{type:"open",answerMode:"auto",
    statementLatex:"Compute $"+i+"+1$.",options:[],defaultPoints:2,
    questionAssetBindings:i===0?{"chart.png":"ast_figure"}:{}},
  grading:{correctOptionId:null,acceptedAnswers:[String(i+1)],
    tolerance:0,explanationLatex:"",rubricLatex:"",
    solutionAssetBindings:{}},
  ...overrides,
});
const sample=(size=3,revisionId="qrv_2026_a")=>({
  format:BUNDLE_FORMAT,quizId:"quiz_alpha",revisionId,revisionNumber:1,
  title:"Practice",description:"",subject:"Math",difficulty:"Practice",
  settings:{durationSeconds:1200,shuffleQuestions:false,
    shuffleOptions:false,allowBack:false,penalty:0,
    scoreRelease:"immediate",solutionRelease:"manual"},
  itemOrder:Array.from({length:size},(_,i)=>"itm_"+i),
  itemCount:size,totalPoints:size*2,
  items:Array.from({length:size},(_,i)=>item(i)),
});
const prepared=()=>preparePublishedBundle(sample());
const mockRead=(p,gen="987654321")=>async args=>{
  assert.deepEqual(args,{storagePath:p.storagePath,
    generation:gen,maxBytes:MAX_BUNDLE_BYTES});
  return {bytes:Buffer.from(p.bytes),contentType:BUNDLE_CONTENT_TYPE,
    generation:gen};
};
const allowed=({revisionId})=>({
  authorized:true,pinnedRevisionId:revisionId,
});
const reader=(m,p,opts={})=>readPrivatePublishedBundle({
  manifest:m,quizId:m.quizId,revisionId:m.revisionId,
  authorizePinnedRead:opts.authorizePinnedRead??allowed,
  readObject:opts.readObject??mockRead(p,m.generation),
});

test("QN10.1 creates exactly one deterministic JSON bundle for pinned revision",()=>{
  const a=prepared(),b=prepared();
  assert(a.bytes.equals(b.bytes));
  assert.equal(a.sha256,b.sha256);
  assert.equal(a.byteLength,a.bytes.length);
  assert.match(a.sha256,/^[0-9a-f]{64}$/);
  assert.equal(a.bundle.itemCount,3);
  assert.deepEqual(a.bundle.itemOrder,["itm_0","itm_1","itm_2"]);
  assert.equal(a.bundle.items[0].grading.acceptedAnswers[0],"1");
  assert.equal(a.bundle.items[0].content.questionAssetBindings["chart.png"],"ast_figure");
  assert.equal(a.storagePath,BUNDLE_OBJECT_PREFIX+
    "/quiz_alpha/qrv_2026_a/"+a.sha256+".json");
  assert.equal(a.bytes.toString(),canonicalBundleBytes(a.bundle).toString());
  assert.equal(JSON.parse(a.bytes.toString()).format,BUNDLE_FORMAT);
});
test("manifest is small, private and contains no answer, token or download URL",()=>{
  const p=prepared(),m=makePublishedBundleManifest(p,"987654321");
  assert.deepEqual(Object.keys(m).sort(),[
    "format","encoding","contentType","quizId","revisionId","storagePath",
    "generation","sha256","byteLength","itemCount","totalPoints"].sort());
  assert.equal(m.encoding,BUNDLE_ENCODING);
  assert.equal(m.contentType,BUNDLE_CONTENT_TYPE);
  assert.equal(m.generation,"987654321");
  assert(!JSON.stringify(m).includes("acceptedAnswers"));
  assert(!JSON.stringify(m).includes("statementLatex"));
  assert(!JSON.stringify(m).includes("answer"));
  assert(!JSON.stringify(m).includes("token"));
  assert(!JSON.stringify(m).includes("https://"));
  assert.equal(validatePublishedBundleManifest(m,"quiz_alpha","qrv_2026_a"),m);
});
test("different published revisions retain separate content-addressed paths",()=>{
  const a=prepared(),b=preparePublishedBundle(sample(3,"qrv_2026_b"));
  assert.notEqual(a.sha256,b.sha256);
  assert.notEqual(a.storagePath,b.storagePath);
  const modified=sample();
  modified.items[0].grading.acceptedAnswers=["changed"];
  const c=preparePublishedBundle(modified);
  assert.notEqual(a.sha256,c.sha256);
  assert.notEqual(a.storagePath,c.storagePath);
});
test("100 and 500-question bundles validate limits and retain ordering",()=>{
  for(const n of [100,500]){
    const p=preparePublishedBundle(sample(n));
    assert.equal(p.bundle.itemCount,n);
    assert.equal(p.bundle.totalPoints,n*2);
    assert.equal(p.bundle.items[n-1].itemId,"itm_"+(n-1));
    assert(p.byteLength<MAX_BUNDLE_BYTES);
  }
});
test("501 questions, mismatched order/count/total and duplicate slots fail closed",()=>{
  assert.throws(()=>preparePublishedBundle(sample(501)),/500 items/);
  const order=sample();
  order.itemOrder[1]="itm_9";
  assert.throws(()=>preparePublishedBundle(order),/order/);
  const duplicate=sample();
  duplicate.itemOrder[1]="itm_0";
  assert.throws(()=>preparePublishedBundle(duplicate),/order/);
  const wrongCount=sample();wrongCount.itemCount=2;
  assert.throws(()=>preparePublishedBundle(wrongCount),/count/);
  const wrongTotal=sample();wrongTotal.totalPoints=999;
  assert.throws(()=>preparePublishedBundle(wrongTotal),/points/);
});
test("unknown content/manifest fields and unsafe IDs are rejected",()=>{
  const s=sample();s.items[0].grading.apiSecret="not-allowed";
  assert.throws(()=>preparePublishedBundle(s),/Unknown grading field/);
  const p=prepared(),m=makePublishedBundleManifest(p,"987654321");
  assert.throws(()=>validatePublishedBundleManifest({...m,signedUrl:"https://evil"},
    m.quizId,m.revisionId),/Unknown/);
  assert.throws(()=>bundleStoragePath("../break","r1",p.sha256),/Invalid quiz/);
  assert.throws(()=>makePublishedBundleManifest(p,"0"),/generation/);
  assert.throws(()=>makePublishedBundleManifest(p,"not-a-generation"),/generation/);
});
test("prepared bundle mutation cannot produce a manifest",()=>{
  const p=prepared();p.bytes[0]^=1;
  assert.throws(()=>makePublishedBundleManifest(p,"123"),/Unverified|changed/);
});
test("trusted read requires injected authorization before touching Storage",async()=>{
  const p=prepared(),m=makePublishedBundleManifest(p,"987654321");
  let reads=0;
  await assert.rejects(readPrivatePublishedBundle({
    manifest:m,quizId:m.quizId,revisionId:m.revisionId,
    readObject:async()=>{reads++;return {};},
  }),/authorization/);
  await assert.rejects(reader(m,p,{
    authorizePinnedRead:async()=>({authorized:false,pinnedRevisionId:m.revisionId}),
    readObject:async()=>{reads++;return {};},
  }),/denied/);
  await assert.rejects(reader(m,p,{
    authorizePinnedRead:async()=>({authorized:true,pinnedRevisionId:"qrv_wrong"}),
    readObject:async()=>{reads++;return {};},
  }),/denied/);
  assert.equal(reads,0);
});
test("trusted backend read matches pinned IDs, generation, hash and byte size",async()=>{
  const p=prepared(),m=makePublishedBundleManifest(p,"987654321");
  const b=await reader(m,p);
  assert.equal(b.quizId,"quiz_alpha");
  assert.equal(b.revisionId,"qrv_2026_a");
  assert.equal(b.items[0].grading.acceptedAnswers[0],"1");
  await assert.rejects(readPrivatePublishedBundle({
    manifest:m,quizId:"quiz_other",revisionId:m.revisionId,
    authorizePinnedRead:allowed,
    readObject:async()=>{throw Error("storage must not be called");},
  }),/mismatch/);
  await assert.rejects(reader({...m,generation:"888"},p,{
    readObject:async()=>({bytes:p.bytes,contentType:BUNDLE_CONTENT_TYPE,
      generation:"987654321"}),
  }),/unavailable/);
});
test("corrupted bytes, wrong content type and path tampering are rejected",async()=>{
  const p=prepared(),m=makePublishedBundleManifest(p,"987654321");
  const bad=Buffer.from(p.bytes);bad[12]^=1;
  await assert.rejects(reader(m,p,{readObject:async()=>({
    bytes:bad,contentType:BUNDLE_CONTENT_TYPE,generation:m.generation,
  })}),/integrity mismatch/);
  await assert.rejects(reader(m,p,{readObject:async()=>({
    bytes:p.bytes,contentType:"text/plain",generation:m.generation,
  })}),/unavailable/);
  await assert.rejects(reader({...m,storagePath:"staging/teacher/asset/original"},p),
    /path/);
  await assert.rejects(reader({...m,sha256:"a".repeat(64)},p),/path/);
});
test("noncanonical JSON encoding is rejected even when its hash matches",async()=>{
  const p=prepared(),m=makePublishedBundleManifest(p,"987654321");
  const obj=JSON.parse(p.bytes.toString());
  const wrongBytes=Buffer.from(JSON.stringify(obj));
  assert(!wrongBytes.equals(p.bytes));
  // This is a different, valid content-addressed object, but it is not
  // canonical and is therefore refused even with a recomputed SHA.
  const {createHash}=await import("node:crypto");
  const badHash=createHash("sha256").update(wrongBytes).digest("hex");
  const alternate={...m,byteLength:wrongBytes.length,sha256:badHash,
    storagePath:bundleStoragePath(m.quizId,m.revisionId,badHash)};
  await assert.rejects(reader(alternate,p,{readObject:async()=>({
    bytes:wrongBytes,contentType:BUNDLE_CONTENT_TYPE,generation:m.generation,
  })}),/noncanonical/i);
});
test("oversized protected data is rejected rather than partially published",()=>{
  const s=sample(500);
  const statement="x".repeat(30000);
  const explanation="y".repeat(30000);
  for(const i of s.items) {
    i.content.statementLatex=statement;
    i.grading.explanationLatex=explanation;
  }
  assert.throws(()=>preparePublishedBundle(s),/exceeds 24 MiB/);
});
test("sparse arrays, unsupported values and prototype pollution are refused",()=>{
  assert.throws(()=>canonicalBundleBytes({x:undefined}),/Invalid bundle value/);
  assert.throws(()=>canonicalBundleBytes({x:[1,,3]}),/Sparse/);
  const obj=JSON.parse('{"__proto__":{"isAdmin":true}}');
  assert.throws(()=>canonicalBundleBytes(obj),/Unsafe property/);
});
