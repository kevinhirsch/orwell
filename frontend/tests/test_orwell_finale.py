"""Feature 0037 / C11 — the front-end finale route (the staged jury-vote panel).

Name-agnostic (no houseguest names). Verifies the route's pass-through of the engine's Vault-free
FinaleView and its FAIL-OPEN behaviour, with the engine call monkeypatched (deterministic, no engine).
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


async def _raise(*_a, **_k):
    raise RuntimeError("engine unreachable")


# --- finale (0037 §8.2): pass through, fail open -------------------------------

def test_finale_passthrough(client, monkeypatch):
    async def fake(user=None):
        return {
            "stage": "reveal",
            "finalists": [{"id": "npc:1", "name": "Finalist One"}, {"id": "player", "name": "You"}],
            "asking": None,
            "reveals": [{"juror": {"id": "npc:3", "name": "A Juror"}, "votedFor": {"id": "player", "name": "You"}}],
        }
    monkeypatch.setattr(orwell_engine, "finale_view", fake)
    r = client.get("/api/orwell/finale")
    assert r.status_code == 200
    body = r.json()
    assert body["finale"]["stage"] == "reveal"
    assert len(body["finale"]["finalists"]) == 2
    assert body["finale"]["reveals"][0]["votedFor"]["name"] == "You"


def test_finale_null_when_not_staging(client, monkeypatch):
    async def fake(user=None):
        return None  # no finale in progress
    monkeypatch.setattr(orwell_engine, "finale_view", fake)
    r = client.get("/api/orwell/finale")
    assert r.status_code == 200
    assert r.json() == {"finale": None}


def test_finale_fails_open_to_null(client, monkeypatch):
    monkeypatch.setattr(orwell_engine, "finale_view", _raise)
    r = client.get("/api/orwell/finale")
    assert r.status_code == 200
    assert r.json() == {"finale": None}  # never blocks the page on an engine error


# --- /health carries the concrete failure reason for the visible engine-status banner ---

def test_health_reports_engine_down_with_a_reason(client, monkeypatch):
    async def fake_detail():
        return {"ok": False, "engineUrl": "http://127.0.0.1:8765", "error": "ConnectError: refused"}
    monkeypatch.setattr(orwell_engine, "engine_health_detail", fake_detail)
    r = client.get("/api/orwell/health")
    assert r.status_code == 200
    body = r.json()
    assert body["engine"] is False
    assert body["error"] == "ConnectError: refused"  # surfaced so the banner can name it
    assert body["engineUrl"] == "http://127.0.0.1:8765"


def test_health_reports_engine_up(client, monkeypatch):
    async def fake_detail():
        return {"ok": True, "engineUrl": "http://127.0.0.1:8765"}
    monkeypatch.setattr(orwell_engine, "engine_health_detail", fake_detail)
    r = client.get("/api/orwell/health")
    assert r.json()["engine"] is True and r.json().get("error") is None


def test_status_pre_game_is_an_honest_200_not_a_fake_outage(client, monkeypatch):
    # Field bug: the status panel's poll logged a 502 per refresh on a healthy, game-less box —
    # the engine's "no active game" refusal was translated into "engine unreachable".
    async def no_game(user=None):
        raise orwell_engine.EngineToolError("no active game for this user", status=404)
    monkeypatch.setattr(orwell_engine, "game_status", no_game)
    r = client.get("/api/orwell/status")
    assert r.status_code == 200
    assert r.json() == {"started": False}


def test_status_still_502s_on_a_real_engine_outage(client, monkeypatch):
    monkeypatch.setattr(orwell_engine, "game_status", _raise)
    r = client.get("/api/orwell/status")
    assert r.status_code == 502


def test_health_reports_a_recent_tool_error_while_up(client, monkeypatch):
    # Engine process is up, but a recent call failed — the banner's amber "degraded" state.
    async def fake_detail():
        return {"ok": True, "engineUrl": "http://127.0.0.1:8765",
                "lastError": {"tool": "advanceGame", "kind": "tool-error",
                              "error": "internal error (HTTP 500)", "ageSeconds": 4}}
    monkeypatch.setattr(orwell_engine, "engine_health_detail", fake_detail)
    body = client.get("/api/orwell/health").json()
    assert body["engine"] is True
    assert body["lastError"]["tool"] == "advanceGame"
    assert "internal error" in body["lastError"]["error"]
