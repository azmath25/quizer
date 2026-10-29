# Math Quiz: Detailed Copilot Implementation Specification

Prepared: 29 October 2026  
Status: planning document. Implementation and production deployment require the owner's instruction.

Save this file as docs/COPILOT_IMPLEMENTATION_PLAN.md in the actual repository. Use the prompts in section 23. Implement one authorized phase at a time and update docs/IMPLEMENTATION_PROGRESS.md after each phase.

MUST denotes a requirement. Defaults are deliberate decisions, not unanswered questions. Examples are target contracts, not claims that code already exists. Preserve working code and the owner's actual Firebase configuration.

## 1. Verified baseline and scope

This plan was grounded in axiom-quiz.zip version 4: 48 files; archive SHA-256:

~~~text
1ead9f1cd3f046f5599da9c06401eb08526acb3c544ff4256ccc09fa593571dd
~~~

The inspected application is plain HTML/CSS/native JavaScript ES modules. Its 41 existing unit tests passed while preparing the plan. Its optional Firestore emulator suite exists but was not rerun for this planning task. The live GitHub repository may have newer Copilot/user changes: reconcile it before editing.

### Current implementation

| Existing file | Actual responsibility | Required treatment |
|---|---|---|
| index.html, js/library.js | Device, bundled/GitHub and Firebase quiz library | Move catalog to quizzes.html; index becomes dashboard |
| login.html, js/account.js | Sign-in and profile in the same route | Split controllers/routes; wait for resolved Auth state |
| upload.html, js/upload.js | LaTeX/JSON import, preview, embedded images, local/cloud saves | Keep importer/preview; replace persistence and introduce problem records |
| quiz.html, js/quiz.js | Local attempts/timing, client grading/self-marking, result sync | Keep presentation; backend owns attempts/time/grading |
| js/firebase-client.js | Firebase 13.1.0 browser SDK, Auth and Firestore | Add Functions/Storage and explicit session readiness |
| js/firebase-core.js | Config validation, permission helpers, return URLs | Keep safe validation; remove unconfigured local-authoring fallback |
| js/cloud-repository.js | Direct Firestore writes of entire serialized quizzes/results | Replace normal use with callable API adapter |
| js/storage.js | IndexedDB quizzes/drafts/account-scoped attempts | Retain only behind one-time migration reader |
| js/published-catalog.js | GitHub contents API and bundled JSON discovery | Retire from normal runtime after migration |
| js/core.js | Quiz validation, bounded arithmetic, grading, shuffle/time helpers | Extract/reuse pure logic with regression coverage |
| js/parser.js | Structured LaTeX importer | Preserve supported syntax and behavior |
| js/render.js, js/math-config.js | Escaped prose/math rendering and MathJax | Preserve; adapt authorized image resolution |
| assets/mathjax.js and license | Bundled MathJax 3.2.2 | Preserve unless a tested upgrade is separately justified |
| assets/app.css | Main stylesheet, 3,636 lines in inspected archive | Split foundations/components/page styles |
| js/common.js | Shell, navigation, dialogs, guide and utilities | Extract focused components; staff-only guide |
| firebase/firestore.rules | v1 roles, quiz documents, client-reported results | Replace together with v2 backend and migration |
| scripts/build.mjs | Copies static files, generates old catalog | Copy new pages/shared code; stop publishing legacy key bundles |
| settings.html | Legacy redirect | Redirect to profile appearance |

Current Firestore layout:

~~~text
roles/{uid}
quizzes/{quizId}
quizzes/{quizId}/content/main        // serialized JSON, embedded images and keys
users/{uid}/attempts/{attemptId}     // client-reported completed results
~~~

The current 900,000-byte cloud limit belongs to the old single-content-document layout. It MUST NOT become the total quiz limit after questions/images are separated.

Already-working features include MathJax preview, typed-answer math preview, safe numeric evaluation, question/option shuffling and timer recovery. Do not describe these as new inventions or replace them casually.

### Scope

In scope: Firebase-only normal persistence; separate assets; reusable problems; teacher ownership; drafts/revisions; public/private access; applications; participant approval; trusted attempts/grading; teacher reports; answer-change history; admin activity; separate Home; role-aware navigation; bright mobile UI; migration; tests and deployment documentation.

Out of scope: AI/PDF extraction and marking, general symbolic proof checking, proctoring, payments, chat, class/organization management, native apps and framework migration.

Hosting stays GitHub Pages, Deploy from a branch, main / root. Do not introduce a custom Pages Actions workflow as a prerequisite. Backend deployment is separate.

## 2. Product decisions and defaults

### Accounts

- Guests can browse Home/public quiz overviews.
- Starting recorded attempts and requesting access require a signed-in, verified, active account.
- New accounts are students; no self-selected teacher/admin role.
- Teachers retain student capabilities and manage their own content/participants/results.
- Admins manage all content, roles, accounts and activity.
- Teachers cannot read another teacher's private bank or submissions.
- The owner teacher can inspect saved in-progress answers and saved change times. Tell students before starting.
- Demotion removes privileged access on the next backend request. Data is retained for admins.

### Quiz concepts

Keep lifecycle, draft, publication, visibility, access mode and availability distinct:

1. lifecycle: active or trashed.
2. draft: editable working content.
3. published revision: immutable student-facing snapshot.
4. visibility: private or public.
5. accessMode: approval or open.
6. availability: opening/closing dates and attempt allowance.

| Visibility | Mode | Public catalog | Participation |
|---|---|---|---|
| private | approval | Hidden | Explicitly approved users |
| public | approval | Safe overview | Approved users |
| public | open | Safe overview | Eligible signed-in users except individually blocked users |
| private | open | Invalid | Reject the combination |

New quizzes are private approval drafts with no published revision. A private quiz can be published for approved users. Students never read the working draft.

~~~json
{
  "durationSeconds": 1200,
  "shuffleQuestions": false,
  "shuffleOptions": false,
  "allowBack": true,
  "penalty": 0,
  "maxAttempts": 1,
  "opensAt": null,
  "closesAt": null,
  "scoreRelease": "immediate",
  "solutionRelease": "manual"
}
~~~

maxAttempts=null means unlimited. Duration 0 means untimed, but a closing date still ends the attempt. afterClose release requires a closing timestamp. Teachers may deliberately select immediate solutions for practice.

### Access decisions

- One participant record per quiz/UID.
- States: none, pending, approved, declined, revoked.
- Declined/revoked override public-open access. The open-quiz “Block” action sets revoked.
- Pending grants no questions/images.
- Declined/revoked users cannot repeatedly reapply; teacher can reopen or approve directly.
- Revocation prevents new attempts; an already active attempt may finish under its captured grant/deadline.
- Ending an active attempt is a separate explicit action.
- Unpublish/visibility/Trash changes block new starts without deleting active/completed attempts.
- Disabling an account blocks new privileged requests, including active answer saves.

### Problem reuse and history

- Problems have independent ownership and immutable revisions.
- Bank visibility is private or teachers; it is separate from quiz visibility.
- Teachers may use owned problems and problems deliberately shared with teachers.
- Only source owner/admin edits the original. Other teachers can fork with attribution.
- Published quizzes pin versions and slot-specific points.
- Source edits/unsharing/archiving do not alter previously published snapshots.
- New source selections require current reuse permission; unchanged already-authorized quiz snapshots can be republished.
- Firebase is the only normal database. Remove “On device,” “Save on device” and normal GitHub catalog fallback.
- Temporary previews/recovery are allowed but never called Saved until the server confirms.
- Exports are backups/reports, not another library.
- Trash restore defaults to private approval.
- Retain history and referenced content; hard deletion cannot silently erase students' records.

## 3. Architecture and trust boundaries

Use the existing native ES-module frontend. Add Firebase Functions 2nd gen using JavaScript ES modules and Node.js 22. Use JSDoc/shared validators instead of requiring frontend compilation.

| Component | Authority |
|---|---|
| Browser | Rendering, input, LaTeX preview, calling APIs |
| Firebase Auth | Identity and session |
| Cloud Functions | Ownership/role decisions, mutations, deadlines, grading, release, jobs |
| Firestore | Structured canonical records and audit history |
| Storage | Immutable images/source files and restricted staging uploads |
| GitHub Pages | Public static website files |

### Browser restrictions

The browser MUST NOT create authoritative scores, roles, approvals, owners, deadlines or audit records. Direct Firestore reads are limited to section 16. All other data access uses authorized backend APIs.

Student question DTOs contain statement/options/points and question-image bindings only. Exclude keys, model solutions, rubrics, solution-image IDs and internal notes. Student result DTOs apply score/solution release independently. Never return raw protected documents using object spread.

### Shared code packaging

Canonical pure code lives in root shared/. Browser modules import it relatively. scripts/sync-functions-shared.mjs copies it into functions/shared/ before backend tests/deploy. That generated mirror belongs inside the deployable Functions directory.

Server code must not depend on files outside its deployment source. Test that the mirror matches canonical files. Do not independently maintain two grading algorithms.

### Configuration

- Preserve the actual js/firebase-config.js. The supplied archive's config is empty; the user's repo may be configured.
- Add js/app-config.js for API version, Functions region and explicitly enabled local emulator settings.
- Match the actual project's region; europe-west1 is the proposed default for a new project. Keep client/server settings aligned.
- Use Firebase-managed backend credentials, never committed service-account keys.
- Missing production config shows a neutral unavailable state, not a visitor connection wizard/local fallback.
- Development uses demo-mathquiz-v2 emulators. An emulator failure must never silently call production.
- Every privileged handler reads current canonical role/account status. Admin SDK bypasses Firestore rules, so handlers need complete authorization.

## 4. Target files and concrete rewiring

Create these paths in the phase that uses them, rather than generating empty scaffolding everywhere.

~~~text
index.html                       dashboard
quizzes.html                     public/available catalog
login.html                       sign-in/register/reset
profile.html                     account/appearance
activity.html                    applications/attempts/results
teaching.html                    teacher workspace
quiz-manage.html                 Content/Access/Results/History
problems.html                    reusable bank
problem-edit.html                individual problem
upload.html                      quiz editor/import; preserve route
quiz.html                        overview/start/runner
results.html                     authorized attempt review
access.html                      private request link
admin.html                       users/activity/content/jobs
guide.html                       staff guide
settings.html                    compatibility redirect

assets/css/tokens.css
assets/css/base.css
assets/css/layout.css
assets/css/components.css
assets/css/pages/{home,catalog,account,editor,quiz,reports,admin}.css

js/app-config.js
js/firebase-client.js
js/firebase-core.js
js/core/{session,navigation,errors,format}.js
js/services/{api,assets,recovery}.js
js/components/{shell,dialog,feedback,math-content}.js
js/pages/{home,catalog,login,profile,activity,teaching,quiz-manage}.js
js/pages/{problems,problem-edit,quiz-editor,quiz,results,access,admin,guide}.js
js/migration/legacy-device.js

shared/{schema,validation,grading,numeric,latex-parser,asset-references,constants}.js

functions/package.json
functions/package-lock.json
functions/src/index.js
functions/src/config.js
functions/src/api/{accounts,problems,quizzes,access,attempts,reports,assets,admin}.js
functions/src/domain/{authorization,idempotency,publication,attempts,audit,retention}.js
functions/src/jobs/{worker,sweeper}.js
functions/src/repositories/{firestore,storage}.js
functions/shared/                generated mirror
functions/test/

