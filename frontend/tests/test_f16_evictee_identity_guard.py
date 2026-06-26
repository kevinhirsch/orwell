"""F16 (#1014) — the FABRICATED / WRONG-EVICTEE outcome guard.

The pre-emission outcome guard was count-only and identity-blind: it caught "X is evicted" only
when the evicted COUNT didn't move, and only inside the eviction phase. Two real live-play failures
slipped through:

  (a) the model narrates "the majority votes to evict <wrong active HG>" while the engine tallies a
      DIFFERENT evictee — the count DID move (someone left), so the count check passed it, and a
      player trusting the chat believes the wrong person went home; and
  (b) the model narrates a committed eviction RESULT ahead of phase (e.g. during veto-competition),
      which no count check covered (mid-comp the count legitimately equals before).

These structural tests drive `_narration_claims_outcome` (which both the post-turn and the
pre-emission guard reuse) with crafted (sentence, before/after signature) pairs. No live LLM —
they prove the guard LOGIC. They must FAIL on pre-fix main and PASS after the F16 fix.

Roles only, per the testing rules — the names here are throwaway TOKENS used solely to exercise the
identity comparison, never canonical cast.
"""

import importlib

chat_helpers = importlib.import_module("routes.chat_helpers")


def _sig(**kw):
    base = {
        "week": 4, "phase": "eviction", "pending": None, "hoh": "npc:1",
        "noms": [], "nomNames": [], "activeNames": [], "vetoHolder": None,
        "vetoUsed": False, "evicted": 2, "evictedNames": [], "finished": False,
        "room": None, "present": [],
    }
    base.update(kw)
    return base


# ── (a) WRONG evictee named while SOMEONE really left ──────────────────────── #

def test_majority_votes_to_evict_a_wrong_active_houseguest_is_held():
    """The narration names an ACTIVE houseguest as the evictee, but the engine evicted someone ELSE
    this turn (the evictedNames delta names a different person). A fabricated/wrong evictee → HOLD."""
    active = ["Wrong One", "Real Evictee", "Bystander"]
    before = _sig(phase="eviction", evicted=2, evictedNames=["Old A", "Old B"], activeNames=active)
    # someone really left — but it was "Real Evictee", NOT the "Wrong One" the model named.
    after = _sig(phase="eviction", evicted=3,
                 evictedNames=["Old A", "Old B", "Real Evictee"], activeNames=["Wrong One", "Bystander"])
    out = chat_helpers._narration_claims_outcome(
        "And the majority votes to evict Wrong One — Wrong One is leaving the house tonight.",
        before, after,
    )
    assert out is not None
    assert out and "RE-GROUND" in out
    assert "WRONG evictee" in out
    # Name-free + count-free: the directive must NOT pre-announce the real evictee or a count.
    assert "Real Evictee" not in out
    assert "3" not in out.split("week", 1)[0]  # no stray tally before the board line


def test_correct_evictee_named_in_phase_is_clean():
    """The narration names the houseguest the engine ACTUALLY just evicted → EMIT (no false alarm)."""
    before = _sig(phase="eviction", evicted=2, evictedNames=["Old A", "Old B"],
                  activeNames=["Real Evictee", "Bystander"])
    after = _sig(phase="eviction", evicted=3, evictedNames=["Old A", "Old B", "Real Evictee"],
                 activeNames=["Bystander"])
    assert chat_helpers._narration_claims_outcome(
        "The votes are in, and Real Evictee is evicted from the house.", before, after,
    ) is None


def test_first_name_of_a_full_name_evictee_is_clean():
    """The model commonly uses a first name for a full-name HG. 'Real' must match 'Real Evictee'
    in the just-evicted delta → EMIT, not a false 'wrong evictee' flag."""
    before = _sig(phase="eviction", evicted=2, evictedNames=[], activeNames=["Real Evictee", "Bystander"])
    after = _sig(phase="eviction", evicted=3, evictedNames=["Real Evictee"], activeNames=["Bystander"])
    assert chat_helpers._narration_claims_outcome(
        "By a wide margin, Real is going home tonight.", before, after,
    ) is None
    # also via the "votes to evict <name>" phrasing
    assert chat_helpers._narration_claims_outcome(
        "The majority votes to evict Real.", before, after,
    ) is None


# ── (b) AHEAD-OF-PHASE committed-eviction claim ────────────────────────────── #

def test_eviction_result_claimed_during_veto_competition_is_held():
    """A committed-eviction result narrated while the engine sits at veto-competition (count unmoved)
    is a phantom by construction — no eviction commits outside the eviction beat → HOLD."""
    before = _sig(phase="veto-competition", evicted=2)
    after = _sig(phase="veto-competition", evicted=2)
    out = chat_helpers._narration_claims_outcome(
        "The majority votes to evict the nominee; they are leaving the house tonight.",
        before, after,
    )
    assert out and "RE-GROUND" in out
    assert "before the eviction" in out


def test_eviction_result_during_nominations_is_held():
    before = _sig(phase="nominations", evicted=1)
    after = _sig(phase="nominations", evicted=1)
    out = chat_helpers._narration_claims_outcome(
        "After the vote, the houseguest is evicted from the house.", before, after,
    )
    assert out and "before the eviction" in out


def test_real_eviction_whose_phase_already_rolled_is_clean():
    """A genuine eviction whose count MOVED but whose phase already rolled past `eviction` (to the
    next week's HOH) must NOT be flagged ahead-of-phase — the count moving proves it was real."""
    before = _sig(phase="eviction", evicted=2)
    after = _sig(phase="hoh-competition", evicted=3)  # rolled to next week, someone really left
    assert chat_helpers._narration_claims_outcome(
        "One houseguest is evicted from the house tonight.", before, after,
    ) is None


def test_eviction_result_in_eviction_phase_count_unmoved_still_held():
    """The original count-only branch still fires inside the eviction phase (no one left yet)."""
    before = _sig(phase="eviction", evicted=2)
    after = _sig(phase="eviction", evicted=2)
    out = chat_helpers._narration_claims_outcome(
        "The house has spoken — the nominee is evicted.", before, after,
    )
    assert out and "EVICTION" in out


# ── the broadened claim pattern reaches the pre-filter ─────────────────────── #

def test_broadened_claim_phrasings_are_caught_by_the_prefilter():
    """The pre-emission hot-loop pre-filter must see the new result phrasings so they reach the
    live-board verify (else the wrong evictee streams to the player un-checked)."""
    for s in (
        "The majority votes to evict the nominee.",
        "The nominee is leaving the house.",
        "She is going home tonight.",
        "He is sent home by a unanimous vote.",
    ):
        assert chat_helpers._sentence_has_closed_set_claim(s), s


def test_conditional_and_room_move_prose_is_not_flagged():
    """Conservatism (the original guard's care preserved through the broadening): a CONDITIONAL
    ('if you get evicted…') and a ROOM move ('leaving the kitchen') must NOT fabricate a desync on
    a clean board. A false hold on creative prose is worse than a missed phantom (ADR 0005 #1)."""
    for s in (
        "They sit by the pool and trade reads on the house.",
        "If you get evicted, the jury still respects a clean game.",  # conditional, not a result
        "He is leaving the kitchen to go to the backyard.",  # room move, not the house
        "She might be going home if the vote flips, but nothing is decided.",  # speculation
    ):
        before = _sig(phase="social", evicted=2)
        after = _sig(phase="social", evicted=2)
        assert chat_helpers._narration_claims_outcome(s, before, after) is None, s
