"""ADR 0011 — the concurrent two-tab agent-loop fix (the "20-step loop" / "freakout").

Two tabs on one game serialize their turns (0064 Messenger single-flight), but the agent loop's
per-turn staleness clock is beat-BLIND: it counts turns where THIS turn fired no progression tool
and cannot tell "I (the model) failed to advance" from "a concurrent PEER advanced the beat" (a
decision-card submit / a turn on another device). That conflation re-fires the advance / forced-
advance nudge against a beat a peer already moved, spinning the loop to agent_max_rounds.

The fix (server-side signal correctness only — NO client turn-lock; the 0064 Messenger ruling
stands): the loop compares the engine's CURRENT beat key to the one the model was FRAMED on this
turn (stashed by apply_game_framing); if it moved with no progression this turn, a peer did — reset
the staleness clock and suppress the nudge. Plus the A-S5 hardening: the stale-beat reconcile keys
off the engine's STRUCTURED 409 body (code/beatSeq), not the human-readable message prose.
"""
import os

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*rel):
    with open(os.path.join(FRONTEND, *rel), encoding="utf-8") as f:
        return f.read()


def _run(coro):
    # Match the codebase convention (e.g. test_t20 / test_0065): drive a coroutine on the SHARED
    # event loop via run_until_complete — never asyncio.run() and never an `async def` test, both of
    # which CLOSE the loop and break the many legacy sync tests that do get_event_loop() after us.
    import asyncio
    try:
        loop = asyncio.get_event_loop()
        if loop.is_closed():
            raise RuntimeError
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    return loop.run_until_complete(coro)


# ── The peer-advance detector (pure, behavioral) ──────────────────────────────

def test_peer_advance_detected_when_beat_moved_without_progression():
    from src.agent_loop import _peer_advanced_since_framing
    # framed on (week 1, eviction); engine now on (week 2, hoh-competition) and THIS turn fired no
    # progression tool → a serialized PEER advanced the beat.
    framed = (1, "eviction", "eviction")
    current = (2, "hoh-competition", "hoh-competition")
    assert _peer_advanced_since_framing(False, framed, current) is True


def test_no_peer_advance_when_this_turn_progressed():
    from src.agent_loop import _peer_advanced_since_framing
    # the beat moved, but THIS turn progressed it (advanceGame/submitDecision) → not a peer, so the
    # normal post-advance cleanup applies, never the peer-suppression.
    framed = (1, "eviction", "eviction")
    current = (2, "hoh-competition", "hoh-competition")
    assert _peer_advanced_since_framing(True, framed, current) is False


def test_no_peer_advance_when_beat_unchanged_single_tab_byte_identical():
    from src.agent_loop import _peer_advanced_since_framing
    # the single-tab common case: the beat sits exactly where the model was framed → no suppression,
    # so the existing stall-nudge behaves byte-identically (the seeded UAT/calibration gates hold).
    key = (1, "hoh-competition", "hoh-competition")
    assert _peer_advanced_since_framing(False, key, key) is False


def test_peer_advance_fails_safe_on_unknown_keys():
    from src.agent_loop import _peer_advanced_since_framing
    # an unknown framing/current key (a cold turn, a fetch hiccup) must NOT suppress a stall — fail
    # toward NOT suppressing (a missed suppression is recoverable; a wrong one would freeze a genuine
    # single-tab stall).
    key = (1, "hoh-competition", "hoh-competition")
    assert _peer_advanced_since_framing(False, None, key) is False
    assert _peer_advanced_since_framing(False, key, None) is False
    assert _peer_advanced_since_framing(False, None, None) is False


# ── T0-1: the framed-4-tuple vs raw-3-tuple comparator fix (#1019 follow-up) ──
# `chat_helpers._LAST_FRAMED_BEAT_KEY` folds an open pending's `kind` in as a 4th tuple element
# whenever a pending was open AT FRAMING TIME (F9/#1019). The agent loop's own current-turn read
# (`_beat_key_at_read`) is always the bare (week, phase, moment) 3-tuple. Before this fix, comparing
# a 4-tuple to a 3-tuple is NEVER equal in Python regardless of content, so EVERY single-tab turn
# where a pending was still open at framing read as "a peer advanced" — wiping the stall counters
# and vetoing the stall-escalation rescue for the pending's entire lifetime (a real 17-turn livelock
# at a veto/eviction pending in live play). The fix: the comparator normalizes the current key with
# the SAME conditional 4th-element rule, using the pending kind read at the SAME turn.

