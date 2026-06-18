"""C-02 (critical — engine bypass): pre-resolve NPC-driven ceremonies before the model's turn.

Found in live play: on an NPC-HOH nominations beat the GM narrated invented nominees ("Summer")
while the engine sat at phase=nominations / noms=[] / pending=None — it never called advanceGame,
desyncing the chat from the deterministic board. The fix RESOLVES the beat for real during framing
so the moment prompt carries the engine's actual outcome ("facts to voice, never scripts to recite").
"""

import asyncio
import importlib

import pytest

chat_helpers = importlib.import_module("routes.chat_helpers")
orwell_engine = importlib.import_module("src.orwell_engine")


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _wire(monkeypatch, *, phase, pending, calls):
    async def fake_status(user=None):
        calls.append("status")
        return {"phase": phase, "pending": pending}

    async def fake_advance(user=None):
        calls.append("advance")
        return {"event": {"content": "HOH nominates A and B"}}

    async def fake_state(user=None, **kw):
        calls.append("state")
        return {"started": True, "phase": "veto-competition", "moment": "veto-competition", "nominees": ["A", "B"]}

    monkeypatch.setattr(orwell_engine, "game_status", fake_status)
    monkeypatch.setattr(orwell_engine, "advance_game", fake_advance)
    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)


def test_resolves_an_npc_ceremony_with_no_player_pending(monkeypatch):
    calls = []
    _wire(monkeypatch, phase="nominations", pending=None, calls=calls)
    state = {"started": True, "phase": "nominations", "moment": "nominations", "nominees": []}
    out = _run(chat_helpers._pre_resolve_npc_ceremony("u", state, retry=False))
    assert "advance" in calls, "an unresolved NPC ceremony must be advanced for real"
    assert out.get("nominees") == ["A", "B"], "framing must carry the engine's real outcome forward"


def test_never_forces_a_player_decision(monkeypatch):
    # The player IS the decider (HOH naming noms) → a pending is present → DO NOT advance.
    calls = []
    _wire(monkeypatch, phase="nominations", pending={"kind": "nominations"}, calls=calls)
    state = {"started": True, "phase": "nominations", "moment": "nominations", "nominees": []}
    out = _run(chat_helpers._pre_resolve_npc_ceremony("u", state, retry=False))
    assert "advance" not in calls, "must never auto-resolve the player's own decision"
    assert out is state


def test_only_fires_at_a_ceremony_phase(monkeypatch):
    # A comp / social / premiere beat is owned by its own flow (comp-intent, runCompetition) — skip.
    calls = []
    _wire(monkeypatch, phase="hoh-competition", pending=None, calls=calls)
    state = {"started": True, "phase": "hoh-competition", "moment": "hoh-competition"}
    out = _run(chat_helpers._pre_resolve_npc_ceremony("u", state, retry=False))
    assert calls == [], "no status probe / advance off a non-ceremony phase"
    assert out is state


@pytest.mark.parametrize("phase", ["nominations", "veto-ceremony", "eviction"])
def test_covers_every_intent_free_ceremony(monkeypatch, phase):
    calls = []
    _wire(monkeypatch, phase=phase, pending=None, calls=calls)
    state = {"started": True, "phase": phase, "moment": phase}
    _run(chat_helpers._pre_resolve_npc_ceremony("u", state, retry=False))
    assert "advance" in calls, phase


def _wire_veto(monkeypatch, *, players, pending, calls):
    """C-03: a veto-competition beat. `players` is the drawn-six list gameStatus reports."""
    async def fake_status(user=None):
        calls.append("status")
        return {"phase": "veto-competition", "pending": pending, "veto": {"holder": None, "used": False, "players": players}}

    async def fake_advance(user=None):
        calls.append("advance")
        return {"event": {"content": "the veto players are drawn: A, B, C, D, E, F"}}

    async def fake_state(user=None, **kw):
        calls.append("state")
        return {"started": True, "phase": "veto-competition", "moment": "veto-competition"}

    monkeypatch.setattr(orwell_engine, "game_status", fake_status)
    monkeypatch.setattr(orwell_engine, "advance_game", fake_advance)
    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)


def test_veto_draw_runs_when_no_field_is_drawn_yet(monkeypatch):
    # The chip draw has not run (no drawn players) and no player decision is pending → draw for real.
    calls = []
    _wire_veto(monkeypatch, players=[], pending=None, calls=calls)
    state = {"started": True, "phase": "veto-competition", "moment": "veto-competition"}
    _run(chat_helpers._pre_resolve_npc_ceremony("u", state, retry=False))
    assert "advance" in calls, "an unrun veto chip draw must be resolved so the field is grounded"


def test_veto_draw_does_not_fire_once_the_field_is_drawn(monkeypatch):
    # The six are already drawn → the COMPETITION is the model's to build/resolve; never advance it.
    calls = []
    _wire_veto(monkeypatch, players=[{"id": "npc:1", "name": "A"}], pending=None, calls=calls)
    state = {"started": True, "phase": "veto-competition", "moment": "veto-competition"}
    out = _run(chat_helpers._pre_resolve_npc_ceremony("u", state, retry=False))
    assert "advance" not in calls, "the comp belongs to the model once the chips are drawn"
    assert out is state


def test_veto_draw_never_overrides_a_player_pending(monkeypatch):
    # The player drew Houseguest's Choice (or owes a comp-intent) → a pending is present → never advance.
    calls = []
    _wire_veto(monkeypatch, players=[], pending={"kind": "houseguests-choice"}, calls=calls)
    state = {"started": True, "phase": "veto-competition", "moment": "veto-competition"}
    out = _run(chat_helpers._pre_resolve_npc_ceremony("u", state, retry=False))
    assert "advance" not in calls, "must never auto-resolve the player's own veto decision"
    assert out is state


def test_is_best_effort_never_raises(monkeypatch):
    # An engine hiccup mid-resolve must leave the turn exactly as it was, never blow up the frame.
    async def boom(user=None):
        raise RuntimeError("engine blip")

    monkeypatch.setattr(orwell_engine, "game_status", boom)
    state = {"started": True, "phase": "nominations", "moment": "nominations"}
    out = _run(chat_helpers._pre_resolve_npc_ceremony("u", state, retry=False))
    assert out is state


def test_framing_invokes_the_pre_resolve():
    # Source-pin: apply_game_framing calls the pre-resolve on a started game BEFORE the moment fetch.
    import os
    src = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                            "routes", "chat_helpers.py"), encoding="utf-8").read()
    assert "_pre_resolve_npc_ceremony(user, game_state" in src
    pre = src.index("_pre_resolve_npc_ceremony(user, game_state")
    mom = src.index('moment = game_state.get("moment")')
    assert pre < mom, "pre-resolve must run before the moment prompt is built"
