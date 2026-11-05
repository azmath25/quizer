import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
const source=readFileSync(new URL(
  "../../scripts/staging/stg2-infra-readonly-audit.py",import.meta.url),"utf8");

test("STG2.2 Cloud Shell inventory is syntactically valid, offline",()=>{
  // Parsing-only: python -c does not import or execute the staging script.
  execFileSync("python3",["-c","import ast,sys;ast.parse(sys.stdin.read())"],
    {input:source,timeout:10000});
});
test("STG2.2 always refuses deployment even when inventory looks complete",()=>{
  assert.match(source,/return 2\s+# Always fail closed/);
  assert.match(source,/"authorizesDeployment": False/);
  assert.match(source,/"authorizesBillingChange": False/);
  assert.match(source,/"authorizesSecretsAccess": False/);
  assert.match(source,/"authorizesProductionChange": False/);
});
test("STG2.2 pins Quizer-only project and does not use a default project",()=>{
  assert.match(source,/PROJECT = "quizer-staging-az26"/);
  assert.match(source,/PROJECT_NUMBER = "509423933910"/);
  assert.match(source,/env\.pop\("GOOGLE_CLOUD_QUOTA_PROJECT", None\)/);
  assert.match(source,/CLOUDSDK_CORE_DISABLE_PROMPTS/);
  assert.doesNotMatch(source,/mimo-backend-|sat-quiz-fd317/);
  assert.doesNotMatch(source,/billing accounts list|gcloud config set project/);
});
test("STG2.2 never invokes a cloud write, API enable or secret-version read",()=>{
  assert.doesNotMatch(source,
    /"services", "enable"|"deploy"|"create"|"delete"|"update"|"set-iam-policy"|"add-iam-policy-binding"|"remove-iam-policy-binding"/);
  assert.doesNotMatch(source,/["']versions["']\s*,\s*["']access["']/);
  assert.doesNotMatch(source,/["']credentials["']\s*,\s*["']create["']/);
  assert.match(source,/subprocess\.run\(argv, capture_output=True/);
  assert.match(source,/return None, "UNVERIFIED_OR_PERMISSION_DENIED"/);
});
test("STG2.2 safe identity output excludes arbitrary account emails",()=>{
  assert.match(source,/dedicatedRuntimeAccountPresent/);
  assert.match(source,/principalClasses/);
  assert.doesNotMatch(source,/print\([^)]*get\("email"/);
});
