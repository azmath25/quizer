# Implementation handoff · 29 October 2026

## Baseline

Started from the saved version 4 `axiom-quiz.zip` and the detailed Copilot implementation plan. The supplied Firebase configuration was empty. No live GitHub checkout, Firebase project credentials or production database access were supplied. The original 41 tests passed before implementation.

## Implemented phases

| Phase | Delivered work |
| --- | --- |
| P00 | Baseline inspected; legacy behavior isolated; original plan retained |
| P01 | Separate Home and role-aware routes, canonical session resolution, direct Profile, safe login return paths |
| P02 | Version 2 contracts, callable router, current-role authorization, request receipts, version conflicts, closed direct-write rules |
| P03 | Independent problem revisions, protected answer keys, shared/forked bank, separate validated Storage assets |
| P04 | Bounded import/draft editing, immutable publication jobs, revisions, duplicate, Trash/restore, backup ZIP |
| P05 | Public/private quizzes, open/approval admission, hashed request links, decisions, revocation, extra attempts |
| P06 | Pinned attempts, transactional allocation, server deadlines, answer versions/history, autosave/recovery, freeze-before-grade |
| P07 | Automatic/manual grading, correction audit, independent release, owner reports, revision statistics and CSV |
| P08 | Admin users/roles/status, last-admin protection, activity, content and jobs |
| P09 | Reusable bank selection, explicit revision updates, ordered slots and per-quiz points |
| P10 | Bright blue shared design tokens, split CSS, responsive pages, theme/text preferences and accessible controls |
| P11 | Explicit owner-run dry-run/apply/resume migration; legacy score provenance; source retention; bootstrap and cutover docs |
| P12 | Unit, policy, emulator, rules, HTTP-wrapper, migration and packaging checks; exact evidence in VERIFICATION.md |

## Implementation decisions

- The Firebase API is one callable `api` router with named versioned actions, plus `processJob` and `scheduledMaintenance`. This keeps deployment small while preserving per-action validation and authorization.
- The canonical role is in Firestore and is re-read on every protected operation. Custom claims are not the authorization source.
- All live quizzes/results use Firebase. Old IndexedDB quizzes are available only through an explicit import path. The legacy GitHub catalog/device fallback has been removed from normal operation.
- Cloud Storage holds immutable raster images and protected source files. Firestore holds metadata, references, versioned content, answer keys and attempts.
- Grading is server-side. The browser cannot submit a score or mark its own proof correct.
- The first admin is an owner-run bootstrap; later role changes go through Admin with a transactionally maintained last-admin counter.
- Import writes draft slots in bounded batches before making the new quiz visible, so a 500-problem import does not require one oversized final write batch.
- Original legacy tests are retained as regression fixtures, not active runtime fallbacks.

## Remaining external checks

Production deployment, actual Google OAuth/domain configuration, cloud IAM signing/CORS, real signed-URL expiry and scheduled Cloud Functions execution require the owner's Firebase project. They were not performed against production. `ACCEPTANCE.md` maps every planned acceptance ID and distinguishes targeted automated evidence from further manual verification.

## Files to open first

1. `README.md`: app and branch deployment.
2. `FIREBASE-SETUP.md`: owner configuration and backend deployment.
3. `docs/MIGRATION.md`: existing-data cutover.
4. `docs/OPERATIONS.md`: smoke test, monitoring and recovery.
5. `docs/VERIFICATION.md`: exact validation and limitations.

No live database was migrated or deleted; no site was published. AI-assisted PDF problem selection remains the separately requested future task.
