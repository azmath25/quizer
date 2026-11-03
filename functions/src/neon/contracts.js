// QN3: server-only contracts; NOT imported by the browser or wired to a live DB.
// @ts-check

/** @typedef {'teacher'|'admin'} TeacherRole */
/** @typedef {{uid:string, role: TeacherRole, accountStatus?:string, emailVerified?:boolean}} TrustedFirebaseActor */
/** @typedef {{problemId:string, ownerId:string, title:string, subject:string, difficulty:string, tags:string[], bankVisibility:'private'|'teachers', lifecycle:'active'|'trashed', latestRevisionId:string, revisionNumber:number, version:number, updatedAt:string}} ProblemHeader */
/** @typedef {{type:'open'|'choice',answerMode:'auto'|'manual',statementLatex:string,options:{id:string,textLatex:string}[],defaultPoints:number,questionAssetBindings:Record<string,string>}} RevisionContent */
/** @typedef {{correctOptionId:string|null,acceptedAnswers:string[],tolerance:number,explanationLatex:string,rubricLatex:string,solutionAssetBindings:Record<string,string>}} ProtectedGrading */
/** @typedef {{query:(sql:string,values:unknown[])=>Promise<{rows:Record<string,unknown>[]} >}} ServerQueryPort */

export class NeonContractError extends Error {
  constructor(reason, message) {
    super(message);
    this.name = "NeonContractError";
    this.reason = reason;
  }
}
export function requireId(value, label = "ID") {
  if (typeof value !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(value) ||
    ["__proto__", "constructor", "prototype"].includes(value))
    throw new NeonContractError("INVALID_FIELDS", "Invalid " + label + ".");
  return value;
}
/** Actor MUST come from Firebase's server-verified Context, NEVER request JSON. */
export function requireTeacher(actor) {
  if (!actor || typeof actor !== "object" || typeof actor.uid !== "string")
    throw new NeonContractError("AUTH_REQUIRED", "Sign in to continue.");
  requireId(actor.uid, "user ID");
  if (actor.accountStatus === "disabled")
    throw new NeonContractError("ACCOUNT_DISABLED", "This account is disabled.");
  if (actor.emailVerified !== true)
    throw new NeonContractError("EMAIL_UNVERIFIED", "Verify your email.");
  if (actor.role !== "teacher" && actor.role !== "admin")
    throw new NeonContractError("ROLE_REQUIRED", "Teacher access required.");
  return actor;
}
export function requireHash(value, label = "hash") {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value))
    throw new NeonContractError("INVALID_FIELDS", "Invalid " + label + ".");
  return value;
}
export function requirePageSize(value = 25) {
  if (!Number.isInteger(value) || value < 1 || value > 100)
    throw new NeonContractError("INVALID_FIELDS", "Page size must be 1–100.");
  return value;
}
export function requireText(value, max, label) {
  if (typeof value !== "string" || value.length > max)
    throw new NeonContractError("INVALID_FIELDS", "Invalid " + label + ".");
  return value;
}
export function asIso(value) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime()))
    throw new NeonContractError("INVALID_FIELDS", "Invalid timestamp.");
  return parsed.toISOString();
}
/** Safely return only the fields the existing problem-bank list exposes. */
export function toProblemHeader(row) {
  return {
    id: row.problem_id,
    problemId: row.problem_id,
    ownerId: row.owner_uid,
    ownerDisplayName: row.owner_display_name ?? "",
    title: row.title,
    searchTitle: row.search_title,
    subject: row.subject,
    difficulty: row.difficulty,
    tags: Array.isArray(row.tags) ? row.tags : [],
    bankVisibility: row.bank_visibility,
    lifecycle: row.lifecycle,
    latestRevisionId: row.latest_revision_id,
    revisionNumber: Number(row.revision_number),
    version: Number(row.version),
    updatedAt: asIso(row.updated_at),
  };
}
/** A shared problem never grants access to its entire uploaded source TeX. */
export function safeSource(source, canSeeWholeSource) {
  const originalQuestionId = source?.originalQuestionId ?? null;
  return canSeeWholeSource
    ? { importJobId: source?.importJobId ?? null,
        sourceAssetId: source?.sourceAssetId ?? null, originalQuestionId }
    : { importJobId: null, sourceAssetId: null, originalQuestionId };
}
