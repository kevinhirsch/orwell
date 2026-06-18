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
    assert "_tool_names & _PROGRESSION_TOOLS" in js
    # the per-turn cap guards the loop; the persisted level sets message forcefulness
    assert "_turn_advance_nudges < _MAX_ADVANCE_NUDGES_PER_TURN" in js
    assert "_ADVANCE_STALL_LEVEL.get(owner" in js
    # nudging continues the loop (gives the model another step), it does not auto-advance
    assert "_ADVANCE_NUDGES[min(_level" in js
    assert '"content": _nudge' in js


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
    # the advance-nudge fires on a lull, OR on a previewed-but-uncommitted outcome (hand-off #1)
    assert "_want_advance = ((not _progressed)" in js
    assert "(_previewed_uncommitted or (_is_lull and _stale))" in js
    assert "if _want_advance and _phase in _ADVANCE_PHASES" in js
    # …and only once the beat has gone STALE (owner ruling 2026-06-18): a lull alone is not enough,
    # so good engaging play and a just-started beat are never shoved.
    assert "_ADVANCE_GRACE_TURNS" in js
    assert "_TURNS_SINCE_PROGRESS" in js
    assert "and _stale" in js


def test_previewed_but_uncommitted_ceremony_is_a_hard_stall(self_check=None):
    # Hand-off #1 (HIGH): previewing a ceremony OUTCOME (runCompetition) in an advance-phase and not
    # committing it (advanceGame) is a hard stall — it bypasses the lull/staleness gate and gets the
    # forceful commit nudge immediately, because the board now contradicts the narration.
    js = _read("src", "agent_loop.py")
    assert '_PREVIEW_TOOLS = {"runCompetition"}' in js
    assert "_PREVIEW_COMMIT_NUDGE" in js
    assert "_previewed_uncommitted = bool(_tool_names & _PREVIEW_TOOLS) and not _progressed" in js
    # the forceful nudge is chosen for the previewed case (not the gentle graduated one)
    assert "_PREVIEW_COMMIT_NUDGE if _previewed_uncommitted" in js


def test_consequence_loop_auto_records_engaged_scenes():
    # Feature 0055: substantive social play MUST fold into the hidden weights. The model under-calls
    # recordInteraction even when nudged, so when an ENGAGED turn touched a houseguest and recorded
    # nothing, the FE GUARANTEES the fold itself via a constrained extraction + recordInteraction.
    js = _read("src", "agent_loop.py")
    assert "_RECORD_TOOLS" in js
    for tool in ('"recordInteraction"', '"makeDeal"', '"surfaceInformationTo"'):
        assert tool in js, tool
    assert "_scene_touched_houseguest" in js
    assert "async def _auto_record_scene" in js
    # the auto-record proposes a model kind + validates ids, then records via the engine
    assert "_RECORD_KINDS" in js
    assert "record_interaction(content" in js
    assert "_oe.record_interaction" in js
    # gated on engagement (not a lull) + a houseguest scene + nothing recorded + NOT a beat-advance
    assert "(not _recorded) and (not _is_lull) and (not _progressed)" in js
    assert "_scene_touched_houseguest(" in js
    assert "_want_record and _touched" in js
    assert "await _auto_record_scene(" in js
    # model-driven recording takes precedence (a fired record tool suppresses the auto path)
    assert "block.tool_type in _RECORD_TOOLS" in js


def test_scene_touched_houseguest_detection():
    import importlib
    al = importlib.import_module("src.agent_loop")
    house = ["Trevor Leach", "Dawn Reynolds", "Ada Sharma"]
    mk = lambda txt: [{"role": "user", "content": txt}]
    # narration names a houseguest → a scene happened
    assert al._scene_touched_houseguest("I pull Trevor aside and make my pitch.", mk("hi"), house)
    # the player's own line names one (first name) → scene
    assert al._scene_touched_houseguest("", mk("Let me find Dawn and work her for the veto."), house)
    # nobody named → not a houseguest scene
    assert not al._scene_touched_houseguest("I sit alone in the backyard and think.", mk("just thinking"), house)
    # no roster → never a false positive
    assert not al._scene_touched_houseguest("I talk to Trevor.", mk("hi"), [])


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
