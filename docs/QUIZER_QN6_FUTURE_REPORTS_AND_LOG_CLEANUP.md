# QN6 — Future activity report access and historical boundary

Date: 2026-11-03. Status: **repository-only, disabled/unwired**. Do not interpret this as a live report cutover.

## New internal reader

`functions/src/neon/activity-reports.js` provides three internal operations through an injected, trusted Postgres SQL port:

- `listAdminActivity`: verified Firebase administrator sees new activity events with optional actor/quiz/action/role/date filters.
- `listAdminUserActivity`: verified Firebase administrator sees future activity performed by a target user.
- `listOwnedQuizHistory`: verified teacher/admin sees activity belonging to a quiz. Quiz ownership is resolved using an **injected trusted Firebase lookup**, never a browser-provided owner ID.

The reader is **disabled by default** and is NOT wired to existing `listActivity`, `getAdminUserActivity` or `getQuizHistory` actions. Existing reports still use historical Firestore auditEvents; do not switch them without a separately approved staging/cutover plan and full integration tests.

The future reader requires an explicit `cutoverAt`, secret for signed cursors, and SQL port. It returns `source: neon_future_only`, `historyStartsAt`, `historicalBackfill: false`, and a bounded opaque signed cursor scoped to actor, filters, cutoff and query dates. Requests before the cutoff are clamped or return no future events, not fabricated history.

Only whitelisted activity metadata is exposed; no answers, full question text, secrets or protected grading keys. Admin role is checked for global/user views; teacher quiz views additionally require Firestore ownership. SQL values are parameterized and result pages are at most 100 events. Benchmarks must assess indexes and query cost before a real cutover.

## Regression tests

`tests/unit/qn6-future-reports.test.mjs`: default-off behavior, student rejection, admin-only user/global logs, teacher-owned-quiz isolation, trusted owner resolution, signed cursor tampering/filter/actor binding, cutoff, SQL parameterization and missing configuration. **11 of 11 tests passed in the isolated V8/mock harness**. Native Node, PostgreSQL, Firebase emulator, frontend/browser and CI tests remain **unrun**.

## Optional old-test-log cleanup — runbook ONLY

**Nothing has been deleted.** If a separate future authorization requests cleanup, the operator must:

1. Confirm a precise old-test-event date range and the exact `auditEvents` collection/document IDs; inspect current security investigations, audit retention/legal hold requirements and whether any reports still rely on these records.
2. Inventory and preserve all `quizzes`, private/published revisions, sources and image assets, questions and answer keys, access requests, attempts, answers, results and teacher grading histories. Explicitly EXCLUDE all these from deletion, along with `activityOutbox` pending retry events.
3. Make a verified, restore-tested backup of the selected old audit documents and export their IDs/counts/checksums; prepare a dry-run diff and estimate any dependent report gaps.
4. Obtain a **new, explicit, narrow approval** stating the dated log range and backup identifier. Never interpret permission to delete test logs as permission to delete historical quizzes or attempts.
5. Only after approval, run a separately reviewed bounded cleanup with audit trail and rollback option; verify quiz links and prior published revisions after. No broad Firestore collection deletion or `DROP SCHEMA` allowed.
6. Clearly display the historical discontinuity in admin/teacher reports. Do not backfill old test logs to Neon to hide the discontinuity.

QN6 adds **no cleanup script** and executes no data deletion.

## Later cutover gates

- QN4 still needs a local disposable PostgreSQL execution with actual constraints, permissions and rollback validated.
- QN5 delivery needs a trusted Neon connection, worker scheduling, retry queue/metrics, outbox backlog monitoring and staging verification.
- QN6 reports need a verified read-only server credential, a Firebase ownership resolver and secure wiring **outside** the Firestore transaction retry boundary; no new public problem-bank API is required.
- If Neon is down, do not silently substitute stale future logs or interrupt student quiz activity. Provide a clear unavailable-state label for new-event reports while keeping old Firebase reports intact.
- QN12 frontend and QN13 overall integration verification remain planned; neither is performed here.

**No deployments, merges, cloud mutations, production migrations, or historical log deletion.**
