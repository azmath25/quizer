// QN11.5 STAGED: resolve immutable, authorized Neon publication sources.
// Injected trusted server ports only. Never imported by the active worker.
import {assert,id,validateProblem,assetIds} from "../../shared/schema.js";
import {requireTeacher} from "../neon/contracts.js";
import {fingerprint} from "../neon/write-repository.js";

export function createPinnedNeonPublicationResolver({
  enabled=false,readRepository,resolvePublicationActor,verifyAssets,
}={}){
  if(enabled!==true)return Object.freeze({
    enabled:false,resolve:async()=>({disabled:true}),
  });
  assert(readRepository?.getProblemForTeacher &&
    typeof resolvePublicationActor==="function" &&
    typeof verifyAssets==="function","INVALID_FIELDS",
    "Trusted publication identity, SQL and asset authorization ports required.");
  async function resolve({problemId,problemRevisionId,source,plan}={}){
    const problem=id(problemId,"problem ID"),
      revision=id(problemRevisionId,"problem revision ID");
    assert(plan?.jobId && plan?.quizId && plan?.revisionId &&
      typeof plan.leaseOwner==="string" && plan.leaseOwner.length>0 &&
      Array.isArray(plan.sources) && plan.sources.length>=1 &&
      plan.sources.length<=500,
      "RESOURCE_UNAVAILABLE","Trusted publication plan unavailable.");
    const pinned=plan.sources.filter(slot=>
      slot.problemId===problem && slot.problemRevisionId===revision &&
      slot.source?.kind==="neon_revision");
    assert(pinned.length>0 && pinned.every(slot=>
      slot.source.problemId===problem &&
      slot.source.problemRevisionId===revision &&
      /^[0-9a-f]{64}$/.test(slot.contentHash) &&
      slot.contentHash===pinned[0].contentHash) &&
      source?.kind==="neon_revision" &&
      source.problemId===problem &&
      source.problemRevisionId===revision,
      "VERSION_CONFLICT","Pinned publication source changed.");
    // The publisher actor MUST be loaded from the verified persisted job and
    // lease, never the browser-provided source or claimed role.
    const actor=requireTeacher(await resolvePublicationActor({plan}));
    const loaded=await readRepository.getProblemForTeacher({
      actor,problemId:problem,revisionId:revision,
    });
    assert(loaded?.problemId===problem && loaded.revisionId===revision &&
      loaded.content && loaded.grading,
      "RESOURCE_UNAVAILABLE","Immutable Neon revision unavailable.");
    const {gradingVersion,...key}=loaded.grading;
    assert(gradingVersion===undefined||gradingVersion===1,
      "VERSION_CONFLICT","Unknown grading version.");
    const normalized=validateProblem(loaded.content,key);
    assert(fingerprint(normalized)===pinned[0].contentHash,
      "VERSION_CONFLICT","Pinned immutable problem hash mismatch.");
    // Verify retention/authorization of BOTH question and solution assets
    // before writing private Storage, and fail closed on any expired object.
    const assets=assetIds(normalized.content,normalized.grading);
    assert(await verifyAssets({
      actor,plan,problemId:problem,problemRevisionId:revision,
      assetIds:assets,
    })===true,"RESOURCE_UNAVAILABLE",
      "A pinned asset was not authorized or ready.");
    return {
      problemId:problem,problemRevisionId:revision,
      content:normalized.content,grading:normalized.grading,
    };
  }
  return Object.freeze({enabled:true,resolve});
}
