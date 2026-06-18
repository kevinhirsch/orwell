"""Round-2 finding: the decision-card reload re-arm read a FE-process-local cache, so a FE restart
or an out-of-band advance broke re-arm. /status now PREFERS the engine's own `pending` (exposed on
gameStatus). The engine value is AUTHORITATIVE — a present `pending`, INCLUDING null, is trusted as
the engine's truth; the FE cache is consulted ONLY when the engine omits the key entirely (an older
engine). R9-FE-1: a present null must NOT fall back to the stale cache, or a decision the model
resolved via its own tool path re-surfaces as a phantom card. Roles only — ids aren't names.
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


def test_status_prefers_engine_pending_over_stale_cache(client, monkeypatch):
    async def fake_status(user=None):
        return {"week": 2, "phase": "veto-competition", "pending": {"kind": "comp-intent", "options": []}}
    monkeypatch.setattr(orwell_engine, "game_status", fake_status)
    monkeypatch.setattr(orwell_engine, "last_pending", lambda user=None: {"kind": "STALE-CACHE"})
    r = client.get("/api/orwell/status")
    assert r.status_code == 200
    assert r.json()["pending"]["kind"] == "comp-intent"  # engine truth wins, never the stale cache


def test_status_present_null_is_authoritative_no_stale_card(client, monkeypatch):
    # R9-FE-1: the engine says "nothing pending" with a PRESENT null. That is the engine's truth —
    # it must win over a stale FE cache (which the model's own tool-path submitDecision never clears),
    # so a resolved decision can never re-surface a phantom card.
    async def fake_status(user=None):
        return {"week": 1, "phase": "hoh-competition", "pending": None}  # engine: nothing pending
    monkeypatch.setattr(orwell_engine, "game_status", fake_status)
    monkeypatch.setattr(orwell_engine, "last_pending", lambda user=None: {"kind": "comp-intent"})
    r = client.get("/api/orwell/status")
    assert r.json()["pending"] is None  # present null is authoritative — never the stale cache


def test_status_falls_back_to_cache_only_when_engine_omits_key(client, monkeypatch):
    # The fallback survives for a genuinely older engine that never exposed `pending` at all
    # (the key is ABSENT, not merely null).
    async def fake_status(user=None):
        return {"week": 1, "phase": "hoh-competition"}  # older engine: no `pending` key
    monkeypatch.setattr(orwell_engine, "game_status", fake_status)
    monkeypatch.setattr(orwell_engine, "last_pending", lambda user=None: {"kind": "eviction-vote"})
    r = client.get("/api/orwell/status")
    assert r.json()["pending"]["kind"] == "eviction-vote"  # graceful fallback to the FE cache
