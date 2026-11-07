# Quizer CI budget policy: manual-only workflows

All 23 Quizer workflows are intentionally triggered only by `workflow_dispatch`.
After this change merges, ordinary commits and pull requests will not trigger the 23 custom GitHub Actions workflows.

**Manual tests**: GitHub repository → Actions → select an existing workflow → Run workflow (choose the branch). Source tests stay in the repository and can also be run locally.

**Manual website publishing**: The `Publish Quizer to GitHub Pages` workflow is preserved but DOES NOT run on pushes. After merging a verified frontend change to main, explicitly run that workflow on `main` to publish new HTML/CSS/JS. The previous Pages deployment remains the most recent publication until a new explicit publish. The `dist/` build is still generated inside that manual workflow; switching Pages to publish the unbuilt repository root is **not** equivalent.

**Backend**: Firebase, Google Cloud Run and Neon deployments remain separate and unaffected. No GitHub workflow here is authorized to auto-deploy Firebase.

**Costs**: Manual workflows still consume minutes where billable. Past usage and saved artifacts are not deleted by this change. Enabling GitHub Actions via repository settings is still required for manual operation.

Restore automation only with a deliberate cost/coverage review.
