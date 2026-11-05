import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const src=readFileSync(new URL(
  "../integration/stg2-6-emulator-reset-restore.test.mjs",import.meta.url),"utf8");
test("STG2.6 reset/restore does not address real Quizer or Mimo resources",()=>{
  assert.match(src,/PROJECT="demo-mathquiz-v2"/);
  assert.match(src,/assert\(process\.env\.FIRESTORE_EMULATOR_HOST/);
  assert.match(src,/initializeApp\(\{projectId:PROJECT\}/);
  assert.match(src,/stg2Synthetic\//);
  assert.match(src,/stg2reset_/);
  assert.doesNotMatch(src,/sat-quiz-fd317|quizer-staging-az26|mimo-backend-513412|soft-grass-35754518/);
  assert.doesNotMatch(src,/DROP\s|ALTER\s|firebase\s+deploy|gcloud\s|run_sql/);
});
test("STG2.6 backup and restore is create-only, cleanup is fixture-scoped",()=>{
  assert.match(src,/batch\.create\(reference\(name\),backup\[name\]\)/);
  assert.match(src,/batch\.create\(reference\(name\),original\[name\]\)/);
  assert.match(src,/names=\["problem","quiz","attempt"\]/);
  assert.match(src,/for\(const name of names\)batch\.delete\(reference\(name\)\)/);
  assert.doesNotMatch(src,/\.recursiveDelete\(|\.listDocuments\(|\.deleteCollection\(/);
  assert.match(src,/fixtureKind:"STG2_EMULATOR_ONLY"/);
});
