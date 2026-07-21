"""L-F3 (#1742) — interactive beats soft-lock on exact phrasing.

An interactive beat (a premiere intro, a comp buzz-in) gates on a *specific* expected action and
used to stall INDEFINITELY on anything else: the live playtest repro looped the identical HOH-comp
trivia question 15 straight turns because "Let's keep the week moving — what's next?" was never
read as an answer. Root cause: the lull-gated advance-nudge (`_is_lull` + `_stale`) and the L39b
safety net both assume the player either disengages (a lull) or the model eventually calls the
tool it's waiting on — neither catches an ENGAGED player whose replies never match the exact
phrase the model invented, so `_is_lull` stays False turn after turn and the gate is re-presented
forever.

This module pins the fix: a loop-detection belt independent of the lull gate (fires on repetition
of the identical framed gate with an engaged-but-non-matching reply), plus the fix to
`_commit_advance_silently`'s false-success path (calling advanceGame against an open player
pending is a documented no-op, but used to be treated as real progress, silently resetting every
stall counter and letting the loop persist with no escalation ever landing).
"""
import os
import importlib

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*rel):
    with open(os.path.join(FRONTEND, *rel), encoding="utf-8") as f:
        return f.read()


def test_loop_break_config_present():
    js = _read("src", "agent_loop.py")
    assert "_LOOP_BREAK_THRESHOLD = 3" in js
    assert "_LOOP_LAST_FRAMED_KEY: Dict[str, tuple] = {}" in js
    assert "_LOOP_STREAK: Dict[str, int] = {}" in js
    assert "def _player_replied_engaged(messages)" in js
    assert "def _loop_break_streak_update(" in js
    assert "_ADVANCE_LOOP_BREAK_NUDGE = (" in js
    assert "_PENDING_LOOP_BREAK_NUDGE = (" in js


def test_loop_break_independent_of_lull_gate():
    # The belt's whole point (AC #1/#4): it folds into `_want_advance` alongside the lull-gated
    # clause, as an ALTERNATIVE — not a replacement — so it fires even when `_is_lull` is False
    # (an engaged, non-matching reply), while a genuine lull still routes through the existing gate.
    js = _read("src", "agent_loop.py")
    assert "_loop_stalled = _loop_break_streak_update(" in js
    assert "or (_loop_stalled and not _runway_holding)" in js
    assert '"content": _nudge' in js


def test_loop_break_never_fires_during_a_social_runway_hold():
    # Non-disruptive (AC #4): a deliberately-held social runway re-presents the SAME "social"
    # moment turn after turn by design — that must never read as a soft-lock. Source-pin the wiring;
    # the actual never-arms-during-a-hold behavior is proven by the behavioral test below.
    js = _read("src", "agent_loop.py")
    assert "runway_holding" in js
    assert "runway_holding=_runway_holding" in js


def test_pending_backed_loop_never_forces_submitdecision():
    # AC #3 / the mandate: a comp-buzz-in loop is broken by ESCALATING the ask (reduce to the
    # engine's literal legal options), never by inventing the player's binding pick. submitDecision
    # is never named as a forced tool_choice anywhere near the loop-break rung.
    js = _read("src", "agent_loop.py")
    assert "elif _loop_stalled and _pending_kind_at_read:" in js
    assert '_nudge, _why = _PENDING_LOOP_BREAK_NUDGE, "loop-break-pending"' in js
    assert "submitDecision" in js  # named only as WHERE the player's own choice is submitted


def test_pending_no_op_advance_no_longer_falsely_resets_counters():
    # The root cause the repro traced: advanceGame against an open player pending is a documented
    # no-op (the engine returns the pending unchanged), but a bare "no exception" success used to
    # be read as real progress, silently zeroing the stall/staleness counters every time it fired —
    # so the escalation ladder could never climb and the loop ran indefinitely with no rung ever
    # actually landing. Now the no-op is detected and reported as a non-progress (False).
    js = _read("src", "agent_loop.py")
    assert "_pending_kind_at_read = None" in js
    assert "_pend_after_kind == _pending_kind_at_read" in js
    assert "silent advanceGame NO-OP" in js
    assert "return False" in js  # the no-op path returns False, not a false success


def test_generic_intent_tolerance_named_in_the_escalation_text():
    # AC #2: "keep moving / what's next / skip it" must be treated as advance intent on a STALLED
    # beat, not ignored — stated explicitly in both escalation variants.
    js = _read("src", "agent_loop.py")
    assert "what's next" in js.lower()
    assert "keep moving" in js.lower()
    assert "skip it" in js.lower()


