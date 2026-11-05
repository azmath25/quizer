# Quizer QN5 checkpoint — future-only audit relay (default OFF)

Date: 2026-11-03. Branch: `work/quizer-audit-optimization-2026-11`.

## Delivered

- `functions/src/neon/activity-outbox.js`: sanitize/whitelist audit metadata; compute payload hash; **feature flag `QUIZER_NEON_ACTIVITY_OUTBOX_ENABLED=true` is OFF unless explicitly set**. No text answers, grading keys, tokens, request bodies, or original TeX in Neon activity payloads.
- `functions/src/domain/runtime.js`: `Context.audit` writes the historical Firestore audit event as before. Only when the feature flag is explicitly enabled, it also enqueues an event in `activityOutbox/{eventId}` **in the same Firestore transaction**. Only future audit events are queued; no old-log scan or backfill.
- `functions/src/neon/activity-relay.js`: trusted, injected query/outbox worker; Neon `INSERT ... ON CONFLICT DO NOTHING`; on replay checks existing payload hash and acknowledges the Firestore outbox item only after SQL is accepted. Durable retry if ack fails; conflicts block ack rather than silently overwrite.
- `functions/src/neon/firebase-activity-outbox.js`: server-only Firestore Admin port listing pending events and compare-and-set acknowledgement in a Firestore transaction. No scheduler/trigger or new public route.
- `tests/unit/qn5-activity-relay.test.mjs`: default-off behavior, metadata redaction, insert+ack, crash-after-insert replay, ID/hash collision, payload tampering, bounded drain and disabled integration.

## Verification

- **8/8 isolated tests passed** by executing the exact committed module/test bodies in a V8 harness with deterministic fake hash and mock SQL/Firestore ports. Not native Node or real database integration.
- No Firestore emulator run, Postgres execution, Actions CI, scheduler verification, performance benchmark, or production traffic test. QN4's actual disposable PostgreSQL schema execution remains an open blocker.
- Only GitHub work-branch files were changed. No Neon connection string installed; nothing enabled or scheduled; no cloud changes.

## Recovery and cutover

When provisioned and approved later: install only a trusted private Postgres SQL port and a supervised scheduled/queued worker, enable the outbox flag **after** successful disposable/staging testing, and monitor pending/failed counts. If Neon is unavailable, activityOutbox entries remain pending without affecting student quiz sessions. On retry, an already-inserted event with identical hash is acknowledged; mismatched hashes are quarantined for human investigation.

**Never migrate historical test logs into Neon. Never delete historical quizzes, published revisions, assets, attempts or grades in the course of log cleanup.**

## Stop gate

QN5 implementation and isolated verification committed. Stop before QN6 unless separately authorized (the user has explicitly authorized QN6 in this conversation). No merges, deployment, cloud mutation or live migrations.
