// QN10.1: PRIVATE published-bundle v1 contract. No dispatcher or writer.
import { createHash, timingSafeEqual } from "node:crypto";
import {
  assert, fields, id, number, text, validateProblem, validateSettings,
  DEFAULT_SETTINGS, LIMITS,
} from "../../shared/schema.js";

export const BUNDLE_FORMAT = "quizer.published_bundle.v1";
export const BUNDLE_ENCODING = "canonical-json-utf8";
export const BUNDLE_CONTENT_TYPE = "application/json";
export const MAX_BUNDLE_BYTES = 24 * 1024 * 1024;
export const BUNDLE_OBJECT_PREFIX = "published-bundles/v1";
const GRADING_FIELDS = ["correctOptionId", "acceptedAnswers", "tolerance",
  "explanationLatex", "rubricLatex", "solutionAssetBindings"];
const CONTENT_FIELDS = ["type", "answerMode", "statementLatex", "options",
  "defaultPoints", "questionAssetBindings"];
const ITEM_FIELDS = ["itemId", "problemId", "problemRevisionId", "points",
  "content", "grading"];
const BUNDLE_FIELDS = ["format", "quizId", "revisionId", "revisionNumber",
  "title", "description", "subject", "difficulty", "settings",
  "itemOrder", "itemCount", "totalPoints", "items"];
const MANIFEST_FIELDS = ["format", "encoding", "contentType", "quizId",
  "revisionId", "storagePath", "generation", "sha256", "byteLength",
  "itemCount", "totalPoints"];
const HEX = /^[0-9a-f]{64}$/;

function canonical(value, depth = 0) {
  assert(depth <= 48, "INVALID_FIELDS", "Bundle nesting limit exceeded.");
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number") {
    assert(Number.isFinite(value), "INVALID_FIELDS", "Invalid bundle number.");
    return JSON.stringify(value);
  }
  assert(value && typeof value === "object", "INVALID_FIELDS", "Invalid bundle value.");
  if (Array.isArray(value)) {
    assert(Object.keys(value).length === value.length,
      "INVALID_FIELDS", "Sparse arrays are forbidden.");
    return "[" + value.map(x => canonical(x, depth + 1)).join(",") + "]";
  }
  assert(Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null,
    "INVALID_FIELDS", "Invalid bundle object.");
  const keys = Object.keys(value).sort();
  assert(keys.every(k => !["__proto__", "prototype", "constructor"].includes(k)),
    "INVALID_FIELDS", "Unsafe property in bundle.");
  return "{" + keys.map(k => JSON.stringify(k) + ":" +
    canonical(value[k], depth + 1)).join(",") + "}";
}
export const canonicalBundleBytes = value => Buffer.from(canonical(value), "utf8");
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const digestEquals = (a,b) => typeof a === "string" &&
  typeof b === "string" && HEX.test(a) && HEX.test(b) &&
  timingSafeEqual(Buffer.from(a,"hex"),Buffer.from(b,"hex"));

function normalizeItem(raw) {
  fields(raw, ITEM_FIELDS, "published item");
  const itemId = id(raw.itemId, "published item ID");
  const problemId = id(raw.problemId, "problem ID");
  const problemRevisionId = id(raw.problemRevisionId, "problem revision ID");
  const points = number(raw.points, "Item points", 0.00000001, 1000);
  fields(raw.content, CONTENT_FIELDS, "question content");
  fields(raw.grading, [...GRADING_FIELDS,"gradingVersion"], "grading");
  if (raw.grading.gradingVersion !== undefined)
    assert(raw.grading.gradingVersion === 1,
      "INVALID_FIELDS", "Unsupported grading version.");
  const gradingInput = Object.fromEntries(GRADING_FIELDS
    .filter(k => Object.hasOwn(raw.grading,k)).map(k => [k,raw.grading[k]]));
  const {content,grading} = validateProblem({
    ...raw.content,
    defaultPoints: raw.content.defaultPoints ?? points,
  },gradingInput);
  return {itemId,problemId,problemRevisionId,points,content,grading};
}