def test_player_replied_engaged_behavioral():
    al = importlib.import_module("src.agent_loop")
    mk = lambda txt: [{"role": "user", "content": txt}]
    # A real reply — however phrased, matching no lull regex at all — counts as engaged.
    assert al._player_replied_engaged(mk("I have no idea, let's just do something else"))
    assert al._player_replied_engaged(mk("what's next?"))  # also engaged (just not ONLY via regex)
    # Silence is not engagement.
    assert not al._player_replied_engaged(mk(""))
    assert not al._player_replied_engaged(mk("   "))
    # A hidden production cue is never the player.
    assert not al._player_replied_engaged(mk("(Production cue: continue the casting interview)"))


def test_loop_break_streak_update_behavioral():
    al = importlib.import_module("src.agent_loop")
    key = "test-user-l-f3"
    al._LOOP_STREAK.pop(key, None)
    al._LOOP_LAST_FRAMED_KEY.pop(key, None)
    gate = (1, "hoh-competition", "comp-round", "comp-round")

    # Same gate, engaged, no progress, no runway hold — three consecutive re-presentations arm it.
    assert not al._loop_break_streak_update(
        key, gate, progressed=False, runway_holding=False, pre_resolved=False, engaged=True)
    assert not al._loop_break_streak_update(
        key, gate, progressed=False, runway_holding=False, pre_resolved=False, engaged=True)
    assert al._loop_break_streak_update(
        key, gate, progressed=False, runway_holding=False, pre_resolved=False, engaged=True)


def test_loop_break_streak_resets_on_progress_or_beat_change():
    al = importlib.import_module("src.agent_loop")
    key = "test-user-l-f3-reset"
    al._LOOP_STREAK.pop(key, None)
    al._LOOP_LAST_FRAMED_KEY.pop(key, None)
    gate = (1, "hoh-competition", "comp-round", "comp-round")
    other_gate = (1, "hoh-competition", "comp-round", "comp-round-2")

    al._loop_break_streak_update(
        key, gate, progressed=False, runway_holding=False, pre_resolved=False, engaged=True)
    al._loop_break_streak_update(
        key, gate, progressed=False, runway_holding=False, pre_resolved=False, engaged=True)
    # A genuine progression resets the streak even mid-repetition.
    assert not al._loop_break_streak_update(
        key, gate, progressed=True, runway_holding=False, pre_resolved=False, engaged=True)
    assert al._LOOP_STREAK.get(key, 0) == 0

    al._LOOP_STREAK.pop(key, None)
    al._LOOP_LAST_FRAMED_KEY.pop(key, None)
    al._loop_break_streak_update(
        key, gate, progressed=False, runway_holding=False, pre_resolved=False, engaged=True)
    al._loop_break_streak_update(
        key, gate, progressed=False, runway_holding=False, pre_resolved=False, engaged=True)
    # A DIFFERENT gate (the beat genuinely moved on) resets the streak, not just any change.
    assert not al._loop_break_streak_update(
        key, other_gate, progressed=False, runway_holding=False, pre_resolved=False, engaged=True)
    assert al._LOOP_STREAK.get(key, 0) == 1  # this turn itself counts as streak=1 for the NEW gate


def test_loop_break_streak_never_arms_during_a_lull_only_silence():
    # Silence (an empty reply) never accumulates the loop-break streak — that's the ordinary lull
    # gate's job, not this belt's. Only an actual engaged reply counts.
    al = importlib.import_module("src.agent_loop")
    key = "test-user-l-f3-silence"
    al._LOOP_STREAK.pop(key, None)
    al._LOOP_LAST_FRAMED_KEY.pop(key, None)
    gate = (1, "premiere", "premiere")
    for _ in range(5):
        assert not al._loop_break_streak_update(
            key, gate, progressed=False, runway_holding=False, pre_resolved=False, engaged=False)
    assert al._LOOP_STREAK.get(key, 0) == 0


def test_loop_break_streak_never_arms_during_a_runway_hold():
    al = importlib.import_module("src.agent_loop")
    key = "test-user-l-f3-runway"
    al._LOOP_STREAK.pop(key, None)
    al._LOOP_LAST_FRAMED_KEY.pop(key, None)
    gate = (1, "veto-ceremony", "social")
    for _ in range(5):
        assert not al._loop_break_streak_update(
            key, gate, progressed=False, runway_holding=True, pre_resolved=False, engaged=True)
    assert al._LOOP_STREAK.get(key, 0) == 0
