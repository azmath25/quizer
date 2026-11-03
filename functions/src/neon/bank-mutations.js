// QN11.4 STAGED bank mutations. NEVER imported by live Firebase handlers.
// SQL tx supplies atomic updates + replay receipts; Firestore auth/asset ports
// are trusted server callbacks. No external Firebase IO inside SQL transactions.
import { validateMetadata, validateProblem, assetIds, fields, enumeration,
  number, text } from "../../shared/schema.js";
import { NeonContractError, requireTeacher, requireId } from "./contracts.js";
import { deterministicId, fingerprint } from "./write-repository.js";

const fail=(reason,message)=>{throw new NeonContractError(reason,message);};
const first=r=>{
  if(!r||!Array.isArray(r.rows))throw Error("Invalid Quizer SQL result.");
  return r.rows[0]??null;
};
const CURRENT_ROLE="SELECT current_user AS role_name,rolsuper,rolcreatedb,"+
  "rolcreaterole,rolreplication,rolbypassrls,EXISTS (SELECT 1 FROM pg_roles s "+
  "WHERE s.rolname='neon_superuser' AND pg_has_role(current_user,s.oid,'MEMBER')) "+
  "AS inherited_neon_superuser FROM pg_roles WHERE rolname=current_user";
const HEADER="SELECT p.*,COALESCE((SELECT array_agg(t.tag::text ORDER BY t.tag) "+
  "FROM quizer.problem_tags t WHERE t.problem_id=p.problem_id),ARRAY[]::text[]) AS tags "+
  "FROM quizer.problems p WHERE p.problem_id=$1 FOR UPDATE OF p";
const REV="SELECT revision_id,revision_number,content_json,grading_json,source_json,"+
  "content_hash,created_by_uid,created_at FROM quizer.problem_revisions "+
  "WHERE problem_id=$1 AND revision_id=$2";
