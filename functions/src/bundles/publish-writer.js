// QN10.2 — staged, fail-closed, private bundle publisher.
// NOT registered with the active worker. The old Firestore publish path
// remains authoritative until QN10.3 supplies secured student delivery.
import { assert, id, number, validateProblem } from "../../shared/schema.js";
import { fingerprint } from "../neon/write-repository.js";
import {
  BUNDLE_FORMAT, BUNDLE_CONTENT_TYPE, MAX_BUNDLE_BYTES,
  preparePublishedBundle, makePublishedBundleManifest,
  readPrivatePublishedBundle,
} from "./published-bundle.js";

function requirePinnedPlan(plan, jobId) {
  assert(plan && typeof plan === "object" && plan.jobId === jobId,
    "RESOURCE_UNAVAILABLE", "Trusted publication job unavailable.");
  const quizId = id(plan.quizId, "quiz ID");
  const revisionId = id(plan.revisionId, "revision ID");
  assert(plan.leaseOwner && typeof plan.leaseOwner === "string" &&
    plan.leaseOwner.length <= 128,
    "RESOURCE_UNAVAILABLE", "Active publication lease required.");
  assert(plan.revision && plan.revision.state === "building" &&
    plan.revision.publicationJobId === jobId,
    "FAILED_PRECONDITION", "Revision is not awaiting publication.");
  assert(Array.isArray(plan.sources) &&
    plan.sources.length >= 1 && plan.sources.length <= 500,
    "INVALID_FIELDS", "Publication must contain 1–500 pinned sources.");
  assert(Array.isArray(plan.revision.itemOrder) &&
    plan.revision.itemOrder.length === plan.sources.length,
    "INVALID_FIELDS", "Publication order mismatch.");
  const seen = new Set();
  for (let index = 0; index < plan.sources.length; index++) {
    const slot = plan.sources[index];
    const itemId = id(slot.itemId, "published item ID");
    id(slot.problemId, "problem ID");
    id(slot.problemRevisionId, "pinned problem revision ID");
    number(slot.points, "Points", 0.00000001, 1000);
    assert(!seen.has(itemId) && itemId === plan.revision.itemOrder[index],
      "INVALID_FIELDS", "Duplicate or reordered source item.");
    seen.add(itemId);
    assert(slot.source?.kind === "neon_revision" &&
      slot.source.problemId === slot.problemId &&
      slot.source.problemRevisionId === slot.problemRevisionId &&
      typeof slot.contentHash === "string" &&
      /^[a-f0-9]{64}$/.test(slot.contentHash),
      "INVALID_FIELDS", "Pinned immutable Neon source hash required.");
  }
  return { quizId, revisionId };
}

