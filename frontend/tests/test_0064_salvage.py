"""Feature 0064 — the Messenger-safe parts salvaged from the parallel build (PR #400):
the `game-updated` instant HUD reconcile, the cast-photo onboarding fix, and the once-only
kickoff — WITHOUT the turn-lock / spectator / take-over (the owner chose the Messenger model).

`game-updated` is verified functionally (the binding routes publish it); the rest are cheap
source drift-pins, including a NEGATIVE pin that the spectator/lock design did NOT come along.
"""

import importlib
import os

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

orwell_routes = importlib.import_module("routes.orwell_routes")
orwell_engine = importlib.import_module("src.orwell_engine")
ogs = importlib.import_module("src.orwell_game_session")
session_events = importlib.import_module("src.session_events")


def _app():
    app = FastAPI()
    app.include_router(orwell_routes.setup_orwell_routes())
    return app


def _read(*parts):
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(root, *parts), "r", encoding="utf-8") as f:
        return f.read()


# ── game-updated instant reconcile (functional) ───────────────────────────────

def test_decision_publishes_game_updated(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "false")

    async def fake_submit(decision, user=None, **_kw):
        return {"ok": True}

    monkeypatch.setattr(orwell_engine, "submit_decision", fake_submit)
    monkeypatch.setattr(orwell_engine, "remember_pending", lambda *a, **k: None)
    monkeypatch.setattr(ogs, "get_game_session", lambda user: "sess-canon")
    published = []
    monkeypatch.setattr(session_events, "publish", lambda sid, ev, data=None: published.append((sid, ev)))

    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.post("/api/orwell/decision", json={"kind": "eviction-vote", "vote": "x"})
    assert r.status_code == 200
    assert ("sess-canon", "game-updated") in published


def test_game_updated_publish_is_best_effort(monkeypatch):
    """A publish failure must never break the decision route (polling is the correctness floor)."""
    monkeypatch.setenv("AUTH_ENABLED", "false")

    async def fake_submit(decision, user=None, **_kw):
        return {"ok": True}

    monkeypatch.setattr(orwell_engine, "submit_decision", fake_submit)
    monkeypatch.setattr(orwell_engine, "remember_pending", lambda *a, **k: None)
    monkeypatch.setattr(ogs, "get_game_session", lambda user: "sess-canon")

    def boom(*a, **k):
        raise RuntimeError("sse down")

    monkeypatch.setattr(session_events, "publish", boom)
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.post("/api/orwell/decision", json={"kind": "eviction-vote", "vote": "x"})
    assert r.status_code == 200  # the route still succeeds


# ── cast-photo onboarding fix (source pins) ───────────────────────────────────

def test_cast_photo_gate_centers_and_syncs_closed():
    src = _read("static", "js", "orwellHeadshot.js")
    # placement: the box rides the "top-center" slot — the slot engine centers it horizontally
    # under the header AND clamps it into the viewport (the stacker can't strand it), which
    # replaced the old !important/translateX(-50%) hard-pin. That pin beat the drag's inline
    # writes, making the titlebar a dead grip; top-center keeps the centering while letting the
    # box be DRAGGABLE (problem A/B) but NOT resizeable (a fixed-size onboarding box).
    assert 'slot: "top-center"' in src
    assert "draggable: true" in src and "resizable: false" in src
    # synced set-state: driven by the server-authoritative finalized bit, closes across devices
    assert "intake.finalized" in src or "finalized" in src
    gate = _read("static", "js", "orwellChatGate.js")
    assert "isBlocked" in gate  # the gate re-derives on a light poll while blocked


# ── once-only kickoff (source pin) ────────────────────────────────────────────

def test_kickoff_is_once_per_game():
    src = _read("static", "js", "orwellOnboarding.js")
    assert "_conversationHasAssistantTurn" in src
    assert "msg-ai" in src  # detects an assistant turn already present (synced from another device)


# ── NEGATIVE pin: the Messenger model — no lock / spectator / take-over ────────

def test_no_turn_lock_or_takeover_came_along():
    """The owner chose Messenger (any device types anytime). The parallel build's turn-lock +
    spectator + take-over must NOT be in the tree."""
    assert not os.path.exists(os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src", "game_turn_lock.py"))
    sync = _read("static", "js", "sessionSync.js")
    assert "enterSpectatorMode" not in sync and "exitSpectatorMode" not in sync
    # run-started still just attaches to the live reply (Messenger), composer never disabled here
    assert "resumeStream" in sync