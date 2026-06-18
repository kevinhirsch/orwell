"""Round-2 finding: the decision-card reload re-arm read a FE-process-local cache, so a FE restart
or an out-of-band advance broke re-arm. /status now PREFERS the engine's own `pending` (exposed on
gameStatus), falling back to the FE cache only if the engine omitted it. Roles only — ids aren't names.
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


def test_status_falls_back_to_cache_when_engine_omits_pending(client, monkeypatch):
    async def fake_status(user=None):
        return {"week": 1, "phase": "hoh-competition", "pending": None}  # older engine / nothing pending
    monkeypatch.setattr(orwell_engine, "game_status", fake_status)
    monkeypatch.setattr(orwell_engine, "last_pending", lambda user=None: {"kind": "eviction-vote"})
    r = client.get("/api/orwell/status")
    assert r.json()["pending"]["kind"] == "eviction-vote"  # graceful fallback to the FE cache
