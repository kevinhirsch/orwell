#!/usr/bin/env python3
"""0113 — bless a visual-regression run's shots as the new blessed baselines.

ONE command: point it at a run's output directory (a local `visual_regression.py --out DIR`
run, OR an unpacked CI artifact — same shape, `shots/*.png` + `shots_manifest.json`) and it
copies every shot into the baselines directory, stamps a `manifest.json` (shot id -> sha256 +
dims + who/when/where it came from), and reports what changed.

Policy (owner-locked, issue #1237): **bless from CI artifacts, not local renders** — a local
chromium/font/AA render can drift from the CI runner's, poisoning the baseline with
false-diff noise for everyone else. This script does not enforce that (it has no way to tell
a CI artifact from a local run — the shape is identical by design), but it prints a loud
reminder, and `--source` should always be set to something that answers "did this come from
CI." Works on ANY conforming run dir; nothing here is golden-path-specific.

Usage:
    python3 scripts/visual_bless.py --run /path/to/run-dir \
        --baselines tests/visual/baselines --source "ci-artifact:run-12345"
"""
from __future__ import annotations

import argparse
import json
import os
import sys

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if FRONTEND not in sys.path:
    sys.path.insert(0, FRONTEND)

from src.visual_manifest import bless_run, diff_manifests, load_manifest  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--run", required=True, help="a visual_regression.py --out DIR, or an "
                    "unpacked CI artifact with the same shape")
    ap.add_argument("--baselines", default=os.path.join(FRONTEND, "tests", "visual", "baselines"))
    ap.add_argument("--source", default="",
                    help='provenance stamp, e.g. "ci-artifact:<run-id>" or "path:<dir>" — '
                         "recorded in the manifest for audit; defaults to the run dir path")
    args = ap.parse_args()

    run_shots_dir = os.path.join(args.run, "shots")
    if not os.path.isdir(run_shots_dir):
        # tolerate being pointed straight at a shots/ dir too.
        run_shots_dir = args.run

    shots_manifest_path = os.path.join(args.run, "shots_manifest.json")
    shot_meta = {}
    if os.path.isfile(shots_manifest_path):
        with open(shots_manifest_path, "r", encoding="utf-8") as fh:
            raw = json.load(fh)
        for shot_id, meta in raw.items():
            shot_meta[shot_id] = {
                "width": meta.get("width"), "height": meta.get("height"),
                "device_scale_factor": meta.get("device_scale_factor"),
                "label": meta.get("label"),
            }
    else:
        print(f"NOTICE: no shots_manifest.json found alongside {args.run} — blessing with "
              "dims/label left null (this is still a valid manifest; just less descriptive).")

    if not args.source.lower().startswith("ci-artifact"):
        print("NOTICE (policy, issue #1237): baselines should be blessed from a CI artifact, "
              "not a local render (font/AA drift between machines poisons the baseline for "
              f"everyone else). --source={args.source!r} does not look like a CI artifact — "
              "proceeding anyway (this script cannot verify provenance), but double-check "
              "before committing.")

    before = load_manifest(args.baselines)
    manifest = bless_run(run_shots_dir, args.baselines,
                         source=args.source or f"path:{os.path.abspath(args.run)}",
                         shot_meta=shot_meta)
    delta = diff_manifests(before, manifest)

    print(f"blessed {len(manifest.entries)} baseline(s) into {args.baselines}")
    for kind in ("added", "changed", "removed"):
        ids = delta[kind]
        if ids:
            print(f"  {kind} ({len(ids)}): " + ", ".join(ids[:20]) + (" ..." if len(ids) > 20 else ""))
    if not any(delta.values()):
        print("  (no change — byte-identical to the previous blessed set)")
    print(f"\nmanifest: {os.path.join(args.baselines, 'manifest.json')}")
    print("Commit the updated baselines/ directory (PNGs + manifest.json) to arm/refresh the gate.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