const validateRole=r=>{
  if(!r||r.role_name!=="quizer_app"||r.rolsuper!==false||
    r.rolcreatedb!==false||r.rolcreaterole!==false||
    r.rolreplication!==false||r.rolbypassrls!==false||
    r.inherited_neon_superuser!==false)
    throw Error("Unverified or elevated Quizer SQL role.");
};
const owner=(actor,row)=>{
  if(!row||(row.owner_uid!==actor.uid&&actor.role!=="admin"))
    fail("RESOURCE_UNAVAILABLE","Problem unavailable.");
};
const visible=(actor,row)=>{
  if(!row||(row.owner_uid!==actor.uid&&actor.role!=="admin"&&
    !(row.lifecycle==="active"&&row.bank_visibility==="teachers")))
    fail("RESOURCE_UNAVAILABLE","Problem unavailable.");
};
const changedHash=(actor,action,request)=>fingerprint({
  actorUid:actor.uid,action,...request,
});
function requireStamp(stamp){
  const value=new Date(stamp??Date.now());
  if(!Number.isFinite(value.getTime()))fail("INVALID_FIELDS","Invalid time.");
  return value.toISOString();
}
function tagList(value,label){
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.length>12)
    fail("INVALID_FIELDS","At most twelve tags are allowed.");
  return [...new Set(value.map(x=>text(x,label,60,true).trim()))];
}
export function createQuizerNeonBankMutations({
  enabled=false,sql,verifyAssetCopy,
}={}){
  if(enabled!==true)return Object.freeze({
    enabled:false,mutate:async()=>({disabled:true}),
  });
  if(typeof sql?.transaction!=="function"||
    typeof verifyAssetCopy!=="function")
    throw Error("QN11.4 requires a restricted SQL transaction and trusted asset-copy verifier.");
  async function run(actor,action,requestId,body,work){
    requireTeacher(actor);requireId(requestId,"request ID");
    const digest=changedHash(actor,action,requestId?body:{});
    return sql.transaction(async tx=>{
      validateRole(first(await tx.query(CURRENT_ROLE,[])));
      // Global per-actor request ID scope covers all bank mutation actions.
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        ["quizer:mutation:"+actor.uid+":"+requestId]);
      const receipt=first(await tx.query(
        "SELECT action,payload_hash,result_json FROM quizer.mutation_receipts "+
        "WHERE actor_uid=$1 AND request_id=$2",[actor.uid,requestId]));
      if(receipt){
        if(receipt.action!==action||receipt.payload_hash.trim()!==digest)
          fail("VERSION_CONFLICT","Request ID was reused with different content.");
        return typeof receipt.result_json==="string"?
          JSON.parse(receipt.result_json):receipt.result_json;
      }
      const result=await work(tx);
      await tx.query(
        "INSERT INTO quizer.mutation_receipts "+
        "(actor_uid,request_id,action,payload_hash,result_json) "+
        "VALUES ($1,$2,$3,$4,$5::jsonb)",
        [actor.uid,requestId,action,digest,JSON.stringify(result)]);
      return result;
    });
  }
  // Retry lookup before external asset-copy preflight. A fork that already
  // committed must replay its receipt even if sharing was revoked afterward.
  async function completedMutation(actor,action,requestId,body){
    requireTeacher(actor);requireId(requestId,"request ID");
    const digest=changedHash(actor,action,body);
    return sql.transaction(async tx=>{
      validateRole(first(await tx.query(CURRENT_ROLE,[])));
      const receipt=first(await tx.query(
        "SELECT action,payload_hash,result_json FROM quizer.mutation_receipts "+
        "WHERE actor_uid=$1 AND request_id=$2",[actor.uid,requestId]));
      if(!receipt)return null;
      if(receipt.action!==action||receipt.payload_hash.trim()!==digest)
        fail("VERSION_CONFLICT","Request ID was reused with different content.");
      return typeof receipt.result_json==="string"?
        JSON.parse(receipt.result_json):receipt.result_json;
    });
  }
  async function header(tx,actor,problemId){
    const row=first(await tx.query(HEADER,[requireId(problemId,"problem ID")]));
    owner(actor,row);return row;
  }
  async function updateTags(tx,problemId,tags){
    await tx.query("DELETE FROM quizer.problem_tags WHERE problem_id=$1",[problemId]);
    for(const tag of tags)
      await tx.query("INSERT INTO quizer.problem_tags (problem_id,tag) VALUES ($1,$2)",
        [problemId,tag]);
  }
  async function mutate({actor,action,requestId,request,now}={}){
    requireTeacher(actor);
    if(!request||typeof request!=="object"||Array.isArray(request))
      fail("INVALID_FIELDS","Invalid mutation payload.");
    const stamp=requireStamp(now);
    if(["setProblemSharing","trashProblem","restoreProblem"].includes(action)){
      fields(request,["problemId","expectedVersion","visibility"]);
      const problemId=requireId(request.problemId);
      const expectedVersion=number(request.expectedVersion,"Expected version",
        1,Number.MAX_SAFE_INTEGER,true);
      const visibility=action==="setProblemSharing"
        ? enumeration(request.visibility,["private","teachers"],"sharing")
        : undefined;
      return run(actor,action,requestId,{problemId,expectedVersion,visibility},async tx=>{
        const old=await header(tx,actor,problemId);
        if(Number(old.version)!==expectedVersion)
          fail("VERSION_CONFLICT","The problem changed elsewhere.");
        const nextVersion=expectedVersion+1;
        if(action==="setProblemSharing") {
          await tx.query("UPDATE quizer.problems SET bank_visibility=$2,"+
            "version=$3,updated_at=$4 WHERE problem_id=$1 AND version=$5",
            [problemId,visibility,nextVersion,stamp,expectedVersion]);
        } else {
          const trashed=action==="trashProblem";
          await tx.query("UPDATE quizer.problems SET lifecycle=$2,"+
            "bank_visibility=$3,trashed_at=$4,version=$5,updated_at=$6 "+
            "WHERE problem_id=$1 AND version=$7",
            [problemId,trashed?"trashed":"active",
              trashed?old.bank_visibility:"private",
              trashed?stamp:null,nextVersion,stamp,expectedVersion]);
        }
        return {version:nextVersion};
      });
    }
    if(action==="bulkUpdateProblems"){
      fields(request,["problemIds","subject","difficulty","addTags",
        "removeTags","visibility"]);
      if(!Array.isArray(request.problemIds)||request.problemIds.length<1||
        request.problemIds.length>50)
        fail("INVALID_FIELDS","Select one to fifty problems.");
      const ids=[...new Set(request.problemIds.map(v=>requireId(v,"problem ID")))].sort();
      const add=tagList(request.addTags,"Tag");
      const remove=tagList(request.removeTags,"Tag");
      const subject=request.subject===undefined?undefined:
        text(request.subject,"Subject",80);
      const difficulty=request.difficulty===undefined?undefined:
        text(request.difficulty,"Difficulty",40);
      const visibility=request.visibility===undefined?undefined:
        enumeration(request.visibility,["private","teachers"],"visibility");
      if(!add.length&&!remove.length&&subject===undefined&&
        difficulty===undefined&&visibility===undefined)
        fail("INVALID_FIELDS","Choose a change.");
      return run(actor,action,requestId,{ids,add,remove,subject,difficulty,visibility},
        async tx=>{
          const rows=[];
          for(const problemId of ids){
            const old=await header(tx,actor,problemId);
            if(old.lifecycle!=="active")
              fail("RESOURCE_UNAVAILABLE","Restore problems before editing.");
            rows.push(old);
          }
          const versions={};
          for(let i=0;i<ids.length;i++){
            const problemId=ids[i],old=rows[i];
            const tags=[...new Set([...(old.tags??[]).filter(t=>!remove.includes(t)),...add])];
            if(tags.length>12)fail("INVALID_FIELDS","At most twelve tags.");
            const newVersion=Number(old.version)+1;
            await tx.query("UPDATE quizer.problems SET subject=$2,difficulty=$3,"+
              "bank_visibility=$4,version=$5,updated_at=$6 "+
              "WHERE problem_id=$1 AND version=$7",
              [problemId,subject??old.subject,difficulty??old.difficulty,
                visibility??old.bank_visibility,newVersion,stamp,old.version]);
            if(fingerprint([...(old.tags??[])].sort())!==fingerprint([...tags].sort()))
              await updateTags(tx,problemId,tags);
            versions[problemId]=newVersion;
          }
          return {versions};
        });
    }
    if(action==="forkProblem"){
      fields(request,["problemId","revisionId","title"]);
      const problemId=requireId(request.problemId,"problem ID");
      const revisionId=request.revisionId===undefined?null:
        requireId(request.revisionId,"revision ID");
      const title=request.title===undefined?null:
        text(request.title,"Title",200,true);
      const earlier=await completedMutation(actor,action,requestId,{
        problemId,revisionId,title,
      });
      if(earlier)return earlier;
      // The verifier MUST authorize a shared source's image references for
      // this actor, not blindly require every shared asset to be actor-owned.
      const preflight=await sql.transaction(async tx=>{
        validateRole(first(await tx.query(CURRENT_ROLE,[])));
        const row=first(await tx.query(HEADER,[problemId]));
        visible(actor,row);
        const rid=revisionId??row.latest_revision_id;
        const rev=first(await tx.query(REV,[problemId,rid]));
        if(!rev)fail("RESOURCE_UNAVAILABLE","Revision unavailable.");
        return {row,rev,rid};
      });
      await verifyAssetCopy({actor,problemId,revisionId:preflight.rid,
        assetIds:assetIds(preflight.rev.content_json,preflight.rev.grading_json)});
      return run(actor,action,requestId,{problemId,revisionId,title},async tx=>{
        const row=first(await tx.query(HEADER,[problemId]));
        visible(actor,row);
        const rid=revisionId??row.latest_revision_id;
        const rev=first(await tx.query(REV,[problemId,rid]));
        if(!rev)fail("RESOURCE_UNAVAILABLE","Revision unavailable.");
        if(rev.content_hash.trim()!==preflight.rev.content_hash.trim()||
          fingerprint(assetIds(rev.content_json,rev.grading_json))!==
          fingerprint(assetIds(preflight.rev.content_json,preflight.rev.grading_json)))
          fail("VERSION_CONFLICT","Source changed after asset authorization.");
        const metadata=validateMetadata({
          title:title??row.title+" (copy)",subject:row.subject,
          difficulty:row.difficulty,tags:row.tags??[],
          bankVisibility:"private",
        });
        const normalized=validateProblem(rev.content_json,rev.grading_json);
        const copyId=deterministicId("prb_",actor.uid,"forkProblem",requestId);
        const copyRev=deterministicId("prv_",actor.uid,"forkProblem",requestId);
        await tx.query("INSERT INTO quizer.problems "+
          "(problem_id,owner_uid,title,subject,difficulty,bank_visibility,"+
          "lifecycle,latest_revision_id,revision_number,version,source_problem_id,"+
          "source_problem_revision_id,created_at,updated_at) "+
          "VALUES ($1,$2,$3,$4,$5,'private','active',$6,1,1,$7,$8,$9,$9)",
          [copyId,actor.uid,metadata.title,metadata.subject,metadata.difficulty,
            copyRev,problemId,rid,stamp]);
        await tx.query("INSERT INTO quizer.problem_revisions "+
          "(revision_id,problem_id,revision_number,content_json,grading_json,"+
          "source_json,content_hash,created_by_uid,created_at) "+
          "VALUES ($1,$2,1,$3::jsonb,$4::jsonb,$5::jsonb,$6,$7,$8)",
          [copyRev,copyId,JSON.stringify(normalized.content),
            JSON.stringify(normalized.grading),JSON.stringify({}),
            fingerprint(normalized),actor.uid,stamp]);
        for(const tag of metadata.tags)
          await tx.query("INSERT INTO quizer.problem_tags (problem_id,tag) VALUES ($1,$2)",
            [copyId,tag]);
        return {problemId:copyId,revisionId:copyRev,version:1};
      });
    }
    fail("INVALID_FIELDS","Unsupported staged bank mutation.");
  }
  return Object.freeze({enabled:true,mutate});
}
