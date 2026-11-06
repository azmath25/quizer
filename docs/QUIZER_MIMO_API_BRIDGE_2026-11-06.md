# Quizer → Mimo workflow API bridge — checkpoint 1 (2026-11-06)

## Scope and result

The first slice implements a **server-only Mimo Execution API client** in Quizer, plus eight mocked tests. It does not register a Firebase callable, wire the browser, deploy to Google Cloud, create a Mimo project key, make a provider call, or alter either production database.

Mimo's incoming workflow API is distinct from Mimo's *outbound REST connectors*. The new code calls the incoming API; no REST connector rollout is required.

## Confirmed API contract

- `POST /v1/workflows/{workflow_id}/runs` with project-key Bearer authentication, `Idempotency-Key`, and `{input,version,background,cost_limit_usd,cost_mode}`.
- `GET /v1/runs/{run_id}` to read the resulting state and output.
- Use the Mimo **Execution** service, not Studio or the compiler.
- Parallel workflows require `background:true`; the client always submits in background mode.
- Project-key permissions must explicitly grant a **published workflow**; project keys must never be embedded in frontend code.

In a read-only inspection of the Mimo production Neon database, `math_extract_verify_tikz` is published at version 2. The PDF-page OCR workflow `c_mvyubtux_pxlvup` is currently unpublished. The two existing Mimo API projects were both revoked. A new dedicated Quizer project with a narrowly scoped workflow grant is needed before live calls.

## Files

- `functions/src/mimo/client.js` — validated server-configured URL and workflow ID, private Bearer token, background runs, bounded inputs/responses/timeouts, deterministic user+request ID idempotency, hard per-run AI-cost cap, and sanitized errors.
- `functions/test/mimo-client.test.mjs` — fake-fetch tests covering API shape, idempotency, validation, status reads, upstream failures, ambiguous submission handling, bounded responses, and secret protection.

## Verification

Node 22: `node --test functions/test/mimo-client.test.mjs` — **8 passed, 0 failed** with fake network transport. Full Quizer CI, Firebase emulators and authenticated live Mimo workflow calls were not run.

## Next gated milestone (do not treat this stage as live integration)

1. Create an active **Mimo project for Quizer**, grant exactly one selected published workflow/version, and store the new key in the **Quizer Firebase Secret Manager** under a dedicated name such as `QUIZER_MIMO_PROJECT_KEY`. Never paste it into chat, put it in GitHub or expose it in browser JS.
2. Verify the live Mimo Execution Cloud Run address and its project-key reachability. Configure workflow ID/version server-side only; do not allow browser-supplied workflow IDs, keys or upstream URLs.
3. Add a separate Firebase callable for authenticated teachers initially, checking Quizer Firebase roles, App Check policy, quotas and **per-user run ownership** before status/output reads. Never send a network call from a Firestore transaction. Retain the same request ID on ambiguous retries.
4. Integrate Quizer's `js/services/ai.js` (currently a placeholder) and Ask AI popup behind an explicit opt-in capability. Only send visible/authorized context, and never send unreleased grading keys. Add complete status/error UI.
5. Verify an actual small published workflow end to end with low run-cost caps; do not infer success from mocked tests.

No merges, production migrations, secret writes or deployments were performed.
