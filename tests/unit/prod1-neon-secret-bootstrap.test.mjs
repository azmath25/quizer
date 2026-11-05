import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";

test("owner-assisted password bootstrap parses without execution",()=>{
  const sh="scripts/neon/repair-and-connect-sat-quiz-live.sh",
    js="scripts/neon/repair-quizer-app-password.mjs";
  for(const [command,args] of [
    ["bash",["-n",sh]],["node",["--check",js]],
  ]){
    const r=spawnSync(command,args,{encoding:"utf8",timeout:5000});
    assert.equal(r.status,0,r.stderr);
  }
  const shell=readFileSync(sh,"utf8"),
    script=readFileSync(js,"utf8");
  assert(shell.includes("read -r -s"));
  assert(shell.includes('printf \'%s\' "$OWNER_URL" |'));
  assert(script.includes("randomBytes(32)"));
  assert(script.includes("ALTER ROLE quizer_app WITH LOGIN PASSWORD"));
  assert(script.includes("secrets\",\"create"));
  assert(script.includes('"--data-file=-"'));
  assert(script.includes("appUrl.href"));
  assert(!script.includes("console.log(appUrl"));
  assert(!shell.includes("firebase deploy"));
  assert(!shell.includes("gcloud run deploy"));
  assert(!shell.includes("mimo-backend-513412"));
});