export function normalizePublishedBundle(input) {
  fields(input,BUNDLE_FIELDS,"published bundle");
  assert(input.format === BUNDLE_FORMAT,
    "INVALID_FIELDS","Unsupported published bundle version.");
  const quizId = id(input.quizId,"quiz ID"),
    revisionId = id(input.revisionId,"published revision ID");
  const revisionNumber = number(input.revisionNumber,"revision number",
    1,Number.MAX_SAFE_INTEGER,true);
  const title = text(input.title,"Title",200,true);
  const description = text(input.description,"Description",2000);
  const subject = text(input.subject,"Subject",80);
  const difficulty = text(input.difficulty,"Difficulty",40);
  const settings = validateSettings(input.settings,DEFAULT_SETTINGS);
  assert(Array.isArray(input.items) && input.items.length>0 &&
    input.items.length<=LIMITS.items,"INVALID_FIELDS","Expected 1–500 items.");
  const items = input.items.map(normalizeItem);
  assert(Array.isArray(input.itemOrder) && input.itemOrder.length===items.length,
    "INVALID_FIELDS","Invalid item order.");
  const itemOrder = input.itemOrder.map(value => id(value,"ordered item ID"));
  assert(new Set(itemOrder).size===itemOrder.length &&
    items.every((item,i)=>item.itemId===itemOrder[i]),
    "INVALID_FIELDS","Items do not match pinned item order.");
  const itemCount = number(input.itemCount,"item count",1,LIMITS.items,true);
  assert(itemCount===items.length,"INVALID_FIELDS","Incorrect item count.");
  const totalPoints = Math.round(items.reduce((sum,item)=>sum+item.points,0)*1e8)/1e8;
  assert(number(input.totalPoints,"total points",0.00000001,LIMITS.items*1000)===totalPoints,
    "INVALID_FIELDS","Incorrect total points.");
  return {format:BUNDLE_FORMAT,quizId,revisionId,revisionNumber,
    title,description,subject,difficulty,settings,itemOrder,itemCount,
    totalPoints,items};
}

export function bundleStoragePath(quizId,revisionId,digest) {
  id(quizId,"quiz ID");
  id(revisionId,"revision ID");
  assert(typeof digest==="string" && HEX.test(digest),
    "INVALID_FIELDS","Invalid bundle hash.");
  return BUNDLE_OBJECT_PREFIX+"/"+quizId+"/"+revisionId+"/"+digest+".json";
}

export function preparePublishedBundle(input) {
  const bundle=normalizePublishedBundle(input);
  const bytes=canonicalBundleBytes(bundle);
  assert(bytes.byteLength<=MAX_BUNDLE_BYTES,
    "INVALID_FIELDS","Private bundle exceeds 24 MiB.");
  const hash=sha256(bytes);
  return Object.freeze({bundle,bytes,sha256:hash,byteLength:bytes.byteLength,
    storagePath:bundleStoragePath(bundle.quizId,bundle.revisionId,hash)});
}

export function makePublishedBundleManifest(prepared,generation) {
  assert(prepared && Buffer.isBuffer(prepared.bytes) &&
    typeof prepared.sha256==="string" &&
    digestEquals(sha256(prepared.bytes),prepared.sha256),
    "INVALID_FIELDS","Unverified bundle bytes.");
  const normalized=preparePublishedBundle(prepared.bundle);
  assert(prepared.storagePath===normalized.storagePath &&
    prepared.byteLength===normalized.byteLength &&
    prepared.sha256===normalized.sha256 &&
    prepared.bytes.equals(normalized.bytes),
    "INVALID_FIELDS","Prepared bundle changed.");
  assert(typeof generation==="string" && /^[1-9][0-9]{0,22}$/.test(generation),
    "INVALID_FIELDS","Storage object generation required.");
  return Object.freeze({
    format:BUNDLE_FORMAT,encoding:BUNDLE_ENCODING,
    contentType:BUNDLE_CONTENT_TYPE,quizId:normalized.bundle.quizId,
    revisionId:normalized.bundle.revisionId,
    storagePath:normalized.storagePath,generation,
    sha256:normalized.sha256,byteLength:normalized.byteLength,
    itemCount:normalized.bundle.itemCount,totalPoints:normalized.bundle.totalPoints,
  });
}

