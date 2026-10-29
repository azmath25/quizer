# Acceptance coverage

This tracks every scenario ID from the original implementation plan. It does **not** claim that all 133 scenarios have been exhaustively tested. “Automated coverage” identifies targeted assertions; it is not a guarantee against all race/network combinations. “Implemented; further verification” means the code path exists, with the remaining focused scenario/manual check still required. Production IAM/OAuth and signed-URL expiry need the owner’s real Firebase project.

Test paths below omit the `tests/` prefix where unambiguous. The emulator suite exercises actual Firebase services; only the separate visual preview uses captured demo responses.

| ID | Requirement | Verification | Code / evidence |
| --- | --- | --- | --- |
| AUTH-01 | Delayed persisted Auth restoration shows profile loading; no login flash | Implemented; further verification | js/firebase-client.js; js/app.js; js/core/navigation.js; integration/core; transport/callable |
| AUTH-02 | Signed-out profile -> one login -> intended destination | Implemented; further verification | js/firebase-client.js; js/app.js; js/core/navigation.js; integration/core; transport/callable |
| AUTH-03 | Signed-in login visit replaces route without redirect loop | Implemented; further verification | js/firebase-client.js; js/app.js; js/core/navigation.js; integration/core; transport/callable |
| AUTH-04 | External/javascript/protocol-relative/sibling-repo return URLs rejected | Automated coverage | js/firebase-client.js; js/app.js; js/core/navigation.js; integration/core; transport/callable |
| AUTH-05 | A's pending private response never renders after switch to B | Implemented; further verification | js/firebase-client.js; js/app.js; js/core/navigation.js; integration/core; transport/callable |
| AUTH-06 | Student lacks guide/staff links/routes; teacher gets permitted tools | Implemented; further verification | js/firebase-client.js; js/app.js; js/core/navigation.js; integration/core; transport/callable |
| AUTH-07 | Network/role error never becomes false signed-out proof | Implemented; further verification | js/firebase-client.js; js/app.js; js/core/navigation.js; integration/core; transport/callable |
| AUTH-08 | Existing-token role revoke/disable blocks next privileged call | Automated coverage | js/firebase-client.js; js/app.js; js/core/navigation.js; integration/core; transport/callable |
| POLICY-01 | B cannot edit/publish/delete/approve A's quiz through direct API | Automated coverage | functions/src/domain/runtime.js; functions/src/api/; integration/core; rules/security |
| POLICY-02 | Student cannot self-promote via profile/direct writes | Automated coverage | functions/src/domain/runtime.js; functions/src/api/; integration/core; rules/security |
| POLICY-03 | Unverified staff cannot upload; unverified learners cannot start/request | Automated coverage | functions/src/domain/runtime.js; functions/src/api/; integration/core; rules/security |
| POLICY-04 | Current admin management allowed; guessed IDs do not help teacher | Implemented; further verification | functions/src/domain/runtime.js; functions/src/api/; integration/core; rules/security |
| POLICY-05 | Teacher taking B's quiz follows admission; preview creates no attempt | Implemented; further verification | functions/src/domain/runtime.js; functions/src/api/; integration/core; rules/security |
| API-01 | Repeated request ID/input creates one resource/event | Automated coverage | functions/src/domain/runtime.js; shared/schema.js; integration/core; unit/contracts |
| API-02 | Reused request ID/different input fails without overwrite | Automated coverage | functions/src/domain/runtime.js; shared/schema.js; integration/core; unit/contracts |
| API-03 | Stale version conflicts preserve latest data | Automated coverage | functions/src/domain/runtime.js; shared/schema.js; integration/core; unit/contracts |
| API-04 | Spoofed authority fields/malformed filters rejected | Automated coverage | functions/src/domain/runtime.js; shared/schema.js; integration/core; unit/contracts |
| PROBLEM-01 | New save creates immutable revision, preserves original | Automated coverage | functions/src/api/problems.js; integration/core; integration/extended; unit/contracts |
| PROBLEM-02 | B cannot read A's private bank | Automated coverage | functions/src/api/problems.js; integration/core; integration/extended; unit/contracts |
| PROBLEM-03 | B can use shared original but cannot edit it | Automated coverage | functions/src/api/problems.js; integration/core; integration/extended; unit/contracts |
| PROBLEM-04 | Fork creates owned copy with attribution/valid refs | Implemented; further verification | functions/src/api/problems.js; integration/core; integration/extended; unit/contracts |
| PROBLEM-05 | Unsharing preserves published snapshots; denies new unauthorized selection | Automated coverage | functions/src/api/problems.js; integration/core; integration/extended; unit/contracts |
| PROBLEM-06 | Bad keys/IDs/oversize/unsafe markup yield useful validation | Automated coverage | functions/src/api/problems.js; integration/core; integration/extended; unit/contracts |
| ASSET-01 | Image produces separate object/metadata, no embedded base64 | Automated coverage | functions/src/api/assets.js; domain/assets.js; jobs/worker.js; integration/extended; rules/security |
| ASSET-02 | Wrong owner/expired/type/size/signature rejected | Implemented; further verification | functions/src/api/assets.js; domain/assets.js; jobs/worker.js; integration/extended; rules/security |
| ASSET-03 | Student/revoked staff cannot stage guessed uploads | Implemented; further verification | functions/src/api/assets.js; domain/assets.js; jobs/worker.js; integration/extended; rules/security |
| ASSET-04 | Arbitrary other-context/source link request denied | Implemented; further verification | functions/src/api/assets.js; domain/assets.js; jobs/worker.js; integration/extended; rules/security |
| ASSET-05 | Pending cannot get images; active gets question not solution assets | Implemented; further verification | functions/src/api/assets.js; domain/assets.js; jobs/worker.js; integration/extended; rules/security |
| ASSET-06 | Finalization retry does not duplicate object/quota/event | Automated coverage | functions/src/api/assets.js; domain/assets.js; jobs/worker.js; integration/extended; rules/security |
| ASSET-07 | Cleanup/new-reference race cannot delete retained asset | Implemented; further verification | functions/src/api/assets.js; domain/assets.js; jobs/worker.js; integration/extended; rules/security |
| ASSET-08 | Expired link refresh reauthorizes; real signing verifies bounded expiry | Production signing/expiry check pending | functions/src/api/assets.js; domain/assets.js; jobs/worker.js; integration/extended; rules/security |
| RULES-01 | Direct writes to roles/quizzes/scores/participants/audit denied | Automated coverage | firebase/firestore.rules; firebase/storage.rules; tests/rules/security.test.mjs |
| RULES-02 | Direct reads of keys/raw attempts/history/source denied | Automated coverage | firebase/firestore.rules; firebase/storage.rules; tests/rules/security.test.mjs |
| RULES-03 | Public catalog works; private records never projected there | Automated coverage | firebase/firestore.rules; firebase/storage.rules; tests/rules/security.test.mjs |
| RULES-04 | Staging rules reject overwrite/list/final reads/unverified/disabled | Automated coverage | firebase/firestore.rules; firebase/storage.rules; tests/rules/security.test.mjs |
| QUIZ-01 | New private approval draft absent from public catalog | Automated coverage | functions/src/api/quizzes.js; jobs/worker.js; integration/core; integration/extended; integration/import |
| QUIZ-02 | Update keeps ID/deep link | Implemented; further verification | functions/src/api/quizzes.js; jobs/worker.js; integration/core; integration/extended; integration/import |
| QUIZ-03 | Duplicate is new owned private quiz | Automated coverage | functions/src/api/quizzes.js; jobs/worker.js; integration/core; integration/extended; integration/import |
| QUIZ-04 | Private/open invalid; three valid combinations work | Implemented; further verification | functions/src/api/quizzes.js; jobs/worker.js; integration/core; integration/extended; integration/import |
| QUIZ-05 | Complete snapshot then atomic pointer/catalog change | Automated coverage | functions/src/api/quizzes.js; jobs/worker.js; integration/core; integration/extended; integration/import |
| QUIZ-06 | Mid-publication failure/missing image preserves old live version | Implemented; further verification | functions/src/api/quizzes.js; jobs/worker.js; integration/core; integration/extended; integration/import |
| QUIZ-07 | Source change does not mutate old publication/attempt | Automated coverage | functions/src/api/quizzes.js; jobs/worker.js; integration/core; integration/extended; integration/import |
| QUIZ-08 | Trash/unpublish blocks starts, retains active/history | Automated coverage | functions/src/api/quizzes.js; jobs/worker.js; integration/core; integration/extended; integration/import |
| QUIZ-09 | Restore private; hard delete rejects retained refs | Automated coverage | functions/src/api/quizzes.js; jobs/worker.js; integration/core; integration/extended; integration/import |
| IMPORT-01 | Existing formats/math/comments/references retain meaningful output | Automated coverage | shared/latex-parser.js; js/pages/quiz-editor.js; functions/src/api/quizzes.js; tests/domain; integration/import; integration/migration |
| IMPORT-02 | Error identifies problem/field; no silent truncation | Automated coverage | shared/latex-parser.js; js/pages/quiz-editor.js; functions/src/api/quizzes.js; tests/domain; integration/import; integration/migration |
| IMPORT-03 | Partial import retry uses stable mappings, no duplicates | Automated coverage | shared/latex-parser.js; js/pages/quiz-editor.js; functions/src/api/quizzes.js; tests/domain; integration/import; integration/migration |
| IMPORT-04 | v1 images separated; original points/options/keys preserved | Automated coverage | shared/latex-parser.js; js/pages/quiz-editor.js; functions/src/api/quizzes.js; tests/domain; integration/import; integration/migration |
| JOB-01 | Duplicate/reordered trigger creates one final result/event | Implemented; further verification | functions/src/jobs/worker.js; jobs/sweeper.js; integration/extended; transport/callable |
| JOB-02 | Expired crashed worker lease resumes safely | Implemented; further verification | functions/src/jobs/worker.js; jobs/sweeper.js; integration/extended; transport/callable |
| JOB-03 | Revoked actor/trashed quiz cannot finalize publication | Implemented; further verification | functions/src/jobs/worker.js; jobs/sweeper.js; integration/extended; transport/callable |
| ACCESS-01 | Guest overview allowed; questions require eligible attempt | Automated coverage | functions/src/api/access.js; domain/runtime.js; integration/core; integration/extended |
| ACCESS-02 | Private without grant/token unavailable/unlisted | Automated coverage | functions/src/api/access.js; domain/runtime.js; integration/core; integration/extended |
| ACCESS-03 | Request token exposes only minimal application | Automated coverage | functions/src/api/access.js; domain/runtime.js; integration/core; integration/extended |
| ACCESS-04 | Repeated request creates one pending record/notification | Implemented; further verification | functions/src/api/access.js; domain/runtime.js; integration/core; integration/extended |
| ACCESS-05 | Approve targeted quiz only; decline/revoke blocks starts | Automated coverage | functions/src/api/access.js; domain/runtime.js; integration/core; integration/extended |
| ACCESS-06 | Individual deny overrides open mode | Automated coverage | functions/src/api/access.js; domain/runtime.js; integration/core; integration/extended |
| ACCESS-07 | Revoked participant's existing attempt can finish; no new start | Automated coverage | functions/src/api/access.js; domain/runtime.js; integration/core; integration/extended |
| ACCESS-08 | Explicit termination freezes saves/reads, retains history | Implemented; further verification | functions/src/api/access.js; domain/runtime.js; integration/core; integration/extended |
| ACCESS-09 | Expired/forged/cross-owner/broad-lookup bypasses fail | Implemented; further verification | functions/src/api/access.js; domain/runtime.js; integration/core; integration/extended |
| ATTEMPT-01 | Concurrent starts allocate/count once | Automated coverage | functions/src/api/attempts.js; js/pages/quiz.js; integration/core; integration/extended |
| ATTEMPT-02 | Window/approval/allowance enforced in allocation transaction | Implemented; further verification | functions/src/api/attempts.js; js/pages/quiz.js; integration/core; integration/extended |
| ATTEMPT-03 | Resume retains version/order/deadline | Automated coverage | functions/src/api/attempts.js; js/pages/quiz.js; integration/core; integration/extended |
| ATTEMPT-04 | Device clock/client duration cannot extend backend time | Automated coverage | functions/src/api/attempts.js; js/pages/quiz.js; integration/core; integration/extended |
| ATTEMPT-05 | At/after deadline save fails; last confirmed values graded | Automated coverage | functions/src/api/attempts.js; js/pages/quiz.js; integration/core; integration/extended |
| ATTEMPT-06 | Save/submit race has no post-freeze mutation | Implemented; further verification | functions/src/api/attempts.js; js/pages/quiz.js; integration/core; integration/extended |
| ATTEMPT-07 | Duplicate submit returns same result/job | Automated coverage | functions/src/api/attempts.js; js/pages/quiz.js; integration/core; integration/extended |
| ATTEMPT-08 | Two-tab stale answer cannot overwrite silently | Automated coverage | functions/src/api/attempts.js; js/pages/quiz.js; integration/core; integration/extended |
| ATTEMPT-09 | Unchanged save adds no history; real change has server time | Automated coverage | functions/src/api/attempts.js; js/pages/quiz.js; integration/core; integration/extended |
| ATTEMPT-10 | Invalid option/oversize/foreign item rejected | Automated coverage | functions/src/api/attempts.js; js/pages/quiz.js; integration/core; integration/extended |
| ATTEMPT-11 | No-back policy enforced in API, not only buttons | Automated coverage | functions/src/api/attempts.js; js/pages/quiz.js; integration/core; integration/extended |
| ATTEMPT-12 | New publication leaves active attempt content/key pinned | Automated coverage | functions/src/api/attempts.js; js/pages/quiz.js; integration/core; integration/extended |
| GRADE-01 | Existing arithmetic/tolerance regression suite works server-side | Automated coverage | shared/grading.js; functions/src/jobs/worker.js; api/reports.js; tests/domain; integration/core |
| GRADE-02 | Fixture totals 1/10 with correct pending counts | Automated coverage | shared/grading.js; functions/src/jobs/worker.js; api/reports.js; tests/domain; integration/core |
| GRADE-03 | Client score/self-marking fields ignored by rejection | Automated coverage | shared/grading.js; functions/src/jobs/worker.js; api/reports.js; tests/domain; integration/core |
| GRADE-04 | Partial worker output not final; retries complete once | Implemented; further verification | shared/grading.js; functions/src/jobs/worker.js; api/reports.js; tests/domain; integration/core |
| GRADE-05 | Penalties/clamp/skipped/pending/all-skipped consistent | Automated coverage | shared/grading.js; functions/src/jobs/worker.js; api/reports.js; tests/domain; integration/core |
| GRADE-06 | Teacher 3-point manual mark gives4/10; correction audited; B denied | Automated coverage | shared/grading.js; functions/src/jobs/worker.js; api/reports.js; tests/domain; integration/core |
| RELEASE-01 | Immediate score after grading, pending marked provisional | Automated coverage | functions/src/domain/runtime.js; api/reports.js; api/assets.js; functions/test/policy; integration/core; integration/extended |
| RELEASE-02 | afterClose valid only with time, hidden beforehand | Implemented; further verification | functions/src/domain/runtime.js; api/reports.js; api/assets.js; functions/test/policy; integration/core; integration/extended |
| RELEASE-03 | Manual release affects targeted attempts only | Implemented; further verification | functions/src/domain/runtime.js; api/reports.js; api/assets.js; functions/test/policy; integration/core; integration/extended |
| RELEASE-04 | Never-release solution absent from DTO/export/asset URL | Implemented; further verification | functions/src/domain/runtime.js; api/reports.js; api/assets.js; functions/test/policy; integration/core; integration/extended |
| RELEASE-05 | Other student cannot read guessed result/history | Implemented; further verification | functions/src/domain/runtime.js; api/reports.js; api/assets.js; functions/test/policy; integration/core; integration/extended |
| RELEASE-06 | Retry subset server-derived/allowance-checked/separately labeled | Implemented; further verification | functions/src/domain/runtime.js; api/reports.js; api/assets.js; functions/test/policy; integration/core; integration/extended |
| RECOVERY-01 | Recovery UID/attempt scoped, clears/expires, never late/stale replay | Implemented; further verification | js/services/recovery.js; js/services/api.js; js/pages/quiz.js; js/firebase-client.js |
| REPORT-01 | A sees/exports only A-owned quiz attempts | Automated coverage | functions/src/api/reports.js; domain/statistics.js; jobs/worker.js; integration/core; integration/extended; unit/contracts |
| REPORT-02 | Filter manipulation cannot include B/private unrelated users | Implemented; further verification | functions/src/api/reports.js; domain/statistics.js; jobs/worker.js; integration/core; integration/extended; unit/contracts |
| REPORT-03 | Saved active answers labeled in progress, not final | Implemented; further verification | functions/src/api/reports.js; domain/statistics.js; jobs/worker.js; integration/core; integration/extended; unit/contracts |
| REPORT-04 | Stats revision-aware, exclude pending/terminated/abandoned averages | Implemented; further verification | functions/src/api/reports.js; domain/statistics.js; jobs/worker.js; integration/core; integration/extended; unit/contracts |
| REPORT-05 | Corrections update totals without double counting | Automated coverage | functions/src/api/reports.js; domain/statistics.js; jobs/worker.js; integration/core; integration/extended; unit/contracts |
| REPORT-06 | Spreadsheet formula-like CSV cells escaped | Automated coverage | functions/src/api/reports.js; domain/statistics.js; jobs/worker.js; integration/core; integration/extended; unit/contracts |
| REPORT-07 | Pagination/export covers authorized rows with count/asOf | Implemented; further verification | functions/src/api/reports.js; domain/statistics.js; jobs/worker.js; integration/core; integration/extended; unit/contracts |
| ADMIN-01 | Nonadmins denied role/activity/job APIs | Implemented; further verification | functions/src/api/accounts.js; js/pages/admin.js; integration/core; transport/callable |
| ADMIN-02 | Role grant/demotion uses canonical state | Automated coverage | functions/src/api/accounts.js; js/pages/admin.js; integration/core; transport/callable |
| ADMIN-03 | Concurrent last-admin removal leaves one active | Automated coverage | functions/src/api/accounts.js; js/pages/admin.js; integration/core; transport/callable |
| ADMIN-04 | Disable effective with existing token; reenable appropriate | Implemented; further verification | functions/src/api/accounts.js; js/pages/admin.js; integration/core; transport/callable |
| ADMIN-05 | Filters show real actor/resource/role-at-event | Implemented; further verification | functions/src/api/accounts.js; js/pages/admin.js; integration/core; transport/callable |
| ADMIN-06 | Admin answer detail works and is audited | Implemented; further verification | functions/src/api/accounts.js; js/pages/admin.js; integration/core; transport/callable |
| ADMIN-07 | Job retry cannot change actor/target/arbitrary work | Implemented; further verification | functions/src/api/accounts.js; js/pages/admin.js; integration/core; transport/callable |
| AUDIT-01 | Command retry emits one linked business event | Automated coverage | functions/src/domain/runtime.js; api/accounts.js; api/reports.js; integration/core; integration/migration |
| AUDIT-02 | Server timestamps, clients cannot forge/edit logs | Automated coverage | functions/src/domain/runtime.js; api/accounts.js; api/reports.js; integration/core; integration/migration |
| AUDIT-03 | General feed has no answers/tokens/signed URLs | Implemented; further verification | functions/src/domain/runtime.js; api/accounts.js; api/reports.js; integration/core; integration/migration |
| AUDIT-04 | New role does not rewrite historical role | Implemented; further verification | functions/src/domain/runtime.js; api/accounts.js; api/reports.js; integration/core; integration/migration |
| AUDIT-05 | Missing legacy history labeled, not fabricated | Automated coverage | functions/src/domain/runtime.js; api/accounts.js; api/reports.js; integration/core; integration/migration |
| BANK-01 | Cross-page selection creates ordered/versioned/pointed slots | Implemented; further verification | js/pages/problems.js; js/components/problem-form.js; functions/src/api/problems.js; api/quizzes.js |
| BANK-02 | Shared source read-only; edit offers fork | Implemented; further verification | js/pages/problems.js; js/components/problem-form.js; functions/src/api/problems.js; api/quizzes.js |
| BANK-03 | Unshare after selection fails save clearly | Implemented; further verification | js/pages/problems.js; js/components/problem-form.js; functions/src/api/problems.js; api/quizzes.js |
| BANK-04 | Source-version update explicit, new quiz publication | Implemented; further verification | js/pages/problems.js; js/components/problem-form.js; functions/src/api/problems.js; api/quizzes.js |
| BANK-05 | Same problem twice has distinct IDs/answers/grades | Implemented; further verification | js/pages/problems.js; js/components/problem-form.js; functions/src/api/problems.js; api/quizzes.js |
| BANK-06 | Shared single problem does not expose full original source | Implemented; further verification | js/pages/problems.js; js/components/problem-form.js; functions/src/api/problems.js; api/quizzes.js |
| UI-01 | Root/repository-prefix routes and role nav work | Implemented; further verification | assets/css/; js/components/; js/pages/; tests/unit/contracts.test.mjs; scripts/verify-static.mjs |
| UI-02 | Widths360/390/768/1280 and zoom no document overflow | Responsive CSS implemented; see VERIFICATION.md for exact viewport checks | assets/css/; js/components/; js/pages/; tests/unit/contracts.test.mjs; scripts/verify-static.mjs |
| UI-03 | Math/images locally scroll/scale/zoom legibly | Implemented; further verification | assets/css/; js/components/; js/pages/; tests/unit/contracts.test.mjs; scripts/verify-static.mjs |
| UI-04 | Keyboard/dialog focus/labels work | Implemented; further verification | assets/css/; js/components/; js/pages/; tests/unit/contracts.test.mjs; scripts/verify-static.mjs |
| UI-05 | Loading/empty/error/denied/unconfirmed states distinct | Implemented; further verification | assets/css/; js/components/; js/pages/; tests/unit/contracts.test.mjs; scripts/verify-static.mjs |
| UI-06 | Malicious HTML/math URL/style code cannot execute | Automated coverage | assets/css/; js/components/; js/pages/; tests/unit/contracts.test.mjs; scripts/verify-static.mjs |
| UI-07 | Bright contrast/theme/text preferences persist | Implemented; further verification | assets/css/; js/components/; js/pages/; tests/unit/contracts.test.mjs; scripts/verify-static.mjs |
| UI-08 | Useful timer announcements/motion/touch handling | Implemented; further verification | assets/css/; js/components/; js/pages/; tests/unit/contracts.test.mjs; scripts/verify-static.mjs |
| UI-09 | Guide/author tools staff-only without redundant login | Implemented; further verification | assets/css/; js/components/; js/pages/; tests/unit/contracts.test.mjs; scripts/verify-static.mjs |
| MIGRATE-01 | Dry run reports without writes | Automated coverage | scripts/migrate-v1.mjs; js/migration/legacy-device.js; tests/integration/migration.test.mjs |
| MIGRATE-02 | IDs/owners/metadata/points/math preserved | Automated coverage | scripts/migrate-v1.mjs; js/migration/legacy-device.js; tests/integration/migration.test.mjs |
| MIGRATE-03 | Asset extraction preserves question/solution placement | Implemented; further verification | scripts/migrate-v1.mjs; js/migration/legacy-device.js; tests/integration/migration.test.mjs |
| MIGRATE-04 | Resume idempotent; changed source detected | Implemented; further verification | scripts/migrate-v1.mjs; js/migration/legacy-device.js; tests/integration/migration.test.mjs |
| MIGRATE-05 | Bad/missing owner reported, never guessed | Implemented; further verification | scripts/migrate-v1.mjs; js/migration/legacy-device.js; tests/integration/migration.test.mjs |
| MIGRATE-06 | Legacy provenance/omissions, no fabricated snapshot/history | Automated coverage | scripts/migrate-v1.mjs; js/migration/legacy-device.js; tests/integration/migration.test.mjs |
| MIGRATE-07 | Device selection/owner correct; source kept until verified | Implemented; further verification | scripts/migrate-v1.mjs; js/migration/legacy-device.js; tests/integration/migration.test.mjs |
| MIGRATE-08 | Failed run preserves source/rollback mapping | Implemented; further verification | scripts/migrate-v1.mjs; js/migration/legacy-device.js; tests/integration/migration.test.mjs |
| COMPAT-01 | Old cloud deep links resolve | Implemented; further verification | shared/legacy-core.js; shared/latex-parser.js; js/core/navigation.js; tests/domain.test.mjs; scripts/verify-static.mjs |
| COMPAT-02 | Old LaTeX/v1 JSON imports supported | Automated coverage | shared/legacy-core.js; shared/latex-parser.js; js/core/navigation.js; tests/domain.test.mjs; scripts/verify-static.mjs |
| COMPAT-03 | Settings/login/profile bookmarks redirect safely | Implemented; further verification | shared/legacy-core.js; shared/latex-parser.js; js/core/navigation.js; tests/domain.test.mjs; scripts/verify-static.mjs |
| COMPAT-04 | No normal device/GitHub fallback or false saved state | Automated coverage | shared/legacy-core.js; shared/latex-parser.js; js/core/navigation.js; tests/domain.test.mjs; scripts/verify-static.mjs |
| PACK-01 | Functions mirror packaged; mismatch fails check | Automated coverage | scripts/build.mjs; scripts/sync-functions-shared.mjs; scripts/verify-static.mjs |
| PACK-02 | Static bundle has routes/assets, no credentials/test data/legacy keys | Automated coverage | scripts/build.mjs; scripts/sync-functions-shared.mjs; scripts/verify-static.mjs |
