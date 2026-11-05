// QN9: SANITIZED TEST ONLY. No Firebase writes, no connection driver.
// Executes an all-or-nothing historical problem/revision rehearsal ONLY on a
// pre-approved disposable Quizer DEV branch; refuses non-synthetic owners/IDs.
import { fingerprint } from "./write-repository.js";
import { requireId } from "./contracts.js";

const DEV_PROJECT = "soft-grass-35754518";
const fail = msg => {throw new Error("QN9_REHEARSAL_BLOCKED: " + msg);};
const one = res => {
  if (!Array.isArray(res?.rows)) throw new Error("QN9_INVALID_SQL_RESULT");
  return res.rows[0]??null;
};
const json = v => typeof v==="string" ? JSON.parse(v) : v;
const same = (a,b) => fingerprint(a) === fingerprint(b);

export async function rehearseSanitizedLegacyMigration({
  plan,sql,target,enabled=false,
}={}) {
  if(enabled!==true) return {disabled:true};
  if(!target || target.projectId!==DEV_PROJECT ||
      target.defaultBranch!==false ||
      !/^qn9-disposable-[A-Za-z0-9_-]{1,55}$/.test(target.branchName??"") ||
      !target.branchId || target.databaseName!=="quizer" ||
      target.confirmedFreshByOperator!==true)
    fail("approved disposable Quizer development branch required");
  if(typeof sql?.transaction!=="function")
    fail("transactional SQL port required");
  if(!plan?.ready || plan.errors?.length ||
      !Array.isArray(plan.migrationRows))
    fail("inventory must have zero broken references and hashes");
  // Deliberate protection: this rehearsal cannot be used for real owner IDs,
  // even if someone accidentally wires it to a production Firebase export.
  if(plan.migrationRows.length<1 || plan.migrationRows.length>500 ||
    plan.migrationRows.some(p=>
      p.ownerId!=="teacher_synthetic" ||
      !/^prb_synth_[0-9]+$/.test(p.problemId) ||
      !Array.isArray(p.revisions) ||
      p.revisions.some(r=>!/^prv_[0-9]+_[12]$/.test(r.revisionId))))
    fail("synthetic fixtures only; real-user migration is not supported");
  if(typeof plan.manifestHash!=="string"||
      !/^[a-f0-9]{64}$/.test(plan.manifestHash))
    fail("invalid preservation fingerprint");

  return sql.transaction(async tx => {
    // Check the entire destination before any write, under transaction.
    const existing=one(await tx.query(
      "SELECT count(*)::integer AS count FROM quizer.problems",[]));
    if(Number(existing?.count)!==0)
      fail("destination is not empty; never overwrite existing problems");
    let insertedRevisions=0;
    for(const p of plan.migrationRows){
      requireId(p.problemId); requireId(p.ownerId);
      await tx.query(
        "INSERT INTO quizer.problems " +
        "(problem_id,owner_uid,owner_display_name,title,subject,difficulty," +
        "bank_visibility,lifecycle,latest_revision_id,revision_number,version," +
        "source_problem_id,source_problem_revision_id,created_at,updated_at,trashed_at) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)",
        [p.problemId,p.ownerId,p.ownerDisplayName,p.metadata.title,
          p.metadata.subject,p.metadata.difficulty,p.metadata.bankVisibility,
          p.lifecycle,p.latestRevisionId,p.revisionNumber,p.version,
          p.sourceProblemId,p.sourceProblemRevisionId,p.createdAt,p.updatedAt,p.trashedAt]);
      for(const r of p.revisions){
        requireId(r.revisionId);
        await tx.query(
          "INSERT INTO quizer.problem_revisions " +
          "(revision_id,problem_id,revision_number,content_json,grading_json," +
          "source_json,content_hash,created_by_uid,created_at) " +
          "VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8,$9)",
          [r.revisionId,p.problemId,r.revisionNumber,
            JSON.stringify(r.content),JSON.stringify(r.grading),
            JSON.stringify(r.source),r.contentHash,r.createdBy,r.createdAt]);
        insertedRevisions++;
      }
      for(const tag of p.metadata.tags)
        await tx.query(
          "INSERT INTO quizer.problem_tags (problem_id,tag) VALUES ($1,$2)",
          [p.problemId,tag]);
    }
    // Assert identity, ownership, pinned latest revisions and full protected
    // content/grading parity BEFORE transaction commit.
    for(const p of plan.migrationRows){
      const header=one(await tx.query(
        "SELECT owner_uid,latest_revision_id,revision_number,version,title," +
        "bank_visibility FROM quizer.problems WHERE problem_id=$1",[p.problemId]));
      if(!header || header.owner_uid!==p.ownerId ||
          header.latest_revision_id!==p.latestRevisionId ||
          Number(header.revision_number)!==p.revisionNumber ||
          Number(header.version)!==p.version ||
          header.title!==p.metadata.title ||
          header.bank_visibility!==p.metadata.bankVisibility)
        fail("header mismatch for "+p.problemId);
      for(const r of p.revisions){
        const result=one(await tx.query(
          "SELECT revision_id,revision_number,content_hash,content_json," +
          "grading_json,source_json FROM quizer.problem_revisions " +
          "WHERE problem_id=$1 AND revision_id=$2",[p.problemId,r.revisionId]));
        if(!result || result.revision_id!==r.revisionId ||
            Number(result.revision_number)!==r.revisionNumber ||
            String(result.content_hash).trim()!==r.contentHash ||
            !same(json(result.content_json),r.content) ||
            !same(json(result.grading_json),r.grading) ||
            !same(json(result.source_json),r.source))
          fail("revision, key, or provenance mismatch for "+r.revisionId);
      }
    }
    return { verified:true,
      syntheticOnly:true,
      insertedProblems:plan.migrationRows.length,
      insertedRevisions,
      originalDocumentCount:plan.counts.documentPaths,
      preservedFirebaseManifestHash:plan.manifestHash,
      // No writes to quizzes/attempts/results/assets, ever.
      firebaseWrites:0 };
  });
}
