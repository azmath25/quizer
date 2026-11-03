# Quizer QN3 — isolated PostgreSQL schema and trusted adapter contract

Status: **repository design only**. Do not provision a Neon project, connect production Firebase, deploy, or execute SQL in QN3.

## 1. Source of truth

| Data | System | Notes |
| --- | --- | --- |
| Sign-in, roles and authorization | Firebase | Server-verified Context.actor is the sole trusted identity source. No Neon Auth. |
| Quiz catalog, draft settings/order, quiz access and attempts/results | Firestore | Draft slots refer to problem IDs/revisions/points, not duplicated problem content. |
| Original uploaded quiz source and images | Firebase Storage | One original TeX object per imported quiz and separate image assets; never copy source into Neon. |
| Individual bank problems, tags and protected immutable revisions | Separate Quizer Neon Postgres project | Teacher-owned metadata and answer content in protected revision JSON. |
| Published student quiz | One private immutable Storage bundle per published revision + Firestore manifest | This is a future QN10 change, NOT implemented in QN3. Students cannot download complete answer-bearing bundles. |
| Future activity events | Neon after later cutover | No historical test-log backfill; Firebase outbox retained until accepted. |
| Optional published-revision archive | Disabled Neon mirror | QN7 must justify any costs first; not on live student path. |
| Existing Firestore quizzes, revisions, attempts | Existing Firebase | Preserve all existing IDs, links, grading data and assets without rewrite or deletion. |

The existing Mimo Neon project is independent and must remain untouched. The Quizer schema should only ever be applied to a new separately approved Quizer database.

## 2. Version-controlled SQL

- **db/quizer/001_initial_schema.sql** defines the transactional schema. It is NOT executed.
- **db/quizer/001_rollback_DISPOSABLE_ONLY.sql** is intentionally destructive. Use only on a separately approved disposable QN4 test database; never on live data.
- **tests/fixtures/neon/qn3-synthetic-problem.json** contains sanitized synthetic owners, sharing, grading, imported source references, an idempotent receipt and a future event.

Tables under the Quizer schema:

| Table | Reason |
| --- | --- |
| **problems** | Owner Firebase UID, searchable metadata, visibility, lifecycle, version and pinned latest revision. |
| **problem_revisions** | Immutable content and protected grading JSON, source provenance, content hash and revision number. |
| **problem_tags** | Normalized searchable tags with no duplicate tag per problem. |
| **import_receipts** | Unique job/item key, payload hash and fixed resulting problem/revision IDs for retry safety. |
| **activity_events** | Future-only audit events. The event ID primary key also acts as the outbox delivery receipt, avoiding another table. |
| **quiz_revision_mirrors** | Disabled optional published-quiz archive, keyed by quiz/revision ID. No copied image binaries or signed URLs. |

Indexes cover owner and shared bank pagination, literal title-prefix search, tags, immutable revision history, and actor/quiz event history.

The latest-revision foreign key is DEFERRABLE INITIALLY DEFERRED and composite on problem_id plus latest_revision_id; a new problem and its first revision must be inserted within **one SQL transaction**. The database verifies that the selected latest revision belongs to that problem. New revisions must be appended, never edited in place. Metadata-only edits update the root and tags, without touching revision or grading records. No-op saves must write nothing.

Firebase UIDs are external identity references; do not mirror authentication users or introduce Neon Auth. Application grants should be limited to trusted Functions and configured later after test validation. The migration revokes PUBLIC schema/table privileges.

## 3. Minimal backend adapter

- **functions/src/neon/ports.d.ts**: private TypeScript declaration of the query port, problem/answer DTOs, actor and repository types, plus future write contracts.
- **functions/src/neon/contracts.js**: IDs, hash/role/page validation, safe bank list mapping and shared-source provenance redaction.
- **functions/src/neon/repository.js**: **read-only, unconnected** parameterized repository. It requires an injected trusted query function. No driver, credentials, network calls on import, new public API, or active Firebase handler changes.
- **tests/unit/qn3-neon-contracts.test.mjs**: isolated fixture/mock checks for auth, SQL parameterization, literal escaped-prefix search, pagination, source redaction and schema structure.

Existing browser-facing operations (listProblems, getProblem, saveProblemRevision, importProblemBatch) remain unchanged. QN8 will add verified server-side writer methods and integrate the adapter **behind** these operations. The caller must pass Context.actor from Firebase verification, never an actor supplied by browser input.

Only authorized teachers/admins can retrieve protected grading. The owner/admin can see source IDs; a collaborator who may read a shared problem receives the question and grading but NOT the full original TeX source ID. Student reads are blocked. Bank listings have metadata only, no answers.

Bank searches use bound parameters and escaped LIKE prefixes (so %, _ and ! are literal when entered) compatible with the prefix index. Internal paging uses (updatedAt, problemId), sorted newest-first; QN8 must wrap the cursor into an opaque, filter-scoped browser cursor before public use.

## 4. Future stage boundaries

**Initial upload, QN8 and QN11:** Browser parses one TeX file, uploads that original source once to Firebase Storage, uploads images separately, and passes extracted individual questions through existing authenticated bounded batch calls. Neon stores each problem, revision, tags and job/item receipt in one SQL transaction. Replaying a matching receipt returns the prior IDs; conflicting content hashes reject. Firebase draft metadata is created/finished only after all problems are confirmed. Cross-store partial failures must be recoverable; imported quizzes remain hidden until complete.

**Draft edit:** Rename/settings/order/points remain Firebase metadata. Editing one problem creates at most one new immutable Neon revision. Unchanged edit needs no write. Original source file is not reuploaded.

**Publish, QN10:** Resolve pinned Neon revisions and hashes, create **one private Firebase Storage bundle per immutable published revision**, verify its hash, then update Firestore's ready manifest. Student attempts pin the old revision until complete and must never depend on Neon. Never distribute full bundle URLs or protected keys to clients.

**Future logs, QN5/QN6:** A minimal durable Firebase outbox is written with committed operations; asynchronously relay new events by unique event ID. Do not backfill historical test logs. Retention cleanup is separately approved later.

**Optional mirror, QN7:** Off by default, asynchronous, hashes/versioned, only if measured to be worthwhile. Never blocks publish, attempts or grading.

## 5. Security and failure invariants

- No arbitrary client-supplied SQL, schema name, database URL, user role or Firebase identity. SQL values are all bound.
- No new frontend access to PostgreSQL. Use one Quizer-specific server credential injected only in an approved trusted backend.
- No original source TeX file or image bytes in SQL, only ID references; never copy signed URLs into logs or optional mirrors.
- Avoid row-data leakage: admin/teacher access is checked before reading revision grading; shared teachers have source IDs redacted.
- SQL transaction retries and idempotency receipts must prevent duplicate imported problems and revisions.
- Published quiz read/answer/grade paths stay Firebase-only even if Neon is unavailable.
- Cross-store operations are **not atomic**. Later code needs job checkpointing, reconciliation, and rollback/retry policies.
- Existing quizzes, revisions, links, question assets and grades stay intact.

## 6. QN4 gate — NOT performed in QN3

QN4 requires a separate approval for a **disposable Quizer database**. Verify against actual PostgreSQL: schema up/down, composite deferred foreign key, malformed/duplicate ID rejection, immutable revision policy, tag uniqueness, idempotent imports/events, indexes and keyset pagination, permissions, transactions and rollback. Use a direct/unpooled connection for schema migration and a pooled connection for later app traffic. Neither Mimo nor live production data may be used.

**No Neon resource was created, queried or changed in this milestone.**