firebase/{firestore.rules,firestore.indexes.json,storage.rules}
firebase/storage-cors.example.json
scripts/{sync-functions-shared,seed-emulators,migrate-v1,bootstrap-admin,verify-static}.mjs
tests/{unit,integration,rules,e2e}/
docs/{COPILOT_IMPLEMENTATION_PLAN,IMPLEMENTATION_PROGRESS,MIGRATION,OPERATIONS}.md
~~~

### Existing-function changes

| Existing entry point | Target |
|---|---|
| account.js formPage/accountPage dispatch | Wait for resolved Auth, separate login/profile |
| firebase-client.js watchSession/initFirebase | Explicit authResolved/roleResolved, UID-safe subscriptions |
| firebase-core.js canCreateQuiz/canPublish | Confirmed active verified staff only |
| common.js mountShell/mountAccountNav/showGuide | Role navigation, direct profile, staff-only guide |
| upload.js parseSource/renderPreview | Preserve parser/math preview; normalize import into problems |
| upload.js performCloudUpload | Save/import/publish APIs and durable job status |
| quiz.js start/makeAttempt use | startAttempt API returns authoritative ID/order/settings |
| quiz.js tick/startTimer | Paint backend deadline; browser cannot extend it |
| quiz.js answer handlers | Version-checked saveAnswers queue |
| quiz.js finish | Flush pending saves, submitAttempt, show server state |
| quiz.js scheduleResultSync/syncResult | Remove client-generated authoritative result upload |
| quiz.js renderResults/renderReview | Released backend DTOs; no student self-marking |
| storage.js loadQuiz/getCatalog | Normal API path; old code only behind migration |

Copy the existing library into quizzes.html before replacing index.html. Keep common.js as a temporary re-export adapter during extraction. Preserve old quiz.html?id=cloud-... links.

Do not feed student DTOs into old validateQuiz: it requires keys/base64 assets. Retain validateLegacyQuizV1 for migration/import, and add separate v2 validators. Do not merely change the old schema constant to 2.

When content is paginated, use the server's totalPoints/itemCount, not the sum of currently loaded questions.

Build copies all new public pages, js/, assets/ and shared/. Exclude backend/test/migration data and legacy key bundles from dist. Root-branch hosting also exposes repository files: never commit credentials/private exports.

## 5. Conventions, types and limits

- schemaVersion=2 for new entities; preserve legacy provenance.
- Random server IDs: cloud- quizzes, prb_ problems, prv_ problem revisions, qrv_ quiz revisions, itm_ slots, att_ attempts, ast_ assets, job_ jobs.
- Preserve old cloud- IDs.
- ownerId always comes from authenticated server context.
- Timestamps are server Firestore timestamps; APIs serialize ISO-8601 UTC strings/null.
- Format scheduled times with timezone in UI.
- Mutable aggregates have integer version; stale expectedVersion fails.
- Reject unknown fields, unsafe/prototype IDs and excessive data. Never silently truncate math.
- Persist asset IDs/paths, not permanent download URLs.

| Application limit | Default |
|---|---|
| Problems per quiz | 1–500 |
| Choices | 2–12, exactly one correct |
| Statement/explanation | 30,000 characters each plus byte cap |
| Choice text | 10,000 characters |
| Accepted short answers | Up to 30, each 500 characters |
| Student short/written response | 500 / 10,000 characters |
| Problem content + grading | 250,000 UTF-8 JSON bytes |
| Any application Firestore document | Below 700,000 encoded bytes |
| Image | 4 MiB PNG/JPEG/WebP/GIF, at most 16 megapixels; no SVG/HTML |
| Source/legacy import | 20 MiB |
| Tags | 12, each 60 characters |
| Listing page | Default 25, maximum 100 |
| Question response page | Maximum 20 items and approximately 1 MiB |
| Answer-save batch | Maximum 20 changes and 256 KiB |
| Points per slot | >0 and <=1,000 |
| Duration | 0–86,400 seconds |
| Active attempt | One per quiz/student |
| Asset signed link | 120 seconds |

These are application choices, not platform maximum claims. Chunk large operations by both bytes and count.

Enums:

~~~text
Role: student | teacher | admin
AccountStatus: active | disabled
BankVisibility: private | teachers
Lifecycle: active | trashed
QuizVisibility: private | public
AccessMode: approval | open
AccessStatus: none | pending | approved | declined | revoked
RevisionState: building | ready | failed
AttemptStatus: active | submitted | timed_out | terminated | abandoned
GradeState: not_started | queued | running | pending_manual | final | failed
ScoreRelease: immediate | afterClose | manual
SolutionRelease: immediate | afterClose | manual | never
JobStatus: queued | running | succeeded | failed | cancelled
AssetStatus: awaiting_upload | processing | ready | failed | deleting
~~~

## 6. Firestore schema

The following are typed contracts. Optional fields must be explicitly declared by validators. Protected records never become client DTOs by generic spreading.

### users/{uid}

~~~ts
type UserRecord = {
  schemaVersion: 2; uid: string; displayName: string; email: string;
  emailVerified: boolean; version: number;
  createdAt: Timestamp; updatedAt: Timestamp; lastSeenAt: Timestamp;
  preferences: {theme: "light"|"dark"|"system"; textScale: 1|1.125|1.25};
  searchName: string; searchEmail: string;
};
~~~

Email/verification reflect Auth. updateProfile accepts displayName/preferences only. After provisioning, the application display name is canonical; an older provider name cannot overwrite a saved profile name. Auth profile synchronization can retry separately.

Throttle lastSeenAt updates to once per 15 minutes. It is not proof of continuous studying or online presence.

### roles/{uid}

~~~ts
type RoleRecord = {
  role: "student"|"teacher"|"admin";
  accountStatus: "active"|"disabled";
  version: number; updatedAt: Timestamp; updatedBy: string;
};
~~~

Canonical authority. Missing role safely means ordinary student until getSessionInfo provisions it. Never replace an existing legacy teacher/admin role with student.

system/accessControl contains activeAdminCount/version. Role/status changes update it transactionally to prevent removing the last active admin.

### problems/{problemId}

~~~ts
type ProblemRecord = {
  schemaVersion: 2; ownerId: string; ownerDisplayName: string;
  title: string; searchTitle: string; subject: string; difficulty: string; tags: string[];
  bankVisibility: "private"|"teachers"; lifecycle: "active"|"trashed";
  latestRevisionId: string; revisionNumber: number; version: number;
  sourceProblemId: string|null; sourceProblemRevisionId: string|null;
  createdAt: Timestamp; updatedAt: Timestamp; trashedAt: Timestamp|null;
};
~~~

Listing record contains neither keys nor full statement bodies.

### problems/{problemId}/revisions/{problemRevisionId}

~~~ts
type ProblemRevision = {
  schemaVersion: 2; revisionNumber: number; createdBy: string; createdAt: Timestamp;
  type: "choice"|"open"; answerMode: "auto"|"manual";
  statementLatex: string;
  options: Array<{id: string; textLatex: string}>;
  defaultPoints: number;
  questionAssetBindings: Record<string, string>; // filename -> assetId
  source: {importJobId: string|null; sourceAssetId: string|null;
           originalQuestionId: string|null};
  contentHash: string;
};
~~~

options is empty for open questions. Revision is immutable. Hash is server-computed over canonical validated content.

Protected grading is at .../revisions/{problemRevisionId}/grading/main:

~~~ts
type ProblemGrading = {
  gradingVersion: 1; correctOptionId: string|null;
  acceptedAnswers: string[]; tolerance: number;
  explanationLatex: string; rubricLatex: string;
  solutionAssetBindings: Record<string, string>;
  createdAt: Timestamp;
};
~~~

Sharing one problem does not expose the entire original .tex file, which may include other private problems/keys.

### quizzes/{quizId}

~~~ts
type QuizRecord = {
  schemaVersion: 2; ownerId: string; ownerDisplayName: string;
  title: string; searchTitle: string; description: string;
  subject: string; difficulty: string;
  lifecycle: "active"|"trashed"; visibility: "private"|"public";
  accessMode: "approval"|"open";
  opensAt: Timestamp|null; closesAt: Timestamp|null; maxAttempts: number|null;
  publishedRevisionId: string|null;
  draftVersion: number; version: number; publishingJobId: string|null;
  createdAt: Timestamp; updatedAt: Timestamp;
  publishedAt: Timestamp|null; trashedAt: Timestamp|null;
};
~~~

Root controls discovery/new starts. Revision controls content/grading of existing attempts. Root title is a management label; public overviews/catalog use the published revision, never an unpublished draft title.

### quizzes/{quizId}/drafts/current and draftItems/{itemId}

~~~ts
type QuizSettings = {
  durationSeconds: number; shuffleQuestions: boolean; shuffleOptions: boolean;
  allowBack: boolean; penalty: number;
  scoreRelease: "immediate"|"afterClose"|"manual";
  solutionRelease: "immediate"|"afterClose"|"manual"|"never";
};
type QuizDraft = {
  version: number; title: string; description: string;
  subject: string; difficulty: string;
  itemOrder: string[]; settings: QuizSettings;
  updatedAt: Timestamp; updatedBy: string;
};
type DraftItem = {
  itemId: string; problemId: string; problemRevisionId: string;
  points: number; reuseFromQuizRevisionId: string|null;
};
~~~

DraftItem records live at quizzes/{quizId}/draftItems/{itemId}. Reuse provenance is server-derived. Slot IDs identify appearances, not problems: one problem can appear twice with two slots/answers.

Save bounded changed items and version the draft. Do not rewrite 500 unchanged documents on every keystroke.

### quizzes/{quizId}/revisions/{quizRevisionId}

~~~ts
type QuizRevision = {
  schemaVersion: 2; state: "building"|"ready"|"failed";
  revisionNumber: number; publicationJobId: string; sourceDraftVersion: number;
  title: string; description: string; subject: string; difficulty: string;
  settings: QuizSettings; itemOrder: string[];
  itemCount: number; totalPoints: number; manifestHash: string;
  createdBy: string; createdAt: Timestamp; readyAt: Timestamp|null;
};
~~~

Student-facing immutable snapshots live at .../items/{itemId}: statement, options, type, answer mode, question asset bindings and effective points. Teacher attribution references are stored but omitted from student DTOs.

Protected key snapshots live separately at .../grading/{itemId}: correct option/accepted answers/tolerance/model solution/rubric/solution bindings/grading version.

This materialization preserves quizzes if the original bank owner later unshares/deletes their listing.

### catalog/{quizId}

~~~ts
type CatalogEntry = {
  quizId: string; title: string; searchTitle: string; description: string;
  ownerDisplayName: string; subject: string; difficulty: string;
  durationSeconds: number; questionCount: number; totalPoints: number;
  accessMode: "open"|"approval";
  opensAt: Timestamp|null; closesAt: Timestamp|null;
  publishedRevisionId: string; updatedAt: Timestamp;
};
~~~

Exists only for active public quizzes with a ready publication. Catalog/root changes commit together. No student identities, keys, notes or owner email.

### quizzes/{quizId}/participants/{uid}