export function createPrivateBundlePublisher({
  enabled = false, publicationStore, resolvePinnedRevision, storage,
} = {}) {
  if (enabled !== true) {
    return Object.freeze({enabled:false,
      publish: async () => ({disabled:true})});
  }
  assert(publicationStore &&
    typeof publicationStore.load === "function" &&
    typeof publicationStore.activate === "function" &&
    typeof resolvePinnedRevision === "function" &&
    storage && typeof storage.createOnly === "function" &&
    typeof storage.readExact === "function",
    "INVALID_FIELDS", "Trusted bundle writer dependencies are required.");

  async function publish({jobId} = {}) {
    id(jobId, "publication job ID");
    // PublicationStore is the sole authority for job, quiz and revision state.
    // Browser input never supplies quiz ID, owner, items or grading.
    const plan = await publicationStore.load(jobId);
    if (plan?.completed === true) {
      assert(plan.revisionId && plan.quizId &&
        plan.manifest && plan.manifest.revisionId === plan.revisionId,
        "RESOURCE_UNAVAILABLE", "Completed publication metadata unavailable.");
      return {alreadyPublished:true,quizId:plan.quizId,
        revisionId:plan.revisionId,manifest:plan.manifest};
    }
    const {quizId,revisionId} = requirePinnedPlan(plan,jobId);
    const items = [];
    for (const slot of plan.sources) {
      // This injected port MUST fetch the EXACT immutable Neon problem
      // revision, not its mutable/latest problem bank pointer.
      const resolved = await resolvePinnedRevision({
        problemId:slot.problemId,
        problemRevisionId:slot.problemRevisionId,
        source:slot.source,
        // Trusted publication plan comes from Firestore's lease/draft
        // preflight; the staged resolver rechecks actor, pin and assets.
        plan,
      });
      assert(resolved && resolved.problemId === slot.problemId &&
        resolved.problemRevisionId === slot.problemRevisionId,
        "VERSION_CONFLICT", "Pinned source revision identity mismatch.");
      assert(resolved.grading && typeof resolved.grading === "object" &&
        (resolved.grading.gradingVersion === undefined ||
          resolved.grading.gradingVersion === 1),
        "VERSION_CONFLICT", "Unsupported immutable grading version.");
      const {gradingVersion: ignoredVersion, ...gradingInput} = resolved.grading;
      const normalized = validateProblem(resolved.content,gradingInput);
      assert(fingerprint(normalized) === slot.contentHash,
        "VERSION_CONFLICT", "Pinned source revision content changed.");
      items.push({itemId:slot.itemId,problemId:slot.problemId,
        problemRevisionId:slot.problemRevisionId,points:slot.points,
        content:normalized.content,grading:normalized.grading});
    }

    const revision = plan.revision;
    const prepared = preparePublishedBundle({
      format:BUNDLE_FORMAT,quizId,revisionId,
      revisionNumber:revision.revisionNumber,
      title:revision.title,description:revision.description,
      subject:revision.subject,difficulty:revision.difficulty,
      settings:revision.settings,itemOrder:revision.itemOrder,
      itemCount:revision.itemCount,totalPoints:revision.totalPoints,items,
    });

    // No writable overwrite or delete path, including on retries.
    // A 412 precondition failure means the exact path already exists; still
    // read it back and hash-verify before any Firestore activation.
    try {
      await storage.createOnly({
        storagePath:prepared.storagePath,
        bytes:prepared.bytes,
        contentType:BUNDLE_CONTENT_TYPE,
        cacheControl:"private, no-store",
        ifGenerationMatch:0,
      });
    } catch(error) {
      if(error?.code !== 412 && error?.code !== "OBJECT_ALREADY_EXISTS")
        throw error;
    }

    // Read exact object generation and bytes from Admin Storage, NEVER URL.
    const stored = await storage.readExact({
      storagePath:prepared.storagePath,maxBytes:MAX_BUNDLE_BYTES});
    assert(stored && typeof stored.generation === "string" &&
      stored.generation !== "0" &&
      stored.downloadTokenPresent !== true,
      "RESOURCE_UNAVAILABLE", "Unverified private Storage object.");
    const manifest = makePublishedBundleManifest(prepared,stored.generation);
    // The only permitted authorization in this internal readback is the
    // job's trusted preflight. Firestore activation RECHECKS the lease, draft,
    // source plan and prior published pointer in its own transaction.
    await readPrivatePublishedBundle({
      manifest,quizId,revisionId,
      authorizePinnedRead:async()=>({
        authorized:true,pinnedRevisionId:revisionId,
      }),
      readObject:async({storagePath,generation,maxBytes})=>{
        assert(storagePath===prepared.storagePath &&
          generation===manifest.generation && maxBytes===MAX_BUNDLE_BYTES,
          "RESOURCE_UNAVAILABLE", "Unexpected Storage read contract.");
        return stored;
      },
    });
    const result = await publicationStore.activate({plan,manifest});
    assert(result && (result.activated===true || result.alreadyPublished===true),
      "RESOURCE_UNAVAILABLE", "Publication activation was not confirmed.");
    return {quizId,revisionId,manifest,...result};
  }
  return Object.freeze({enabled:true,publish});
}
