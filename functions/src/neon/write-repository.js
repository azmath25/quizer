// QN8 server-only, default-OFF, transactional problem-bank writer.
// Never invoke Postgres from a Firebase Firestore transaction retry callback.
import { createHash } from "node:crypto";
import { validateMetadata, validateProblem, assetIds, number, fields } from "../../shared/schema.js";
import { requireId, requireTeacher, NeonContractError } from "./contracts.js";

export const MAX_IMPORT_BATCH = 20;
function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return "{" + Object.keys(value).sort()
    .map(k => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
}
export const fingerprint = value =>
  createHash("sha256").update(canonical(value)).digest("hex");
export const deterministicId = (prefix, ...parts) =>
  prefix + fingerprint(parts.join(":")).slice(0, 28);
const fail = (reason, message) => { throw new NeonContractError(reason, message); };
function first(result) {
  if (!result || !Array.isArray(result.rows)) throw new Error("Invalid SQL result");
  return result.rows[0] ?? null;
}
const HEADER_SQL =
  "SELECT p.*, COALESCE((SELECT array_agg(t.tag::text ORDER BY t.tag) " +
  "FROM quizer.problem_tags t WHERE t.problem_id=p.problem_id), " +
  "ARRAY[]::text[]) AS tags " +
  "FROM quizer.problems p WHERE p.problem_id=$1 FOR UPDATE OF p";
const REVISION_SQL =
  "SELECT content_hash, content_json, grading_json, source_json " +
  "FROM quizer.problem_revisions WHERE problem_id=$1 AND revision_id=$2";
function sameMetadata(row, metadata) {
  return row.title === metadata.title &&
    row.subject === metadata.subject &&
    row.difficulty === metadata.difficulty &&
    row.bank_visibility === metadata.bankVisibility &&
    canonical([...(row.tags ?? [])].sort()) === canonical([...metadata.tags].sort());
}
function validatedEntry(raw) {
  fields(raw, ["importItemKey", "originalQuestionId", "metadata",
    "content", "grading", "points"]);
  const key = requireId(raw.importItemKey, "import item key");
  const metadata = validateMetadata(raw.metadata);
  const parsed = validateProblem(raw.content, raw.grading);
  return {
    key, metadata, ...parsed,
    points: number(raw.points ?? parsed.content.defaultPoints, "Points",
      0.00000001, 1000),
    originalQuestionId: raw.originalQuestionId === undefined
      ? null : requireId(raw.originalQuestionId, "question source ID"),
    payloadHash: fingerprint(raw),
  };
}

