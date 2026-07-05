"""BE-202 — the outcome guard's if/elif short-circuit + pre-commit-only tally scoping let a
fabricated vote-count/"unanimous" claim reach the player in the SAME beat as a real eviction.

`_narration_claims_outcome` used to be one long if/elif chain: once the eviction-claim regex
matched a sentence, EVERY later category (including the vote-tally check) was skipped outright —
even when the eviction branch itself concluded "this is a legitimate, correctly-named eviction."
So a sentence that both correctly reports an eviction AND fabricates a numeric tally in the same
breath ("the house votes to evict Alex, nine to one") slipped the phantom tally past the guard.
Separately, the tally branch required the `evicted` count to be UNMOVED, so a tally narrated in
the SAME beat as the real commit was architecturally exempt on a second, independent ground.

These tests pin the fix: a genuine eviction commit no longer suppresses the independent tally
check, and a numeric/spelled N-to-M tally is refused regardless of whether the commit already
landed (the engine never reveals an exact count, ever — only anonymized ballots, per-voter
attribution sealed until the 0048 retrospective). The vaguer "the majority voted…" language stays
unpoliced once a genuine, correctly-named eviction has landed (ordinary flavor, not a leak).
"""

import importlib

chat_helpers = importlib.import_module("routes.chat_helpers")


def _sig(**kw):
    base = {
        "week": 4, "phase": "eviction", "pending": None, "hoh": "npc:1",
        "noms": [], "nomNames": [], "activeNames": [], "vetoHolder": None,
        "vetoUsed": False, "evicted": 2, "evictedNames": [], "finished": False,
    }
    base.update(kw)
    return base


def test_a_correct_eviction_plus_a_fabricated_numeric_tally_is_still_a_desync():
    # The eviction itself is real and correctly named (count moved, evictee matches) — the OLD
    # if/elif chain would let the eviction-claim regex consume the sentence and never even reach
    # the tally check. The fabricated "nine to one" must still be caught.
    before = _sig(evicted=2, evictedNames=[], activeNames=["Real Evictee", "Bystander"])
    after = _sig(evicted=3, evictedNames=["Real Evictee"], activeNames=["Bystander"])
    out = chat_helpers._narration_claims_outcome(
        "By a vote of nine to one, the house votes to evict Real Evictee.", before, after,
    )
    assert out is not None
    assert "TALLY" in out or "RESULT" in out


def test_a_numeric_tally_is_a_desync_even_in_the_same_beat_as_a_real_commit():
    # BE-202 point 2: the tally branch used to require `evicted` UNMOVED — exempting a tally
    # narrated in the SAME beat as the real commit. A numeric count is never revealed, commit or not.
    before = _sig(evicted=2)
    after = _sig(evicted=3)  # the eviction genuinely committed THIS turn
    out = chat_helpers._narration_claims_outcome(
        "The vote comes in 8 to 1 to send them packing.", before, after,
    )
    assert out is not None
    assert "TALLY" in out or "RESULT" in out


def test_a_numeric_tally_pre_commit_is_still_caught_unmoved_count():
    before = _sig(evicted=2)
    after = _sig(evicted=2)  # nobody has left yet
    out = chat_helpers._narration_claims_outcome(
        "It looks like it will be ten to one.", before, after,
    )
    assert out is not None


def test_generic_majority_language_after_a_correctly_named_real_eviction_stays_clean():
    # The vaguer "the majority voted to evict X" is ordinary, tautologically-true flavor once a
    # real, correctly-named eviction has landed — not a leak of the sealed per-voter ballot, so it
    # must NOT be rail-corrected (ADR 0005 principle #1 — never police accurate creative prose).
    before = _sig(evicted=2, evictedNames=[], activeNames=["Real Evictee", "Bystander"])
    after = _sig(evicted=3, evictedNames=["Real Evictee"], activeNames=["Bystander"])
    assert chat_helpers._narration_claims_outcome(
        "The majority votes to evict Real Evictee.", before, after,
    ) is None
