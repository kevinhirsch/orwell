#!/usr/bin/env python3
"""0108 — the PR-time golden-path REPLAY gate (deterministic, key-free, blocking).

Boots a fresh engine + front-end with ``ORWELL_GOLDEN_REPLAY=<fixture>`` (the FE's model
chokepoints re-emit the recorded bytes — no provider, no key, no network beyond loopback)
and walks the same golden path, asserting the eight 0108 invariants plus the replay
contract (zero fixture misses, zero provider reach). With ``--runs 2`` (the CI default)
it runs the whole walk twice on fresh engines and asserts the driver digests are
identical — the determinism proof.

A replay MISS means a prompt/tool-schema change drifted off the recording — that is the
gate working. Regenerate: ``ORWELL_GOLDEN_RECORD=1 python3 scripts/golden_path_record.py``
(needs a live narrator key; see INTEGRATION.md §golden-path).
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from scripts._golden_driver import fixture_models, run_once  # noqa: E402
from src import golden_path as gp  # noqa: E402


def _default_fixture() -> str:
    """The canonical committed fixture: DEFAULT_FIXTURE when present, else the single
    golden_path_*.jsonl under tests/golden/ (the fixture is model-named; the gate is
    model-agnostic — it replays whatever tier the owner recorded). Multiple candidates
    with no canonical DEFAULT_FIXTURE is AMBIGUOUS and a HARD FAILURE — CI must never
    silently pick one and replay the wrong tier."""
    if os.path.isfile(gp.DEFAULT_FIXTURE):
        return gp.DEFAULT_FIXTURE
    import glob
    hits = sorted(glob.glob(os.path.join(os.path.dirname(gp.DEFAULT_FIXTURE), "golden_path_*.jsonl")))
    if len(hits) == 1:
        return hits[0]
    if len(hits) > 1:
        print("FAIL: multiple golden fixtures found and no canonical DEFAULT_FIXTURE at "
              f"{gp.DEFAULT_FIXTURE} — refusing to guess which to replay. Candidates:")
        for h in hits:
            print(f"  - {h}")
        print("Disambiguate: pass --fixture <path>, or commit the canonical fixture at "
              "the DEFAULT_FIXTURE path.")
        sys.exit(2)
    return gp.DEFAULT_FIXTURE  # none found → main() reports not-found + the regenerate hint


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--fixture", default="")
    ap.add_argument("--runs", type=int, default=2)
    # Budget-parity with the record default: replay walks the recorded trajectory, so a
    # smaller replay budget would truncate a real-narrator week that recorded fine.
    ap.add_argument("--turn-budget", type=int, default=120)
    ap.add_argument("--report", default="")
    args = ap.parse_args()
    args.fixture = args.fixture or _default_fixture()

    if not os.path.isfile(args.fixture):
        print(f"FAIL: fixture not found: {args.fixture}\n{gp.REGENERATE_HINT}")
        return 2
    integrity = gp.fixture_integrity_scan(args.fixture)
    if integrity:
        print("FAIL: committed fixture fails the integrity scan (multi-writer or "
              "off-model records — re-record it):")
        for v in integrity[:20]:
            print("  -", v)
        return 1
    leaks = gp.fixture_leak_scan(args.fixture)
    if leaks:
        print("FAIL: committed fixture fails the leak scan:")
        for v in leaks[:20]:
            print("  -", v)
        return 1

    model, utility_model = fixture_models(args.fixture)
    digests, failed = [], []
    for n in range(max(1, args.runs)):
        print(f"\n── replay run {n + 1}/{args.runs} ─────────────────────────────", flush=True)
        d = run_once(mode="replay", fixture=args.fixture, model=model, utility_model=utility_model,
                     engine_port=8971 + n, fe_port=7971 + n,
                     turn_timeout=120, turn_budget=args.turn_budget)
        rep = d.report((args.report + f".run{n + 1}.json") if args.report else None)
        digests.append(rep["digest"])
        failed.extend(d.inv.failed)

    if len(set(digests)) > 1:
        print(f"\nFAIL: replay is non-deterministic across runs ({[d[:12] for d in digests]}) — "
              "that is itself a seam bug to fix, never to mute.")
        return 1
    if failed:
        print(f"\nFAIL: {len(failed)} invariant/contract assertion(s) failed under replay.")
        return 1
    print(f"\nREPLAY OK — {args.runs} deterministic run(s), digest {digests[0][:16]}…, "
          "zero misses, zero provider reach.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
