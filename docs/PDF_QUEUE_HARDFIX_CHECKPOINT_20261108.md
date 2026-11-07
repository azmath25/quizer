# Quizer PDF queue + provider quota UX — source checkpoint (2026-11-08)

## Production diagnosis
- Six older `attention` jobs occupied the first six entries of the previous `mimoBatchSweep` query, starving a new `running` document. The old query was `where(state in [running,budget_exhausted,attention]).limit(6)` with no fair ordering.
- After cleanup, a fresh 1-page job dispatched to Mimo but was displayed as `Reading source (pending)` while the provider returned known 429 deferrals. The source/worker stage had in fact advanced. Mimo ultimately recorded `waiting_for_review`.

## Source-only changes on `fix/pdf-queue-fairness-20261108`
1. Sweep runnable `running` jobs separately, ordered by `updatedAt`, with a heartbeat after processing so a long-running job rotates out of the initial six. This ensures older `attention` parents never consume runnable admission slots.
2. Independently poll existing submitted run IDs in paused `attention` or `budget_exhausted` parents, using the durable `needsAttentionPolling` flag. Never dispatch new paid runs for these parent states; no automatic replay of an ambiguous dispatch.
3. Add Firestore composite indexes `(state ASC, updatedAt ASC)` and `(needsAttentionPolling ASC, updatedAt ASC)`. **Deploy indexes first and wait until they are READY before deploying the updated scheduler.** Missing indexes would cause the scheduler to fail.
4. Accept Mimo's safe `next_attempt_at`/`rate_limit_deferrals`, persist a bounded ISO retry timestamp, and show `Rate-limited — retry scheduled` plus the local display time rather than claiming the source is still being read. Suppress unnecessary Mimo timeline GETs during known waits.
5. Allowlist new rate-limit diagnostic codes and the exact legacy terminal reason string. Log only a sanitized Firebase error code on scheduler exceptions, never raw provider bodies or credentials.

## Verification and deployment boundary
- Changes committed, not deployed. Local tests and CI have not yet been run by this assistant.
- `bash scripts/mimo/verify-hardfix-cloudshell.sh` performs syntax checking and mock-Mimo/Firebase tests after installing locked Node dependencies. Mock transports do not create real AI jobs.
- Confirm Mimo release includes Neon Alembic `0026`, the updated worker/HTTP API, and the same pinned Quizer workflow before deploying this UI/backend.
- After tests pass, separate authorized Firebase release sequence: deploy `firebase/firestore.indexes.json` to `sat-quiz-fd317`; confirm both new composites READY; deploy only `mimoBatchStart`, `mimoBatchStatus`, `mimoBatchSweep`, `mimoBatchReconcile` (also `mimoBatchList` only if needed for list metadata), with `functions:mathquiz:<name>` targets. Publish the updated `ai-studio.js` through the website's existing supported release path; do not overwrite unrelated frontend work.
- The new materialized `needsAttentionPolling` field is populated on new parent records and subsequent state transitions. Older terminal `attention` jobs without a submitted page do not need backfill. Historical paused parents with still-submitted run IDs should be migrated explicitly if found; they can be reconciled through existing known-run-ID APIs, without resubmission.
- Never delete historical jobs to fix scheduler fairness again. No merge/deployment until separately authorized, and no new paid or free-provider requests during source checks.

## Limits
- Five AI blocks per page and OpenRouter `:free` daily caps mean free extraction can still pause for hours. The fix makes that wait visible and bounded; it cannot buy or invent more model capacity.
- Operator must verify actual provider account allowance and privacy terms before releasing a paid or third-party fallback.