export function validatePublishedBundleManifest(manifest,quizId,revisionId) {
  fields(manifest,MANIFEST_FIELDS,"published manifest");
  assert(manifest.format===BUNDLE_FORMAT && manifest.encoding===BUNDLE_ENCODING &&
    manifest.contentType===BUNDLE_CONTENT_TYPE,
    "INVALID_FIELDS","Unsupported manifest format.");
  const q=id(manifest.quizId,"manifest quiz ID"),
    r=id(manifest.revisionId,"manifest revision ID");
  assert(q===id(quizId,"requested quiz ID") &&
    r===id(revisionId,"requested revision ID"),
    "RESOURCE_UNAVAILABLE","Requested revision mismatch.");
  assert(typeof manifest.sha256==="string" && HEX.test(manifest.sha256),
    "INVALID_FIELDS","Invalid manifest SHA-256.");
  assert(manifest.storagePath===bundleStoragePath(q,r,manifest.sha256),
    "INVALID_FIELDS","Invalid protected Storage path.");
  assert(typeof manifest.generation==="string" &&
    /^[1-9][0-9]{0,22}$/.test(manifest.generation),
    "INVALID_FIELDS","Invalid object generation.");
  number(manifest.byteLength,"bundle byte length",1,MAX_BUNDLE_BYTES,true);
  number(manifest.itemCount,"item count",1,LIMITS.items,true);
  number(manifest.totalPoints,"total points",0.00000001,LIMITS.items*1000);
  return manifest;
}

// Trusted backend helper only, NOT an HTTP endpoint.
// The caller must authorize actor + attempt/quiz before invoking it, using
// Firestore's pinned published revision and release policy.
// readObject must use Admin SDK with EXACT generation and bounded bytes.
export async function readPrivatePublishedBundle({
  manifest,quizId,revisionId,readObject,
}={}) {
  const m=validatePublishedBundleManifest(manifest,quizId,revisionId);
  assert(typeof readObject==="function",
    "INVALID_FIELDS","Trusted private Storage reader required.");
  const object=await readObject({storagePath:m.storagePath,
    generation:m.generation,maxBytes:MAX_BUNDLE_BYTES});
  assert(object && Buffer.isBuffer(object.bytes) &&
    object.bytes.byteLength<=MAX_BUNDLE_BYTES &&
    object.contentType===BUNDLE_CONTENT_TYPE &&
    String(object.generation)===m.generation,
    "RESOURCE_UNAVAILABLE","Private bundle unavailable.");
  assert(object.bytes.byteLength===m.byteLength &&
    digestEquals(sha256(object.bytes),m.sha256),
    "RESOURCE_UNAVAILABLE","Private bundle integrity mismatch.");
  let parsed;
  try{parsed=JSON.parse(object.bytes.toString("utf8"));}
  catch{assert(false,"RESOURCE_UNAVAILABLE","Invalid bundle encoding.");}
  const bundle=normalizePublishedBundle(parsed);
  assert(bundle.quizId===m.quizId && bundle.revisionId===m.revisionId &&
    bundle.itemCount===m.itemCount && bundle.totalPoints===m.totalPoints &&
    canonicalBundleBytes(bundle).equals(object.bytes),
    "RESOURCE_UNAVAILABLE","Noncanonical or mismatched private bundle.");
  // Includes protected grading. QN10.3 must implement authorized slices;
  // never return this object from a client-accessible Firebase function.
  return bundle;
}
