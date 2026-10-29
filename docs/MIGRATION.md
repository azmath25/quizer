# Migrate the previous app

Version 2 changes the backend data model. Do not simply deploy its rules on top of an active version 1 website: the old client writes quiz JSON and scores directly, and those writes are deliberately blocked by the new rules.

## What moves where

| Previous data | Version 2 destination |
| --- | --- |
| `roles/{uid}` | Preserved role, normalized active status/version and administrator counter |
| `quizzes/{id}` metadata | Same quiz ID, same owner, new schema, private/open policy derived from old publication status |
| `quizzes/{id}/content/main.json` string | Retained unchanged as migration source |
| Questions inside quiz JSON | Independent `problems/{id}` and immutable revisions, draft slots and published snapshot if applicable |
| Embedded raster images | Separate immutable `assets/{owner}/{asset}/image.png` Storage objects plus protected Firestore asset records |
| `users/{uid}/attempts/{id}` | Preserved original plus root `attempts/{newId}` marked `legacy_client_v1` and separate legacy responses |
| Browser IndexedDB quizzes | Explicit teacher import from Upload; never silently copied or deleted |

Old results have no trustworthy historical quiz snapshot. The migration preserves their recorded score and responses, labels their provenance, and leaves `quizRevisionId` null. It does not invent historical questions or recalculate those old client-generated scores. They are excluded from new revision-based statistics.

## Prepare and dry-run

1. Save the old frontend release, rules and Firebase configuration.
2. Export Firestore and back up Storage through your normal owner-operated backup process. Record backup locations and timestamps outside the public repository.
3. Install root and Functions dependencies. Authenticate an Admin SDK environment authorized for the exact project, preferably Application Default Credentials. Keep credentials outside the project.
4. Choose an explicit run ID, for example `v2_cutover_20261029`. Use it unchanged for resume.
5. Run a read-only report:

```sh
node scripts/migrate-v1.mjs \
  --project YOUR_PROJECT_ID \
  --bucket YOUR_ACTUAL_BUCKET_NAME \
  --run-id YOUR_RUN_ID \
  --dry-run \
  --report migration-report-private.json
```

The report can contain project/quiz identifiers; keep it private. Fix every reported error first. The script refuses missing owners, missing images, malformed problems, unsupported image formats and text it would otherwise have to truncate. It never guesses ownership. Optional `--only-quiz QUIZ_ID` selects one quiz and its legacy results for a staged rehearsal.

## Maintenance and cutover

The migration requires a maintenance window. The old client does not honor version 2's maintenance flag, so pause the old site and apply temporary owner-only Firestore/Storage access before applying the migration. Save the old rules first. This is an owner operation; the script does not change site hosting or deploy rules for you.

Run the same command with `--apply` instead of `--dry-run`:

```sh
node scripts/migrate-v1.mjs \
  --project YOUR_PROJECT_ID \
  --bucket YOUR_ACTUAL_BUCKET_NAME \
  --run-id YOUR_RUN_ID \
  --apply \
  --report migration-report-private.json
```

- `system/maintenance.enabled` is set to true. Version 2 mutations and workers stop during migration.
- `migrationRuns/{runId}` records progress, stable mappings and source hashes.
- Problems and assets use deterministic IDs. Already completed pieces are reused.
- A quiz's root publication pointer changes only when its content is complete.
- Original source documents and old results remain intact.
- The process exits nonzero if the report has errors; maintenance stays enabled.

For an interrupted run, add `--resume` with the **same project, run ID, bucket and unchanged source**. A changed source hash is an error. Do not hide that error by deleting journal entries or choosing a new run ID without investigating. A completed schema-2 quiz is skipped safely on resume.

## Verify before opening the site

Check quiz counts, independent problem counts, image counts, owners, publication/private status and a sample of full question/answer content against the report. Verify old result scores and responses in both source and destination. Check the active-admin counter, and bootstrap a verified owner only if no administrator exists.

Deploy the new Functions, indexes, Firestore/Storage rules and frontend during the same maintenance window. Wait for indexes. Keep emulators disabled in production. Verify role-specific pages and an image with an owner account, then set `system/maintenance.enabled` to false using an authorized owner environment or the Firestore Console. Complete the smoke test in `OPERATIONS.md` with a separate student account.

## Rollback

Do not run the old frontend against the version 2 rules/data and call that rollback. Pause writes again, record any new version 2 attempts, and restore a consistent saved frontend/rules/data set from your backups. Preserve new records separately for reconciliation. The retained legacy source and migration journal assist recovery but are not a substitute for a verified Firestore export and Storage backup.

## Browser-only data

On the same device/browser that held old quizzes, sign in as a teacher and open Upload. If the old IndexedDB database exists, an explicit **Import from the previous version** selector appears. Preview and import only quizzes that you own. Local copies remain. Unsupported SVG/other embedded images must be replaced with PNG/JPEG/WebP/GIF before import.

Device-only result history is not treated as authoritative new server-scored history. The cloud migration preserves existing saved legacy results with their provenance; new attempts use server grading from their pinned revision.
