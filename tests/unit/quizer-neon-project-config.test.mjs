import test from "node:test";
import assert from "node:assert/strict";
import { quizerNeonConfig } from "../../functions/src/neon/project-config.js";

const enabled = {
  QUIZER_NEON_ENABLED: "true",
  QUIZER_NEON_PROJECT_ID: "new-quizer-dev-project",
  MIMO_NEON_PROJECT_ID: "late-pine-40973150",
  QUIZER_NEON_DATABASE_URL:
    "postgresql://quizer_app:synthetic@ep-test-pooler.eu-central-1.aws.neon.tech/quizer?sslmode=require",
};

test("Neon feature remains off by default with no credentials", () => {
  assert.deepEqual(quizerNeonConfig({}), {enabled:false});
  assert.deepEqual(quizerNeonConfig({...enabled, QUIZER_NEON_ENABLED:"false"}), {enabled:false});
});
test("accepts a dedicated server-only Quizer project", () => {
  const c = quizerNeonConfig(enabled);
  assert.equal(c.enabled, true);
  assert.equal(c.projectId, "new-quizer-dev-project");
  assert.equal(c.database, "quizer");
  assert(c.getConnectionString().includes("quizer_app"));
  assert(!JSON.stringify(c).includes("synthetic"));
});
test("explicitly refuses the Mimo project", () => {
  assert.throws(() => quizerNeonConfig({
    ...enabled, QUIZER_NEON_PROJECT_ID:"late-pine-40973150",
  }), /separate from Mimo/);
});
test("rejects missing environment project verification", () => {
  assert.throws(() => quizerNeonConfig({
    ...enabled, MIMO_NEON_PROJECT_ID:"",
  }), /separate from Mimo/);
});
for (const [reason, url] of [
  ["localhost", "postgresql://quizer_app:x@localhost/quizer?sslmode=require"],
  ["incorrect DB", "postgresql://quizer_app:x@ep-test.neon.tech/neondb?sslmode=require"],
  ["admin role", "postgresql://neondb_owner:x@ep-test.neon.tech/quizer?sslmode=require"],
  ["no TLS", "postgresql://quizer_app:x@ep-test.neon.tech/quizer"],
  ["query override", "postgresql://quizer_app:x@ep-test.neon.tech/quizer?sslmode=require&host=localhost"],
  ["wrong protocol", "https://quizer_app:x@ep-test.neon.tech/quizer?sslmode=require"],
]) test("rejects unsafe URL: " + reason, () => assert.throws(() =>
  quizerNeonConfig({...enabled,QUIZER_NEON_DATABASE_URL:url}), /unsafe|Unexpected/));
test("invalid URL reports no connection-string secret", () => {
  const secret = "SENSITIVE_TOKEN_123";
  assert.throws(() => quizerNeonConfig({
    ...enabled, QUIZER_NEON_DATABASE_URL:"postgresql://"+secret+"%not-a-url",
  }), err => !err.message.includes(secret));
});
