# Verification · 29 October 2026

This is a source-code release, not a deployment to an existing Firebase project. The supplied configuration is empty and production credentials were not available.

## Performed checks

| Check                               | Result          | Scope                                                                                                                          |
| ----------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Original baseline                   | 41 tests passed | Previous parser, grading, configuration and catalog regression tests                                                           |
| Frontend/shared unit suite          | 48 tests passed | Legacy regressions, v2 contracts, safe content/navigation, grading and local HTTP asset serving                                |
| Backend policy suite                | 4 tests passed  | Ownership, current roles, admission, release rules and canonical hashes                                                        |
| Full emulator integration/rules run | 23 tests passed | Auth, Firestore and Storage; publication, admission, attempts, marking, images, exports, cleanup, migration and rules          |
| Final focused regression run        | 8 tests passed  | Seven core integration tests, including old-profile normalization, plus one real Auth/callable transport test                  |
| Static verification                 | Passed          | 16 application routes, relative assets/imports, no active legacy repository fallback, shared backend mirror                    |
| Production frontend build           | Passed          | Frontend-only dist output; no Functions source or private configuration                                                        |
| Syntax / ZIP checks                 | Passed          | Authored JavaScript parses; complete source archive opens and excludes installed packages, test-generated data and credentials |

The final focused run repeats six cases from the integration run and adds the profile regression and transport case. Counts must not be added as if all cases were independent. After the final image-filename validation change, the complete unit/backend checks were rerun; the earlier full emulator run was not repeated solely for that pure validation addition.

The import tests exercised **500 problems**, interrupted/resumed batches, stable mappings, hidden incomplete imports and publication revision continuity. Migration tests exercised dry-run, separate images, retained old scores/answers with legacy provenance and safe reruns. Rules tests used the Firebase client SDK, including denied direct writes and Storage overwrite protection.

The transport test uses real emulator Auth tokens and the actual exported callable HTTP wrapper, hosted by a local Express harness. It also invokes the real publication worker. It does not prove production Cloud Functions trigger delivery or scheduler operation.

## Browser verification limits

Final browser acceptance was not completed. The managed preview environment could not launch the Java emulator runtime, and a later browser action was blocked by its URL policy after a failed preview connection. No browser policy was bypassed. Consequently this release does **not** claim a completed visual, mobile-device, OAuth or end-to-end browser acceptance pass.

Read-only visual QA tooling is included. `npm run qa:capture` records real emulator API responses and demo images; `npm run qa:preview` serves those fixtures through the production page controllers. The fixture preview supports teacher, student, admin and guest views, and narrow iframe layouts. It cannot verify mutations, OAuth, production authorization or actual device behavior, and is never part of the production build. Generated fixture data is excluded from the release archive. The regular `npm start` / `npm run dev` always serves the real Firebase app.

## Checks requiring the owner's deployment

Follow the ten-step smoke test in [OPERATIONS.md](OPERATIONS.md), especially:

- Google provider, authorized GitHub Pages domain and persisted sign-in/Profile behavior.
- Production Storage CORS, IAM signing, generation-pinned URLs and actual 120-second expiry.
- Cloud Functions event triggers, retries and scheduled deadline grading with the browser closed.
- Mobile widths, keyboard/focus behavior, themes, large text, image expansion and long equations.
- Live notifications and permission changes across already-open browser tabs.
- Backup/restore in the intended production data set and explicit migration dry-run before cutover.

[ACCEPTANCE.md](ACCEPTANCE.md) maps all 133 scenarios from the original plan. It distinguishes targeted automated evidence from implemented paths requiring further verification; it is not a claim that every scenario was fully exercised.

## Reproduce

Use Node 22 and Java 21+, then run:

```sh
npm ci
npm --prefix functions ci
npm test
npm run test:backend
npm run test:integration
npm run test:transport
npm run verify:static
npm run build
```

Run emulator suites against a fresh `demo-` project state. Do not seed the visual QA fixture database into the same run as the core tests: those tests deliberately assert exact collection counts. An initial combined capture/test invocation failed for this fixture-isolation reason; the clean focused rerun passed all eight cases. Production data was never used for testing.