~~~ts
type Participant = {
  quizId: string; quizOwnerId: string; uid: string;
  accessStatus: "none"|"pending"|"approved"|"declined"|"revoked";
  requestMessage: string; requestedAt: Timestamp|null;
  decidedAt: Timestamp|null; decidedBy: string|null; decisionReason: string;
  attemptCount: number; extraAttempts: number;
  activeAttemptId: string|null; latestAttemptId: string|null;
  version: number; updatedAt: Timestamp;
};
~~~

Do not reset counts by deleting participants. Grant additional allowance through an audited command.

joinLinks/{sha256(token)} stores quizId/creator/createdAt/expiresAt/revokedAt. Generate 32 random bytes, base64url encode; store only hash. Default expiry 30 days. Link allows applying, never self-approval.

### attempts/{attemptId}

~~~ts
type Attempt = {
  schemaVersion: 2;
  studentId: string; studentDisplayName: string; studentEmail: string;
  quizId: string; quizOwnerId: string; quizRevisionId: string; quizTitle: string;
  ordinal: number; attemptKind: "standard"|"retry_incorrect";
  sourceAttemptId: string|null;
  status: "active"|"submitted"|"timed_out"|"terminated"|"abandoned";
  gradeState: "not_started"|"queued"|"running"|"pending_manual"|"final"|"failed";
  startedAt: Timestamp; deadlineAt: Timestamp|null; closedAtSnapshot: Timestamp|null;
  submittedAt: Timestamp|null; finalizedAt: Timestamp|null; lastSavedAt: Timestamp|null;
  currentFrontier: number;
  uiState: {currentIndex: number; flaggedItemIds: string[]; version: number};
  order: string[]; optionOrder: Record<string, string[]>;
  settingsSnapshot: QuizSettings;
  answeredCount: number; answerVersion: number; gradeVersion: number;
  scoreReleasedAt: Timestamp|null; solutionsReleasedAt: Timestamp|null;
  terminationReason: string|null;
  provenance: "server_v2"|"legacy_client_v1";
  totals: {
    score: number|null; possible: number; percentage: number|null;
    correct: number; incorrect: number; skipped: number; pending: number; partial: number;
  };
};
~~~

Never return raw Attempt to student. Serialize a released DTO.

Current answers: attempts/{attemptId}/answers/{itemId}:

~~~ts
type SavedAnswer = {
  value: string; revision: number; updatedAt: Timestamp;
  lastRequestId: string; updatedBy: string;
};
~~~

History: .../answers/{itemId}/changes/{changeId} contains value/revision/savedAt/actorId/requestId. Immutable, server-timestamped saved revisions.

Grades: attempts/{attemptId}/grades/{itemId}:

~~~ts
type ItemGrade = {
  status: "correct"|"incorrect"|"skipped"|"pending"|"partial";
  awarded: number; possible: number; manualPoints: number|null;
  gradedBy: string; gradingVersion: number;
  feedbackLatex: string; updatedAt: Timestamp; version: number;
};
~~~

manualPoints is teacher input 0..possible; awarded is effective contribution after penalty. They may differ for a zero manual mark. Grade corrections append .../gradeEvents/{eventId} with before/after, actor, reason, time.

### assets/{assetId}

~~~ts
type Asset = {
  ownerId: string; kind: "image"|"source"; originalName: string;
  declaredContentType: string; expectedBytes: number;
  status: "awaiting_upload"|"processing"|"ready"|"failed"|"deleting";
  stagingPath: string; storagePath: string|null; generation: string|null;
  contentType: string|null; sizeBytes: number|null; sha256: string|null;
  width: number|null; height: number|null;
  expiresAt: Timestamp; createdAt: Timestamp; readyAt: Timestamp|null;
  referenceCount: number; version: number;
};
~~~

assets/{assetId}/refs/{deterministicRefId} records targetType/targetId/targetRevisionId/createdAt. Create/remove refs and touch the asset root transactionally so new refs cannot race deletion. A counter alone is insufficient.

### Jobs, audit and supporting data

~~~ts
type Job = {
  kind: string; requestedBy: string; requestId: string; targetId: string;
  status: "queued"|"running"|"succeeded"|"failed"|"cancelled";
  input: object; // validated immutable references, no executable input
  progress: {processed: number; total: number; stage: string};
  processedCursor: string|null; leaseOwner: string|null; leaseExpiresAt: Timestamp|null;
  retryCount: number; createdAt: Timestamp; updatedAt: Timestamp; completedAt: Timestamp|null;
  result: object; // IDs/counts/hashes, no permanent URLs
  error: {reason: string; message: string; retryable: boolean}|null;
};
~~~

| Path | Purpose |
|---|---|
| jobs/{jobId} | Durable resumable work |
| auditEvents/{eventId} | Server event: actorId/actorRoleAtTime/action/targetType/targetId/quizId/quizOwnerId/affectedUserId/changedFields/requestId/occurredAt |
| users/{uid}/notifications/{id} | Event-derived in-app notification/readAt |
| operations/{uid}/requests/{requestId} | action/inputHash/status/resource/job IDs/timestamps |
| system/accessControl | Last-active-admin counter/version |
| usage/{uid} | Reserved/finalized bytes and quota |
| rateLimits/{bucketId} | Server-owned action limits |
| migrationRuns/{runId} | Source hashes/mappings/status/errors/rollback metadata |

Audit feeds never contain full answers, tokens or signed URLs. Details stay in protected resource histories.

Default teacher upload budget is 1 GiB finalized plus reserved bytes; admin-configurable application cap, not a Firebase free quota.

## 7. Storage lifecycle and image authorization

### Paths

~~~text
staging/{uid}/{assetId}/original
assets/{ownerId}/{assetId}/image.{png,jpg,webp}
sources/{ownerId}/{assetId}/original.tex
exports/{requesterUid}/{jobId}/results.csv
exports/{requesterUid}/{jobId}/quiz-backup.zip
~~~

Server chooses extensions from decoded bytes. User filenames never choose arbitrary paths.

### Upload algorithm

1. createAssetUpload checks current verified active staff, rate/byte budget; reserves bytes and creates awaiting_upload record.
2. Return exact staging path, assetId and one-hour expiry.
3. Browser uploads with uploadBytesResumable; show actual transferred bytes.
4. finalizeAssetUpload verifies ownership/reservation, actual size/type/signature/dimensions and computes checksum.
5. Decode/re-encode using a pinned maintained decoder such as sharp. Preserve mathematical PNG labels losslessly. Flatten animated GIFs with a visible conversion notice.
6. Write immutable final object, strip permanent download-token metadata, set private cache metadata.
7. Mark ready with canonical generation/path/dimensions/bytes/hash; adjust quota and write one asset.uploaded event.
8. Ready assets may enter saved publications. Failures stay recoverable; never claim success with missing assets.

No SVG/HTML, arbitrary external URL fetching or TeX execution. Source .tex remains owner/admin-only.

### Asset links

getAssetLinks accepts:

~~~ts
{
  context: {
    kind: "problem"|"quiz_draft"|"attempt"|"result"|"source";
    id: string; revisionId: string|null;
  };
  assetIds: string[]; // at most 20
}
~~~

Authenticate, authorize the context, verify each asset is referenced there, and return generation-pinned read-only V4 signed URLs valid 120 seconds. Active attempts receive question assets only. Solutions require result-release permission.

Never sign arbitrary client storagePath input. Sharing one problem does not permit downloading its full original source file.

This central policy avoids trying to fit enrollment/version/release logic into Storage's small cross-service rule lookup budget. Existing signed links may remain usable until expiry; new links are denied after access loss. Previously downloaded bytes cannot be recalled.

Keep URLs in memory only, refresh when needed, omit from database/logs/recovery. Use no-referrer. Configure necessary CORS origins for downloads/canvas/export; origins do not include GitHub repository paths.

Inject AssetUrlSigner. Production signs real links; emulator-only adapter supports tests without cloud credentials. It must be unreachable in production. Verify real IAM/signing/CORS in a test project.

### Cleanup

Expired unreferenced staging objects are swept and reservations released. Ready objects cannot be overwritten. Mark deleting only after transactional ref checks; new refs reject deleting assets. Use object generation preconditions. Missing objects are successful retry cases.

Retain assets needed by snapshots/attempts/history. No broad lifecycle deletion of all final assets. Deleting a Firestore parent does not automatically delete subcollections or Storage objects.

## 8. Permission policy

Implement/test central predicates before wiring screens:

~~~text
requireUser
requireVerifiedActiveUser
requireTeacher
requireAdmin
canManageQuiz
canReadProblem
canReuseProblemRevision
canRequestAccess
canStartAttempt
canReadAttempt
canSaveAnswers
canGradeAttempt
canRevealScore
canRevealSolutions
canReadAssetInContext
~~~

Context comes from validated Auth plus current roles/{uid}; client flags are never authority.

### Authoritative start policy

~~~text
require verified active caller
load quiz and ready published revision
reject trashed/unpublished quiz
reject before opening or at/after closing
load participant, default none/count zero
reject declined/revoked even when public-open
require approved when private or approval mode
if activeAttemptId is live: return it, do not increment
if active attempt expired: close it, return ATTEMPT_EXPIRED
compute allowance = maxAttempts + extraAttempts, unless unlimited
reject exhausted allowance
allocate one attempt and increment counter atomically
~~~

Teacher preview creates no student attempt. Taking someone else's quiz follows ordinary admission.

| Action | Student | Teacher | Admin |
|---|---|---|---|
| Public overview | Yes, also guest | Yes | Yes |
| Apply/start | According to policy | Same policy | Same for recorded attempts |
| Released own result | Yes | Yes | Yes |
| Create/edit problems | No | Own | All |
| Shared teacher bank | No | Read/reuse | All |
| Edit another original | No | No | Yes |
| Manage quiz/access/results | No | Own quizzes | All |
| Saved answer/history | Own attempt | Own quiz's attempts | All through admin APIs |
| Roles/disable/global activity | No | No | Yes |
| Guide app entry/route | No | Yes | Yes |

Private IDs without grant/link produce generic unavailable responses. Valid private application link exposes only minimal application title/teacher summary, never questions/participants/keys.

Guide restriction is UI/route behavior. Public GitHub source is not a secrecy boundary for static documentation. Sensitive quiz data is backend-protected.

## 9. Callable API contracts

Use Firebase httpsCallable through js/services/api.js. Do not replace these with unauthenticated ad-hoc HTTP routes.

Every request has apiVersion:2. Explicit mutations also have requestId (UUID created once per user action and reused on retries). getSessionInfo's deterministic UID-keyed self-provisioning is the exception.

~~~json
{
  "apiVersion": 2,
  "requestId": "3cb5d514-a76f-4c6c-8b39-a22ed055cf09",
  "quizId": "cloud-exampleQuiz01234567",
  "expectedVersion": 4
}
~~~

Success envelope:

~~~json
{
  "apiVersion": 2,
  "serverTime": "2026-10-29T12:00:00.000Z",
  "data": {"version": 5}
}
~~~

Use HttpsError with stable details.reason, not English-message parsing. Reasons: AUTH_REQUIRED, EMAIL_UNVERIFIED, ACCOUNT_DISABLED, ROLE_REQUIRED, RESOURCE_UNAVAILABLE, VERSION_CONFLICT, INVALID_FIELDS, ACCESS_PENDING, ACCESS_DECLINED, ACCESS_REVOKED, QUIZ_NOT_OPEN, QUIZ_CLOSED, ATTEMPT_LIMIT, ATTEMPT_EXPIRED, ATTEMPT_FROZEN, ASSET_NOT_READY, QUOTA_EXCEEDED, RATE_LIMITED.

