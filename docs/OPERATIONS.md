# Operations

## Production smoke test

Use a teacher and a separate student account on the actual GitHub Pages hostname.

1. Sign in with Google and email/password. Reload Profile: it should remain Profile, with no extra sign-in visit.
2. Import `examples/starter.tex` with `examples/triangle.png`. Inspect MathJax, options, answer keys and the image in preview. Save the private draft. Confirm the image is a separate Storage object.
3. Publish, keep the quiz private with approval access, and create an application link. The student can request access but cannot read questions or start until approved.
4. Approve the student. Start one attempt; reload and resume it. Try opening it in another tab. Conflicting saved answers must be reviewed rather than silently overwritten.
5. Submit a multiple-choice/short-answer/written-response mix. Check the auto-score and pending written work. Mark the written response; confirm totals, partial credit, release behavior and audit history.
6. Edit the source problem and republish. Confirm the old result still uses its original snapshot. Unpublish or revoke access: new attempts stop, but an already admitted active attempt remains available until its pinned deadline.
7. Start a short timed attempt, close the tab and let the deadline pass. Confirm scheduled maintenance freezes and grades the last server-saved answers.
8. Download results CSV and a quiz backup ZIP. Import the ZIP into a new private draft and check image links, problem order, points and answers.
9. In Admin, inspect teacher/student activity and change a test teacher to student. Confirm old open tabs lose access and new backend writes are denied. Verify the last active admin cannot be removed.
10. Check 360/390 px phone widths, tablet, keyboard navigation, larger text, dark theme, long formulas and an image expansion. Inspect Firebase logs for unexpected errors.

## Jobs and recovery

Publication, image finalization, automatic grading, duplication and exports use durable `jobs/{id}` records. Workers lease jobs transactionally, checkpoint progress and write deterministic output. A minute scheduler resumes queued jobs and expired leases. A failed publication leaves the previous ready publication available.

Teachers can inspect their quiz's processing state and retry/cancel supported failed jobs. Administrators have a Jobs screen. Resolve the root error (role, missing resource, quota, IAM) before retry. A retry uses the same job data and deterministic outputs; it does not silently rebuild a publication from newly edited content.

Failed/expired upload reservations are cleaned after expiry if unreferenced. Staging and a recorded unfinished final object are removed, and reserved quota is released. Published/attempt-referenced assets are retained. Quizzes/problems use Trash and Restore; there is no browser hard-delete action that destroys old results.

Export links last 120 seconds. Download promptly or request another link. Expiring a link does not delete the export object. Use a bucket lifecycle rule for the `exports/` prefix according to your retention policy (for example, several days). Do not apply that lifecycle rule to `assets/`, `sources/` or referenced snapshots.

## Monitoring and retention

Watch failed jobs, Functions errors, storage allowances, Firestore usage and billing. Default maximum instances are deliberately bounded. App Check is supported; enable enforcement after registration and metrics verification.

Operation receipts and rate-limit records are backend-only. Rate-limit records have an `expiresAt` field suitable for a Firestore TTL policy; enable it through the Console if desired. Keep operation receipts long enough for your retry/audit policy, and do not delete active-job records. Audit events and saved-answer revisions contain access-controlled educational records; decide retention and deletion policy before a large rollout. The app records saved changes, not every keystroke.

No permanent Firebase download tokens are installed on production assets. Production links are signed and generation-pinned. Demo emulators use a separate test-only token adapter because local emulators cannot IAM-sign V4 URLs; their links do not verify production expiry behavior.

## Maintenance

An authorized owner can set `system/maintenance.enabled=true` to stop version 2 mutations and background workers. Reads remain available according to normal permissions. This is useful for migration; it is not honored by the old version 1 client, which requires its own write pause.

## Troubleshooting

| Symptom                                 | Check                                                                                                                |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Sign-in not enabled for website address | Authentication authorized hostname and enabled Google provider                                                       |
| Quiz service not connected              | Public web configuration, Functions region and backend deployment                                                    |
| Direct Firestore write denied           | Expected: use the app's callable API; do not relax the rules                                                         |
| Upload denied                           | Verified active teacher/admin, unexpired reservation, exact size/MIME, Storage-to-Firestore service connection       |
| Image finalization fails                | Valid raster bytes, dimensions, quota and runtime bucket permissions                                                 |
| Signed image/backup link fails          | Correct bucket, runtime `signBlob` permission, generation, expiry and CORS                                           |
| List query needs an index               | Deploy the supplied indexes and wait until they are ready                                                            |
| Job remains queued                      | Firestore trigger deployment and minute scheduler; inspect Admin → Jobs                                              |
| Publication fails after role change     | The worker rechecks the actor's current role; restore authorized access or have an administrator inspect the failure |
| Old quiz cannot be edited               | Run the migration after backup and dry-run; do not rewrite its schema manually                                       |

## Emulator tooling

Use a `demo-` project. Seed accounts are fixtures, never production users. The optional `npm run qa:browser` starts a local frontend bridge plus isolated emulators for UI testing; it is separate from the production Firebase SDK path and excluded from `dist/`. Production authentication is checked separately through real emulator Auth tokens and the exported callable wrapper.

For read-only visual review, run `npm run qa:capture` followed by `npm run qa:preview`. The capture creates disposable demo response/image fixtures, which are excluded from the release and production build. In that preview only, `/__qa/view?role=student` (or `teacher`, `admin`, `guest`) selects a fixture view; `/__qa/frame?width=390&page=/index.html` shows a narrow layout. This is a QA transport, not a production login or authorization mechanism.

If a corporate proxy incorrectly forwards loopback emulator requests, configure your local tool environment so localhost services stay local. Do not weaken Firebase rules to make a test pass. Java 21+ and Node 22 are the supported local test baseline for this project.
