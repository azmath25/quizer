# Q-AI.3 — Mimo extracted-page contract and Quizer human-review handoff

**Checkpoint:** 2026-11-06. Feature branch **feature/q-ai3-extraction-contract-20261106** branched from **work/quizer-audit-optimization-2026-11**.

**Boundary:** Contract code and tests only. No frontend or Firebase deployment, Mimo deployment, Neon migration, new provider call, merge, imported problem, or live document job. Q-AI.4 and Q-AI.5 are not started.

## Model output — extracted page v1

The pure module at **shared/mimo-extraction.js** validates exactly **mimo.extracted_page.v1**. This is untrusted output of an AI model. No model-supplied source owner, page ID, storage path, access role, source hash or URL is trusted.

~~~json
{
  "schema": "mimo.extracted_page.v1",
  "quality_status": "pass",
  "questions": [{
    "printed_number": "1",
    "statement_latex": "Solve $2x+3=7$.",
    "question_type": "multiple_choice",
    "options": [
      {"label": "A", "latex": "$1$"},
      {"label": "B", "latex": "$2$"},
      {"label": "C", "latex": "$3$"},
      {"label": "D", "latex": "$4$"}
    ],
    "answer": null,
    "has_figure": false,
    "figure_description": null,
    "diagram_requires_reconstruction": false,
    "continuation": "complete",
    "review_required": false,
    "review_reasons": [],
    "uncertain_spans": []
  }]
}
~~~

- Page quality: **pass**, **review_required**, **fail**.
- Question type: **multiple_choice**, **short_answer**, **open_ended**.
- Continuation: **complete**, **continued_from_previous_page**, **continues_next_page**, **continues_both_sides**, **uncertain**.
- Every uncertain-span member is an object containing only **text** and **reason**.
- Answer is nullable. A multiple-choice answer, when present, must be an existing choice label. Open questions can be explicitly marked for manual marking. Missing answers are never guessed.
- Up to 100 questions per page and 2–12 distinct A–L options per multiple-choice question. Bounded text, exact keys, duplicate printed numbers, incompatible figure flags, forbidden importer controls and unsafe TeX commands are rejected.

## Separate, trusted source metadata

This information comes from a server-side upload/job record, NOT the model output or an untrusted user identity.

~~~json
{
  "document_id": "quizer_document_id",
  "source_artifact_id": "owned_mimo_pdf_artifact_id",
  "page_artifact_id": "owned_rendered_page_artifact_id",
  "page_number": 1,
  "page_count": 4,
  "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
}
~~~

The page-artifact ID can be null for an unrendered page. The contract checks types, bounds and consistency. It cannot prove ownership or hash authenticity: a future authenticated Firebase adapter must bind the teacher identity, validate artifact ownership and compute the original PDF SHA-256.

## Per-question review and importer handoff

The exported pure functions have the following roles:

1. **validateExtractedPage(raw, source)** validates the untrusted model response and trusted-source shape.
2. **createExtractionReview(raw, source)** creates **quizer.extraction_review.v1** with every question pending, even if the AI said quality pass and review_required false.
3. **decideExtractionQuestion(review, itemId, decision, reviewerId)** takes a verified human review decision and optional explicit corrections. The eventual server must supply the authenticated reviewer ID, never accept it from the browser. Approved corrections are limited to statement, options, answer and figure description.
4. **prepareReviewedExtractionImport(review, {title})** requires every question to be approved or rejected and at least one approved question. It produces **quizer.reviewed_extraction_import.v1**, with each approved problem's existing Quizer **content/grading** DTO, original page/printed-number provenance, reviewer metadata, a safe LaTeX export and image filenames to resolve. It calls the real Quizer validator and re-parses the exact generated TeX using the existing importer, checking content and answer keys.

Review safeguards:

- Unknown multiple-choice answers cannot be approved until a teacher supplies the right choice. Unknown open answers require an explicit **manual_marking_confirmed** flag.
- Questions continuing across pages must wait for Q-AI.4's page reconciliation; the reviewer cannot silently set continuation to complete.
- A figure question needs reviewed description, a linked image alias/asset ID and a matching LaTeX includegraphics reference before approval. Reconstructing or verifying actual figure bytes remains a later step.
- Failed pages need re-extraction. Rejected questions require a reason and are not exported.
- Percent signs are escaped for the Quizer TeX importer; importer round-trip verifies question count, wording, options, grading mode and correct answers.

**No implicit writes:** output is a prepared package, not a saved quiz. It does not upload, insert an import receipt, alter quiz or bank tables, publish, contact an AI provider, or bypass teacher permissions. The future authenticated adapter must reverify asset ownership, reviewer permissions and explicit import consent.

## Tests and stop point

**tests/unit/q-ai3-extraction-contract.test.mjs** exercises untrusted JSON, source provenance, unexpected fields, duplicate IDs, unsafe TeX, reviewer decisions, unknown answers, manual marking, question continuation, images, rejection, tampered reviewers and exact Quizer importer round-trips.

The no-deploy workflow **.github/workflows/q-ai3-extraction-verify.yml** runs focused extraction tests, all unit tests, frontend static/build, existing backend tests, Firebase emulator/rules and transport checks. There are no deploy jobs.

**Q-AI.4** will separately handle owner-authorized PDF/image upload, durable background job IDs, page-wise Mimo orchestration, checkpoints/retries, figure reconstruction and continuation reconciliation.

**Q-AI.5** will separately replace simulated activity in Quizer ai.html with authenticated document review, live progress, and the eventual verified-import action. Neither phase has been started.

**STOP after Q-AI.3**: no merge or deployment until explicitly approved.