Map to unauthenticated/permission-denied/not-found/invalid-argument/aborted/failed-precondition/resource-exhausted/unavailable. A conflict returns actualVersion/expectedVersion.

Listings accept limit/cursor, return items/nextCursor. Validate opaque cursors and reapply all authorization filters. Cursors never grant access.

### Retry contract

operations/{uid}/requests/{requestId} stores action/inputHash/status/resource/job IDs. Same ID+input returns the same result; same ID+different input fails. Generate IDs outside retrying transactions. No external uploads/notifications inside transaction callbacks. Database audit/notification IDs are deterministic.

Long operations return durable job IDs. Do not expire receipts while jobs can still retry. Keep deterministic resource mappings for create/import/start operations.

### Accounts and dashboard

| Function | Input after envelope | Output data |
|---|---|---|
| getSessionInfo | none | Profile, role/status, capabilities, API version |
| updateProfile | displayName/preferences patch, expectedVersion | Updated allowed fields/version |
| getDashboard | none | Scoped real counts and <=5 recent items/section |
| listMyNotifications | limit/cursor | Own notifications |
| markNotificationRead | notificationId | readAt |
| listUsers | Admin role/status/search/limit/cursor | Minimal user summaries |
| setUserRole | Admin targetUid/role/expectedVersion/reason | New role/version |
| setAccountStatus | Admin targetUid/status/expectedVersion/reason | New status/version |

Provision missing student/profile records safely. Never make the first visitor admin. Never accept role/emailVerified/quota in updateProfile.

### Problems

| Function | Input | Output |
|---|---|---|
| listProblems | view mine/shared, title prefix, subject/difficulty/tag, lifecycle, page | Bank listings |
| getProblem | problemId, optional revisionId | Authorized content/key revision |
| createProblem | metadata, content, grading | problemId/revisionId/version |
| saveProblemRevision | problemId, expectedVersion, metadata/content/grading | New immutable revision/version |
| setProblemSharing | problemId/visibility/expectedVersion | Updated listing |
| forkProblem | problemId/revisionId/optional title | Owned fork + attribution |
| trashProblem / restoreProblem | problemId/expectedVersion | Lifecycle/version |
| listProblemRevisions | problemId/page | Revision summaries |

metadata accepts title/subject/difficulty/tags/bankVisibility. content accepts type/answerMode/statementLatex/options/defaultPoints/questionAssetBindings. grading accepts the fields in section 6. Ownership/provenance comes from the server.

### Quiz and import

| Function | Input | Output |
|---|---|---|
| listPublicQuizzes | title prefix/subject/page | Safe catalog; guest allowed |
| listAvailableQuizzes | page | Approved available quizzes for caller |
| getQuizOverview | quizId, optional joinToken | Safe overview and eligibility reason |
| listMyQuizzes | lifecycle/visibility/title prefix/page | Owned management list |
| getQuizDraft | quizId | Draft metadata/order/refs/versions |
| getQuizDraftItems | quizId/itemIds <=20 | Bounded author preview with keys |
| listQuizRevisions | quizId/page | Owned/admin history |
| previewQuizRevision | quizId/revisionId/itemIds/includeKeys | Staff preview, no student attempt |
| createQuiz | optional title | Private empty quiz/root+draft version |
| saveQuizDraft | quizId/expectedDraftVersion/patch/upsertItems/removeItemIds/itemOrder | New version/item ID mappings |
| publishQuiz | quizId/expectedDraftVersion/expectedVersion | Publication job ID |
| getJob | jobId | Authorized status/progress/result/error |
| setQuizAccessPolicy | quizId/expectedVersion/visibility/mode/window/maxAttempts | New effective root policy/version |
| unpublishQuiz | quizId/expectedVersion | Cleared live pointer; history retained |
| duplicateQuiz | quizId/source draft or published/expectedVersion | New private owned quiz |
| trashQuiz / restoreQuiz | quizId/expectedVersion | Lifecycle/version; restore private |
| createImportJob | name/sourceAssetId/schema/itemCount | Import job |
| importProblemBatch | jobId/batchKey/records | Stable item/problem/revision mappings |
| finishImportJob | jobId/metadata/settings/order | Private quiz or updated draft |
| exportQuizBackup | quizId/optional revisionId | Authorized ZIP job |

saveQuizDraft changes <=20 items per call; a 500-ID reorder array is allowed. New slots use clientKey; existing slots use itemId. Server allocates new IDs and returns itemIdMap. itemOrder can refer to new clientKeys from that request. Serialize editor saves using returned versions.

~~~json
{
  "apiVersion": 2,
  "requestId": "20d5f413-9d71-4209-b61b-2f9a08adb9bc",
  "quizId": "cloud-exampleQuiz01234567",
  "expectedDraftVersion": 3,
  "patch": {"title": "Geometry practice", "settings": {"durationSeconds": 1800}},
  "upsertItems": [
    {
      "clientKey": "new_slot_1",
      "problemId": "prb_exampleProblem01234567",
      "problemRevisionId": "prv_exampleRevision01234567",
      "points": 3
    }
  ],
  "removeItemIds": [],
  "itemOrder": ["itm_existingItem01234567", "new_slot_1"]
}
~~~

Return draftVersion:4, normalized order and the allocated mapping. Client reuseFromQuizRevisionId is not proof; derive reuse provenance on server.

Import records contain importItemKey/originalQuestionId/content/grading/points/bindings. Retries in one job reuse mappings. Identify errors by item/field. Partial batch processing must be explicitly resumable, never silently half-succeed.

### Applications and participants

| Function | Input | Output |
|---|---|---|
| createJoinLink | quizId/optional expiry | Raw token once + expiry |
| revokeJoinLink | quizId/link ID or hash | Revocation |
| resolveJoinLink | token | Minimal application overview |
| requestQuizAccess | quizId or token/message <=500 | Participant state/version |
| listMyApplications | page | Own requests and safe summaries |
| listAccessRequests | quizId/status/page | Owner/admin requests |
| decideQuizAccess | quizId/targetUid/approve-decline-revoke-reopen/expectedVersion/reason | Updated participant |
| bulkDecideQuizAccess | quizId/<=25 decisions | Per-user success/conflict |
| lookupParticipant | quizId/exactEmail | Minimal registered-account match |
| grantQuizAccess | quizId/targetUid/reason | Approved participant |
| addAttemptAllowance | quizId/targetUid/delta/expectedVersion/reason | New extra allowance |

Check quiz ownership before email lookup. No full user directory for teachers. In-app notifications only; no automatic email.

### Attempts

| Function | Input | Output |
|---|---|---|
| startAttempt | quizId/optional sourceAttemptId for retry | Attempt ID/order/settings/deadline |
| getAttempt | attemptId | Authorized redacted state/own saved answers |
| getAttemptQuestions | attemptId/<=20 itemIds | Allowed statements/options/asset IDs |
| saveAnswers | attemptId/changes/expectedAnswerVersion | Confirmed answer versions/times |
| navigateAttempt | attemptId/targetIndex | Accepted frontier |
| saveAttemptUiState | attemptId/index/flags/expectedUiVersion | UI-state version, no frontier bypass |
| submitAttempt | attemptId | Frozen status/grading job |
| abandonAttempt | attemptId | Abandoned, allowance consumed |
| endActiveAttempt | quizId/attemptId/reason | Teacher/admin termination |
| listMyAttempts | optional quiz/status/page | Release-filtered summaries |
| getAttemptResult | attemptId/page | Released summary/review items or awaiting release |
| getAnswerHistory | attemptId/itemId/page | Authorized saved changes |

~~~json
{
  "apiVersion": 2,
  "requestId": "7a5f1af5-9998-43e7-aaf8-875208842d24",
  "attemptId": "att_exampleAttempt01234567",
  "expectedAnswerVersion": 7,
  "changes": [
    {"itemId": "itm_existingItem01234567", "value": "3/2", "expectedRevision": 2}
  ]
}
~~~

Response confirms answerVersion:8, item revision:3 and savedAt. No answer key or client-selected deadline.

Attempt input never accepts authoritative score/correctCount/ownerId/startedAt/deadline/manualScores/quizSnapshot.

### Reports, grading, administration

| Function | Input | Output |
|---|---|---|
| listQuizAttempts | quiz/revision/student/status/date/page filters | Owner/admin summary page |
| getTeacherAttempt | attemptId/page | Authorized answers/grades/detail |
| saveManualGrade | attemptId/itemId/points/feedback/reason/expectedGradeVersion | New grade/totals versions |
| releaseResults | quizId/<=25 attempts or revision-scope job/score+solution flags | Release results/job |
| getQuizStatistics | quizId/revisionId | Revision-aware summary/asOf |
| exportQuizResults | quizId/revision/filters | CSV job |
| listActivity | Admin actor/role-at-time/quiz/action/date/page | Redacted events |
| getAdminAttempt | attemptId/page | Full authorized detail + read audit |
| getAdminUserActivity | targetUid/page | User events |
| adminListContent | quiz/problem, owner/lifecycle/visibility/search/page | Admin management list |

All exports enforce ownership. Escape CSV formula-like cells. Admin detail reads emit an event; global feed contains no full answers.

### Assets

| Function | Input | Output |
|---|---|---|
| createAssetUpload | kind/name/contentType/expectedBytes | Asset ID/staging path/expiry |
| finalizeAssetUpload | assetId | Ready metadata or processing job |
| cancelAssetUpload | assetId | Cleanup/cancellation status |
| getAssetLinks | Authorized context + <=20 assetIds | Temporary URLs/expiry |

getJob reauthorizes by job kind. A demoted/disabled owner cannot use an old privileged export job to bypass access loss.

## 10. Publication, reuse and jobs

### Publish algorithm

1. Require current owner/admin and expected root/draft versions.
2. Validate metadata, 1–500 slots, unique slot IDs, points, types, release settings.
3. Transactionally reserve a building revision/job and capture exact draft/version. Set publishingJobId; initial implementation rejects further draft edits while publishing.
4. Resolve pinned sources and check current ownership/sharing or an existing owned authorized snapshot. Capture reuse permission at job acceptance.
5. Verify all question/solution assets ready; reserve refs/leases.
6. Copy immutable statement/key snapshots in bounded chunks, targeting <4 MiB per database batch.
7. Compute counts/points/manifest hash from written data.
8. Final transaction rechecks actor privileges/lifecycle/job lease/version. Mark ready, switch published pointer/catalog, clear job flag and append one publication event.
9. New starts use the new revision only after step 8.
10. Failure retains previous live pointer/catalog; durable job can retry/cancel.

Storage uploads plus database writes are not one cross-service transaction. Staging/finalization/final-pointer activation prevent incomplete publications.

### Reuse/retention

Draft updates never mutate a publication. Offer “New source version available” explicitly. Attempts use pinned quizRevisionId.

Existing snapshots remain usable after bank sharing is withdrawn. Duplicating such an owned quiz can fork its authorized snapshots into newly owned private problem records, retaining attribution/assets; it cannot claim ownership of the original.

Hard deletion rejects retained references. Administrative retention purges are separately approved, not a Trash side effect.

### Job worker

Kinds: publish_quiz, finalize_asset, grade_attempt, export_results, export_quiz, cleanup, migrate_v1, account_auth_sync.

