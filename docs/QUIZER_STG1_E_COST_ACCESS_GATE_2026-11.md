# Quizer STG1-E — $1 staging cost boundary and fail-closed predeployment gate

Date: 2026-11-04 (Asia/Baku)  
Repository / branch: `azmath25/quizer` / `work/quizer-audit-optimization-2026-11`  
Release order: **STG → PROD → AI → PROD2**  
Scope: **read-only project metadata + documentation only**. No cloud mutations, merges, deploys, SQL execution, new roles, secret handling, or paid-service enablement.

## Decision

**STG1-E audit CHECKPOINT RECORDED, but staging runtime / STG2 remain NO GO.**

The owner-selected staging target is **USD $1 per calendar month**, specifically for `quizer-staging-az26`. This is a target, not evidence of a configured project-wide hard cap. Last user-verified Google Cloud billing check returned **billingEnabled: false**; no new billing read or mutation was available in this checkpoint. Do not silently upgrade to Blaze or link a billing account.

## Verified boundaries

| Boundary | Current evidence | Gate |
| --- | --- | --- |
| Firebase project | `quizer-staging-az26`; Google Auth provider enabled; authorized domains were inspected; Firestore `(default)` in `europe-west3` with staging-only deny-all client rules | Configuration passed; real authenticated sign-in, role-aware rules, indexes and runtime not proven |
| Firebase billing | User's last read-only check: disabled | Keep disabled, therefore do not provision/deploy billable Storage or Functions |
| Firebase project IAM | Previous scoped project IAM inventory found one human owner, no `allUsers`/`allAuthenticatedUsers` grants, and service account bindings only for listed service roles | Project IAM inventory passed; resource-level grants, inherited bindings and signing permissions not proven |
| Neon project | `quizer-dev` / `soft-grass-35754518` | Existing Quizer-only environment; not Mimo |
| Neon default branch | `main` / `br-wispy-night-b9ug6kub` | **Forbidden as a staging migration/test target** |
| Neon disposable branch | `stg1b-disposable-2026-11-04` / `br-sweet-rice-b9ehdv9i`, parent `br-wispy-night-b9ug6kub`, `default=false`, `primary=false` | Reconfirmed via read-only `list_branches` on 2026-11-04; do not drop or modify without a separate scope |
| Neon schema | Prior STG1-B real rehearsal: 7 tables, 17 indexes, 1 trigger, zero problem rows; original migration scripts are not automatically idempotent | Rehearsal passed historically; runtime version ledger, restricted SQL LOGIN and secret delivery still blocked |
| Existing Quizer production | `sat-quiz-fd317`; `main` and `main-backup` | Do not access or modify |
| Mimo | `mimo-backend-513412` and all Mimo Neon projects | Never access or modify |
| AI | `feat/ai-browser-snip-ask`, `feat/ai-workspace` | Keep separate and unmerged until separately approved |

Neon's branch inventory showed both named Quizer branches present; branch metadata alone does **not** prove that a compute endpoint is presently suspended or costless. No database connection was opened.

## Important pricing facts

1. Standard Google Cloud **alerts-only budgets are not spending caps**. They do not automatically stop services at the dollar threshold; billing/reporting can lag. Reference: https://docs.cloud.google.com/billing/docs/how-to/budgets
2. Google Cloud **spend-cap budgets (preview)** cover **individual eligible services** in a single project; current listed services include Cloud Run and Cloud Run functions. They are not a project-wide cap for all Firebase, Firestore, Storage, Neon and other resources, and can overshoot due to in-flight work/reporting delay. Confirm availability/eligibility in the exact billing account before relying on a cap. Reference: https://docs.cloud.google.com/billing/docs/how-to/budgets-spend-caps
3. Cloud Storage for Firebase **requires Blaze billing** to provision/access buckets; a storageBucket value in Firebase SDK config does not establish a provisioned bucket. Reference: https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024

## Required approvals / proofs before any stage billing enablement

- **Separate explicit authorization to link billing / enable Blaze** on exactly `quizer-staging-az26`. Until then keep all billable provisioning OFF.
- Verify project-scoped **$1/month alerts-only budget** at 25%, 50%, 80%, 100% if billing is enabled; separately investigate eligible service-specific spend caps, and record that **neither is a guaranteed overall $1 cap**.
- Set conservative service quotas and max instances; first estimate minimum sustained costs, request charges, idle resource costs and a stop/teardown plan. Confirm quota changes do not weaken production or Mimo.
- Inspect service identities and minimum IAM grants, stage-only URL/allowed origins, App Check, Firestore+Storage rules, and actual bucket state without public access. No service-account JSON keys.
- Provide an approved restricted Neon SQL **LOGIN** whose privileges are proven (no SUPERUSER, CREATEDB, CREATEROLE, BYPASSRLS, neon_superuser membership), TLS and app pool max=3; route its secret directly to an authorized server-only store, **not** ChatGPT, GitHub or browser.
- Prove migration version ledger and reviewed runner, stage-only restore/rollback with synthetic data, full integration checks and measured cost.
- Final STG1-F decision: **NO GO** until every applicable item has independent execution evidence. Then request separate approval before STG2 staging deployment.

## Stop and no-change declaration

This checkpoint performed a read-only Neon branch listing and reviewed existing Quizer repository files and official Google/Firebase pricing documentation. No Cloud Shell commands were run; no claims of live Google project re-verification are made. No PostgreSQL query, migration, rollback, IAM change, Firebase deploy, budget creation, billing upgrade, backend deployment, branch merge, or AI work occurred. GitHub work-branch documentation is the only intended repository write.
