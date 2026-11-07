#!/usr/bin/env bash
# P0 forensic inventory: read-only, no cloud invocation, no secret payloads.
# Run once inside an authenticated Cloud Shell checkout of Quizer.
set -euo pipefail
QUIZER_PROJECT="sat-quiz-fd317"
MIMO_PROJECT="mimo-backend-513412"
REGION="europe-west1"

command -v gcloud >/dev/null || { echo "gcloud is required"; exit 2; }
command -v python3 >/dev/null || { echo "python3 is required"; exit 2; }

echo "=== P0 read-only Cloud audit: 2026-11-07 ==="
echo "Projects are explicitly pinned; no active project is changed."
echo "No secret values, provider keys, document content or raw logs are printed."

inspect_function() {
  local name="$1" doc
  echo
  echo "=== Firebase v2 function: ${name} ==="
  if ! doc="$(gcloud functions describe "$name" --gen2 --region="$REGION" \
        --project="$QUIZER_PROJECT" --format=json 2>/dev/null)"; then
    echo "NOT_FOUND_OR_NO_ACCESS — check whether function was deployed and IAM permits read"
    return
  fi
  printf '%s' "$doc" | python3 -c '
import sys,json
d=json.load(sys.stdin)
config=d.get("serviceConfig") or {}
bindings=config.get("secretEnvironmentVariables") or []
print("state:",d.get("state","unknown"))
print("updated:",d.get("updateTime","unknown"))
print("runtime:",(d.get("buildConfig") or {}).get("runtime","unknown"))
print("bound_secret_names:",",".join(sorted(set(str(b.get("secret","")) for b in bindings))) or "(none)")
print("bound_neon_secret:",any(str(b.get("secret") or "").rsplit("/",1)[-1]=="QUIZER_NEON_DATABASE_URL" for b in bindings))
print("service_revision:",(config.get("revision") or "not exposed"))
'
}

inspect_secret() {
  local name="$1" out
  echo
  echo "=== Secret metadata: ${name} ==="
  if ! gcloud secrets describe "$name" --project="$QUIZER_PROJECT" \
      --format='value(name)' >/dev/null 2>&1; then
    echo "NOT_FOUND_OR_NO_ACCESS"
    return
  fi
  # Metadata only: NEVER access a secret version's payload.
  if out="$(gcloud secrets versions list "$name" --project="$QUIZER_PROJECT" \
       --filter='state=ENABLED' --limit=1 --format='value(name)' 2>/dev/null)"; then
    if [[ -n "$out" ]]; then echo "enabled_version: present";
    else echo "enabled_version: none"; fi
  else
    echo "enabled_version: cannot inspect (permissions)"
  fi
}

inspect_service() {
  local service="$1" doc
  echo
  echo "=== Mimo Cloud Run: ${service} ==="
  if ! doc="$(gcloud run services describe "$service" --region="$REGION" \
      --project="$MIMO_PROJECT" --format=json 2>/dev/null)"; then
    echo "NOT_FOUND_OR_NO_ACCESS"
    return
  fi
  printf '%s' "$doc" | python3 -c '
import sys,json
d=json.load(sys.stdin); st=d.get("status") or {}
ready=next((c.get("status") for c in st.get("conditions",[]) if c.get("type")=="Ready"),"unknown")
print("ready:",ready)
print("latest_ready_revision:",st.get("latestReadyRevisionName","unknown"))
'
}

inspect_logs() {
  local project="$1" filter="$2" label="$3" report
  echo
  echo "=== Redacted log summary: ${label} ==="
  # No raw logs, HTTP headers, credentials, error bodies or request inputs are
  # ever persisted. Python only emits aggregate counts and numeric HTTP codes.
  if report="$(gcloud logging read "$filter" --project="$project" \
      --limit=600 --format=json 2>/dev/null | python3 -c '
import json,re,sys,collections
try: data=json.load(sys.stdin)
except Exception: print("LOG_READ_INVALID");sys.exit(0)
codes=collections.Counter();marks=collections.Counter();severity=collections.Counter()
for e in data:
    severity[str(e.get("severity","DEFAULT"))]+=1
    payload=e.get("jsonPayload") or {}
    msg=str(e.get("textPayload") or payload.get("message") or "")
    for marker in ("mimo_ai_hub_internal_failure","mimo_batch_internal_failure",
                   "HTTPStatusError","ReadTimeout","ConnectTimeout",
                   "MEMORY_NOT_CONFIGURED","permission-denied"):
        if marker in msg: marks[marker]+=1
    for match in re.finditer(r"(?:HTTPStatusError|status_code|HTTP/1\.1|HTTP/2|Response)\D{0,40}([45][0-9]{2})",msg):
        codes[match.group(1)]+=1
print("entries_examined:",len(data))
print("severity_counts:",dict(sorted(severity.items())))
print("safe_error_marker_counts:",dict(sorted(marks.items())))
print("provider_http_codes_when_present:",dict(sorted(codes.items())))
')"; then
    echo "$report"
  else
    echo "LOG_READ_FAILED_OR_NO_ACCESS"
  fi
}

inspect_function mimoAiHub
inspect_function mimoBatchStart
inspect_function mimoExtractStatus
inspect_secret QUIZER_NEON_DATABASE_URL
inspect_secret QUIZER_MIMO_PROJECT_KEY
inspect_service mimo-worker
inspect_service mimo-execution

inspect_logs "$QUIZER_PROJECT" \
  'timestamp>="2026-11-06T00:00:00Z" AND (resource.type="cloud_run_revision" OR resource.type="cloud_function") AND severity>=ERROR' \
  "Quizer Firebase error logs since 2026-11-06"
inspect_logs "$MIMO_PROJECT" \
  'timestamp>="2026-11-07T07:00:00Z" AND timestamp<="2026-11-07T12:30:00Z" AND resource.type="cloud_run_revision" AND resource.labels.service_name="mimo-worker"' \
  "Mimo worker near failed extraction runs"

echo
echo "=== Audit complete. No changes were made. ==="
echo "If the upstream HTTP code is absent, historical generic Mimo failures"
echo "cannot be reconstructed from these logs. Use the proposed Mimo P0"
echo "safe-failure patch for future runs; do not retry paid runs blindly."