Use leaseOwner/leaseExpiresAt/processedCursor and deterministic output IDs. Triggers can repeat or arrive out of order. Scheduled sweeper retries abandoned leases and queued work.

Publication input is immutable; grading freezes answers first. Exports report asOf and included count. A job must not expose partial grading as a final result.

## 11. Attempts, timing, saves and grading

### Allocation

In one transaction read quiz/revision/participant, evaluate section 8, allocate attempt, increment counter and set activeAttemptId. Generate random question/option order server-side.

~~~text
durationDeadline = start + duration, or infinity if untimed
closingDeadline = current quiz closing time, or infinity
deadlineAt = minimum, or null if both infinite
~~~

Capture settings/closing date in attempt. Later settings affect new attempts only. Teacher termination remains explicit.

### Saves

Client debounce approximately 800ms, minimum one second between ordinary saves; flush on blur/navigation/submit when possible.

Server transaction:

1. Read attempt and affected answers before writes.
2. Require caller is student owner, active account, active attempt, now strictly before deadline.
3. Enforce frontier when backward navigation is disabled.
4. Validate option ID or text bounds against pinned content.
5. Compare overall answerVersion and each expectedRevision.
6. Unchanged value returns existing version without history.
7. Real change writes current answer + immutable saved change + attempt count/version/time + redacted event.
8. Return confirmed savedAt/revisions.

Client clocks never determine acceptance. Second-tab conflicts do not silently overwrite.

saveAttemptUiState validates all flag IDs and position, cannot advance restricted frontier, and does not change score/deadline/allowance/answer version.

### Submit and timeout

Freeze root in a transaction before grading. Saves also touch root, so races serialize. Duplicate submit returns existing status/job.

At/after deadline, freeze timed_out using deadline as effective submittedAt and grade last server-confirmed answers. No late recovery text is silently accepted.

Enforce expiry on every operation and with a scheduled sweep when browser is closed. Display countdown using serverTime/monotonic browser offset.

Abandoned/terminated attempts retain answers, consume allowance and are excluded from ordinary score averages. Teacher can grant extra allowance.

### Grading

Reuse existing bounded numeric parser/text normalization/tolerance. No eval/general symbolic-equivalence claims.

Implement gradeSnapshotAnswer(item,key,value,manualPoints), mapping v2 fields to existing pure grading shape: id=itemId, prompt=statementLatex, points=slot points, answer=correctOptionId, answers=acceptedAnswers, tolerance=key tolerance, options[].text=textLatex.

Keep this protected adapter server-side. Students never receive keys just because old gradeQuestion expects them.

- Correct automatic response: slot points.
- Incorrect response: negative penalty or zero.
- Skipped/pending: no penalty.
- Nonempty manual response: pending teacher marking.
- Empty manual response: skipped.
- Manual points 0..maximum; preserve/test existing zero-mark penalty convention.
- Total can be negative; displayed percentage clamped 0–100.
- Preserve eight-decimal aggregate rounding.
- Mark provisional while manual responses remain pending.

Grading job writes item grades, computes totals, then publishes one completed gradeVersion. Retry does not double-count/events.

Manual corrections require ownership/frozen attempt/manual type/bounds/expected version. Record before/after/reason/actor/time. Never modify student's submitted response.

### Release and retry

Students see scores only after grading plus captured immediate/afterClose/manual rule. Solutions have independent policy, require frozen attempt, and never reveal while active. “Never” suppresses model solutions permanently for that revision.

Old attempts follow captured policy and explicit release timestamps. Do not promise retraction after viewing.

Retry-incorrect requires released source result, eligible access/allowance and server-derived incorrect/skipped subset. Record sourceAttemptId/attemptKind and report separately.

## 12. Teacher reports and administrator activity

Teaching workspace: My quizzes, Requests, Results, Problems.

Per-quiz management: Content, Access, Results, History.

Results columns: participant, attempt number/kind, revision, status, score/possible, percentage, pending marks, start/submit/duration/last save. Filter by participant/date/status/revision, paginate.

Detail includes statement, saved/submitted answer, change history, authorized key/rubric, marks, feedback and grade corrections. Label active responses In progress.

Statistics select revision and standard attempts by default. Show unique participants, completion, pending grading and final average with denominator/asOf. Exclude terminated/abandoned/pending-manual results from final average. Never mix incompatible versions silently.

CSV export is scoped and safe; result visibility applies to student exports too.

### Applications

Display Pending/Approved/Declined/Access revoked. Keep decided requests in history filters. Bulk decisions report individual conflicts. Direct grants require registered users; no automatic email.

### Audit taxonomy

~~~text
account.created
profile.updated
role.changed
account.status_changed
problem.created
problem.revision_saved
problem.sharing_changed
problem.forked
problem.trashed
problem.restored
asset.uploaded
asset.failed
quiz.created
quiz.draft_saved
quiz.published
quiz.unpublished
quiz.access_policy_changed
quiz.duplicated
quiz.trashed
quiz.restored
access.requested
access.approved
access.declined
access.revoked
access.reopened
attempt.allowance_changed
attempt.started
attempt.answers_saved
attempt.submitted
attempt.timed_out
attempt.terminated
attempt.abandoned
grade.completed
grade.manually_changed
result.released
report.exported
admin.attempt_viewed
migration.quiz_imported
~~~

Write audit with authoritative commits where possible. Only final job completion emits completed business event. Store actorRoleAtTime, sort by server occurredAt/stable ID, never infer order from trigger arrival.

Admin tabs: Users/roles/status; Activity filters; Attempts/answers/times; Content by owner/lifecycle; failed/stuck Jobs with safe retry.

Admin sees meaningful recorded actions, not invented online presence or unstored historical edits. Answer bodies remain in protected histories, not global feed.

## 13. Page and session behavior

### Authentication state

~~~text
initializing -> signedOut
initializing -> signedInRoleLoading -> signedIn
initializing -> unavailable
signedIn -> signedOut or disabled
network error -> recoverable error
~~~

For incremental P01, add authResolved=false/roleResolved=false to existing session shape. Set first only from first Auth callback, second after role read. Update existing ready/connecting consumers together; config failure is not signed-out proof.

No login form before confirmed signed-out. Profile can show identity while role loads, privileged controls hidden.

login.html with existing session uses location.replace to validated returnTo/profile. Signed-out profile redirects once to login with returnTo. Validate same origin, exact GitHub base path and fixed HTML allowlist. Test root and /sat-quiz/.

On UID change/sign-out/demotion clear relevant subscriptions/private DOM/recovery/cache. Subscribe to own role changes.

### Navigation and Home

Desktop: Home, Quizzes, My activity, Teaching if permitted, Admin if permitted, Profile.

Mobile: Home, Quizzes, My activity, Profile; staff workspace shortcuts on Home/Profile and overflow. Do not cram all tools into footer.

Guide link/app route only teachers/admins. Remove unconditional data-guide buttons.

Home:

- Guest: Browse/sign-in and short public list.
- Student: Resume, available quizzes, request decisions, recent results.
- Teacher: Student features plus Create/My quizzes/Problems/requests/marking.
- Admin: Teacher features plus users/activity/jobs.

Maximum five recent rows/section plus View all. Real loading/empty/error states and real counts. No hero slogans or fake metrics.

### Catalog and profile

Catalog has Public and Available to me. Cards show title/teacher/subject/count/points/time/access. Search is title-prefix, accurately labeled. No local/GitHub source badges.

Overview action is Sign in / Request / Pending / Start / Resume / Closed / Results according to backend eligibility.

Profile has name/email/verification/role/appearance/UID disclosure/logout/workspace links. Preserve Google/email/reset/verification and friendly errors.

### Editor

New / Import / Existing / From bank entry modes. Desktop editor+preview; mobile Edit/Preview switch.

Persistent Save draft/Preview/Publish and authoritative Unsaved/Saving/Saved/Failed status.

Slot rows show type/points/source/revision with edit/replace/duplicate/remove/reorder. Include keyboard up/down alternatives.

Sections: Metadata; Problems; Test settings; Access; Results release; Images. Shared-source edit offers Fork. Publication shows effective visibility/access/revision and waits for job.

### Import

Preserve problem/exercise, exam-class and top-level enumerate syntax, escaped braces/comments/math/images. Do not execute TeX packages/files/shell commands.

Errors identify problem/field and source line if available. Missing assets show exact aliases. Preview precedes cloud creation. Confirmed import creates stable job/mappings, separate assets/problems and private quiz.

Accept v1 JSON with embedded raster images as input, but never persist base64 in new cloud documents.

### Bank

My problems / Shared with teachers / own Trash; title/subject/difficulty/tag filters; pagination. Retain selected revisions across pages.

Math preview, tags/type/owner/revision/points; staff-only collapsible key. Selection tray shows count/order/Create quiz. Backend rechecks reuse permission.

### Runner and results

Teacher controls time; students cannot override it at start. Problem/answer occupy most screen. Show math preview, flag/navigation/timer and save status.

Long equations scroll locally. Images scale/zoom.

Submit confirmation shows answered/unanswered and save failures. Do not show success before freeze.

Results distinguish Grading/Provisional/Released/Awaiting release. Show authorized points/counts/time/review/feedback. Remove student self-marking.

### Tables

Desktop tables; mobile labeled compact rows or deliberate local scroller. No tiny shrink-to-fit text. Reachable row actions, explicit timezone timestamps.

## 14. CSS, bright design and accessibility

~~~css
:root {
  --bg: #f4f8ff;
  --surface: #ffffff;
  --surface-blue: #eaf2ff;
  --text: #172b4d;
  --text-muted: #50627a;
  --primary: #2459d3;
  --primary-hover: #1e47a8;
  --border: #cedbea;
  --focus: #174fc4;
  --danger: #b42318;
  --success: #146c43;
  --radius-sm: 6px;
  --radius-md: 10px;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;
  --content-max: 1200px;
}
~~~

Starting palette, verify rendered contrast. System fonts, 16px body, readable math line height. White/pale blue surfaces, blue actions, restrained borders/shadows, modest rounding, compact useful layouts.

tokens.css defines theme/spacing/type/radii. base.css resets/type/focus/forms/motion. layout.css shell/grids/navigation/safe-area. components.css buttons/panels/dialogs/status/tables. Page sheets contain unique styles/responsive rules.

Same shared load order then page sheet. Remove migrated duplicate selectors from app.css. Replace static inline styles with classes; validated numeric progress custom properties are fine.

Test widths 360/390/768/1280, landscape and 200% zoom:

- No document-level overflow; math/code/table local scrollers allowed.
- Main tap targets >=44px application target.
- Text contrast >=4.5:1 normal, >=3:1 large.
- Focus visible, labels/logical order, modal focus trap/Escape/restore.
- Status live regions useful; no timer announcement each second.
- Preserve inputs after error, identify fields.
- Light/dark/system and text sizes use tokens; light default.
- Respect reduced motion and safe areas.
- Escape untrusted HTML and restrict unsafe MathJax URL/style/extension commands in all content.

Unsupported teacher markup gets clear validation. Preserve student response text; render unsupported/unsafe formatting as escaped text rather than losing the answer.

## 15. Migration and compatibility

scripts/migrate-v1.mjs supports --project/--dry-run/--run-id/--only-quiz/--resume; default dry-run, writes require --apply. Refuse unspecified project.

