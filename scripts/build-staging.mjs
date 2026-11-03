// Deliberately separate from the default build: only this explicit command
// can place public staging Firebase settings in the generated dist bundle.
// This script does not access Firebase, Google Cloud, or Neon.
import { spawnSync } from "node:child_process";
import { copyFile, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { firebaseConfig } from "../config/firebase.staging.js";

const expected = {
  projectId: "quizer-staging-az26",
  appId: "1:509423933910:web:bce54427cd2e87af076c77",
  authDomain: "quizer-staging-az26.firebaseapp.com",
  storageBucket: "quizer-staging-az26.firebasestorage.app",
  messagingSenderId: "509423933910",
  apiKey: "AIzaSyBlJRy2cpdVu4WJD_XqzFAtsxlElBR27vU",
};
for (const [key,value] of Object.entries(expected)) {
  if (firebaseConfig[key] !== value) {
    throw new Error("STG1-C refused: Firebase staging identity drift.");
  }
}
if (!/^AIza[0-9A-Za-z_-]+$/.test(firebaseConfig.apiKey))
  throw new Error("STG1-C refused: missing Firebase public web API key.");

const buildScript=fileURLToPath(new URL("./build.mjs",import.meta.url));
const stagingConfig=new URL("../config/firebase.staging.js",import.meta.url);
const dist=new URL("../dist/",import.meta.url);
const destination=new URL("../dist/js/firebase-config.js",import.meta.url);

const build=spawnSync(process.execPath,[buildScript],{
  cwd:fileURLToPath(new URL("../",import.meta.url)),
  env:process.env,encoding:"utf8",stdio:"inherit"
});
if (build.error || build.status!==0)
  throw new Error("STG1-C base static build failed; staging output is not verified.");
try {
  await copyFile(stagingConfig,destination);
  const rendered=await readFile(destination,"utf8");
  if (!rendered.includes(expected.projectId) ||
      !rendered.includes(expected.appId) ||
      rendered.includes("sat-quiz-fd317") ||
      rendered.includes("mimo-backend-513412"))
    throw new Error("STG1-C refused: staging output project mismatch.");
} catch(e) {
  await rm(dist,{recursive:true,force:true});
  throw e;
}
console.log("Offline staging bundle built for quizer-staging-az26. NOT deployed.");
