import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {hash} from "../../functions/src/domain/runtime.js";
import {createPrivateZipStoragePort} from "../../functions/src/bundles/private-zip-storage.js";
import {createFirestorePrivateExportAssetReader} from "../../functions/src/bundles/private-export-asset-reader.js";
const digest=b=>createHash("sha256").update(b).digest("hex");
const reason=r=>e=>e?.reason===r;
function fakeZipBucket(){
  let saved=null,metadata=null,generation="15",signed=0;
  const bucket={file:(path,{generation:pinned}={})=>({
    async save(bytes,opts){
      assert.equal(opts.preconditionOpts.ifGenerationMatch,0);
      assert.equal(opts.metadata.cacheControl,"private, no-store");
      assert.equal(opts.metadata.contentType,"application/zip");
      saved=Buffer.from(bytes);
      metadata={size:String(bytes.length),generation,
        ...opts.metadata};
    },
    async getMetadata(){return [metadata]},
    async download(){
      assert.equal(pinned,generation);
      return [Buffer.from(saved)]},
    async getSignedUrl(opts){
      signed++;
      assert.equal(opts.queryParams.generation,generation);
      return ["https://storage.example/export.zip?sig=123"]},
  })};
  return {bucket,get saved(){return saved},
    get signed(){return signed},tamper(){metadata.metadata.sha256="0".repeat(64)}};
}
test("QN11.6.3 private ZIP Storage allows only created, hash-matched, private files",async()=>{
  const f=fakeZipBucket(),s=createPrivateZipStoragePort({
    enabled:true,bucket:f.bucket});
  const path="exports/teacher_1/job_1/quiz_1-job_1.zip";
  const bytes=Buffer.from("TEST_PRIVATE_ZIP_BYTES");
  const created=await s.createOnly({storagePath:path,bytes,quizId:"quiz_1"});
  assert.equal(created.sha256,digest(bytes));
  const read=await s.readExact({...created});
  assert.equal(read.generation,"15");
  assert.equal(read.contentType,"application/zip");
  const url=await s.sign({storagePath:path,quizId:"quiz_1",generation:read.generation,
    expiresAt:new Date(Date.now()+60000)});
  assert(url.startsWith("https://"));
  assert.equal(f.signed,1);
  f.tamper();
  await assert.rejects(s.readExact({...created}),reason("RESOURCE_UNAVAILABLE"));
});
test("QN11.6.3 ZIP paths cannot escape owner/job scope or sign private bundles",async()=>{
  const f=fakeZipBucket(),s=createPrivateZipStoragePort({
    enabled:true,bucket:f.bucket});
  for(const path of [
    "published-bundles/v1/quiz/rev/key.json",
    "exports/teacher_1/job_1/quiz_1-job_other.zip",
    "exports/teacher_1/job_1/../../source.tex",
    "exports/teacher_1/job_1/quiz_wrong-job_1.zip",
  ])
    await assert.rejects(s.createOnly({storagePath:path,quizId:"quiz_1",
      bytes:Buffer.from("a")}),reason("INVALID_FIELDS"));
  await assert.rejects(s.sign({storagePath:
    "exports/teacher_1/job_1/quiz_1-job_1.zip",quizId:"quiz_1",generation:"15",
    expiresAt:new Date(Date.now()+300000)}),reason("INVALID_FIELDS"));
  assert.equal(f.signed,0);
});
test("QN11.6.3 exported image reader demands published ref and matching exact image bytes",async()=>{
  const bytes=Buffer.from("SYNTHETIC_IMAGE_BYTES"),digestHash=digest(bytes),
    target="quizzes/quiz_1/revisions/qrv_1",
    path="assets/owner_1/ast_1/image.png";
  const data={
    "assets/ast_1":{ownerId:"owner_1",kind:"image",status:"ready",
      storagePath:path,generation:"8",contentType:"image/png",
      sizeBytes:bytes.length,sha256:digestHash,referenceCount:1,
      originalName:"diagram.png"},
    ["assets/ast_1/refs/"+hash(target)]:{target},
  };
  const db={doc:name=>({async get(){const d=data[name];
    return {exists:!!d,data:()=>d}}})};
  let downloads=0;
  const bucket={file:(requested,{generation}={})=>({
    async getMetadata(){
      assert.equal(requested,path);assert.equal(generation,"8");
      return [{size:String(bytes.length),generation:"8",
        contentType:"image/png",metadata:{sha256:digestHash}}]},
    async download(){
      downloads++;return [bytes]},
  })};
  const reader=createFirestorePrivateExportAssetReader({
    enabled:true,db,bucket});
  const job={authorized:true,jobId:"job_1",kind:"export_quiz",
    ownerId:"owner_1",quizId:"quiz_1",revisionId:"qrv_1",
    leaseOwner:"worker_1"};
  assert.equal(await reader.verifyRetained({
    job,quizId:"quiz_1",revisionId:"qrv_1",assetId:"ast_1"}),true);
  assert.equal(downloads,0);
  const result=await reader.readVerified({
    job,quizId:"quiz_1",revisionId:"qrv_1",assetId:"ast_1"});
  assert.equal(result.name,"images/ast_1.png");
  assert(result.bytes.equals(bytes));assert.equal(downloads,1);
  delete data["assets/ast_1/refs/"+hash(target)];
  await assert.rejects(reader.readVerified({
    job,quizId:"quiz_1",revisionId:"qrv_1",assetId:"ast_1"}),
    reason("RESOURCE_UNAVAILABLE"));
  assert.equal(downloads,1);
});