Use trusted environment credentials, no private keys in repo. Report source IDs/owners/visibility/counts/assets/errors/mappings/hashes. Detect source changes on resume.

### Cloud migration

First preserve/normalize legacy role records with active status/version; initialize actual active-admin count while administrative writes are frozen.

For each v1 quiz:

1. Validate old JSON with preserved v1 validator.
2. Preserve quiz ID/owner/creation time.
3. Convert questions into owned problem revisions and slot mappings.
4. Extract/validate embedded raster assets to separate objects.
5. Separate question/solution bindings and keys.
6. Create draft; create ready snapshot if old quiz published.
7. Old published -> public/open; old private draft -> private/approval/unpublished.
8. Preserve timing/shuffle/penalty; old unlimited retakes -> maxAttempts=null.
9. Verify statement/options/key/points/math/counts/assets.
10. Record all source/destination hashes/mappings.

Missing owner is a blocking report, never guessed as admin.

### Results/device migration

Legacy results retain provenance=legacy_client_v1. Do not certify them as trusted grades. Preserve available answers/times/scores/omitted flags. If exact historical snapshot is unknown, do not invent a matching revision/review.

Unrecorded past changes cannot be recovered.

Offer detected device quizzes only to signed-in authorized teachers, with explicit selection into private drafts. Do not assign shared-browser data automatically. Retain old local copies until verified and user chooses removal.

Seed examples deliberately under chosen owner or retain as test/import fixtures. Remove runtime GitHub contents discovery/bundled fallback.

### Cutover

Back up -> test-project backend -> dry run -> resolve blockers -> freeze old writes -> apply/verify migration -> coordinated v2 functions/rules/frontend -> block legacy key/result writes -> verify deep links -> retain protected rollback backup.

Old tabs get upgrade/reload error. Do not reopen permissive rules automatically during rollback.

## 16. Rules, queries and operational limits

### Direct Firestore allowlist

| Path | Browser read | Browser write |
|---|---|---|
| catalog | Public get, bounded list <=100 | Deny |
| users/{uid} | Own get | Deny |
| roles/{uid} | Own get/listener | Deny |
| users/{uid}/notifications | Own bounded get/list | Deny |
| Everything else including legacy keys/results | Deny | Deny |

Sensitive reads/mutations use handlers. Never allow all authenticated users to all documents.

### Storage rules

Create only staging/{uid}/{assetId}/original if UID matches, email verified, current role active staff, reservation owned/awaiting/unexpired, size/type/path exactly match and object absent. Only two Firestore lookups: role + asset.

Deny overwrite/list/final-object direct reads. Signed links use IAM, not subsequent Firebase rule checks; their expiry limit is deliberate.

### Index/query registry

Maintain tested supported filter combinations:

| Collection | Scope/filter | Ordering |
|---|---|---|
| catalog | optional subject | updatedAt desc or searchTitle asc |
| quizzes | owner/lifecycle, optional visibility | updatedAt desc |
| problems | owner/lifecycle or teachers-shared/active | updatedAt desc or title prefix |
| problems | supported subject/difficulty/tag | documented order |
| participants group | uid/status | updatedAt desc |
| one quiz participants | status | requestedAt desc |
| attempts | student/status | startedAt desc |
| attempts | quiz+owner/revision/student/status | startedAt desc |
| attempts | active | deadlineAt asc for sweep |
| auditEvents | actor/role-at-time/quiz/action/date | occurredAt desc |
| jobs | status/kind | updatedAt asc |
| jobs | running | leaseExpiresAt asc |
| assets | status | expiresAt asc |

Stable document-ID tiebreaker. Reject unsupported filters instead of fetching everything. Title prefix is not full-text math search. Exempt large bodies/answers/bindings/job payloads from indexes.

Initial application rate limits: requests10/hour; exact-email lookup20/hour/teacher; uploads60/hour/teacher; answer saves120/min/user; publication10/min/teacher. Add byte/job concurrency caps.

Configure/test App Check then enforce production; it supplements identity/ownership. Logs contain safe IDs/reasons, no answers/tokens/URLs.

## 17. Emulator setup and fixtures

Pin compatible dependencies/lockfiles. Node.js22 backend; record Java/CLI versions that actually pass. Do not blindly retain old optional firebase-tools pin.

Root scripts:

~~~json
{
  "prepare:backend": "node scripts/sync-functions-shared.mjs",
  "test": "node --test tests/*.test.mjs tests/unit/*.test.mjs",
  "test:backend": "npm run prepare:backend && npm --prefix functions test",
  "test:rules": "firebase emulators:exec --project demo-mathquiz-v2 --only auth,firestore,storage \"node --test tests/rules/*.test.mjs\"",
  "test:integration": "npm run prepare:backend && firebase emulators:exec --project demo-mathquiz-v2 --only auth,firestore,storage,functions \"node --test tests/integration/*.test.mjs\"",
  "test:e2e": "node scripts/run-e2e.mjs",
  "verify:static": "node scripts/verify-static.mjs"
}
~~~

Create matching tests before adding globs. Preserve baseline tests until deliberately moved to legacy coverage.

Functions dependencies: firebase-admin/firebase-functions/image decoder. Dev tools: client SDK/rules-unit-testing/Playwright. Keep out of browser runtime.

Emulators: Auth9099, Firestore8080, Functions5001, Storage9199, explicit rule paths, singleProjectMode. Frontend4173, test repository prefix /sat-quiz/.

Seed script refuses real projects or missing emulator variables. Reserved example.test emails only:

- admin_a/admin_b: two active admins for concurrency.
- teacher_a/teacher_b: cross-owner/shared-bank.
- teacher_unverified: verification gates.
- student_approved/pending/blocked/other/unverified.
- account_disabled.

Fixture Teacher A: choice2pts key b; numeric3pts accepted3/2; manual proof5pts and solution-only image. Quiz10pts, penalty1. Public-open and private-approval versions. B owns unrelated content.

Expected: correct choice + wrong numeric + nonempty pending proof -> 1/10, correct1/incorrect1/pending1. Teacher awards3 ->4/10, correct1/incorrect1/partial1. Zero manual mark under preserved penalty ->0/10, correct1/incorrect2.

Create source revision2 after attempt start. Old attempt must still use revision1.

## 18. Implementation task cards

Execute in dependency order. Read referenced contracts/policies/tests before coding. Development branch only until coordinated release. A working button backed by mocks or permissive rules is not completion.

### P00 — Reconcile actual repository

Files: project instructions, git status, README/package/Firebase config/source/tests. Create docs/IMPLEMENTATION_PROGRESS.md only.

1. Identify root, existing changes/backend and presence of config without printing values.
2. Compare section1; preserve newer user/Copilot work.
3. Run current tests/build, record routes/deployment/data paths.
4. Create phase/requirement checklist and actual blockers.

Done: baseline/progress documented, no application/data changes. Report next files/tests. Never assume an earlier assistant's “done” is evidence.

### P01 — Session, routes and separate Home

Depends P00. Files: firebase-client/core, account/common, index/quizzes/login/profile/settings, session/navigation/page modules.

1. Add explicit Auth/role resolution.
2. Split sign-in/profile; validate/consume returnTo once.
3. Move current library to quizzes.html before replacing index.
4. Add role-aware shell and direct-route guards; hide guide until staff confirmed.
5. Clear stale private responses/subscriptions on account change.
6. Home initially uses working navigation only until P02 APIs exist; no fake counts.

Tests AUTH-01–07, UI-01, COMPAT-01. Done: no sign-in flash, safe round trip, staff guide only, old quiz links work and existing math tests pass.

### P02 — Shared contracts and backend authorization

Depends P01. Files: shared/, Functions package/handlers/domain helpers, services/api, emulator config/tests.

1. Extract parser/numeric/grading with compatibility wrappers.
2. Implement strict validators/DTO serializers and byte limits.
3. Add generated Functions mirror and packaging check.
4. Add callable wrapper/current role/status/error/idempotency/audit.
5. Implement session/profile/dashboard APIs and safe student provisioning.
6. Implement section8 predicates and seed/bootstrapping tools.
7. Development v2 rules only; do not break production mid-phase.

Tests AUTH-08, POLICY-01–05, API-01–04, PACK-01. Done: real emulator calls authenticate, spoofed authority fails, retries stable, deployment includes shared files.

### P03 — Independent problems and assets

Depends P02. Files: problem/asset APIs, Storage repository/rules, asset service, references, basic problem editor.

1. Problem create/immutable revision/share/fork/Trash/restore.
2. Upload reservations/staging/finalization/quota.
3. Separate question/solution bindings.
4. Context-authorized links and emulator signer adapter.
5. Ref-safe cleanup and source privacy.
6. Minimal working problem edit/refresh/image flow.

Tests PROBLEM-01–06, ASSET-01–08, RULES-01–04. Done: real cloud-model records/assets reload; B can reuse shared but not edit A; students cannot read bank/keys; no base64 in new records.

### P04 — Draft/import/publication/lifecycle

Depends P03. Files: quiz/import APIs, publication worker, quiz editor, parser adapter.

1. Private quiz creation and versioned incremental draft saves.
2. LaTeX/v1 import preview -> stable job/item mappings.
3. Assemble ordered slots/points from source revisions.
4. Build snapshots and final pointer switch; failure recovery.
5. Visibility/window/attempt/release validation.
6. Duplicate/unpublish/Trash/private restore/history/preview.
7. Confirmed cloud save status.

Tests QUIZ-01–09, IMPORT-01–04, JOB-01–03. Done: updates preserve link; failed publish preserves old live quiz; source revisions cannot mutate old publication; repeated import no duplication.

### P05 — Applications and admission

Depends P04. Files: access APIs/policy, access page, activity/teacher Access tab, notifications.

1. Hashed expiring/revocable request links.
2. Request/pending/approve/decline/revoke/reopen.
3. Registered-user grant/limited lookup/bulk decisions.
4. Student available/request status and teacher inbox/counts.
5. Identical policy on starts/questions/asset contexts.

Tests ACCESS-01–09. Done: pending/declined cannot bypass APIs, approval is quiz-specific, cross-owner management denied and link never means approval.

### P06 — Attempts, time, answers and grading

Depends P05. Files: attempts/domain/worker, runner/results foundation, recovery.

1. Transactional allocate/resume fixed revision/order/deadline.
2. Availability/attempt limits and server expiry.
3. Versioned saves/history/frontier/UI state.
4. Question pagination/math/image display.
5. Freeze before grading, timeout sweep, idempotent grading.
6. Remove authoritative client scores/time override/self-marking.
7. Recovery by UID/attempt, 24h TTL; clear after confirmation/logout; never replay late/stale.
8. Account change cannot attach pending writes to new identity.

Tests ATTEMPT-01–12, GRADE-01–05, RECOVERY-01. Done: browser manipulation cannot change grade/time; duplicate starts/submits safe; refresh retains same attempt; late answers denied.

### P07 — Reports, marking and release

Depends P06. Files: report/manual-grade/release APIs, teacher reports, results/statistics/exports.

1. Owned-quiz listing/detail/change history.
2. Manual marking/corrections/feedback/version conflicts.
3. Score/solution release in all DTOs/exports/assets.
4. Revision-aware statistics and CSV.
5. Student history/review/retry-incorrect under limits.

Tests REPORT-01–07, RELEASE-01–06, GRADE-06. Done: ownership enforced, keys absent before release, corrections audited/update totals, exports safe.

