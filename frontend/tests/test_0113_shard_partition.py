"""0113 — the Tier-A shard-partition coverage invariant (#1359).

The CI `visual-regression` job runs as a PARALLEL matrix (`--shard-index I --shard-count N`) so
the ~120-shot Tier-A capture no longer times out one runner. The correctness of that split rests
on ONE invariant: sharding must change only WHICH shots each leg captures, never the shot SET.
This file is the browser-free proof of that invariant — it imports only the pure slot-list /
partition helpers (`scripts.visual_regression.tier_a_shot_slots` / `tier_a_shard_shot_ids` /
`tier_a_shot_id`), never the browser (the literal string that flips `conftest.py`'s browser-lane
marker never appears here, so this stays in the fast, parallel `fe-unit` xdist lane).

Roles only — no cast/game content anywhere.
"""
from __future__ import annotations

import os
import sys

import pytest

FRONTEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if FRONTEND_DIR not in sys.path:
    sys.path.insert(0, FRONTEND_DIR)

from scripts import visual_regression as vr  # noqa: E402

# The shard count the CI matrix actually uses (.github/workflows/ci.yml). Pinned so a change to
# the matrix legs without a matching harness thought reads as a test edit, not a silent drift.
CI_SHARD_COUNT = 4


def _full_set():
    """The single-job (unsharded) Tier-A shot set — shard_count == 1 owns every slot."""
    return vr.tier_a_shard_shot_ids(0, 1)


# ── the ordered slot list is the single source of truth ────────────────────────────────────


def test_tier_a_slot_list_is_the_full_design_matrix():
    slots = vr.tier_a_shot_slots()
    # 6 surfaces x 4 viewports x 5 themes = 120 (the design note's Tier-A cardinality).
    assert len(slots) == len(vr.TIER_A_SURFACES) * len(vr.TIER_A_VIEWPORTS) * len(vr.TIER_A_THEMES)
    assert len(slots) == 120


def test_tier_a_slot_shot_ids_are_unique_and_canonically_shaped():
    slots = vr.tier_a_shot_slots()
    ids = [vr.tier_a_shot_id(surf, vp, theme) for (surf, vp, _w, _h, theme) in slots]
    # every slot maps to a DISTINCT id — the set-based partition preserves the count only if the
    # ids are a bijection with the slots.
    assert len(ids) == len(set(ids)) == 120
    # the id shape is EXACTLY the live `tierA:{surface}:{viewport}:{theme}` form the XFAIL
    # registry + baseline manifest key on — sharding must not change it.
    for sid in ids:
        parts = sid.split(":")
        assert parts[0] == "tierA" and len(parts) == 4
    assert vr.tier_a_shot_id("gadget-rail", "tablet-768", "the-feed") == \
        "tierA:gadget-rail:tablet-768:the-feed"


def test_shard_count_one_is_the_whole_unsharded_set():
    """(c) — the single-job behavior: shard_count == 1 captures the FULL set (today's behavior,
    byte-for-byte)."""
    slots = vr.tier_a_shot_slots()
    full = vr.tier_a_shard_shot_ids(0, 1)
    assert full == {vr.tier_a_shot_id(s, vp, th) for (s, vp, _w, _h, th) in slots}
    assert len(full) == 120


# ── the coverage invariant: union == full, pairwise disjoint (the deliverable) ──────────────


def test_four_shards_union_exactly_equals_the_full_set():
    """(a) — the UNION of the 4 shards' Tier-A shot ids is EXACTLY the single-job set: no shot
    dropped, none invented."""
    full = _full_set()
    shards = [vr.tier_a_shard_shot_ids(i, CI_SHARD_COUNT) for i in range(CI_SHARD_COUNT)]
    union = set().union(*shards)
    assert union == full
    # and every shot is captured exactly ONCE across the shards (sizes sum to the full count) —
    # the disjointness half stated as a count, so a double-capture can't hide behind the union.
    assert sum(len(s) for s in shards) == len(full)


def test_four_shards_are_pairwise_disjoint():
    """(b) — no shot is captured by two shards."""
    shards = [vr.tier_a_shard_shot_ids(i, CI_SHARD_COUNT) for i in range(CI_SHARD_COUNT)]
    for i in range(CI_SHARD_COUNT):
        for j in range(i + 1, CI_SHARD_COUNT):
            assert shards[i].isdisjoint(shards[j]), f"shards {i} and {j} overlap"


@pytest.mark.parametrize("n", [1, 2, 3, 4, 5, 7, 8, 120])
def test_coverage_invariant_holds_for_any_shard_count(n):
    """The invariant is not special to N=4: for any valid shard_count the union is the full set
    and the shards are pairwise disjoint (a partition)."""
    full = _full_set()
    shards = [vr.tier_a_shard_shot_ids(i, n) for i in range(n)]
    union = set().union(*shards) if shards else set()
    assert union == full
    assert sum(len(s) for s in shards) == len(full)  # disjoint (partition)


