"""Audit E70 — POST /api/orwell/new-game is ADMIN-GATED.

Coherent with the one-door restart design (E1/D1): players start and restart seasons through
the chat tools (the 0050 casting interview -> createCharacter; a confirmed restart routes
through the engine's one sanctioned reset door). This route bypasses the interview — a
soul-shallow character one curl away — so it survives only as a debug/ops door:

  * default auth posture (AUTH_ENABLED unset/true, no admin session) -> 403, engine NEVER called;
  * AUTH_ENABLED=false (the deploy-smoke / responsive-matrix configuration) -> the route runs;
  * the in-process internal-tool token (loopback agent tools) -> the route runs.

Name-agnostic; the engine is monkeypatched (no running engine needed).
"""

import importlib

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

orwell_engine = importlib.import_module("src.orwell_engine")
orwell_routes = importlib.import_module("routes.orwell_routes")
core_middleware = importlib.import_module("core.middleware")


def _app():
    app = FastAPI()
    app.include_router(orwell_routes.setup_orwell_routes())
    return app


def _stub_engine(monkeypatch, calls):
    async def fake_state(user=None, timeout=None):
        return {"started": False}

    async def fake_create(name, **kwargs):
        calls.append(name)
        return {"started": True}

    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)
    monkeypatch.setattr(orwell_engine, "create_character", fake_create)


def test_new_game_403_without_admin(monkeypatch):
    """The default posture: auth on, no admin -> 403 and the engine is never reached."""
    monkeypatch.setenv("AUTH_ENABLED", "true")
    calls = []
    _stub_engine(monkeypatch, calls)
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.post("/api/orwell/new-game", json={"playerName": "P"})
    assert r.status_code == 403
    assert calls == []  # the gate sits BEFORE any engine traffic


def test_new_game_allowed_under_smoke_config(monkeypatch):
    """AUTH_ENABLED=false — deploy/smoke.sh stage 4 and responsive_matrix.stage_game() keep working."""
    monkeypatch.setenv("AUTH_ENABLED", "false")
    calls = []
    _stub_engine(monkeypatch, calls)
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.post("/api/orwell/new-game", json={"playerName": "P"})
    assert r.status_code == 200
    assert calls  # the route ran through to the engine


def test_new_game_allowed_with_internal_tool_token(monkeypatch):
    """The loopback agent-tool bypass (same contract as every require_admin route)."""
    monkeypatch.setenv("AUTH_ENABLED", "true")
    calls = []
    _stub_engine(monkeypatch, calls)
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.post(
        "/api/orwell/new-game",
        json={"playerName": "P"},
        headers={core_middleware.INTERNAL_TOOL_HEADER: core_middleware.INTERNAL_TOOL_TOKEN},
    )
    assert r.status_code == 200
    assert calls


def test_other_orwell_routes_stay_player_reachable(monkeypatch):
    """E70 gates ONLY the bypass door — the player-facing reads stay open."""
    monkeypatch.setenv("AUTH_ENABLED", "true")

    async def fake_state(user=None, timeout=None):
        return {"started": False}

    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)
    client = TestClient(_app(), raise_server_exceptions=False)
    assert client.get("/api/orwell/state").status_code == 200


def test_route_source_keeps_the_gate():
    """Drift pin: the route body must call require_admin before anything else."""
    import inspect
    import os

    src_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                            "routes", "orwell_routes.py")
    with open(src_path, "r", encoding="utf-8") as f:
        src = f.read()
    body = src.split('@router.post("/new-game")')[1]
    assert "require_admin(request)" in body.split("playerName.strip()")[0]
    assert inspect is not None
