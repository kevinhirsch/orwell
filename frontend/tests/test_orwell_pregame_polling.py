"""Issue 2 — premature polling before a game exists must NOT log-spam.

Before any game, the FE polls finale/tagline/recap. Each engine call refuses with the benign
"no active game" (EngineToolError.no_game) — a NORMAL pre-game state, not a failure. The routes
must return their fail-open shapes QUIETLY (no `[orwell] … failed: no active game` warnings), so a
homepage-before-casting box leaves a clean log.

Also covers Issue 1's `reconnecting` flag riding the /health route to the banner.

Name-agnostic; the engine calls are monkeypatched (deterministic, no engine).
"""
import importlib
import logging

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

orwell_engine = importlib.import_module("src.orwell_engine")
orwell_routes = importlib.import_module("routes.orwell_routes")
orwell_tagline = importlib.import_module("src.orwell_tagline")

ROUTE_LOGGER = "routes.orwell_routes"


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(orwell_routes.setup_orwell_routes())
    return TestClient(app)


def _no_game(*_a, **_k):
    async def inner(*_a2, **_k2):
        raise orwell_engine.EngineToolError("no active game for this user", status=404)
    return inner


@pytest.fixture(autouse=True)
def _clean_throttle():
    orwell_routes._LAST_WARN.clear()
    yield
    orwell_routes._LAST_WARN.clear()


# --- /finale: pre-game is a quiet {finale: null}, never a logged failure ------------------------

def test_finale_pre_game_is_quiet_null(client, monkeypatch, caplog):
    monkeypatch.setattr(orwell_engine, "finale_view", _no_game())
    with caplog.at_level(logging.WARNING, logger=ROUTE_LOGGER):
        r = client.get("/api/orwell/finale")
    assert r.status_code == 200
    assert r.json() == {"finale": None}
    spam = [rec for rec in caplog.records if "finale failed" in rec.getMessage()]
    assert spam == [], "pre-game finale polling must not log `finale failed: no active game`"


def test_finale_real_outage_still_warns(client, monkeypatch, caplog):
    async def boom(user=None):
        raise RuntimeError("engine unreachable")
    monkeypatch.setattr(orwell_engine, "finale_view", boom)
    with caplog.at_level(logging.WARNING, logger=ROUTE_LOGGER):
        r = client.get("/api/orwell/finale")
    assert r.status_code == 200 and r.json() == {"finale": None}
    # A genuine outage is still surfaced (throttled) — only the benign pre-game state is silent.
    assert any("finale failed" in rec.getMessage() for rec in caplog.records)


# --- /tagline: pre-game falls open to the static line, no warning ------------------------------

def test_tagline_pre_game_is_quiet_static_line(client, monkeypatch, caplog):
    monkeypatch.setattr(orwell_engine, "player_tagline", _no_game())
    with caplog.at_level(logging.WARNING, logger=ROUTE_LOGGER):
        r = client.get("/api/orwell/tagline")
    assert r.status_code == 200
    assert r.json() == {"text": "The house is waiting."}
    spam = [rec for rec in caplog.records if "tagline failed" in rec.getMessage()]
    assert spam == [], "pre-game tagline polling must not log `tagline failed: no active game`"


def test_get_tagline_helper_returns_static_line_pre_game(monkeypatch):
    # The helper itself swallows the benign no_game (the route's fail-open never even sees it).
    monkeypatch.setattr(orwell_engine, "player_tagline", _no_game())
    import asyncio
    out = asyncio.get_event_loop().run_until_complete(orwell_tagline.get_tagline(user="fresh"))
    assert out == {"text": "The house is waiting."}


# --- /health: the soft "reconnecting" flag reaches the banner (Issue 1) -------------------------

def test_health_surfaces_reconnecting_flag(client, monkeypatch):
    async def fake_detail():
        return {"ok": False, "engineUrl": "http://127.0.0.1:8765",
                "error": "ConnectError: blip", "reconnecting": True}
    monkeypatch.setattr(orwell_engine, "engine_health_detail", fake_detail)
    body = client.get("/api/orwell/health").json()
    assert body["engine"] is False
    assert body["reconnecting"] is True  # the banner renders a soft "reconnecting…" line


def test_health_reconnecting_defaults_false(client, monkeypatch):
    async def fake_detail():
        return {"ok": True, "engineUrl": "http://127.0.0.1:8765"}
    monkeypatch.setattr(orwell_engine, "engine_health_detail", fake_detail)
    assert client.get("/api/orwell/health").json()["reconnecting"] is False
