"""#670 — the L39 forced-advance backstop must COVER the staged finale, without double-advancing.

The engine reports phase="finale" for every staged finale beat (GameSessionAdapter.syncProjection →
s.beat / "finale" when finished); the player-finalist's MOMENT is "jury-finale" and a player-juror's
is "jury". The agent loop's `_ADVANCE_PHASES` is matched against the engine PHASE, so the old
"jury-finale" entry was DEAD (a moment string, never a phase) — leaving the forced-advance backstop
blind to the long staged finale, exactly where the model most reliably under-calls advanceGame (#548
/ R4-01). The fix puts "finale" in the set.

Double-advance guard: the pre-resolve (`_CEREMONY_RESOLVE_PHASES`, which already covers "finale")
walks ONE finale beat per turn. So when the pre-resolve advanced a beat this turn, it marks a one-shot
flag the agent loop CONSUMES — treating the turn as already-progressed (staleness reset) AND
suppressing the backstop — so the backstop never advances a SECOND beat the same turn (which would
skip a finale-reveal beat, wrecking the E12-style staged jury vote).
"""

import asyncio
import importlib
import os

import pytest

agent_loop = importlib.import_module("src.agent_loop")
chat_helpers = importlib.import_module("routes.chat_helpers")
orwell_engine = importlib.import_module("src.orwell_engine")

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


@pytest.fixture(autouse=True)
def _clear_state():
    chat_helpers.clear_social_runway("u")
    chat_helpers._PRE_RESOLVED_ADVANCE.pop("u", None)
    yield
    chat_helpers.clear_social_runway("u")
    chat_helpers._PRE_RESOLVED_ADVANCE.pop("u", None)


# ── Source-pin: the engine's finale PHASE is in the forced-advance backstop coverage ──────────── #

def test_finale_phase_is_in_advance_phases():
    assert "finale" in agent_loop._ADVANCE_PHASES, (
        "the forced-advance backstop must cover the staged finale (phase='finale'), where the model "
        "most reliably under-calls advanceGame (#670)"
    )


def test_dead_jury_finale_moment_string_removed():
    # "jury-finale" is a MOMENT, never a phase — it never matched and gave a false sense of coverage.
    assert "jury-finale" not in agent_loop._ADVANCE_PHASES, (
        "'jury-finale' is a moment string, not a phase — it must not masquerade as backstop coverage"
    )


def test_weekly_advance_phases_still_covered():
    # Regression guard: the finale is ADDED, not a substitution — the weekly loop stays covered.
    for phase in ("premiere", "hoh-competition", "nominations", "veto-competition",
                  "veto-ceremony", "eviction", "finale", "twist-reveal"):
        assert phase in agent_loop._ADVANCE_PHASES, phase


def test_backstop_gate_guards_on_pre_resolved():
    # Source-pin: the end-of-turn advance/backstop block must be suppressed when the pre-resolve
    # already walked a beat this turn (the #670 double-advance guard).
    with open(os.path.join(FRONTEND, "src", "agent_loop.py"), encoding="utf-8") as f:
        src = f.read()
    assert "and not _pre_resolved:" in src, (
        "the advance backstop gate must include `not _pre_resolved` (no double-advance with the pre-resolve)"
    )
    assert "consume_pre_resolved_advance" in src, "the agent loop must consume the pre-resolve flag"


# ── The one-shot flag round-trips (set once, consumed once) ───────────────────────────────────── #

def test_pre_resolved_flag_is_one_shot():
    chat_helpers.mark_pre_resolved_advance("u")
    assert chat_helpers.consume_pre_resolved_advance("u") is True, "first consume sees the set flag"
    assert chat_helpers.consume_pre_resolved_advance("u") is False, "the flag is one-shot per turn"


def test_consume_is_false_when_never_marked():
    assert chat_helpers.consume_pre_resolved_advance("never-set") is False


# ── The pre-resolve SETS the flag when it walks a real finale beat ────────────────────────────── #

def _wire(monkeypatch, *, phase, pending, calls):
    async def fake_status(user=None):
        calls.append("status")
        return {"phase": phase, "pending": pending}

    async def fake_advance(expected_beat_seq=None, idempotency_key=None, user=None):
        calls.append("advance")
        return {"event": {"content": "the jury casts a vote"}}

    async def fake_state(user=None, **kw):
        calls.append("state")
        return {"started": True, "phase": "finale", "moment": "jury-finale"}

    monkeypatch.setattr(orwell_engine, "game_status", fake_status)
    monkeypatch.setattr(orwell_engine, "advance_game", fake_advance)
    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)


def test_pre_resolve_marks_the_flag_on_a_real_finale_advance(monkeypatch):
    calls = []
    _wire(monkeypatch, phase="finale", pending=None, calls=calls)
    state = {"started": True, "phase": "finale", "moment": "jury-finale"}
    _run(chat_helpers._pre_resolve_npc_ceremony("u", state, retry=False))
    assert "advance" in calls, "an unresolved finale beat must be advanced for real"
    # And the agent loop will now SEE that a beat was walked this turn → suppress its backstop.
    assert chat_helpers.consume_pre_resolved_advance("u") is True, (
        "a real pre-resolve advance must mark the one-shot flag so the backstop does not double-advance"
    )


def test_pre_resolve_does_not_mark_when_player_owes_a_finale_decision(monkeypatch):
    # A pending player finale decision is NOT auto-resolved → no advance → no flag → the (separate)
    # decision card leads. (Forcing advanceGame here would be a no-op anyway, but the flag must be clean.)
    calls = []
    _wire(monkeypatch, phase="finale", pending={"kind": "finale-statement"}, calls=calls)
    state = {"started": True, "phase": "finale", "moment": "jury-finale"}
    _run(chat_helpers._pre_resolve_npc_ceremony("u", state, retry=False))
    assert "advance" not in calls
    assert chat_helpers.consume_pre_resolved_advance("u") is False