def test_single_tab_pending_open_turn_is_not_misread_as_peer_advance():
    from src.agent_loop import _peer_advanced_since_framing
    # framed WITH an open pending (the 4-tuple #1019 shape) — the model was grounded on this beat
    # while a comp-intent / veto / eviction-vote pending sat open.
    framed = (1, "eviction", "eviction", "eviction-vote")
    # this turn's OWN read of the SAME still-open pending (single tab: nothing else touched it) —
    # same week/phase/moment, same pending kind.
    current = (1, "eviction", "eviction")
    current_pending_kind = "eviction-vote"
    # no progression tool fired this turn (a lull) — this is exactly the shape of the livelock.
    assert _peer_advanced_since_framing(False, framed, current, current_pending_kind) is False


def test_pending_open_and_resolved_mid_turn_still_detected_as_peer_advance():
    from src.agent_loop import _peer_advanced_since_framing
    # framed WITH an open pending; by the time THIS turn reads state, the pending resolved (a peer's
    # decision-card POST, or another device's turn) — the #1019 case the 4th element exists to catch.
    framed = (1, "eviction", "eviction", "eviction-vote")
    current = (1, "eviction", "eviction")
    assert _peer_advanced_since_framing(False, framed, current, None) is True


def test_pending_kind_changed_mid_turn_is_a_peer_advance():
    from src.agent_loop import _peer_advanced_since_framing
    # the pending at framing and the pending at read are BOTH open but of a DIFFERENT kind — someone
    # else resolved the old one and a new one opened (still no week/phase/moment change).
    framed = (1, "eviction", "eviction", "comp-intent")
    current = (1, "eviction", "eviction")
    assert _peer_advanced_since_framing(False, framed, current, "eviction-vote") is True


def test_call_site_threads_this_turns_pending_kind_into_the_comparator():
    js = _read("src", "agent_loop.py")
    # the call site must pass the SAME-turn pending kind so the comparator can normalize shapes —
    # a regression here silently reintroduces the 4-tuple-vs-3-tuple false-positive.
    assert ("_peer_advanced_since_framing(_progressed, _framed_beat_key, _beat_key_at_read,\n"
            "                                                        _pending_kind_at_read):") in js


# ── The wiring (source-pins: the stash, the gate, the clock reset) ────────────

def test_framing_stashes_the_beat_key():
    js = _read("routes", "chat_helpers.py")
    assert "_LAST_FRAMED_BEAT_KEY" in js
    # stashed from the SAME game_state framing already reads (zero extra engine call). The base key is
    # (week, phase, moment); F9 (#1019) folds the open pending's `kind` in as a 4th element so an
    # out-of-band decision-card POST that resolves the pending flips the key.
    assert '(game_state.get("week"), game_state.get("phase"), moment)' in js
    assert "_pending_kind" in js


def test_advance_nudge_is_gated_on_not_peer_advanced():
    js = _read("src", "agent_loop.py")
    assert "_peer_advanced_since_framing(" in js
    # the advance / forced-advance branch no longer fires when a peer moved the beat (nor when the
    # pre-resolve already walked a beat this turn — the #670 double-advance guard, same precedent)
    assert "if _want_advance and _phase in _ADVANCE_PHASES and not _peer_advanced and not _pre_resolved:" in js
    # a detected peer-advance resets the staleness clock + clears the persisted escalation. NAR-1:
    # keyed via `_belt_key` (was raw `owner`, gated `if owner:` — inert single-tenant).
    assert "_peer_advanced = True" in js
    assert "_TURNS_SINCE_PROGRESS[_belt_key(owner)] = 0" in js


# ── A-S5: stale-beat reconcile keys off the STRUCTURED 409 body, not the prose ─

def test_stale_beat_recognised_by_structured_code_despite_drifted_message():
    from src.orwell_engine import EngineToolError
    from routes import chat_helpers as ch
    # a 409 whose MESSAGE wording drifted (no "stale write refused" marker) but which carries the
    # engine's stable machine code → still recognised as stale-beat (A-S5: the wording-drift fail-
    # closed can no longer happen).
    drifted = EngineToolError("the board moved on; the write was refused", status=409,
                              code="stale-beat", beat_seq=42)
    assert ch._is_stale_beat_error(drifted) is True