### P08 — Admin and activity

Depends P07; audit writes start P02. Files: admin APIs/UI, role/status commands, audit indexes, job controls.

1. Role/status management with last-admin safety.
2. Immediate canonical disable gate; Auth synchronization retries separately.
3. Teacher/student event filters and role-at-event.
4. Saved answer/grade drill-down with admin-read audit.
5. Owner content filters, failed-job views and safe retry.

Tests ADMIN-01–07, AUDIT-01–05. Done: nonadmins denied, revocation effective next call, concurrency safe, real timestamps/history, no full answers in global feed.

### P09 — Problem bank builder

Depends P03/P04, scheduled after core reports/admin.

Files: bank/edit pages, problem listing/filter/pagination, selection/editor integration.

1. Mine/Shared/Trash and accurate filters.
2. Math/key preview for staff.
3. Retain selected versions/order across pages.
4. Create private quiz with per-slot points.
5. Explicit revision update/fork.
6. Server rechecks rights if source unshared after selection.

Tests BANK-01–06 and PROBLEM-05. Done: select existing problems -> working quiz without altering originals; old snapshots survive unsharing; new unauthorized use fails clearly.

### P10 — Bright design/CSS and polish

Depends working pages P01–09. Files: assets/css, components/page renderers.

1. Extract shared foundations/components/page sheets in fixed order.
2. Bright palette/compact hierarchy everywhere.
3. Remove duplicate/static inline styles.
4. Appearance preferences before paint where practical.
5. Import errors, previews, save states, images, timer, reports polish.
6. Keyboard/contrast/zoom/mobile/motion checks.

Tests UI-01–09. Done: specified widths/no global overflow, roles clean, functional Home, readable math/images, consistent themes. Do not casually change grading in CSS work.

### P11 — Migration/cutover preparation

Depends P01–10. Files: migration script/legacy reader/build docs.

1. Dry-run/resume/hashes/protected backups.
2. Cloud/result/device fixture conversion.
3. Compare IDs/ownership/points/keys/images; report unresolved records.
4. Document coordinated freeze/migrate/rules/frontend.
5. Remove normal local/GitHub fallback only after verified conversion.
6. Keep migration readers explicit, protect source until verified.
7. Rollback must retain subsequent v2 activity.

Tests MIGRATE-01–08, COMPAT-01–04, PACK-02. Done: repeatable migration, old links, no silent data loss, legacy provenance, no device-library UI.

Production application remains a separately owner-authorized operation; completing tooling is not proof production was migrated.

### P12 — Final verification and handoff

Depends P00–11. Files: tests, README/FIREBASE-SETUP/OPERATIONS, Firebase/build config.

1. Run unit/backend/rules/integration/browser/migration suites.
2. Real emulator SDK authorization, not only service mocks.
3. Inspect static artifacts for secrets/legacy keys/missing routes.
4. Verify IAM/signing/CORS/Google login in supplied test project.
5. Document billing/limits/bootstrap/backups/job recovery.
6. Prove main/root Pages and repository-prefix routes.
7. Produce release checklist/test evidence/known blockers/rollback.

Done only when requirements map to actual code/evidence. Mark unavailable cloud smoke checks Blocked, not Passed. No automatic production deploy from this specification.

## 19. Required acceptance scenarios

These are planned tests, not tests claimed to have run. Parameterized suites may cover several IDs, but progress must map every ID to evidence. Use actual emulator SDK/API requests for security, mocks only for isolated logic/failure injection.

### Identity, policy, API

| ID | Expected scenario |
|---|---|
| AUTH-01 | Delayed persisted Auth restoration shows profile loading; no login flash |
| AUTH-02 | Signed-out profile -> one login -> intended destination |
| AUTH-03 | Signed-in login visit replaces route without redirect loop |
| AUTH-04 | External/javascript/protocol-relative/sibling-repo return URLs rejected |
| AUTH-05 | A's pending private response never renders after switch to B |
| AUTH-06 | Student lacks guide/staff links/routes; teacher gets permitted tools |
| AUTH-07 | Network/role error never becomes false signed-out proof |
| AUTH-08 | Existing-token role revoke/disable blocks next privileged call |
| POLICY-01 | B cannot edit/publish/delete/approve A's quiz through direct API |
| POLICY-02 | Student cannot self-promote via profile/direct writes |
| POLICY-03 | Unverified staff cannot upload; unverified learners cannot start/request |
| POLICY-04 | Current admin management allowed; guessed IDs do not help teacher |
| POLICY-05 | Teacher taking B's quiz follows admission; preview creates no attempt |
| API-01 | Repeated request ID/input creates one resource/event |
| API-02 | Reused request ID/different input fails without overwrite |
| API-03 | Stale version conflicts preserve latest data |
| API-04 | Spoofed authority fields/malformed filters rejected |

### Problems, files and rules

| ID | Expected scenario |
|---|---|
| PROBLEM-01 | New save creates immutable revision, preserves original |
| PROBLEM-02 | B cannot read A's private bank |
| PROBLEM-03 | B can use shared original but cannot edit it |
| PROBLEM-04 | Fork creates owned copy with attribution/valid refs |
| PROBLEM-05 | Unsharing preserves published snapshots; denies new unauthorized selection |
| PROBLEM-06 | Bad keys/IDs/oversize/unsafe markup yield useful validation |
| ASSET-01 | Image produces separate object/metadata, no embedded base64 |
| ASSET-02 | Wrong owner/expired/type/size/signature rejected |
| ASSET-03 | Student/revoked staff cannot stage guessed uploads |
| ASSET-04 | Arbitrary other-context/source link request denied |
| ASSET-05 | Pending cannot get images; active gets question not solution assets |
| ASSET-06 | Finalization retry does not duplicate object/quota/event |
| ASSET-07 | Cleanup/new-reference race cannot delete retained asset |
| ASSET-08 | Expired link refresh reauthorizes; real signing verifies bounded expiry |
| RULES-01 | Direct writes to roles/quizzes/scores/participants/audit denied |
| RULES-02 | Direct reads of keys/raw attempts/history/source denied |
| RULES-03 | Public catalog works; private records never projected there |
| RULES-04 | Staging rules reject overwrite/list/final reads/unverified/disabled |

### Quiz/import/jobs

| ID | Expected scenario |
|---|---|
| QUIZ-01 | New private approval draft absent from public catalog |
| QUIZ-02 | Update keeps ID/deep link |
| QUIZ-03 | Duplicate is new owned private quiz |
| QUIZ-04 | Private/open invalid; three valid combinations work |
| QUIZ-05 | Complete snapshot then atomic pointer/catalog change |
| QUIZ-06 | Mid-publication failure/missing image preserves old live version |
| QUIZ-07 | Source change does not mutate old publication/attempt |
| QUIZ-08 | Trash/unpublish blocks starts, retains active/history |
| QUIZ-09 | Restore private; hard delete rejects retained refs |
| IMPORT-01 | Existing formats/math/comments/references retain meaningful output |
| IMPORT-02 | Error identifies problem/field; no silent truncation |
| IMPORT-03 | Partial import retry uses stable mappings, no duplicates |
| IMPORT-04 | v1 images separated; original points/options/keys preserved |
| JOB-01 | Duplicate/reordered trigger creates one final result/event |
| JOB-02 | Expired crashed worker lease resumes safely |
| JOB-03 | Revoked actor/trashed quiz cannot finalize publication |

### Admission

| ID | Expected scenario |
|---|---|
| ACCESS-01 | Guest overview allowed; questions require eligible attempt |
| ACCESS-02 | Private without grant/token unavailable/unlisted |
| ACCESS-03 | Request token exposes only minimal application |
| ACCESS-04 | Repeated request creates one pending record/notification |
| ACCESS-05 | Approve targeted quiz only; decline/revoke blocks starts |
| ACCESS-06 | Individual deny overrides open mode |
| ACCESS-07 | Revoked participant's existing attempt can finish; no new start |
| ACCESS-08 | Explicit termination freezes saves/reads, retains history |
| ACCESS-09 | Expired/forged/cross-owner/broad-lookup bypasses fail |

### Attempts/grading/release

| ID | Expected scenario |
|---|---|
| ATTEMPT-01 | Concurrent starts allocate/count once |
| ATTEMPT-02 | Window/approval/allowance enforced in allocation transaction |
| ATTEMPT-03 | Resume retains version/order/deadline |
| ATTEMPT-04 | Device clock/client duration cannot extend backend time |
| ATTEMPT-05 | At/after deadline save fails; last confirmed values graded |
| ATTEMPT-06 | Save/submit race has no post-freeze mutation |
| ATTEMPT-07 | Duplicate submit returns same result/job |
| ATTEMPT-08 | Two-tab stale answer cannot overwrite silently |
| ATTEMPT-09 | Unchanged save adds no history; real change has server time |
| ATTEMPT-10 | Invalid option/oversize/foreign item rejected |
| ATTEMPT-11 | No-back policy enforced in API, not only buttons |
| ATTEMPT-12 | New publication leaves active attempt content/key pinned |
| GRADE-01 | Existing arithmetic/tolerance regression suite works server-side |
| GRADE-02 | Fixture totals 1/10 with correct pending counts |
| GRADE-03 | Client score/self-marking fields ignored by rejection |
| GRADE-04 | Partial worker output not final; retries complete once |
| GRADE-05 | Penalties/clamp/skipped/pending/all-skipped consistent |
| GRADE-06 | Teacher 3-point manual mark gives4/10; correction audited; B denied |
| RELEASE-01 | Immediate score after grading, pending marked provisional |
| RELEASE-02 | afterClose valid only with time, hidden beforehand |
| RELEASE-03 | Manual release affects targeted attempts only |
| RELEASE-04 | Never-release solution absent from DTO/export/asset URL |
| RELEASE-05 | Other student cannot read guessed result/history |
| RELEASE-06 | Retry subset server-derived/allowance-checked/separately labeled |
| RECOVERY-01 | Recovery UID/attempt scoped, clears/expires, never late/stale replay |

### Reports/admin/audit

| ID | Expected scenario |
|---|---|
| REPORT-01 | A sees/exports only A-owned quiz attempts |
| REPORT-02 | Filter manipulation cannot include B/private unrelated users |
| REPORT-03 | Saved active answers labeled in progress, not final |
| REPORT-04 | Stats revision-aware, exclude pending/terminated/abandoned averages |
| REPORT-05 | Corrections update totals without double counting |
| REPORT-06 | Spreadsheet formula-like CSV cells escaped |
| REPORT-07 | Pagination/export covers authorized rows with count/asOf |
| ADMIN-01 | Nonadmins denied role/activity/job APIs |
| ADMIN-02 | Role grant/demotion uses canonical state |
| ADMIN-03 | Concurrent last-admin removal leaves one active |
| ADMIN-04 | Disable effective with existing token; reenable appropriate |
| ADMIN-05 | Filters show real actor/resource/role-at-event |
| ADMIN-06 | Admin answer detail works and is audited |
| ADMIN-07 | Job retry cannot change actor/target/arbitrary work |
| AUDIT-01 | Command retry emits one linked business event |
| AUDIT-02 | Server timestamps, clients cannot forge/edit logs |
| AUDIT-03 | General feed has no answers/tokens/signed URLs |
| AUDIT-04 | New role does not rewrite historical role |
| AUDIT-05 | Missing legacy history labeled, not fabricated |

