"""Feature 0061 — player self-eviction (voluntary walk-out / quit) FE wiring.

The two-step OOC handshake relayed through the FE: an intent-to-leave raises the engine's
self-evict CONFIRMATION (POST /api/orwell/self-eviction/request — no state change), and ONLY an
explicit confirm binds it via the validated decision seam (POST /api/orwell/decision with
{kind:'self-evict', confirmed:true}); a cancel clears it (POST /api/orwell/self-eviction/cancel).
The confirmed exit rides the SAME structural decision route as every binding decision — prose can
never bind through it. Route tests here; the confirm/cancel card UX is exercised in the static
assertions + the real-browser smoke. Sync tests (pytest-asyncio auto mode).
"""

import importlib
import os

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


def test_decision_route_accepts_self_evict_kind_and_confirmed(client, monkeypatch):
    seen = {}

    async def fake_submit(decision, user=None, **_kw):
        seen.update(decision)
        return {"event": {"beat": "self-eviction"}, "pending": None, "status": {"week": 2}}

    monkeypatch.setattr(orwell_engine, "submit_decision", fake_submit)
    r = client.post("/api/orwell/decision", json={"kind": "self-evict", "confirmed": True})
    assert r.status_code == 200
    # The confirmed flag rides the validated seam to the engine.
    assert seen == {"kind": "self-evict", "confirmed": True}


def test_decision_route_still_rejects_unknown_kind(client, monkeypatch):
    called = []

    async def fake_submit(decision, user=None, **_kw):
        called.append(decision)
        return {}

    monkeypatch.setattr(orwell_engine, "submit_decision", fake_submit)
    r = client.post("/api/orwell/decision", json={"kind": "abdicate"})
    assert r.status_code == 400 and not called


def test_self_eviction_request_raises_confirmation_no_state_change(client, monkeypatch):
    calls = []

    async def fake_request(user=None):
        calls.append("request")
        # The engine surfaces the confirmation pending and changes nothing.
        return {"event": None, "pending": {"kind": "self-evict"}, "status": {"week": 1}}

    monkeypatch.setattr(orwell_engine, "request_self_eviction", fake_request)
    r = client.post("/api/orwell/self-eviction/request")
    assert r.status_code == 200
    assert calls == ["request"]
    assert r.json()["pending"]["kind"] == "self-evict"


def test_self_eviction_cancel_clears_confirmation(client, monkeypatch):
    calls = []

    async def fake_cancel(user=None):
        calls.append("cancel")
        return {"event": None, "pending": None, "status": {"week": 1}}

    monkeypatch.setattr(orwell_engine, "cancel_self_eviction", fake_cancel)
    r = client.post("/api/orwell/self-eviction/cancel")
    assert r.status_code == 200
    assert calls == ["cancel"]


def test_self_eviction_request_502_when_engine_down(client, monkeypatch):
    async def boom(user=None):
        raise RuntimeError("engine unreachable")

    monkeypatch.setattr(orwell_engine, "request_self_eviction", boom)
    r = client.post("/api/orwell/self-eviction/request")
    assert r.status_code == 502


def test_engine_client_exposes_self_eviction_helpers():
    # The engine client wraps the new tools (request/cancel) + the confirmed decision rides submit.
    assert hasattr(orwell_engine, "request_self_eviction")
    assert hasattr(orwell_engine, "cancel_self_eviction")
    assert hasattr(orwell_engine, "submit_decision")


def _read(*parts):
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(base, *parts), encoding="utf-8") as f:
        return f.read()


def test_decision_card_renders_confirm_and_cancel_for_self_evict():
    card = _read("static", "js", "orwellDecision.js")
    # The card knows the self-evict kind and builds the confirmed payload (no pick needed).
    assert '"self-evict"' in card or "'self-evict'" in card
    assert "confirmed: true" in card
    # An explicit Cancel posts the engine cancel so declining never leaves a half-committed exit.
    assert "/api/orwell/self-eviction/cancel" in card
    # The player-visible copy names the irreversible stakes, never the machinery.
    assert "cannot be undone" in card
    assert "The engine validates" not in card


def test_self_evict_confirm_posts_through_the_validated_decision_route():
    # The confirmed self-eviction binds through the SAME structural decision route as every binding
    # decision — never a bespoke prose path (the confirm payload posts to /api/orwell/decision).
    card = _read("static", "js", "orwellDecision.js")
    assert "/api/orwell/decision" in card
