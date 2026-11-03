// STG1 offline-only migration safety gate. NO DB driver, credentials,
// schema changes, cloud calls, or deploy action. Input ledger is read by a
// separately approved operator; this module does NOT fetch or modify Neon.
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";

export const QUIZER_MIGRATIONS=Object.freeze([
  Object.freeze({version:1,
    path:"db/quizer/001_initial_schema.sql",
    gitBlob:"c0c7c8db0cbe424fed69d79c4124ddf705c323ea"}),
  Object.freeze({version:2,
    path:"db/quizer/002_mutation_receipts_DISPOSABLE_ONLY.sql",
    gitBlob:"07d2391efdedfab7bcfc093eb87f5717beab39f9"}),
]);

const NO_CONNECTION="Migration requires a verified disposable Quizer branch.";
function gitBlob(bytes) {
  return createHash("sha1")
    .update("blob "+bytes.byteLength+"\0")
    .update(bytes).digest("hex");
}
function verifyIdentity(identity){
  if(identity?.projectId!=="soft-grass-35754518" ||
    identity?.branchId!=="br-sweet-rice-b9ehdv9i" ||
    identity?.parentBranchId!=="br-wispy-night-b9ug6kub" ||
    identity?.branchName!=="stg1b-disposable-2026-11-04" ||
    identity?.database!=="quizer" ||
    identity?.defaultBranch===true ||
    identity?.primary===true ||
    identity?.branchId===identity?.parentBranchId)
    throw new Error(NO_CONNECTION);
}
export function inspectQuizerMigrationPlan({
  identity, applied, readBytes=(p)=>readFileSync(
    fileURLToPath(new URL("../../"+p,import.meta.url))),
}={}){
  verifyIdentity(identity);
  if(!Array.isArray(applied) || applied.length>QUIZER_MIGRATIONS.length)
    throw new Error("Unverified migration ledger; refusing to plan.");
  if(typeof readBytes!=="function")
    throw new TypeError("Trusted migration byte reader required.");
  const manifests=QUIZER_MIGRATIONS.map(m=>{
    const bytes=readBytes(m.path);
    if(!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array))
      throw new Error("Migration reader returned nonbinary source.");
    if(gitBlob(bytes)!==m.gitBlob)
      throw new Error("Migration source drift; pinned Git blob mismatch.");
    return Object.freeze({...m});
  });
  const seen=new Set();
  for(let i=0;i<applied.length;i++){
    const row=applied[i],expected=manifests[i];
    if(!row || !Number.isInteger(row.version) ||
      row.version!==expected.version || seen.has(row.version) ||
      row.gitBlob!==expected.gitBlob ||
      row.status!=="applied")
      throw new Error("Migration ledger drift or reordered/partial application.");
    seen.add(row.version);
  }
  return Object.freeze({
    authorizedTarget:Object.freeze({...identity}),
    applied:Object.freeze(manifests.slice(0,applied.length)),
    pending:Object.freeze(manifests.slice(applied.length)),
    safeToExecute:false,
    // Deliberately no run(), connection string or SQL mutation capability.
    // STG1 doesn't authorize execution of this plan by an app runner.
    nextGate:applied.length===manifests.length
      ?"Verify role login and real Firebase staging integration"
      :"Review migrations and run by an explicitly authorized operator",
  });
}
