"""Mobile casting short-circuit fix (feature 0050).

The casting interview force-finalized after only name+photo, minting a default-archetype
"floater with no stats." Root causes on the FE side:

  - hidden PRODUCTION CUES (the post-photo "continue the casting interview" auto-cue) read as a
    player "lull"/"ready" signal, marching the stall counter with no real player intent;
  - the FORCED createCharacter("{}") fired on name-only `ready` instead of the engine's higher
    `finalizable` floor;
  - cancelled/empty turns escalated the stall counter.

These pin the unit-testable FE seams (the deep streaming-loop fallback is exercised live).
"""

import importlib

agent_loop = importlib.import_module("src.agent_loop")


def _user(text):
    return [{"role": "user", "content": text}]


# --- hidden production cues are NOT a player lull -------------------------------------

def test_production_cue_is_detected():
    assert agent_loop._is_production_cue(
        "(Production cue — the cast photo step is done; continue the casting interview.)")
    # leading whitespace tolerated
    assert agent_loop._is_production_cue(
        "  (Production cue — begin the casting interview now.)")
    # ordinary player text is not a cue
    assert not agent_loop._is_production_cue("Let's continue the interview, I'm ready")
    assert not agent_loop._is_production_cue("")


def test_production_cue_is_not_a_lull():
    # The literal word "continue" inside an engine-authored cue must NOT register as a lull —
    # it would silently escalate the casting stall counter with no player intent.
    cue = ("(Production cue — the cast photo step is done; acknowledge it briefly, in character "
           "as the producers, and continue the casting interview.)")
    assert agent_loop._is_production_cue(cue)
    assert agent_loop._player_turn_is_lull(_user(cue)) is False


def test_real_player_continue_is_still_a_lull():
    # A genuine short player "continue" stays a lull (the error-correction net is preserved).
    assert agent_loop._player_turn_is_lull(_user("continue")) is True
    # Empty player turn is a lull.
    assert agent_loop._player_turn_is_lull(_user("")) is True


def test_substantive_player_turn_is_never_a_lull():
    long_scheme = ("I want to pull " + "x" * 100 + " into a final-two deal and gauge how they "
                   "feel about the people upstairs before anything else happens.")
    assert agent_loop._player_turn_is_lull(_user(long_scheme)) is False


# --- the forced finalize must require the engine's `finalizable`, not name-only `ready` ----

def test_finalizable_gate_constants_present():
    # The cue prefix the FE matches must align with what orwellOnboarding.js emits.
    assert agent_loop._PRODUCTION_CUE_PREFIX == "(Production cue"
    # the force threshold sits past the text rungs (unchanged contract)
    assert agent_loop._CASTING_FORCE_LEVEL == len(agent_loop._CASTING_NUDGES)
