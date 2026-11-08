#!/usr/bin/env python3
"""Controlled T1-only Firebase PNG callable release from Cloud Shell.

No GitHub Actions, no protected-branch merge, no website publishing, no Mimo
POST/run/paid job, and no changes to Firestore, secrets or other callables.
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BRANCH = "release/t1-png-recovery-safe-20261108"
RECOVERY_BRANCH = "fix/pdf-completed-checkpoint-recovery-20261108"
PROJECT = "sat-quiz-fd317"
TARGET = "functions:mathquiz:mimoBatchImage"


class Stop(Exception):
    pass


def command(*args: str, timeout: int = 90, quiet: bool = True) -> str:
    try:
        p = subprocess.run(
            list(args), cwd=ROOT, text=True, stdout=subprocess.PIPE if quiet else None,
            stderr=subprocess.PIPE if quiet else None, timeout=timeout, check=False
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise Stop(f"Command unavailable or exceeded limit: {args[0]}") from exc
    if p.returncode:
        raise Stop(f"Command failed ({p.returncode}): {args[0]} "
                   f"{args[1] if len(args) > 1 else ''}")
    return (p.stdout or "").strip()


def preflight():
    if not (ROOT / "firebase.json").is_file():
        raise Stop("Run from the Quizer repository (firebase.json missing).")
    if "azmath25/quizer" not in command("git", "remote", "get-url", "origin"):
        raise Stop("Unexpected GitHub repository. Nothing deployed.")
    local = command("git", "rev-parse", "HEAD")
    published = command("git", "rev-parse", "origin/" + BRANCH)
    if local != published:
        raise Stop(f"Checkout is not the fetched {BRANCH} commit.")
    command("git", "merge-base", "--is-ancestor", "origin/" + RECOVERY_BRANCH, "HEAD")
    if command("git", "status", "--porcelain", "--untracked-files=no"):
        raise Stop("Working tree contains tracked changes.")
    if not command("node", "--version").startswith("v22."):
        raise Stop("Node 22 required. Set your Node 22 PATH first.")
    command("firebase", "--version")
    command("gcloud", "--version")
    if command("gcloud", "config", "get-value", "project") != PROJECT:
        raise Stop(f"Expected active GCP project {PROJECT}.")
    if not (ROOT / "functions/src/mimo/completed-page.js").is_file():
        raise Stop("PDF checkpoint recovery helper is absent.")
    if not (ROOT / "js/components/mimo-png-viewer.js").is_file():
        raise Stop("T1 PNG viewer is absent.")
    if "mimoBatchImage" not in (ROOT / "functions/src/index.js").read_text():
        raise Stop("PNG callable was not exported.")
    print("T1_RELEASE_PREFLIGHT_PASS", flush=True)
    print("Branch:", BRANCH)
    print("Source:", local)
    print("Firebase target:", PROJECT, TARGET)
    print("Only this image callable may be deployed. Static frontend is NOT published.")


def apply():
    preflight()
    print("Running T1 and PDF recovery unit regression tests (no paid Mimo calls).", flush=True)
    command("node", "scripts/sync-functions-shared.mjs", timeout=60, quiet=False)
    command("node", "--test",
            "tests/unit/t1-mimo-png-viewer.test.mjs",
            "functions/test/mimo-batch.test.mjs",
            "functions/test/mimo-extraction.test.mjs",
            "functions/test/mimo-completed-page.test.mjs",
            timeout=300, quiet=False)
    command("node", "scripts/verify-static.mjs", timeout=90, quiet=False)
    command("node", "scripts/build.mjs", timeout=90, quiet=False)

    frontend = (ROOT / "dist/js/components/mimo-png-viewer.js")
    if not frontend.is_file():
        raise Stop("Frontend build omitted PNG viewer. Do not deploy.")
    print("Installing Firebase Functions dependencies only.", flush=True)
    command("npm", "ci", "--prefix", "functions", "--omit=dev",
            "--no-audit", "--no-fund", "--prefer-offline",
            timeout=600, quiet=False)

    print("Deploying ONLY Quizer's authenticated image retrieval callable.", flush=True)
    command("firebase", "deploy", "--project", PROJECT, "--only", TARGET,
            "--non-interactive", timeout=1500, quiet=False)
    print("T1_FIREBASE_IMAGE_DEPLOY_PASS", flush=True)
    print("Frontend is intentionally NOT published, because Quizer GitHub Pages")
    print("currently requires Actions. Complete the signed-in browser read-only")
    print("smoke test; do not rerun the source PDF or create another Mimo job.")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    mode = p.add_mutually_exclusive_group(required=True)
    mode.add_argument("--plan", action="store_true")
    mode.add_argument("--apply", action="store_true")
    args = p.parse_args()
    try:
        if args.apply:
            apply()
        else:
            preflight()
            print("PLAN ONLY — no deployment and no AI provider activity.")
    except Stop as error:
        print("STOP: " + str(error), file=sys.stderr)
        sys.exit(2)