def test_shards_are_balanced_within_one_at_ci_shard_count():
    """Load-balance sanity: 120 / 4 = 30 exactly, so all four legs are the same size (a badly
    skewed split would put us back near the timeout on one leg)."""
    sizes = sorted(len(vr.tier_a_shard_shot_ids(i, CI_SHARD_COUNT)) for i in range(CI_SHARD_COUNT))
    assert sizes == [30, 30, 30, 30]
    assert max(sizes) - min(sizes) <= 1  # generic balance guard for any surface/viewport/theme edit


def test_every_shard_sees_every_surface_at_ci_shard_count():
    """Each surface contributes 20 slots (4 vp x 5 themes), so at N=4 every shard owns 5 of each
    surface — no shard is blind to a whole surface, so the per-shard geometry gate covers every
    surface family (and any surface-scoped XFAIL slice is exercised on whichever shard owns it)."""
    surfaces = set(vr.TIER_A_SURFACES)
    for i in range(CI_SHARD_COUNT):
        seen = {sid.split(":")[1] for sid in vr.tier_a_shard_shot_ids(i, CI_SHARD_COUNT)}
        assert seen == surfaces, f"shard {i} is missing surfaces: {surfaces - seen}"


# ── the XFAIL registry keys on shot-id prefixes — sharding must keep those ids reachable ────


def test_registered_xfail_shot_prefixes_are_fully_covered_by_the_union():
    """The XFAIL registry scopes each known finding to a shot-id PREFIX (e.g.
    `tierA:gadget-rail:tablet-768`). Those exact shot ids must still be captured by SOME shard, or
    a registered known-issue would silently stop matching. Every shot matching a registered prefix
    is present in the union (== full set) — proven directly against the live XFAIL entries."""
    full = _full_set()
    tier_a_prefixes = [ent["shot"] for ent in vr.XFAIL.values() if ent["shot"].startswith("tierA:")]
    # guard the guard: if the registry ever empties, this test would vacuously pass — pin that we
    # actually exercised the live gadget-rail:tablet-768 slice the current registry scopes.
    assert any(p.startswith("tierA:gadget-rail:tablet-768") for p in tier_a_prefixes), \
        "expected the live VIS-2 gadget-rail:tablet-768 XFAIL scope — registry shape changed"
    for prefix in tier_a_prefixes:
        matching = {sid for sid in full if sid.startswith(prefix)}
        assert matching, f"XFAIL prefix {prefix!r} matches no Tier-A shot — the shot set changed"
        # every shot under the prefix is owned by exactly one shard, and their union is the slice.
        covered = set()
        for i in range(CI_SHARD_COUNT):
            covered |= {sid for sid in vr.tier_a_shard_shot_ids(i, CI_SHARD_COUNT)
                        if sid.startswith(prefix)}
        assert covered == matching, f"XFAIL prefix {prefix!r} slice not fully covered by the shards"


# ── invalid shard configs raise (fail fast, before any boot) ───────────────────────────────


@pytest.mark.parametrize("shard_index,shard_count", [
    (0, 0),      # shard_count must be >= 1
    (0, -1),
    (-1, 4),     # shard_index must be in [0, shard_count)
    (4, 4),
    (5, 4),
])
def test_invalid_shard_config_raises_value_error(shard_index, shard_count):
    with pytest.raises(ValueError):
        vr.tier_a_shard_shot_ids(shard_index, shard_count)


def test_visual_walk_ctor_validates_shard_config():
    """The VisualWalk constructor revalidates (belt-and-suspenders with run()'s early check) —
    a bad shard config never yields a half-built walk that silently captures the wrong slice."""
    class _StubDriver:
        fe = "http://unused"

    # a valid config builds fine (browser=None is never touched in the ctor).
    walk = vr.VisualWalk(_StubDriver(), browser=None, out_dir="/tmp/_vr_shard_test",
                         tier="a", shard_index=1, shard_count=4)
    assert walk._tier_a_shot_ids == vr.tier_a_shard_shot_ids(1, 4)
    assert walk._tier_b_enabled is False       # Tier B is shard-0-only
    assert vr.VisualWalk(_StubDriver(), browser=None, out_dir="/tmp/_vr_shard_test0",
                         tier="a")._tier_b_enabled is True  # default (shard 0/1) captures Tier B

    with pytest.raises(ValueError):
        vr.VisualWalk(_StubDriver(), browser=None, out_dir="/tmp/_vr_shard_test_bad",
                      tier="a", shard_index=4, shard_count=4)