def test_non_stale_409_is_not_misread_as_stale_beat():
    from src.orwell_engine import EngineToolError
    from routes import chat_helpers as ch
    # a DIFFERENT 409 (an integrity TurnRefusedError) carries no stale-beat code and no marker.
    refused = EngineToolError("turn refused: integrity checkpoint failed", status=409)
    assert ch._is_stale_beat_error(refused) is False


def test_legacy_string_marker_still_recognised_when_no_code():
    from src.orwell_engine import EngineToolError
    from routes import chat_helpers as ch
    # backward-compat: an older engine (no structured code) still reconciles via the message marker.
    legacy = EngineToolError("stale write refused (now 7)", status=409)
    assert ch._is_stale_beat_error(legacy) is True


def test_handle_stale_beat_refreshes_from_structured_beat_seq(monkeypatch):
    from src.orwell_engine import EngineToolError
    from routes import chat_helpers as ch

    async def _noop(_user):
        return None
    monkeypatch.setattr(ch, "_capture_beat_signature", _noop)
    user = "adr0011-test-user"
    ch._LAST_BEAT_SEQ.pop(user, None)
    # the fresh beatSeq is in the STRUCTURED field, NOT the message ("now N" absent)
    exc = EngineToolError("the write was refused", status=409, code="stale-beat", beat_seq=99)
    _run(ch._handle_stale_beat(user, exc))
    assert ch._LAST_BEAT_SEQ.get(user) == 99


def test_handle_stale_beat_falls_back_to_message_marker(monkeypatch):
    from src.orwell_engine import EngineToolError
    from routes import chat_helpers as ch

    async def _noop(_user):
        return None
    monkeypatch.setattr(ch, "_capture_beat_signature", _noop)
    user = "adr0011-test-user-2"
    ch._LAST_BEAT_SEQ.pop(user, None)
    # no structured beat_seq → parse the legacy "(now N)" marker
    exc = EngineToolError("stale write refused (now 13)", status=409)
    _run(ch._handle_stale_beat(user, exc))
    assert ch._LAST_BEAT_SEQ.get(user) == 13


# ── The thin client surfaces the structured 409 fields ───────────────────────

def test_engine_tool_error_carries_structured_fields():
    from src.orwell_engine import EngineToolError
    exc = EngineToolError("x", status=409, code="stale-beat", beat_seq=5, board={"week": 2})
    assert exc.code == "stale-beat"
    assert exc.beat_seq == 5
    assert exc.board == {"week": 2}
    # default (no structured body) → all None, byte-identical to the old 3-arg construction
    plain = EngineToolError("y", status=400)
    assert plain.code is None and plain.beat_seq is None and plain.board is None


def test_thin_client_capture_pins():
    js = _read("src", "orwell_engine.py")
    # the thin client reads the structured body and threads code/beatSeq/board onto the error
    assert 'body.get("code")' in js
    assert "beat_seq=" in js
    assert 'board=body.get("board")' in js


# ── FE render-bounding: silent beats + the rail cap (both live + reload paths) ─

def test_silent_beats_cover_the_pure_context_reads():
    js = _read("static", "js", "orwellToolBeats.js")
    assert "ORWELL_SILENT_BEATS" in js
    assert "export function orwellBeatIsSilent" in js
    assert "ORWELL_MAX_VISIBLE_BEATS" in js
    # the noisy pure reads that stack as identical "Production notes" rows are covered
    for tool in ("getGameState", "gameStatus", "getMomentPrompt", "whereabouts", "socialRead"):
        assert f"'{tool}'" in js, tool


def test_live_path_suppresses_silent_beats_and_caps_the_rail():
    js = _read("static", "js", "chat.js")
    # a pure-read beat renders NO chip in the game build…
    assert "orwellBeatIsSilent(json.tool) && isGameBuild()" in js
    # …and clears currentToolBubble so the paired tool_output is skipped (next real beat re-arms it)
    assert "currentToolBubble = null;" in js
    # the rail is capped as a backstop
    assert "ORWELL_MAX_VISIBLE_BEATS" in js


def test_reload_path_suppresses_silent_beats_and_caps_the_rail():
    js = _read("static", "js", "chatRenderer.js")
    # the reload path filters silent beats out before rendering chips (mirror of live)…
    assert "orwellBeatIsSilent" in js
    assert "_visibleTools" in js
    # …and caps the re-painted rail
    assert "ORWELL_MAX_VISIBLE_BEATS" in js
