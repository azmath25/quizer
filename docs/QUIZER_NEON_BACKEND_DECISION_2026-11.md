# Quizer: dedicated Neon backend design and safe connection gate
Date: 2026-11-03
Branch: work/quizer-audit-optimization-2026-11
Status: **design + fail-closed configuration code committed, not provisioned or deployed**.

## Read-only account inventory
The available Neon account currently has one project named `mimo` (project ID known to the connected account). There is **no dedicated Quizer project**. No database, Neon branch, role, table, SQL query or cloud setting was created or modified by this inspection. Do not create Quizer tables in the Mimo project, even in another schema: the applications must remain operationally independent.

## Chosen architecture
1. **Firebase Auth:** source of user identity and authoritative roles. No second login system.
2. **Firebase Storage:** one immutable original `.tex` upload per imported quiz, referenced image assets, and one private compiled bundle per published revision. The bundle is read by trusted Firebase code only; student clients cannot download grading keys or locked future questions.
3. **Firestore:** quiz draft metadata/settings/order/slot references, access permissions, published bundle manifest, attempts, answers, grading/results, and an optional future-event outbox. A title edit modifies only metadata.
4. **Dedicated Quizer Neon PostgreSQL project:** reusable individual problem metadata, immutable question+grading revisions, tags, idempotent import receipts and *new* audit events. No historical test-log import.
5. **One trusted backend boundary:** existing Firebase authenticated actions call a small server-only Neon repository. No new REST service, Data API, browser SQL client, or public problem-bank API.
6. **Student availability:** published quiz sessions, navigation, submission and grading cannot depend on Neon; the published Firebase bundle and Firestore attempt state are the authority.

## Isolation and configuration
`functions/src/neon/project-config.js` is a disabled-by-default, side-effect-free configuration guard. Only when `QUIZER_NEON_ENABLED=true` does it require:
- `QUIZER_NEON_PROJECT_ID` identifying a dedicated project, **different** from `MIMO_NEON_PROJECT_ID`;
- `QUIZER_NEON_DATABASE_URL` pointing to a `*.neon.tech` PostgreSQL host, a database named `quizer` or `quizer_*`, a least-privilege `quizer_app` or `quizer_reader` role and `sslmode=require`;
- no extra connection-string host overrides or insecure settings.

The configuration loader contains no hardcoded secret or Mimo credential, and does not open a network connection when imported. Treat all URLs as server secrets and never send them to the frontend, logs, error messages, or GitHub. URL validation is defense-in-depth, **not proof that a given hostname belongs to the declared project**; the trusted operator must cross-check project ID against Neon inventory at provisioning.

## Database layout
QN3 version-controlled SQL is `db/quizer/001_initial_schema.sql`: problems, revisions, tags, import receipts, activity events, optional disabled mirror. QN4 adds an explicit localhost disposable-only rehearsal; this still needs real PostgreSQL verification. The write repository and SDK connection are **not yet wired**; QN8 must implement atomic SQL transactions, ownership/version checks, asset retention, idempotent bulk import and Firestore/Neon reconciliation.

Choose the pooled Neon connection for ordinary serverless application queries and direct/unpooled connection for DDL rehearsal/migrations. Split migration and application privileges. Keep the connection lazy, bounded and private. No report reader or relay activation until a dedicated project passes staging tests.

## Intended backend flow
- **Import**: parse locally, upload source once, validate and insert extracted problems into Neon in bounded idempotent batches, then commit a lightweight Firebase draft. Keep retry checkpoints for partial failures.
- **Edit**: title/settings/order/points are small Firestore updates. A change to one problem creates a single new Neon revision. Unchanged content creates no new revision.
- **Publish**: pin exact revision IDs/hashes, build a single private immutable Firebase Storage bundle, then atomically publish a ready manifest. Keep previous revisions for active attempts.
- **Activity**: new audit event writes to a Firebase outbox in the same business transaction, then relays to Neon and acknowledges by stable event ID. Flag remains disabled. Admin/teacher future-log readers also remain disabled until verified.
- **Outage**: Neon unavailable blocks creating/editing bank problems but **must not** interrupt previously published student exams.

## Remaining verification gates
- **QN4**: execute the SQL migration/rollback and constraints on a newly approved disposable Quizer PostgreSQL instance. Never use Mimo.
- **QN7**: benchmark optional mirror; default is **skip** unless evidence justifies storage duplication.
- **QN8–QN11**: implement/test database write path, safe imports, preserved legacy reads and private published bundles.
- **QN12**: mobile-first frontend review, including imports/edits and progress/retry UX.
- **QN13**: all-up emulator, SQL, browser/security, preserve-old-quizzes and 10/100/500-question performance verification.

No new cloud project was provisioned because there is no existing safe Quizer target and creation can incur usage charges. The next concrete infrastructure action is an **explicitly authorized separate Quizer development project** with minimal compute/idle suspension. No merge, deployment, production SQL or changes to the Mimo project are part of this design checkpoint.
