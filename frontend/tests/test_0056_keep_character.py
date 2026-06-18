"""Feature 0056 — season-to-season character continuity through the restart door.

A confirmed restart can KEEP the existing houseguest (carry their CHARACTER into the new season)
instead of running fresh casting. The relay forwards `keepCharacter` to the engine, and when it is
set the route no longer requires a `playerName` (the engine re-supplies the prior player's name).

Name-agnostic; the engine is monkeypatched (no running engine needed).
"""

import importlib

from fastapi import FastAPI
from fastapi.testclient import TestClient

orwell_engine = importlib.import_module("src.orwell_engine")
orwell_routes = importlib.import_module("routes.orwell_routes")


def _app():
    app = FastAPI()
    app.include_router(orwell_routes.setup_orwell_routes())
    return app


def _stub_engine(monkeypatch, captured):
    async def fake_state(user=None):
        return {"started": True}  # a finished/started season exists — a restart is in play

    async def fake_create(name, **kwargs):
        captured["name"] = name
        captured["kwargs"] = kwargs
        return {"started": True}

    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)
    monkeypatch.setattr(orwell_engine, "create_character", fake_create)


def test_new_game_keep_character_forwards_the_flag(monkeypatch):
    """keepCharacter:true rides through to the engine relay so the same houseguest returns."""
    monkeypatch.setenv("AUTH_ENABLED", "false")  # smoke posture: the route runs
    captured = {}
    _stub_engine(monkeypatch, captured)
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.post("/api/orwell/new-game", json={"confirm": True, "keepCharacter": True})
    assert r.status_code == 200
    assert captured["kwargs"].get("keep_character") is True
    assert captured["kwargs"].get("confirm_restart") is True


def test_new_game_keep_character_needs_no_player_name(monkeypatch):
    """With keepCharacter the engine carries the prior name, so playerName is no longer required."""
    monkeypatch.setenv("AUTH_ENABLED", "false")
    captured = {}
    _stub_engine(monkeypatch, captured)
    client = TestClient(_app(), raise_server_exceptions=False)
    # No playerName at all — previously a 400; now accepted because keepCharacter is set.
    r = client.post("/api/orwell/new-game", json={"confirm": True, "keepCharacter": True})
    assert r.status_code == 200
    assert captured["name"] is None  # the relay passes no name; the engine supplies it


def test_new_game_without_keep_still_requires_a_name(monkeypatch):
    """The recreate path is unchanged: no keepCharacter and no name -> 400, engine never called."""
    monkeypatch.setenv("AUTH_ENABLED", "false")
    captured = {}
    _stub_engine(monkeypatch, captured)
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.post("/api/orwell/new-game", json={"confirm": True})
    assert r.status_code == 400
    assert "kwargs" not in captured  # rejected before any engine traffic


def test_relay_builds_keepCharacter_arg(monkeypatch):
    """orwell_engine.create_character maps keep_character -> the engine's keepCharacter arg."""
    import asyncio

    sent = {}

    async def fake_call(tool, args, user=None):
        sent["tool"] = tool
        sent["args"] = args
        return {"started": True}

    monkeypatch.setattr(orwell_engine, "_call", fake_call)
    asyncio.get_event_loop().run_until_complete(
        orwell_engine.create_character(None, confirm_restart=True, keep_character=True, user="u")
    )
    assert sent["tool"] == "createCharacter"
    assert sent["args"].get("keepCharacter") is True
    assert sent["args"].get("confirmRestart") is True
    assert "playerName" not in sent["args"]  # no name when keeping the character
