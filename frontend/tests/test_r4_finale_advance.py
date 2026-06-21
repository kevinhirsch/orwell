"""R4-01 (real-LLM finding): the FINALE must auto-advance one beat per turn, like the eviction reveal.

With the real model (deepseek-v4-pro) the FINALE never completes — the game LOOPS at
moment=jury-finale / phase="finale" and never crowns a winner. Driving the engine's advanceGame
directly completes it cleanly (F2 opening statements → each finalist answers all 9 jurors → the
jury vote revealed one juror at a time → winner). So the ENGINE is healthy; the model simply
under-calls advanceGame through the long staged finale — the SAME under-call that bites the
eviction-vote reveal, which only progresses BECAUSE "eviction" is in _CEREMONY_RESOLVE_PHASES.

The fix: add the engine's finale phase to _CEREMONY_RESOLVE_PHASES so _pre_resolve_npc_ceremony
drives ONE finale beat per turn. The engine reports phase="finale" for every staged finale beat
(GameSessionAdapter.syncProjection → s.beat, which liveSeason sets to "finale"; "jury-finale" is
the MOMENT string, not the phase). The staged reveal is preserved (one beat per turn) and the
pending-decision guard still skips any beat where the player owes a decision (finale-statement /
finale-answer / juror-vote surface as status.pending → their card leads, never auto-resolved).

Mirrors the test style of tests/test_c02_ceremony_preresolve.py (the same _wire / monkeypatch
approach over orwell_engine.game_status / advance_game / get_game_state).
"""

import asyncio
import importlib
import os

import pytest

chat_helpers = importlib.import_module("routes.chat_helpers")
orwell_engine = importlib.import_module("src.orwell_engine")

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


@pytest.fixture(autouse=True)
def _clear_runway():
    """The social runway (the never-fast-forward fix) keeps process-local per-user state; clear it
    between cases so one test's armed runway never holds another's first advance."""
    chat_helpers.clear_social_runway("u")
    yield
    chat_helpers.clear_social_runway("u")


def _wire(monkeypatch, *, phase, pending, calls):
    async def fake_status(user=None):
        calls.append("status")
        return {"phase": phase, "pending": pending}

    async def fake_advance(expected_beat_seq=None, idempotency_key=None, user=None):
        # 0065 Part A/B: the FE-issued pre-resolve threads the optional sync-spine fields.
        calls.append("advance")
        return {"event": {"content": "a finalist gives an opening statement"}}

    async def fake_state(user=None, **kw):
        calls.append("state")
        # the next staged finale beat — still phase="finale" (the reveal stays at one signature)
        return {"started": True, "phase": "finale", "moment": "jury-finale"}

    monkeypatch.setattr(orwell_engine, "game_status", fake_status)
    monkeypatch.setattr(orwell_engine, "advance_game", fake_advance)
    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)


# ── Source-pin: the engine's finale phase is in the auto-advance coverage ─────────────────── #

def test_finale_phase_is_in_the_ceremony_resolve_set():
    # The exact phase string the engine reports for the staged finale (GameSessionAdapter:
    # this.phase = s.finished ? "finale" : s.beat; liveSeason sets the staged-finale beat to "finale").
    assert "finale" in chat_helpers._CEREMONY_RESOLVE_PHASES, (
        "the finale must auto-advance one beat per turn like the eviction reveal (R4-01)"
    )


def test_eviction_reveal_still_covered():
    # Regression guard: the original intent-free ceremonies stay covered — the finale is ADDED, not
    # a substitution.
    for phase in ("nominations", "veto-ceremony", "eviction", "finale"):
        assert phase in chat_helpers._CEREMONY_RESOLVE_PHASES, phase


# ── Behavioral: the belt now drives the finale, one beat per turn, guarding the player's cards ─ #

def test_drives_the_finale_with_no_player_pending(monkeypatch):
    # The staged finale sits at an unresolved engine-driven beat with NO player decision → advance
    # ONE beat for real so the moment carries the engine's real outcome (the model under-calls).
    calls = []
    _wire(monkeypatch, phase="finale", pending=None, calls=calls)
    state = {"started": True, "phase": "finale", "moment": "jury-finale"}
    _run(chat_helpers._pre_resolve_npc_ceremony("u", state, retry=False))
    assert "advance" in calls, "an unresolved finale beat must be advanced for real (R4-01)"


def test_advances_exactly_one_finale_beat_per_turn(monkeypatch):
    # CRITICAL: preserve the staged reveal — exactly ONE advanceGame per turn (never roll through the
    # ~29 finale beats in a single turn, which would wreck the dramatic staging, E12-style).
    calls = []
    _wire(monkeypatch, phase="finale", pending=None, calls=calls)
    state = {"started": True, "phase": "finale", "moment": "jury-finale"}
    _run(chat_helpers._pre_resolve_npc_ceremony("u", state, retry=False))
    assert calls.count("advance") == 1, "the staged finale reveal must walk ONE beat per turn"


@pytest.mark.parametrize("kind", ["finale-statement", "finale-answer", "juror-vote"])
def test_never_auto_resolves_a_player_finale_decision(monkeypatch, kind):
    # The pending-decision guard must stay intact: the player's OWN finale decisions (opening
    # statement, answering a juror, a player-juror's vote) surface as status.pending → their card
    # leads, NEVER auto-resolved by the belt.
    calls = []
    _wire(monkeypatch, phase="finale", pending={"kind": kind}, calls=calls)
    state = {"started": True, "phase": "finale", "moment": "jury-finale"}
    out = _run(chat_helpers._pre_resolve_npc_ceremony("u", state, retry=False))
    assert "advance" not in calls, "must never auto-resolve the player's own finale decision"
    assert out is state


def test_finale_is_best_effort_never_raises(monkeypatch):
    # An engine hiccup mid-resolve must leave the turn exactly as it was, never blow up the frame.
    async def boom(user=None):
        raise RuntimeError("engine blip")

    monkeypatch.setattr(orwell_engine, "game_status", boom)
    state = {"started": True, "phase": "finale", "moment": "jury-finale"}
    out = _run(chat_helpers._pre_resolve_npc_ceremony("u", state, retry=False))
    assert out is state