export function createQuizerNeonWriteRepository({
  sql, verifyAssets, enabled = false,
} = {}) {
  if (enabled !== true) return Object.freeze({
    enabled: false,
    createProblem: async () => ({ disabled: true }),
    saveProblemRevision: async () => ({ disabled: true }),
    importProblemBatch: async () => ({ disabled: true }),
  });
  // QN8 cannot provision privileged Neon-MCP default roles.
  if (!sql || typeof sql.transaction !== "function" ||
      sql.restrictedRoleVerified !== true || typeof verifyAssets !== "function")
    throw new Error("QN8 requires restricted Postgres role verification, transactions and Firebase asset checks.");
  async function verify(actor, content, grading, sourceAssetId = null) {
    const ids = [...new Set([...assetIds(content, grading),
      ...(sourceAssetId ? [sourceAssetId] : [])])];
    await verifyAssets({ actor, assetIds: ids });
  }
  async function insert(tx, { actor, problemId, revisionId, metadata,
    content, grading, source = {}, now, ownerDisplayName = "" }) {
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
      ["quizer:problem:" + problemId]);
    const existing = first(await tx.query(HEADER_SQL, [problemId]));
    const contentHash = fingerprint({ content, grading });
    if (existing) {
      const rev = first(await tx.query(REVISION_SQL,
        [problemId, existing.latest_revision_id]));
      if (existing.owner_uid !== actor.uid ||
          !sameMetadata(existing, metadata) ||
          rev?.content_hash?.trim() !== contentHash)
        fail("VERSION_CONFLICT", "The request ID was reused with different content.");
      return { problemId, revisionId: existing.latest_revision_id,
        version: Number(existing.version), replayed: true };
    }
    const stamp = new Date(now).toISOString();
    await tx.query(
      "INSERT INTO quizer.problems " +
      "(problem_id,owner_uid,owner_display_name,title,subject,difficulty," +
      "bank_visibility,lifecycle,latest_revision_id,revision_number,version,created_at,updated_at) " +
      "VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8,1,1,$9,$9)",
      [problemId, actor.uid, ownerDisplayName, metadata.title, metadata.subject,
        metadata.difficulty, metadata.bankVisibility, revisionId, stamp]);
    await tx.query(
      "INSERT INTO quizer.problem_revisions " +
      "(revision_id,problem_id,revision_number,content_json,grading_json," +
      "source_json,content_hash,created_by_uid,created_at) " +
      "VALUES ($1,$2,1,$3::jsonb,$4::jsonb,$5::jsonb,$6,$7,$8)",
      [revisionId, problemId, JSON.stringify(content), JSON.stringify(grading),
        JSON.stringify(source), contentHash, actor.uid, stamp]);
    for (const tag of metadata.tags)
      await tx.query("INSERT INTO quizer.problem_tags (problem_id,tag) VALUES ($1,$2)",
        [problemId, tag]);
    return { problemId, revisionId, version: 1 };
  }

  async function createProblem({ actor, requestId, metadata: rawMetadata,
    content: rawContent, grading: rawGrading, now = new Date(),
    ownerDisplayName = "" }) {
    requireTeacher(actor);
    requireId(requestId, "request ID");
    const metadata = validateMetadata(rawMetadata);
    const { content, grading } = validateProblem(rawContent, rawGrading);
    await verify(actor, content, grading);
    const id = deterministicId("prb_", actor.uid, "createProblem", requestId);
    const rev = deterministicId("prv_", actor.uid, "createProblem", requestId);
    return sql.transaction(tx => insert(tx, { actor, problemId: id,
      revisionId: rev, metadata, content, grading, now, ownerDisplayName }));
  }
  async function saveProblemRevision({ actor, requestId, problemId, expectedVersion,
    metadata: rawMetadata, content: rawContent, grading: rawGrading, now = new Date() }) {
    requireTeacher(actor);
    requireId(requestId, "request ID");
    requireId(problemId, "problem ID");
    number(expectedVersion, "Expected version", 1, Number.MAX_SAFE_INTEGER, true);
    const metadata = validateMetadata(rawMetadata);
    const hasContent = rawContent !== undefined || rawGrading !== undefined;
    if (hasContent && (rawContent === undefined || rawGrading === undefined))
      fail("INVALID_FIELDS", "Content and grading must be submitted together.");
    const parsed = hasContent ? validateProblem(rawContent, rawGrading) : null;
    if (parsed) await verify(actor, parsed.content, parsed.grading);
    return sql.transaction(async tx => {
      const old = first(await tx.query(HEADER_SQL, [problemId]));
      if (!old || (old.owner_uid !== actor.uid && actor.role !== "admin") ||
          old.lifecycle !== "active")
        fail("RESOURCE_UNAVAILABLE", "Problem unavailable.");
      if (Number(old.version) !== expectedVersion)
        fail("VERSION_CONFLICT", "The problem has changed elsewhere.");
      const sameMeta = sameMetadata(old, metadata);
      const previous = parsed ? first(await tx.query(REVISION_SQL,
        [problemId, old.latest_revision_id])) : null;
      if (parsed && !previous) fail("RESOURCE_UNAVAILABLE", "Revision unavailable.");
      const sameContent = !parsed ||
        previous.content_hash.trim() === fingerprint(parsed);
      if (sameMeta && sameContent)
        return { problemId, revisionId: old.latest_revision_id,
          version: Number(old.version), unchanged: true };
      const nextVersion = Number(old.version) + 1;
      let revisionId = old.latest_revision_id;
      let revisionNumber = Number(old.revision_number);
      const stamp = new Date(now).toISOString();
      if (!sameContent) {
        revisionId = deterministicId("prv_", actor.uid, "saveProblemRevision",
          requestId, problemId);
        revisionNumber++;
        await tx.query(
          "INSERT INTO quizer.problem_revisions " +
          "(revision_id,problem_id,revision_number,content_json,grading_json," +
          "source_json,content_hash,created_by_uid,created_at) " +
          "VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8,$9)",
          [revisionId, problemId, revisionNumber,
            JSON.stringify(parsed.content), JSON.stringify(parsed.grading),
            JSON.stringify(previous.source_json), fingerprint(parsed), actor.uid, stamp]);
      }
      const updated = await tx.query(
        "UPDATE quizer.problems SET title=$2,subject=$3,difficulty=$4," +
        "bank_visibility=$5,latest_revision_id=$6,revision_number=$7," +
        "version=$8,updated_at=$9 WHERE problem_id=$1 AND version=$10 RETURNING problem_id",
        [problemId, metadata.title, metadata.subject, metadata.difficulty,
          metadata.bankVisibility, revisionId, revisionNumber,
          nextVersion, stamp, expectedVersion]);
      if (!first(updated)) fail("VERSION_CONFLICT", "The problem changed concurrently.");
      if (!sameMeta) {
        await tx.query("DELETE FROM quizer.problem_tags WHERE problem_id=$1", [problemId]);
        for (const tag of metadata.tags)
          await tx.query("INSERT INTO quizer.problem_tags (problem_id,tag) VALUES ($1,$2)",
            [problemId, tag]);
      }
      return { problemId, revisionId, version: nextVersion,
        ...(sameContent ? { metadataOnly: true } : {}) };
    });
  }
  async function importProblemBatch({ actor, job, records, now = new Date(),
    ownerDisplayName = "" }) {
    requireTeacher(actor);
    // The job must be loaded and checked by trusted Firebase backend, not browser.
    if (!job || job.kind !== "import" || job.status !== "running" ||
        job.requestedBy !== actor.uid)
      fail("RESOURCE_UNAVAILABLE", "Import job unavailable.");
    const jobId = requireId(job.jobId, "job ID");
    if (job.sourceAssetId != null) requireId(job.sourceAssetId, "source ID");
    if (!Array.isArray(records) || records.length < 1 ||
        records.length > MAX_IMPORT_BATCH)
      fail("INVALID_FIELDS", "Import 1–20 problems per batch.");
    const entries = records.map(validatedEntry);
    if (new Set(entries.map(e => e.key)).size !== entries.length)
      fail("INVALID_FIELDS", "Duplicate import key in the batch.");
    for (const entry of entries)
      await verify(actor, entry.content, entry.grading, job.sourceAssetId);
    const sorted = [...entries].sort((a,b) => a.key.localeCompare(b.key));
    return sql.transaction(async tx => {
      const mapped = new Map();
      for (const entry of sorted) {
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
          ["quizer:import:" + jobId + ":" + entry.key]);
        const receipt = first(await tx.query(
          "SELECT payload_hash,problem_id,revision_id FROM quizer.import_receipts " +
          "WHERE job_id=$1 AND import_item_key=$2",
          [jobId, entry.key]));
        const itemId = deterministicId("itm_", actor.uid, jobId, entry.key);
        if (receipt) {
          if (receipt.payload_hash.trim() !== entry.payloadHash)
            fail("VERSION_CONFLICT", "Imported content changed for an existing item key.");
          mapped.set(entry.key, { importItemKey: entry.key,
            problemId: receipt.problem_id, revisionId: receipt.revision_id,
            itemId, version: 1, points: entry.points,
            hash: entry.payloadHash, replayed: true });
          continue;
        }
        const problemId = deterministicId("prb_", actor.uid, jobId, entry.key);
        const revisionId = deterministicId("prv_", actor.uid, jobId, entry.key);
        const created = await insert(tx, { actor, problemId, revisionId,
          metadata: entry.metadata, content: entry.content, grading: entry.grading,
          source: { importJobId: jobId, sourceAssetId: job.sourceAssetId ?? null,
            originalQuestionId: entry.originalQuestionId }, now, ownerDisplayName });
        await tx.query(
          "INSERT INTO quizer.import_receipts " +
          "(job_id,import_item_key,payload_hash,problem_id,revision_id) " +
          "VALUES ($1,$2,$3,$4,$5)",
          [jobId, entry.key, entry.payloadHash, problemId, revisionId]);
        mapped.set(entry.key, { importItemKey: entry.key, ...created,
          itemId, points: entry.points, hash: entry.payloadHash });
      }
      return { mappings: entries.map(e => mapped.get(e.key)),
        processedInBatch: entries.length,
        newlyInserted: [...mapped.values()].filter(x => !x.replayed).length };
    });
  }
  return Object.freeze({ enabled: true, createProblem,
    saveProblemRevision, importProblemBatch });
}
