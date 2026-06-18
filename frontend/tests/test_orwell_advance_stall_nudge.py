"""Engine progression error-correction — the agent-loop stall-nudge.

The GM reliably narrates a beat (a competition, a ceremony, the premiere move-in) WITHOUT
ever calling advanceGame, freezing the season (the #1 playthrough blocker, robust even on
strong models). Per the owner's ruling we keep the dynamic DM and ERROR-CORRECT the omission:
when the live game sits in a phase that exists to be driven forward and the turn fired no
progression tool, nudge the model in-loop — non-disruptive first, escalating, capped, tunable.

Source-pins (the behavior runs against the real engine in the play-through harness).
"""
import os

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*rel):
    with open(os.path.join(FRONTEND, *rel), encoding="utf-8") as f:
        return f.read()


def test_stall_nudge_config_present():
    js = _read("src", "agent_loop.py")
    assert "_ADVANCE_PHASES" in js
    # the phases that must be driven forward are covered
    for phase in ("premiere", "hoh-competition", "nominations", "veto-competition",
                  "veto-ceremony", "eviction", "jury-finale"):
        assert f'"{phase}"' in js, phase
    assert "_PROGRESSION_TOOLS" in js
    assert '"advanceGame"' in js and '"submitDecision"' in js
    # three graduated rungs: gentle → firmer → forceful
    assert "_ADVANCE_NUDGES = [" in js
    assert js.count("# 1 — gentle") == 1
    assert "STOP. The game is FROZEN" in js              # the forceful rung
    assert "_MAX_ADVANCE_NUDGES_PER_TURN" in js          # in-loop cap
    assert "_ADVANCE_STALL_LEVEL" in js                  # persisted cross-turn escalation


def test_stall_nudge_fires_only_for_live_game_at_a_beat_with_no_progress():
    js = _read("src", "agent_loop.py")
    # gated on a live season, an advance-phase, and NO progression tool this turn
    assert "_is_live_game = game_mode in (True, \"game\")" in js
    assert "_phase in _ADVANCE_PHASES" in js
    assert "in _PROGRESSION_TOOLS" in js and "if not _progressed:" in js
    # the per-turn cap guards the loop; the persisted level sets message forcefulness
    assert "_turn_advance_nudges < _MAX_ADVANCE_NUDGES_PER_TURN" in js
    assert "_ADVANCE_STALL_LEVEL.get(owner" in js
    # nudging continues the loop (gives the model another step), it does not auto-advance
    assert "messages.append({\"role\": \"system\", \"content\": _nudge})" in js


def test_stall_escalation_resets_when_the_game_advances():
    js = _read("src", "agent_loop.py")
    # a fired progression tool clears the persisted escalation for that game
    assert "block.tool_type in _PROGRESSION_TOOLS and owner:" in js
    assert "_ADVANCE_STALL_LEVEL.pop(owner, None)" in js


def test_nudge_only_seizes_a_lull_not_substantive_play():
    # Pacing is engagement, not a turn count (owner ruling): substantive social play runs
    # indefinitely; we only nudge progression on a LULL (short/closing reply or an explicit
    # readiness signal) that the model failed to seize.
    js = _read("src", "agent_loop.py")
    assert "_player_turn_is_lull" in js
    assert "_LULL_READY_RE" in js
    assert "_LULL_SHORT_CHARS" in js
    # the nudge is gated on the lull check, alongside the advance-phase + no-progress gates
    assert "_phase in _ADVANCE_PHASES and _player_turn_is_lull(messages)" in js


def test_lull_detection_engagement_vs_lull():
    # Behavioral: load the helper and check it reads engagement, not length-as-count.
    import importlib
    al = importlib.import_module("src.agent_loop")
    mk = lambda txt: [{"role": "user", "content": txt}]
    # lulls / readiness
    assert al._player_turn_is_lull(mk("ok"))
    assert al._player_turn_is_lull(mk("let's go"))
    assert al._player_turn_is_lull(mk("what's next?"))
    assert al._player_turn_is_lull(mk("alright, I'm ready — bring it on"))
    # substantive social play is NOT a lull
    rich = ("I find Dawn away from the noise and make my case quietly: she barely knows me, "
            "Ava put me up as a number not a threat, and using the veto on me costs her nothing "
            "but buys someone who remembers it. I want to read how she takes that before I push.")
    assert not al._player_turn_is_lull(mk(rich))
