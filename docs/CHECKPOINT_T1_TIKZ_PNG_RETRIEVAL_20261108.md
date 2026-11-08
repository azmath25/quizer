# T1 — Authenticated Mimo compiled-PNG retrieval in Quizer (2026-11-08)

## Boundary

T1 only. No new PDF upload, provider call, workflow change, grading/import change, auto-image attachment, job/revision redesign, production deploy, protected-branch merge or GitHub Actions.

T1 development branch: `fix/t1-authenticated-tikz-png-20261108`, based on `feature/unified-pdf-job-revisions-20261108`. This branch is a T1 implementation/checkpoint; **it must not be deployed by wholesale replacing the live Quizer frontend/backend** until any differences from the deployed PDF recovery code are reconciled in a release branch.

## Known live artifact (read-only)

The existing Mimo PDF workflow `c_mw5e6wmr_wma1bg`, published version 1, contains a real completed page-2 run:
- Run: `7e8f42c3-514c-407c-b93a-4f85fe54bd71`.
- `diagram_gate` chose yes; `tikz_source` completed.
- `compile_png` checkpoint completed, with the real `image/png` artifact in private Mimo storage.
- Object key: `compiler/compile_png/47c01a3158bdf1a84bb8b687f2cb8046bc9651f781193d6c060c2e346f5901f4.png`.
- Size: **13,527 bytes**. DPI: 160. SHA-256: `47c01a3158bdf1a84bb8b687f2cb8046bc9651f781193d6c060c2e346f5901f4`.
- Cloud Shell retrieval is confirmed **only** for the Cloud Shell account. **Quizer browser retrieval has not been tested or claimed.**
- The original teacher-owned Quizer document job ID is not the same as the Mimo run UUID; the `mimoBatchImage` callable must be passed the Quizer `jobId` and `pageNumber`, never the private storage object key.

## Existing authenticated path

1. The Quizer browser calls `readMimoBatchImage(jobId,pageNumber)`, which invokes Firebase callable `mimoBatchImage` under Quizer Authentication/App Check.
2. `createBatchService.image` verifies the signed-in, verified teacher/admin role and owner-scoped durable `mimoBatchJobs` document, requires a completed page with a stored Mimo run ID, and reads the compiled artifact using a **server-held Mimo project key**.
3. Mimo's `GET /v1/runs/{runId}/artifacts/compile_png` checks project ownership, completed checkpoint status, private storage key, media type and artifact SHA-256. It returns PNG bytes.
4. Quizer limits the response to 4 MiB, checks the PNG magic, and returns base64, byte length and SHA-256 to the authorized browser.
5. The browser decodes the PNG, creates an in-memory blob URL, shows a visible image and an explicit download link. No raw Mimo key or private storage URL is exposed.

## T1 source changes

- `js/components/mimo-png-viewer.js`: small reusable browser component. Can be opened from the existing PDF job overview, and automatically loads when a completed page is opened. Displays an inline retryable error, returns a direct download link and shows byte count/checksum. Drops stale responses when the page was removed. Does not call any POST endpoint.
- `js/pages/ai-studio.js`: uses the viewer **before** the old question-review form; keeps a click-to-view option in the overview to avoid downloading every figure at once. Old approval UI is not changed in T1.
- `js/services/mimo-extraction.js`: explicit missing/malformed PNG and storage checksum error messages.
- `functions/src/mimo/extraction.js`: binary response must really be `image/png`; rejects 200 JSON masquerading as a PNG.
- `functions/src/mimo/batch.js`: owner-checked PNG response returns `byteLength` and `sha256` alongside the existing `contentType/base64`.
- `ai.html`: cache-busting version for the T1 frontend module.
- Node-only mock tests in `functions/test/mimo-batch.test.mjs` and `tests/unit/t1-mimo-png-viewer.test.mjs`.

## Verification

- 6 direct V8 behavior checks on the committed `createMimoPngViewer` implementation **passed** (initial preview, download link, metadata, duplicate fetch suppression, inline failure and stale-job handling).
- Full Node 22 suite, static source checks and live Firebase/authenticated browser verification remain pending. Do not claim T1 end-to-end passed yet.
- **No GitHub Actions**: .github/workflows/quizer-verify.yml only triggers push on `work/quizer-audit-optimization-2026-11`; this feature branch does not match its trigger.
- Cloud Shell helper: `bash scripts/mimo/t1-verify-cloudshell.sh` performs focused syntax, Node mock tests and static checks with **no paid Mimo calls and no deployment**.

## Release/test gate (requires separate explicit authorization)

1. Run the Cloud Shell helper using Node 22. Do not deploy if any test fails.
2. Reconcile T1 changes against the actual live Quizer PDF-recovery implementation. Deploy only the affected `mimoBatchImage` callable if required; do not replace unrelated callables.
3. Publish frontend changes via the chosen controlled Quizer release process, preserving the existing logo/nav, chats and job history. No GitHub Actions, no automatic merge.
4. Sign into production Quizer as the document owner, open the existing completed PDF job, open **page 2** and verify the PNG automatically appears. Use **Download compiled PNG** and compare 13,527 bytes and SHA-256 above. No PDF upload and no new AI run.
5. Repeat as a different user without job ownership and confirm the artifact remains inaccessible. Confirm no PDF run POST occurs during preview/download.
6. Stop at T1 checkpoint; **T2 automatic question-image attachment** is explicitly out of scope.
