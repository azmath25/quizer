import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const root=new URL("../../",import.meta.url);
const read=p=>readFileSync(new URL(p,root),"utf8");
const release=read("scripts/mimo/m1-release-vercel-cloudshell.sh");
const verify=read("scripts/mimo/m1-verify-cloudshell.sh");
const config=JSON.parse(read("vercel.json"));

test("M1 Vercel release reuses only the previously linked isolated project",()=>{
  assert.match(release,/BRANCH="release\/m1-vercel-20261108"/);
  assert.match(release,/PROJECT="quizer-ai-studio-m1-azmath25"/);
  assert.match(release,/TEAM="azmath25s-projects"/);
  assert.match(release,/if \[\[ ! -f \.vercel\/project\.json \]\]/);
  assert.match(release,/p\.projectName!==process\.env\.EXPECTED_PROJECT/);
  assert.match(release,/project inspect "\$PROJECT" --scope "\$TEAM"/);
  assert.doesNotMatch(release,/"\$\{VERCEL\[@\]\}" project add/);
  assert.doesNotMatch(release,/"\$\{VERCEL\[@\]\}" project create/);
  assert.doesNotMatch(release,/"\$\{VERCEL\[@\]\}" link --yes/);
  assert.equal((release.match(/case "\$DEPLOY_URL" in/g)||[]).length,1);
});

test("M1 Vercel release pins CLI and retries bounded archive upload",()=>{
  assert.match(release,/vercel@65\.12\.1/);
  assert.match(release,/NODE_USE_ENV_PROXY=1/);
  assert.match(release,/M1_VERCEL_NODE_NETWORK_(PASS|FAIL)/);
  assert.match(release,/deploy --prod --yes --scope "\$TEAM" --archive=tgz/);
  assert.match(release,/M1_VERCEL_PROD_DEPLOY_PASS/);
  assert.doesNotMatch(release,/firebase deploy|actions\/deploy-pages|npm run deploy/);
});

test("M1 release preflights verified public dist and generated mirror",()=>{
  assert.match(release,/git status --porcelain --untracked-files=normal/);
  assert.match(release,/git rev-parse "origin\/\$\{BRANCH\}\^\{commit\}"/);
  assert.match(release,/bash scripts\/mimo\/m1-verify-cloudshell\.sh/);
  assert.match(verify,/node scripts\/sync-functions-shared\.mjs[\s\S]*node scripts\/verify-static\.mjs/);
  assert.match(read(".gitignore"),/functions\/shared\//);
  assert.equal(config.outputDirectory,"dist");
  assert.equal(config.cleanUrls,false);
  assert.ok(!config.functions && !config.rewrites);
});
