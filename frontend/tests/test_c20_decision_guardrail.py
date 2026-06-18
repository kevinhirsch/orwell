"""Queue C20 — confirm-on-binding: the structural commitment path.

Per ADR 0003 the guardrail structures only the COMMITMENT: the confirm card posts the
player's explicit selection ENGINE-DIRECT (POST /api/orwell/decision → submitDecision), so
prose can never bind through this surface. Route tests here; the card's interaction
behavior (options render, pick-count enforcement, arming, dismissal) is exercised in a
REAL browser by scripts/browser_smoke.py.
"""

import importlib

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

orwell_engine = importlib.import_module("src.orwell_engine")
orwell_routes = importlib.import_module("routes.orwell_routes")


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(orwell_routes.setup_orwell_routes())
    return TestClient(app)


def test_decision_forwards_engine_direct(client, monkeypatch):
    seen = {}

    async def fake_submit(decision, user=None):
        seen.update(decision)
        return {"event": None, "pending": None, "status": {"week": 3}}

    monkeypatch.setattr(orwell_engine, "submit_decision", fake_submit)
    r = client.post("/api/orwell/decision", json={"kind": "nominations", "choice": ["npc:1", "npc:2"]})
    assert r.status_code == 200
    assert seen == {"kind": "nominations", "choice": ["npc:1", "npc:2"]}


def test_decision_rejects_unknown_kind(client, monkeypatch):
    called = []

    async def fake_submit(decision, user=None):
        called.append(decision)
        return {}

    monkeypatch.setattr(orwell_engine, "submit_decision", fake_submit)
    r = client.post("/api/orwell/decision", json={"kind": "coronation"})
    assert r.status_code == 400 and not called


def test_decision_forwards_every_wire_field(client, monkeypatch):
    seen = {}

    async def fake_submit(decision, user=None):
        seen.update(decision)
        return {}

    monkeypatch.setattr(orwell_engine, "submit_decision", fake_submit)
    client.post("/api/orwell/decision", json={
        "kind": "finale-answer", "appeal": "mend", "vote": "npc:1",
        "statement": "s", "intent": "compete", "use": True, "save": "npc:2",
        "replacement": "npc:3",
    })
    for f in ("appeal", "vote", "statement", "intent", "use", "save", "replacement"):
        assert f in seen, f


def test_decision_502_when_engine_down(client, monkeypatch):
    async def boom(*a, **k):
        raise RuntimeError("engine unreachable")

    monkeypatch.setattr(orwell_engine, "submit_decision", boom)
    r = client.post("/api/orwell/decision", json={"kind": "eviction-vote", "vote": "npc:1"})
    assert r.status_code == 502


def test_card_module_is_script_tagged_and_chat_dispatches():
    import os
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(base, "static", "index.html"), encoding="utf-8") as f:
        html = f.read()
    assert "orwellDecision.js" in html
    with open(os.path.join(base, "static", "js", "chat.js"), encoding="utf-8") as f:
        js = f.read()
    # advanceGame/submitDecision results hand pending to the guardrail
    assert "orwell:pending" in js
    with open(os.path.join(base, "static", "js", "orwellDecision.js"), encoding="utf-8") as f:
        card = f.read()
    # the card posts engine-direct — never composes a chat message as the binding act
    assert "/api/orwell/decision" in card
    assert "Confirm — this is binding" in card
    # dismissal keeps the conversation path open (ADR 0003: a guardrail, not a gate)
    assert "Dismiss" in card


def test_card_rearms_on_reload_after_async_chat_mount():
    # A refresh mid-decision must still show the card. The game build mounts #chat-history
    # asynchronously and then renders history into it, so the boot rearm has to wait for the
    # host AND survive the history re-render (which wiped an early mount) — re-asserting until
    # the card is stably present, but never fighting an explicit dismiss/submit.
    import os
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(base, "static", "js", "orwellDecision.js"), encoding="utf-8") as f:
        card = f.read()
    assert "rearmFromStatus" in card
    assert "/api/orwell/status" in card                 # rearm reads the engine's pending
    assert "_userDismissed" in card                     # dismiss/submit suppress re-assert
    assert "getElementById(CARD_ID)" in card            # re-assert only while the card is missing
    assert "if (++stable >= 3) break" in card           # stop once stably mounted
    # explicit dismiss (×/Escape) and submit all set the suppress flag
    assert card.count("_userDismissed = true") >= 3
