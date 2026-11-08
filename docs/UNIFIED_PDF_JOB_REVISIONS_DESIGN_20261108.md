# Unified PDF job with internal revisions — product contract (2026-11-08)

**Authoritative correction:** **One uploaded PDF = one durable, owner-scoped Quizer document job. Every correction/re-extraction/revision of that PDF belongs inside that same job.** Never display or create a new *document job* when the teacher asks AI to revise an existing PDF result. A new Mimo *run* is permitted as an internal execution record, and may use a different workflow, but is linked to the **same** Quizer document job. Do not confuse Quizer job IDs, Mimo run IDs, document revision IDs, and quiz draft IDs.

This replaces the earlier proposed "new linked job for each revision" design.

## UX to build

1. Open PDF in a **Quizer-native** workspace: shared Quizer logo, site navigation, theme, user account, responsive layout and existing chat interactions. Preserve accessible original frontend in Git history; do not overwrite it with the standalone prototype styling. Use normal Quizer UI components.
2. Upload original PDF once. Exactly one owner-scoped `document_job_id` is created. Persist an immutable authenticated original file reference and checksum, per-page artifacts and extracted page outputs; never duplicate original PDF bytes for revisions. A job list shows the single document and its current progress/revision.
3. Initial Mimo extraction/solve/format pass produces a **single complete Quizer LaTeX document** conforming to `guide.html`, `shared/latex-parser.js` and example `examples/algebra.tex`: `\quiztitle{}`, `\begin{problem}`, `\begin{choices}`, `\correctchoice`, `\answer{}` when genuinely verified, and referenced raster assets. Preserve original numbering as display/provenance metadata when possible. The pre-import output may contain uncertain answers, warnings and diagrams; never invent unsupported answers, silently ignore incomplete questions or auto-publish.
4. Show a document-level LaTeX editor, full **standard Quizer parser and visual preview**, and a compact editable issue list; **no six individual Approve/Reject cards**, no alternative import/grade format, no new manual import approval subsystem. The teacher may inspect the whole draft, hand edit LaTeX, request AI correction or open the standard importer.
5. "Revise with AI" takes teacher instructions and the **same job ID**, selected question/page scopes, source artifact references, previous LaTeX and revision summary. It creates an immutable **revision inside that job**. A revision can call another published Mimo workflow (designed later) without creating another Quizer document job. Never call the old extraction for every page to correct one question. AI result is a **candidate**; never overwrite the teacher's current edits silently. Show diff and explicit Apply / Keep existing / Restore.
6. "Import to Quizer" uses the existing LaTeX import flow in `js/pages/quiz-editor.js` / `upload.html`, which already has a `mathquiz.aiImport` handoff, parser, visual preview, image checks, private draft, normal hand-edit and publish. Import is explicitly teacher-initiated, not automatically committed by an AI response. Any release path should make this handoff durable/owner-scoped and preserve source attribution, not invent an alternate bank import protocol.
7. The teacher can navigate back to the **same PDF job** from its quiz draft and ask additional revisions. Saving/publishing remains Quizer's existing independent action; previously published revisions, quiz attempts and grading keys are untouched.

## Data model and invariants

Parent `document_jobs/{jobId}` (conceptual; use existing Firestore `mimoBatchJobs` collection as the migration starting point, not a parallel job collection): `ownerUid`, `sourceArtifactRef`, `sourceSha256`, `originalFileName`, `pageCount`, `pageArtifactRefs`, `activeRevisionId`, `revisionCount`, `state`, `createdAt`, `updatedAt`, `budgetPolicy`, `linkedQuizDraftIds`.

Child `document_jobs/{jobId}/revisions/{revisionId}` (or existing batch-job child collection): `revisionNumber` monotone, `parentRevisionId`, `requestedBy`, `teacherInstructions`, `affectedPages`, `workflowId`, `workflowVersion`, `mimoRunIds[]`, `status`, `rawExtractionCheckpointRefs`, `candidateLatexRef` or bounded `candidateLatex`, `assetRefs`, `issueSummary`, `modelCosts`, `confirmedAt`, `createdAt`. Versioned content must be immutable once completed and atomically selected as active only with teacher confirmation. Keep source/outputs under server-side authorized access (Firestore/Storage as appropriate), never raw grading keys in browser cache or API logs.

**Invariants:**
- One PDF upload -> one Quizer document job ID, regardless of revision count.
- One revision may have multiple Mimo calls, but all are children of the same job. Existing ongoing/failed/uncertain Mimo run IDs are reconciled, never blind-retried.
- Every revision has an exact parent/provenance and prior state available; no destructive rewrite or erasure of teacher edits.
- Revision request has its own user-approved spend ceiling and provider-quota admission; original PDF need not be uploaded to Mimo again if stored artifact is usable.
- LaTeX output must pass the same `parseLatex` and problem validation as manual imports before enabling import. Never bypass existing authorization, image ownership checks, source provenance, publication/visibility controls, or private answers.
- Status is per **revision** as well as job, but the job list contains only **one row per PDF**.
- No per-question teacher approval requirement. Teacher sign-off is at the whole-document preview/import/publish step, with optional local corrections.
- Future workflow selection happens per revision without changing the original extraction workflow version 1, unless explicitly approved.

## Implementation boundaries (short reviewable milestones)

**J1 — Restore Quizer-native UI shell:** compare `main` and `backup/main-before-document-image-ui-20261106`; preserve logo/nav/theme/mobile behavior. Remove duplicate Quizer AI branding/navigation, do not drop useful chat/history/job features. Test old route handling, mobile. Stop and verify before further work.

**J2 — Canonical LaTeX output contract:** create pure converter of validated extraction (and optional independent QA) to Quizer guide's LaTeX, with explicit uncertainty handling and image mapping. Roundtrip test through `shared/latex-parser.js`; preserve teacher corrections and source references. No paid runs.

**J3 — Single job, internal revision storage:** additive, atomic revisions under existing `mimoBatchJobs`; original PDF and existing jobs retained; first extraction is revision 1; migrate/read existing completed jobs with safe fallback. No automatic paid run, no new external job ID for revisions.

**J4 — Standard import handoff:** use existing `upload.html` preview and draft editor, not the obsolete question-by-question `mimoBatchReviewPage` / `mimoBatchPrepared` UI. Enable import only when the whole source is valid, explicitly approved by the teacher; no automatic publication. Ensure image/answer/owner checks stay authoritative. Test import and edit/publish paths.

**J5 — Future revision workflow:** teacher input and scope -> same job new revision -> optional second Mimo workflow, with exact selected source and previous LaTeX, candidate diff, apply/revert. Test no duplicate PDF upload, no replacement of prior versions, and budgets/unknown-run reconciliation.

## Release safety

This is a **design checkpoint only**, not a deployment. Implement on this feature branch in bounded milestones. Do not merge to `main`, overwrite historical `ai.html`, touch Firebase production, change secrets or start paid Mimo runs until the targeted implementation and tests are ready and the user approves that release. The separately staged `fix/pdf-review-unlock-ui-20261108` repairs are not the target architecture and must not be mistaken for a redesign.
