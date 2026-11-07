import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {safeMimoRunDiagnostic,SAFE_RUN_CODES} from "../../functions/src/mimo/run-diagnostics.js";

const read=path=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");

test("only allowlisted upstream HTTP status is exposed",()=>{
  const raw={
    error_code:"provider_rate_limited",
    upstream_http_status:429,
    error:"API secret ABC; private document",
    request_headers:{"Authorization":"Bearer TOPSECRET"},
  };
  assert.deepEqual(safeMimoRunDiagnostic(raw),{
    diagnosticCode:"provider_rate_limited",
    diagnosticHttpStatus:429,
  });
  assert.equal(JSON.stringify(safeMimoRunDiagnostic(raw)).includes("TOPSECRET"),false);
  assert.ok(Object.hasOwn(SAFE_RUN_CODES,"provider_rate_limited"));
});

test("malicious or unexpected error body is suppressed",()=>{
  for(const bad of ["__proto__","constructor","invalid","MIMO_UPSTREAM_UNKNOWN"]){
    assert.deepEqual(safeMimoRunDiagnostic({
      error_code:bad,upstream_http_status:400,raw:"private PDF text",
    }),{});
  }
  assert.deepEqual(safeMimoRunDiagnostic({error_code:"provider_invalid_request",
    upstream_http_status:200}),{diagnosticCode:"provider_invalid_request"});
  assert.deepEqual(safeMimoRunDiagnostic(null),{});
});

test("both Quizer extraction status paths expose only sanitized diagnosis",()=>{
  const single=read("functions/src/mimo/extraction.js");
  const batch=read("functions/src/mimo/batch.js");
  const frontend=read("js/pages/ai-studio.js");
  assert.match(single,/safeMimoRunDiagnostic\(run\.output\)/);
  assert.match(batch,/safeMimoRunDiagnostic\(run\.output\)/);
  assert.match(batch,/diagnosticCode:p\.diagnosticCode/);
  assert.match(frontend,/describeMimoRunFailure\(result\)/);
  assert.match(frontend,/describeMimoRunFailure\(page\)/);
});
