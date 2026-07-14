#!/usr/bin/env python3
"""0108 — record the golden-path fixture against a LIVE narrator model (one real run).

Boots a fresh engine + front-end with ``ORWELL_GOLDEN_RECORD=1``, walks the golden path
(casting → premiere → Week 1 → eviction → week roll) through the real chat endpoint, and
writes the keyed transcript fixture the PR-time replay gate consumes. Run it whenever a
prompt/tool-schema change legitimately invalidates the committed fixture:

    cd frontend && OPENROUTER_API_KEY=sk-... ORWELL_GOLDEN_RECORD=1 \
        python3 scripts/golden_path_record.py

Then eyeball the printed invariant table, pass the integrity + leak scans (automatic
below), and commit ``tests/golden/golden_path_glm-4.7.jsonl``. The nightly workflow runs
this same script and uploads the refreshed fixture as an artifact (a ready-to-commit
regenerate). Defaults follow the owner's two-tier topology (2026-07-07): narration
GLM 5.2, utility Qwen 3.6 Flash.
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
    ap.add_argument("--model", default="z-ai/glm-4.7",
                    help="the NARRATION model (default_model)")
    ap.add_argument("--utility-model", default="qwen/qwen3.6-flash",
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
    # Per-turn stream-silence timeout. The casting-finalize turn kicks background cast-genesis,
    # which on glm-4.7 emits the whole 15-NPC skeleton JSON as one ~4400-token completion (~6 min
    # of stream silence) — under the driver's 420s default only when it does NOT re-roll. We raise
    # the ceiling to 900s (record-only; prod is untouched) so a single genesis pass plus a possible
    # re-roll can complete without a false genuine-hang timeout. The re-roll itself is separately
    # reduced by the strengthened hidden-element minimum in orwell_cast_genesis.build_genesis_messages.
    ap.add_argument("--turn-timeout", type=int, default=900)
    ap.add_argument("--report", default="")
    args = ap.parse_args()

    if not args.api_key:
        print("FAIL: no provider key (OPENROUTER_API_KEY / --api-key) — recording needs a live model")
        return 2
    if os.path.exists(args.fixture):
        os.remove(args.fixture)  # a recording always starts a FRESH fixture
    # Resolve the utility tier ONCE (empty ⇒ same as narration) so the declared meta, the
    # integrity scan, and the ACTUAL run all agree — passing the raw empty value to the run
    # while meta/integrity resolve it would make them describe a model the run didn't use.
    utility_model = args.utility_model or args.model
    # Format-2 self-description: the FE process writes the meta line ITSELF on its first
    # record (driver passes the declared tier via env), so the meta writer and the record
    # writer are the same process — the integrity scan's initialized-by-A-populated-by-B
    # rule holds by construction. (Attempt #5 walked a perfect week and was rejected solely
    # because the SCRIPT had stamped the meta line from its own pid.)

    d = run_once(mode="record", fixture=args.fixture, model=args.model,
                 utility_model=utility_model,
                 provider_url=args.base_url, provider_key=args.api_key,
                 turn_budget=args.turn_budget, turn_timeout=args.turn_timeout)
    rep = d.report(args.report or None)

    print(f"\nfixture: {args.fixture} "
          f"({sum(1 for _ in open(args.fixture)) if os.path.exists(args.fixture) else 0} records)")
    census = gp.fixture_model_census(args.fixture)
    print("model census:", " ".join(f"{m}×{c}" for m, c in sorted(census.items())) or "<empty>")
    integrity = gp.fixture_integrity_scan(
        args.fixture, narration_model=args.model,
        utility_model=utility_model)
    if integrity:
        print("FAIL: fixture integrity scan (fixture NOT trustworthy — do not commit):")
        for v in integrity[:20]:
            print("  -", v)
        return 1
    print("integrity: single writer, all records on the declared model set")
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
