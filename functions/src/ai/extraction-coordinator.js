/**
 * Q-AI.4.1 — server-only, one-checkpoint-per-invocation PDF orchestrator.
 *
 * Intentional separation: another workstream owns the Neon schema/adapter.
 * This module writes nothing to Neon itself. Its injected store MUST provide
 * atomic job ownership, durable checkpoints, lease fencing and an outbox.
 * Never import this file into the browser or call it without Firebase IAM.
 *
 * No process timers, in-memory queue, secret handling or paid live calls.
 */
import { createHash, randomUUID } from "node:crypto";
import { validateExtractedPage } from "../../shared/mimo-extraction.js";

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const MAX_BYTES = 10 * 1024 * 1024;
const TERMINAL = new Set(["awaiting_review", "cancelled", "attention", "submission_uncertain"]);
const RUN_PENDING = new Set(["queued", "running", "pending", "deferred", "claimed", "scheduled"]);
const RUN_STOPPED = new Set(["failed", "cancelled", "waiting_for_review", "interrupted", "dispatch_failed"]);
const STAGES = new Set([
  "upload_source", "ingest_source", "render_page", "prepare_submission",
  "submit_page", "poll_page", ...TERMINAL,
]);

export class ExtractionJobError extends Error {
  constructor(code) { super(code); this.name = "ExtractionJobError"; this.code = code; }
}
function fail(code) { throw new ExtractionJobError(code); }
function isId(value) {
  return typeof value === "string" && ID.test(value) &&
    !["__proto__", "prototype", "constructor"].includes(value);
}
function bounded(value, limit, required = true) {
  return typeof value === "string" && value.length <= limit &&
    (!required || !!value.trim()) && !/[\u0000-\u001f]/.test(value);
}
function hash(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function asBytes(data) {
  if (!(data instanceof Uint8Array) || data.byteLength < 1 ||
      data.byteLength > MAX_BYTES) fail("INVALID_SOURCE");
  return data;
}
function artifactId(result) {
  const value = result?.id ?? result?.artifact_id;
  if (!isId(value)) fail("INVALID_MIMO_ARTIFACT");
  return value;
}
function runId(result) {
  const value = result?.id ?? result?.runId ?? result?.run_id;
  if (typeof value !== "string" || !UUID.test(value))
    fail("INVALID_MIMO_RUN");
  return value;
}
function extractPage(run) {
  const payload = run?.output?.exports?.extracted_page;
  let data = payload;
  if (typeof data === "string") {
    if (Buffer.byteLength(data, "utf8") > 256 * 1024)
      fail("EXTRACTION_TOO_LARGE");
    try { data = JSON.parse(data); } catch { fail("INVALID_EXTRACTION_OUTPUT"); }
  }
  if (!data || typeof data !== "object" || Array.isArray(data))
    fail("MISSING_EXTRACTED_PAGE_EXPORT");
  return data;
}
function pageInput(job, instructions) {
  const annotation = bounded(job.pageTextExcerpt ?? "", 2000, false)
    ? job.pageTextExcerpt : "";
  return {
    kind: "mimo_image_artifact", artifact_id: job.pageArtifactId,
    text: [
      instructions,
      "Extract mathematics from PDF page " + job.pageNumber + " of " + job.pageCount + ".",
      "Respect visible page evidence; preserve uncertain spans. Never infer unseen pages or answers.",
      annotation ? "Trusted PDF text excerpt (may be incomplete):\n" + annotation : "",
    ].filter(Boolean).join("\n").slice(0,4000),
  };
}

/**
 * Storage port:
 *  inspectOwnedPdf({uid,sourceRef}) -> {sizeBytes, contentType}
 *  readOwnedPdf({uid,sourceRef}) -> {bytes: Uint8Array, contentType}
 *
 * Neon store port (all mutating operations atomic and fenced):
 *  createJob(record) -> record (unique by ownerUid+requestId)
 *  getOwnedJob({uid,jobId}) -> record|null
 *  claimJob({jobId,workerId,leaseMs}) -> {job,leaseToken,version}|null
 *  commitStep({jobId,leaseToken,version,patch,pageResult?}) -> record
 *  recordIssue({jobId,leaseToken,version,status,code}) -> record
 *
 * claimJob MUST reject terminal jobs, respect the next-at timestamp,
 * atomically bump a version, and fence concurrent/expired workers.
 * commitStep and recordIssue MUST only accept that exact lease/version.
 * pageResult insertion and advancing the job MUST be one transaction.
 * A durable outbox/reconciler must wake queued jobs and pending polls.
 */
export function createExtractionCoordinator({
  store, storage, mimo, workflowId, version, maxPages = 20,
  instructions = "Return the exact mimo.extracted_page.v1 JSON as named export extracted_page.",
  uuid = randomUUID, workerLeaseMs = 90_000,
} = {}) {
  if (!store || !storage || !mimo ||
      !["createJob", "getOwnedJob", "claimJob", "commitStep", "recordIssue"]
        .every(key => typeof store[key] === "function") ||
      !["inspectOwnedPdf", "readOwnedPdf"].every(key => typeof storage[key] === "function") ||
      !["uploadArtifact", "ingestArtifact", "renderPage", "run", "getRun"]
        .every(key => typeof mimo[key] === "function"))
    throw new Error("Complete trusted storage/Neon/Mimo ports required");
  if (!isId(workflowId) || !Number.isInteger(version) || version < 1 ||
      !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100 ||
      !bounded(instructions, 2000) ||
      !Number.isInteger(workerLeaseMs) || workerLeaseMs < 15_000 || workerLeaseMs > 300_000)
    throw new Error("Pin a bounded published extraction workflow and worker lease");

  async function create({uid, requestId, sourceRef, title}) {
    // uid comes from verified Firebase Authentication on the server, NEVER data.uid.
    if (!isId(uid) || !isId(sourceRef) || !bounded(title, 160) ||
        !isId(requestId) || requestId.length < 16) fail("INVALID_FIELDS");
    const meta = await storage.inspectOwnedPdf({uid, sourceRef});
    if (meta?.contentType !== "application/pdf" ||
        !Number.isInteger(meta.sizeBytes) || meta.sizeBytes < 1 ||
        meta.sizeBytes > MAX_BYTES)
      fail("INVALID_SOURCE");
    const id = uuid();
    if (!UUID.test(id)) fail("INVALID_JOB_ID");
    const record = {
      id, ownerUid: uid, requestId, sourceRef, title: title.trim(),
      status: "queued", stage: "upload_source",
      workflowId, workflowVersion: version,
      pageNumber: 1, pageCount: null, sourceSha256: null,
      sourceArtifactId: null, pageArtifactId: null,
      mimoRunId: null, idempotencyKey: null, pageTextExcerpt: "",
    };
    return store.createJob(record);
  }
  async function status({uid, jobId}) {
    if (!isId(uid) || !UUID.test(jobId)) fail("INVALID_FIELDS");
    const job = await store.getOwnedJob({uid,jobId});
    if (!job) fail("JOB_NOT_FOUND");
    return {
      id:job.id,status:job.status,stage:job.stage,
      pageNumber:job.pageNumber,pageCount:job.pageCount,
      updatedAt:job.updatedAt ?? null,
      // Never include sourceRef, source SHA, provider key, image bytes or prompts.
    };
  }
  async function advance({jobId, workerId}) {
    // This operation is ONLY for a server-authenticated worker/queue consumer.
    if (!UUID.test(jobId) || !isId(workerId)) fail("INVALID_WORKER_REQUEST");
    const claim = await store.claimJob({jobId,workerId,leaseMs:workerLeaseMs});
    if (!claim) return {status:"not_claimed"};
    const {job,leaseToken,version:rowVersion} = claim;
    if (!UUID.test(job?.id) || job.id !== jobId || !isId(job.ownerUid) ||
        !STAGES.has(job.stage) || !isId(leaseToken) ||
        !Number.isInteger(rowVersion) || rowVersion < 1 ||
        job.workflowId !== workflowId || job.workflowVersion !== version)
      fail("INVALID_CLAIM");
    if (TERMINAL.has(job.stage))
      fail("TERMINAL_JOB_CLAIMED");
    const commit = async (patch, pageResult) => {
      const result = await store.commitStep({
        jobId, leaseToken, version:rowVersion, patch,
        ...(pageResult ? {pageResult} : {}),
      });
      return {status:result.status,stage:result.stage,pageNumber:result.pageNumber};
    };
    const issue = async (code, value = "attention") => {
      await store.recordIssue({
        jobId,leaseToken,version:rowVersion,status:value,code,
      });
      return {status:value,code};
    };

    // At most ONE remote provider operation per invocation. All checkpoints are
    // durable before proceeding. We never hold SQL transactions over I/O.
    try {
      switch (job.stage) {
        case "upload_source": {
          const file = await storage.readOwnedPdf({uid:job.ownerUid,sourceRef:job.sourceRef});
          if (file?.contentType !== "application/pdf") fail("INVALID_SOURCE");
          const bytes = asBytes(file.bytes);
          const actualSha256 = hash(bytes);
          if (job.sourceSha256 !== null && job.sourceSha256 !== actualSha256)
            fail("SOURCE_CHANGED");
          const artifact = await mimo.uploadArtifact("source.pdf", bytes, "application/pdf");
          return commit({stage:"ingest_source",status:"running",
            sourceArtifactId:artifactId(artifact),sourceSha256:actualSha256});
        }
        case "ingest_source": {
          if (!isId(job.sourceArtifactId) || !HASH.test(job.sourceSha256))
            fail("INVALID_CHECKPOINT");
          const metadata = await mimo.ingestArtifact(job.sourceArtifactId);
          const count = metadata?.page_count;
          if (!Number.isInteger(count) || count < 1 || count > maxPages)
            fail("PDF_PAGE_LIMIT");
          return commit({stage:"render_page",status:"running",pageCount:count,
            pageNumber:1});
        }
        case "render_page": {
          if (!isId(job.sourceArtifactId) || !Number.isInteger(job.pageNumber) ||
              !Number.isInteger(job.pageCount) || job.pageNumber < 1 ||
              job.pageNumber > job.pageCount) fail("INVALID_CHECKPOINT");
          const artifact = await mimo.renderPage(job.sourceArtifactId,job.pageNumber);
          return commit({stage:"prepare_submission",status:"running",
            pageArtifactId:artifactId(artifact)});
        }
        case "prepare_submission": {
          if (!isId(job.pageArtifactId) || !Number.isInteger(job.pageNumber))
            fail("INVALID_CHECKPOINT");
          // Persist the key BEFORE a billable request. If the worker crashes
          // afterward, a later call can use the exact same Mimo key.
          const key = "qai4_" + job.id.replace(/-/g,"") + "_p" + job.pageNumber;
          return commit({stage:"submit_page",status:"running",idempotencyKey:key});
        }
        case "submit_page": {
          if (!isId(job.pageArtifactId) || !isId(job.idempotencyKey) ||
              !Number.isInteger(job.pageNumber) || !Number.isInteger(job.pageCount))
            fail("INVALID_CHECKPOINT");
          const result = await mimo.run(
            workflowId,pageInput(job,instructions),
            {version,background:true,idempotencyKey:job.idempotencyKey});
          return commit({stage:"poll_page",status:"running",mimoRunId:runId(result)});
        }
        case "poll_page": {
          if (!UUID.test(job.mimoRunId) || !HASH.test(job.sourceSha256) ||
              !isId(job.sourceArtifactId) || !isId(job.pageArtifactId))
            fail("INVALID_CHECKPOINT");
          const result = await mimo.getRun(job.mimoRunId);
          if (RUN_PENDING.has(result?.status))
            return commit({stage:"poll_page",status:"running",nextPollAt:"later"});
          if (RUN_STOPPED.has(result?.status))
            return issue("MIMO_" + String(result.status).toUpperCase(), "attention");
          if (result?.status !== "completed") return issue("UNEXPECTED_MIMO_STATUS");
          const trustedSource = {
            document_id:job.id, source_artifact_id:job.sourceArtifactId,
            page_artifact_id:job.pageArtifactId,page_number:job.pageNumber,
            page_count:job.pageCount,sha256:job.sourceSha256,
          };
          const extracted = validateExtractedPage(extractPage(result),trustedSource);
          const last = job.pageNumber === job.pageCount;
          // Page review data and advancing the cursor are ONE Neon transaction.
          return commit({
            stage:last?"awaiting_review":"render_page",
            status:last?"awaiting_review":"running",
            pageNumber:last?job.pageNumber:job.pageNumber+1,
            pageArtifactId:null,mimoRunId:null,idempotencyKey:null,
          },{pageNumber:job.pageNumber,mimoRunId:job.mimoRunId,
            source:trustedSource,extraction:extracted});
        }
        default: return issue("UNKNOWN_STAGE");
      }
    } catch (error) {
      const code=error instanceof ExtractionJobError?error.code:
        error?.name==="ExtractionContractError"?"EXTRACTION_INVALID":
          "UPSTREAM_OR_STORAGE_FAILURE";
      // No automatic second Mimo submission after a network/DB ambiguity:
      // service operator must first reconcile the preserved idempotency key.
      if (job.stage === "submit_page")
        return issue("MIMO_SUBMISSION_UNCERTAIN","submission_uncertain");
      return issue(code,"attention");
    }
  }
  return Object.freeze({create,status,advance});
}
