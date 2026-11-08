# PDF v1 Cerebras extraction-output repair — 2026-11-08

Scope: Mimo workflow `c_mw5e6wmr_wma1bg` **published version 1 in place**, and Quizer Firebase PDF bridge. No new workflow version, no old run replay, no migration of quiz data.

## Confirmed defect
- Real completed run `e3959d4c-8fb5-43ca-9a41-618e4acbc8ec` contained 6 valid questions (6–11) under `nodes.extract.result.content`.
- Its `verify` Qwen call used 3,500 reasoning tokens, returned empty visible text, and Mimo marked the run completed with `exports.extracted_page_json=""`.
- Quizer expected `exports.extracted_page_json` to contain a schema-valid JSON string, so it showed Needs action. This was an **output wiring bug**, not merely a polling issue.

## Live Mimo changes (already applied in Neon)
Workflow v1 `outputs.exports`:
- `extracted_page_json` -> **extract** (string, minLength=1, maxLength=100000).
- `verified_page_json` -> **verify** (optional human-review candidate; may be empty).
- Existing diagram exports and all other nodes remain.
- Output bundle also collects `extract`.
- Five AI output limits raised: processor 10000, extract 12000, verify 14000, rebuild_plan 6000, tikz_source 10000.
- Original graph snapshots in `workflow_model_edit_snapshots`, keys `cerebras-all-tokens-v1-20261108` and `quizer-extract-export-v1-20261108`.
- Old Mimo runs are immutable and continue to use their saved graph snapshots.

## Quizer code
Branch `fix/pdf-completed-checkpoint-recovery-20261108`:
- `functions/src/mimo/completed-page.js`: validates Mimo first-pass and separate optional verification, promotes valid QA only when printed question numbers align, otherwise retains the valid first pass **only for teacher review**. The old completed run with an empty final export can be recovered from its stored valid `extract` checkpoint. Normalizes literal prose `\\n` without affecting `\\nu`, `\\nabla`, or `\\frac`.
- `functions/src/mimo/batch.js`: stores validated page once using Firestore transaction create-if-absent; concurrent polling cannot clobber already saved teacher review. State only becomes `completed` when validated page checkpoint exists. No additional /runs POST.
- `functions/src/mimo/extraction.js`: same contract for single-page extraction.
- `js/pages/ai-studio.js`: differentiates unverified extraction and teacher-review requirement; frontend requires its **separate GitHub Pages release**.

## Verification
- Independently executed 13 helper contract assertions directly against the real Quizer source modules in a V8 isolation test: 13/13 passed.
- Executed the live 6-question model response against actual Quizer parser: historical recovery, new v1 empty QA, invalid QA, and valid QA all produced 6 valid questions; literal model-escaped prose newlines normalized.
- Cloud Shell Node 22 mock-test gate and Firebase deployment are **pending**. No claim of production Quizer release before `QUIZER_COMPLETED_CHECKPOINT_RELEASE_PASS`.

## Release from existing Quizer Cloud Shell checkout
```bash
cd ~/quizer-queue-release
export PATH="$HOME/.local/node-v22.23.4/bin:$PATH"
git fetch origin +refs/heads/fix/pdf-completed-checkpoint-recovery-20261108:refs/remotes/origin/fix/pdf-completed-checkpoint-recovery-20261108
git switch --detach origin/fix/pdf-completed-checkpoint-recovery-20261108
python3 scripts/mimo/release-completed-checkpoint-cloudshell.py --apply
```
Script runs local mock tests (no paid calls), installs only Functions dependencies, deploys only `mimoBatchReconcile`, `mimoBatchSweep`, `mimoBatchStatus`, `mimoBatchGetPage`, and `mimoExtractStatus`. It does not publish the frontend, deploy unrelated Functions, touch indexes, or run GitHub Actions.

After success, use Quizer's existing **Check existing run IDs** for the known completed run (no new paid job). New page tests are separate and explicitly approved by the user. Review original PDF before any approval/import.
