#!/usr/bin/env python3
"""0108 — record the golden-path fixture against a LIVE narrator model (one real run).

Boots a fresh engine + front-end with ``ORWELL_GOLDEN_RECORD=1``, walks the golden path
(casting → premiere → Week 1 → eviction → week roll) through the real chat endpoint, and
writes the keyed transcript fixture the PR-time replay gate consumes. Run it whenever a
prompt/tool-schema change legitimately invalidates the committed fixture:

    cd frontend && OPENROUTER_API_KEY=sk-... ORWELL_GOLDEN_RECORD=1 \
        python3 scripts/golden_path_record.py

Then eyeball the printed invariant table, run the leak scan (automatic below), and commit
``tests/golden/golden_path_deepseek_v4_pro.jsonl``. The nightly workflow runs this same
script and uploads the refreshed fixture as an artifact (a ready-to-commit regenerate).
"""
from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from scripts._golden_driver import run_once  # noqa: E402
from src import golden_path as gp  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--fixture", default=gp.DEFAULT_FIXTURE)
    ap.add_argument("--model", default="deepseek/deepseek-v4-pro",
                    help="the NARRATION model (default_model)")
    ap.add_argument("--utility-model", default="",
                    help="the cheap tier for utility/background call classes "
                         "(utility_model); empty = same as --model")
    ap.add_argument("--base-url", default=os.environ.get(
        "ORWELL_GOLDEN_BASE_URL", "https://openrouter.ai/api/v1"))
    ap.add_argument("--api-key", default=os.environ.get("OPENROUTER_API_KEY")
                    or os.environ.get("ORWELL_OPENROUTER_KEY") or "")
    # A real narrator paces richer than the stub (multi-round scenes, fuller narration): the
    # first GLM 5.2 run reached veto at 60 turns without hitting eviction. 120 covers the
    # golden week with headroom; replay walks the same trajectory, budget-capped identically.
    ap.add_argument("--turn-budget", type=int, default=120)
    ap.add_argument("--report", default="")
    args = ap.parse_args()

    if not args.api_key:
        print("FAIL: no provider key (OPENROUTER_API_KEY / --api-key) — recording needs a live model")
        return 2
    if os.path.exists(args.fixture):
        os.remove(args.fixture)  # a recording always starts a FRESH fixture

    d = run_once(mode="record", fixture=args.fixture, model=args.model,
                 utility_model=args.utility_model,
                 provider_url=args.base_url, provider_key=args.api_key,
                 turn_budget=args.turn_budget)
    rep = d.report(args.report or None)

    print(f"\nfixture: {args.fixture} "
          f"({sum(1 for _ in open(args.fixture)) if os.path.exists(args.fixture) else 0} records)")
    leaks = gp.fixture_leak_scan(args.fixture)
    if leaks:
        print("FAIL: fixture leak scan found violations (fixture NOT safe to commit):")
        for v in leaks[:20]:
            print("  -", v)
        return 1
    print("leak scan: clean (no Vault keys, no secret-shaped material)")
    if d.inv.failed:
        print(f"\nFAIL: {len(d.inv.failed)} invariant(s) failed on the LIVE run — "
              "fix the seam (or the driver) before committing this fixture.")
        return 1
    print("\nRECORD OK — commit the fixture + this run's report "
          f"(digest {rep['digest'][:16]}…) to land the regenerate.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
