import test from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {firebaseConfig as staging}
  from "../../config/firebase.staging.js";

const source=new URL("../../js/firebase-config.js",import.meta.url);
const buildScript=fileURLToPath(
  new URL("../../scripts/build-staging.mjs",import.meta.url));
const root=fileURLToPath(new URL("../../",import.meta.url));

test("STG1-C public staging config exactly matches independently verified Firebase app",()=>{
  assert.equal(staging.projectId,"quizer-staging-az26");
  assert.equal(staging.appId,"1:509423933910:web:bce54427cd2e87af076c77");
  assert.equal(staging.authDomain,"quizer-staging-az26.firebaseapp.com");
  assert.equal(staging.storageBucket,"quizer-staging-az26.firebasestorage.app");
  assert.equal(staging.messagingSenderId,"509423933910");
  assert.match(staging.apiKey,/^AIza/);
  assert.equal("privateKey" in staging,false);
});
test("STG1-C production source remains unchanged; no staging config in default build",()=>{
  const production=readFileSync(source,"utf8");
  const defaultBuild=readFileSync(
    new URL("../../scripts/build.mjs",import.meta.url),"utf8");
  assert.match(production,/sat-quiz-fd317/);
  assert.doesNotMatch(production,/quizer-staging-az26/);
  assert.doesNotMatch(defaultBuild,/firebase\.staging/);
  assert.doesNotMatch(defaultBuild,/config\//);
});
test("STG1-C explicit offline staging build replaces only distribution config",()=>{
  const before=readFileSync(source,"utf8");
  const output=execFileSync(process.execPath,[buildScript],{
    cwd:root,encoding:"utf8",timeout:15000,
  });
  assert.match(output,/NOT deployed/);
  const distConfig=readFileSync(new URL(
    "../../dist/js/firebase-config.js",import.meta.url),"utf8");
  assert.match(distConfig,/quizer-staging-az26/);
  assert.doesNotMatch(distConfig,/sat-quiz-fd317/);
  assert.equal(readFileSync(source,"utf8"),before);
  assert.equal(readFileSync(new URL(
    "../../dist/index.html",import.meta.url),"utf8").includes("js/app.js"),true);
});
