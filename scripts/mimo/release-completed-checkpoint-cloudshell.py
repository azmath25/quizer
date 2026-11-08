#!/usr/bin/env python3
"""Deploy only Quizer Mimo PDF checkpoint-recovery Functions from Cloud Shell.

No GitHub Actions, no Firestore index creation, no paid AI calls, no root npm ci.
The default is a read-only plan; --apply runs the focused mock tests first.
Run as a child process, not with 'source', so any error cannot close Cloud Shell.
"""
from __future__ import annotations

import argparse
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
BRANCH = "fix/pdf-completed-checkpoint-recovery-20261108"
PROJECT = "sat-quiz-fd317"
FUNCTIONS = (
    "mimoBatchReconcile",
    "mimoBatchSweep",
    "mimoBatchStatus",
    "mimoExtractStatus",
)
TARGETS = ",".join("functions:mathquiz:" + name for name in FUNCTIONS)


class Stop(Exception):
    pass


def command(*args: str, timeout: int = 60, output: bool = True) -> str:
    try:
        result = subprocess.run(
            list(args), cwd=ROOT, timeout=timeout,
            text=True, capture_output=output, check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise Stop(f"command unavailable or timed out: {args[0]}") from exc
    if result.returncode:
        # Sensitive diagnostic output is not echoed. Full provider keys should
        # never be passed as command line arguments or environment log values.
        raise Stop(f"command failed ({result.returncode}): {args[0]} {args[1] if len(args)>1 else ''}")
    return result.stdout.strip() if output else ""


def preflight() -> None:
    if not (ROOT / "firebase.json").is_file():
        raise Stop("run from the Quizer release checkout")
    origin = command("git", "remote", "get-url", "origin")
    if "azmath25/quizer" not in origin:
        raise Stop("Git origin is not the expected Quizer repository")
    head = command("git", "rev-parse", "HEAD")
    target = command("git", "rev-parse", "origin/" + BRANCH)
    if head != target:
        raise Stop("checkout does not match the fetched checkpoint recovery branch")
    if command("git", "status", "--porcelain", "--untracked-files=no"):
        raise Stop("tracked files have local modifications; preserve them first")
    if not command("node", "--version").startswith("v22."):
        raise Stop("Node 22 required: export PATH=\"$HOME/.local/node-v22.23.4/bin:$PATH\"")
    command("firebase", "--version")
    gcp = command("gcloud", "config", "get-value", "project")
    if gcp != PROJECT:
        raise Stop(f"set GCP project to {PROJECT} (found {gcp})")
    print("QUIZER_CHECKPOINT_PREFLIGHT_PASS", flush=True)
    print("Targets:", ", ".join(FUNCTIONS), flush=True)


def apply() -> None:
    preflight()
    print("Running local mock tests; no Mimo requests.", flush=True)
    command("bash", "scripts/mimo/verify-hardfix-cloudshell.sh",
            timeout=180, output=False)
    print("Installing Functions-only production dependencies.", flush=True)
    command("npm", "ci", "--prefix", "functions", "--omit=dev",
            "--no-audit", "--no-fund", "--prefer-offline",
            timeout=360, output=False)
    print("Deploying only four Quizer Mimo status/reconciliation functions.", flush=True)
    command("firebase", "deploy", "--project", PROJECT,
            "--only", TARGETS, "--non-interactive",
            timeout=1200, output=False)
    print("QUIZER_COMPLETED_CHECKPOINT_RELEASE_PASS", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    flags = parser.add_mutually_exclusive_group(required=True)
    flags.add_argument("--plan", action="store_true")
    flags.add_argument("--apply", action="store_true")
    opts = parser.parse_args()
    try:
        if opts.apply:
            apply()
        else:
            preflight()
            print("PLAN ONLY. No database, provider or Firebase changes.")
    except Stop as exc:
        print("STOP: " + str(exc), file=sys.stderr)
        sys.exit(2)