### Bank/UI/migration/package

| ID | Expected scenario |
|---|---|
| BANK-01 | Cross-page selection creates ordered/versioned/pointed slots |
| BANK-02 | Shared source read-only; edit offers fork |
| BANK-03 | Unshare after selection fails save clearly |
| BANK-04 | Source-version update explicit, new quiz publication |
| BANK-05 | Same problem twice has distinct IDs/answers/grades |
| BANK-06 | Shared single problem does not expose full original source |
| UI-01 | Root/repository-prefix routes and role nav work |
| UI-02 | Widths360/390/768/1280 and zoom no document overflow |
| UI-03 | Math/images locally scroll/scale/zoom legibly |
| UI-04 | Keyboard/dialog focus/labels work |
| UI-05 | Loading/empty/error/denied/unconfirmed states distinct |
| UI-06 | Malicious HTML/math URL/style code cannot execute |
| UI-07 | Bright contrast/theme/text preferences persist |
| UI-08 | Useful timer announcements/motion/touch handling |
| UI-09 | Guide/author tools staff-only without redundant login |
| MIGRATE-01 | Dry run reports without writes |
| MIGRATE-02 | IDs/owners/metadata/points/math preserved |
| MIGRATE-03 | Asset extraction preserves question/solution placement |
| MIGRATE-04 | Resume idempotent; changed source detected |
| MIGRATE-05 | Bad/missing owner reported, never guessed |
| MIGRATE-06 | Legacy provenance/omissions, no fabricated snapshot/history |
| MIGRATE-07 | Device selection/owner correct; source kept until verified |
| MIGRATE-08 | Failed run preserves source/rollback mapping |
| COMPAT-01 | Old cloud deep links resolve |
| COMPAT-02 | Old LaTeX/v1 JSON imports supported |
| COMPAT-03 | Settings/login/profile bookmarks redirect safely |
| COMPAT-04 | No normal device/GitHub fallback or false saved state |
| PACK-01 | Functions mirror packaged; mismatch fails check |
| PACK-02 | Static bundle has routes/assets, no credentials/test data/legacy keys |

### Full manual walkthrough

Admin grants A teacher. A uploads image/problem, imports LaTeX, publishes private quiz. Student applies, cannot fetch questions, gets approved, starts/saves/reloads. A publishes revision2; active student keeps revision1. Student submits, A reviews change times/marks proof, student gets released result. B/other student cannot fetch it. Admin sees real activity. B builds quiz from shared problem without editing A. A revokes participant, trashes/restores quiz, history persists. Repeat on390px and /sat-quiz/.

## 20. Deployment, operations and rollback

Owner supplies real project/config and chooses production target. Required: Auth/Firestore/Storage/Functions. Storage requires Blaze billing; no-cost allowances exist but zero cost is not guaranteed. Application quotas/concurrency and budget alerts are separate; alerts are not hard caps.

Use explicit least-necessary backend identity/permissions for database/bucket/signing. Never fix signing by making bucket public.

After tests and explicit project selection:

~~~sh
npm ci
npm --prefix functions ci
npm run prepare:backend
npm test
npm run test:backend
npm run test:rules
npm run test:integration
npm run test:e2e
npm run verify:static
npx firebase deploy --project PROJECT_ID --only firestore:rules,firestore:indexes,storage,functions
~~~

PROJECT_ID is a deliberate placeholder. Commands must match actual pinned CLI/scripts. Runtime nodejs22/package engine22; verify support when implementing. This is independent of old Actions Node warnings.

Bootstrap initial admin via explicit project/UID/dry-run/apply tool, maintaining counter. Then use admin commands, not ad-hoc role edits.

Configure Google/email providers/authorized hostname and necessary Storage origins. No visitor connection wizard.

Frontend stays main/root, .nojekyll, relative paths. Optional dist packaging only public runtime files. Unsupported API version shows update/unavailable, never insecure fallback.

Operations: failed-job view, safe retry, structured logs, upload usage, documented backup/restore, expiry sweep, timeout sweep, tested dependency/runtime versions.

Retain versions/history by default. Automatic destructive retention requires separate policy.

Rollback prefers previous working v2 code with v2 data retained. After new attempts exist, old v1 frontend is not safe rollback. Pause starts/publications if needed. Protected migration backups remain. Rollback removal only touches unreferenced failed-run artifacts, never subsequent user activity.

## 21. Requirements traceability

| Requirement | Phases | Evidence |
|---|---|---|
| REQ-01 No sign-in flash/direct profile | P01 | AUTH01–07 |
| REQ-02 Separate Home/catalog | P01/P10 | UI01/manual all roles |
| REQ-03 Staff guide | P01/P10 | AUTH06/UI09 |
| REQ-04 Firebase-only normal data | P04/P11 | COMPAT04/MIGRATE07 |
| REQ-05 Separate images | P03/P11 | ASSET/MIGRATE03 |
| REQ-06 Owned private/public management | P04/P05 | POLICY01/QUIZ |
| REQ-07 Stable links/drafts/versions | P04/P06 | QUIZ02/05/06/07/ATTEMPT12 |
| REQ-08 Admission/application | P05 | ACCESS |
| REQ-09 Teacher reports/answers | P07 | REPORT |
| REQ-10 Trusted time/grading/release | P06/P07 | ATTEMPT/GRADE/RELEASE |
| REQ-11 Admin staff/student activity | P08 | ADMIN/AUDIT |
| REQ-12 Saved changes/times | P06/P08 | ATTEMPT08/09/AUDIT |
| REQ-13 Reusable independent problems | P03/P09 | PROBLEM/BANK |
| REQ-14 Bright mobile design | P10 | UI02–08/screenshots |
| REQ-15 Modular CSS/code | P02/P10 | Imports/PACK01/CSS audit |
| REQ-16 Migration/deep links | P11 | MIGRATE/COMPAT |
| REQ-17 Branch Pages deployment | P12 | Root/prefix/PACK02 |
| REQ-18 Preserve LaTeX/math features | P02/P04/P10 | Baseline/IMPORT01/UI03/06 |
| REQ-19 Future AI import compatibility | P02/P04 | Shared import contracts; AI not implemented |

## 22. Progress record and handoff

Create docs/IMPLEMENTATION_PROGRESS.md:

~~~markdown
# Implementation progress

## Baseline
- Actual commit/branch:
- Differences from v4:
- Existing tests/build:
- Config present yes/no (no values):

## Phases
- [ ] P00 Reconcile
- [ ] P01 Auth/routes
- [ ] P02 Backend/shared
- [ ] P03 Problems/assets
- [ ] P04 Quiz/import/publication
- [ ] P05 Admission
- [ ] P06 Attempts/grading
- [ ] P07 Reports/release
- [ ] P08 Admin/activity
- [ ] P09 Bank builder
- [ ] P10 Design/CSS
- [ ] P11 Migration
- [ ] P12 Verification/handoff

## Current phase
- Goal:
- Files changed:
- Behavior working:
- Test IDs -> files/evidence:
- Commands/results:
- Routes/screens checked:
- Failures/blockers:
- Real data/deployment changes:
- Next authorized phase:

## Decisions changed
- Date/requirement/old/new/reason/owner instruction:
~~~

Phase handoff reports concrete behavior, files/why, test commands/outcomes, genuine limits and next phase. Distinguish mocks/emulators/real cloud. Do not mark complete with fake data, loose rules, missing backend, client authority or manual console work for ordinary teacher operations.

## 23. Copy-paste prompts for Copilot

### Start with repository reconciliation

~~~text
Read docs/COPILOT_IMPLEMENTATION_PLAN.md and inspect the actual repository.
Implement P00 only. Compare with section1, run existing tests/build,
preserve my working changes and Firebase configuration, and create
docs/IMPLEMENTATION_PROGRESS.md using section22.
Do not rewrite the app, deploy, change production data/rules or start later
phases. Report concrete differences and exact P01 files/tests.
~~~

### Implement one authorized phase

~~~text
Implement P01 from docs/COPILOT_IMPLEMENTATION_PLAN.md.
Read its task card and referenced schema/policy/API/UI/tests, plus current
IMPLEMENTATION_PROGRESS.md. Inspect actual code and preserve working config.
Complete the phase end to end: code, relevant tests, route/mobile checks
and progress notes. Use specified defaults for routine decisions.
Do not use fake backend success or weaken permissions to pass tests.
Report behavior, files, commands/results and real blockers.
Stop after P01. Do not start P02 or deploy until instructed.
~~~

Replace P01 with the intended phase. Several phases may run only when authorized, in dependency order with separate evidence.

### Resume after context loss

~~~text
Read specification sections1,2,8 and current phase card; read progress
and inspect git diff. Continue authorized work from actual state.
Verify completed code rather than previous assistant claims.
Do not recreate modules or repeat migrations. Finish current acceptance
tests, update progress and stop at its boundary.
~~~

### If Copilot calls it abstract

~~~text
Identify the exact missing contract by section/field/endpoint/test ID.
Check section6 schema, section9 API, section8 policy, sections10–11
algorithms and section19 acceptance tests first. Implement specified details.
For routine code organization choose a small consistent solution and record it.
For a truly missing product decision, state the smallest question and continue
independent work. Do not return another generic architecture proposal.
~~~

### Review completion

~~~text
Review actual diff/tests against this phase and every referenced test ID.
Check unauthorized reads, forged authority, leaked keys, stale-session
responses, duplicate actions, broken version references, unconfirmed saves,
incomplete migrations and mobile regressions.
Fix authorized defects, record evidence, and do not declare done on UI alone.
~~~

## 24. Official references and limitations

References support platform facts; product defaults are choices in this plan. Verify/pin current compatible SDK/runtime versions during implementation.

| Reference | URL |
|---|---|
| Functions runtimes | https://firebase.google.com/docs/functions/manage-functions |
| Callable protocol | https://firebase.google.com/docs/functions/callable |
| Field/document read rules | https://firebase.google.com/docs/firestore/security/rules-fields |
| Authorized queries | https://firebase.google.com/docs/firestore/security/rules-query |
| Atomic DB writes | https://firebase.google.com/docs/firestore/manage-data/transactions |
| Firestore limits/budgets | https://firebase.google.com/docs/firestore/quotas |
| Storage rule constraints | https://firebase.google.com/docs/storage/security/rules-conditions |
| Signed URLs | https://docs.cloud.google.com/storage/docs/access-control/signed-urls |
| Trigger duplication/order | https://firebase.google.com/docs/functions/firestore-events |
| Deletion/retention | https://firebase.google.com/docs/firestore/manage-data/delete-data |
| Emulator configuration | https://firebase.google.com/docs/emulator-suite/install_and_configure |
| Storage billing requirement | https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024 |
| Contrast | https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum |
| Google sign-in | https://firebase.google.com/docs/auth/web/google-signin |

Explicit boundaries:

- Actual live GitHub repo was not inspected; start by reconciling newer changes.
- Existing math evaluator is bounded numeric/text matching, not symbolic proof.
- Short-lived URLs remain bearer links until expiry; downloaded bytes cannot be recalled.
- Emulator tests do not prove production OAuth domains/IAM/signing/billing.
- Legacy client scores cannot be retroactively certified or missing history reconstructed.
- Public source/static files cannot hide embedded keys/secrets.
- Writing this plan did not implement changes, deploy, migrate data or enable billing.



