// QN8: STAGED bridge for existing Firebase action names. Not registered as
// another public API or installed in active dispatch until QN11 compatibility
// and legacy-preservation tests pass. Runs OUTSIDE Firebase transactions.
import { fields, assert } from "../../shared/schema.js";
import { requireTeacher, requireId } from "./contracts.js";

const ACTION_FIELDS = Object.freeze({
  createProblem: ["metadata", "content", "grading"],
  saveProblemRevision: ["problemId", "expectedVersion", "metadata", "content", "grading"],
  importProblemBatch: ["jobId", "records"],
});
export function createQuizerNeonActionGateway({
  enabled = false, writer, resolveFirebaseActor, readFirebaseImportJob,
} = {}) {
  if (enabled !== true)
    return Object.freeze({ enabled:false, handle:async()=>({ disabled:true }) });
  if (!writer?.enabled || typeof resolveFirebaseActor !== "function" ||
      typeof readFirebaseImportJob !== "function")
    throw new Error("QN8 requires trusted Firebase identity/job loaders and enabled Neon writer.");

  return Object.freeze({
    enabled: true, replaySafeEdits: writer.replaySafeEdits === true,
    async handle(action, trustedFirebaseAuth, request) {
      assert(Object.hasOwn(ACTION_FIELDS, action),
        "INVALID_FIELDS", "Unsupported Neon bank action.");
      // These fields are the existing callable payload, not a new public URL.
      fields(request, ["apiVersion", "action", "requestId", ...ACTION_FIELDS[action]]);
      assert(request.apiVersion === 2 && request.action === action &&
        typeof request.requestId === "string" &&
        /^[a-zA-Z0-9_-]{16,100}$/.test(request.requestId),
      "INVALID_FIELDS", "Invalid action envelope.");
      // This callback must fetch Firestore role/account state for verified
      // Firebase Auth; never trust actor/user/role fields in request JSON.
      const actor = requireTeacher(await resolveFirebaseActor(trustedFirebaseAuth));
      if (action === "createProblem")
        return writer.createProblem({ actor, requestId:request.requestId,
          metadata:request.metadata,content:request.content,grading:request.grading });
      if (action === "saveProblemRevision")
        return writer.saveProblemRevision({ actor,requestId:request.requestId,
          problemId:request.problemId,expectedVersion:request.expectedVersion,
          metadata:request.metadata,content:request.content,grading:request.grading });
      const jobId = requireId(request.jobId, "job ID");
      // Import authorization is explicitly rechecked in Firebase immediately
      // before the Neon transaction. QN11 still must persist safe progress
      // and reconcile partial cross-store completion before live cutover.
      const job = await readFirebaseImportJob({ jobId, actor });
      // Existing Firebase jobs store sourceAssetId inside input. Do not trust
      // a browser-supplied source/owner; normalize only the privileged lookup.
      assert(job?.kind==="import" && job.requestedBy===actor.uid &&
        job.status==="running",
        "RESOURCE_UNAVAILABLE","Import job unavailable.");
      const sourceAssetId=job.input?.sourceAssetId ?? job.sourceAssetId ?? null;
      return writer.importProblemBatch({
        actor,job:{
          jobId,kind:"import",status:job.status,requestedBy:job.requestedBy,
          sourceAssetId,
        },
        records:request.records,
      });
    },
  });
}
