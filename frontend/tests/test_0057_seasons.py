"""Feature 0057 — seasons as levels: the per-user season store + the next-season / reset endpoints.

A completed season is a level. Starting the NEXT season increments the user's season number;
resetting progress mid-season does NOT. Both route through the engine's one sanctioned reset.

Name-agnostic; the engine + store are monkeypatched (no running engine, no real files needed).
"""

import importlib

from fastapi import FastAPI
from fastapi.testclient import TestClient

orwell_engine = importlib.import_module("src.orwell_engine")
orwell_routes = importlib.import_module("routes.orwell_routes")
orwell_seasons = importlib.import_module("src.orwell_seasons")


def _app():
    app = FastAPI()
    app.include_router(orwell_routes.setup_orwell_routes())
    return app


# ── the store ────────────────────────────────────────────────────────────────────────────────

def test_store_defaults_to_one_and_increments(tmp_path, monkeypatch):
    monkeypatch.setattr(orwell_seasons, "SEASONS_PATH", tmp_path / "s.json")
    assert orwell_seasons.get_season("u") == 1          # never incremented ⇒ season 1
    assert orwell_seasons.increment_season("u") == 2
    assert orwell_seasons.increment_season("u") == 3
    assert orwell_seasons.get_season("u") == 3
    assert orwell_seasons.get_season("other") == 1      # per-user isolation
    assert orwell_seasons.reset_season("u") == 1        # full reset (factory) ⇒ back to 1


def test_store_survives_corruption(tmp_path, monkeypatch):
    p = tmp_path / "s.json"
    p.write_text("{ not json", encoding="utf-8")
    monkeypatch.setattr(orwell_seasons, "SEASONS_PATH", p)
    assert orwell_seasons.get_season("u") == 1          # a corrupt store never breaks the game


# ── GET /season ──────────────────────────────────────────────────────────────────────────────

def test_get_season_route(tmp_path, monkeypatch):
    monkeypatch.setattr(orwell_seasons, "SEASONS_PATH", tmp_path / "s.json")
    orwell_seasons.increment_season("default")          # -> season 2
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.get("/api/orwell/season")
    assert r.status_code == 200 and r.json()["season"] == 2


# ── POST /next-season ────────────────────────────────────────────────────────────────────────

def _finished_state(monkeypatch, finished=True, started=True):
    async def fake_state(user=None):
        return {"started": started, "finished": finished}
    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)


def test_next_season_keep_increments_and_keeps(tmp_path, monkeypatch):
    monkeypatch.setattr(orwell_seasons, "SEASONS_PATH", tmp_path / "s.json")
    _finished_state(monkeypatch)
    seen = {}

    async def fake_create(name, **kwargs):
        seen["create"] = kwargs
        return {"started": True}

    monkeypatch.setattr(orwell_engine, "create_character", fake_create)
    monkeypatch.setattr(orwell_portraits := importlib.import_module("src.orwell_portraits"),
                        "scrub_user", lambda u: None)

    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.post("/api/orwell/next-season", json={"keep": True, "confirm": True})
    assert r.status_code == 200
    body = r.json()
    assert body["season"] == 2 and body["kept"] is True
    assert seen["create"].get("keep_character") is True and seen["create"].get("confirm_restart") is True


def test_next_season_recreate_resets_and_increments(tmp_path, monkeypatch):
    monkeypatch.setattr(orwell_seasons, "SEASONS_PATH", tmp_path / "s.json")
    _finished_state(monkeypatch)
    seen = {}

    async def fake_manage(op=None, user=None):
        seen["op"] = op
        return {"started": False}

    monkeypatch.setattr(orwell_engine, "manage_sandbox", fake_manage)
    monkeypatch.setattr(importlib.import_module("src.orwell_portraits"), "scrub_user", lambda u: None)

    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.post("/api/orwell/next-season", json={"keep": False, "confirm": True})
    assert r.status_code == 200
    assert r.json()["season"] == 2 and r.json()["kept"] is False
    assert seen["op"] == "reset"  # recreate routes through the sanctioned reset to OOBE


def test_next_season_requires_confirm(tmp_path, monkeypatch):
    monkeypatch.setattr(orwell_seasons, "SEASONS_PATH", tmp_path / "s.json")
    _finished_state(monkeypatch)
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.post("/api/orwell/next-season", json={"keep": True})
    assert r.status_code == 400
    assert orwell_seasons.get_season("default") == 1  # never advanced without confirm


def test_next_season_refused_until_season_over(tmp_path, monkeypatch):
    monkeypatch.setattr(orwell_seasons, "SEASONS_PATH", tmp_path / "s.json")
    _finished_state(monkeypatch, finished=False)  # a live, unfinished season
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.post("/api/orwell/next-season", json={"keep": True, "confirm": True})
    assert r.status_code == 409
    assert orwell_seasons.get_season("default") == 1  # no skipping ahead — the level isn't cleared


# ── POST /reset-progress ─────────────────────────────────────────────────────────────────────

def test_reset_progress_resets_without_incrementing(tmp_path, monkeypatch):
    monkeypatch.setattr(orwell_seasons, "SEASONS_PATH", tmp_path / "s.json")
    orwell_seasons.increment_season("default")  # the user is on season 2
    seen = {}

    async def fake_manage(op=None, user=None):
        seen["op"] = op
        return {"started": False}

    monkeypatch.setattr(orwell_engine, "manage_sandbox", fake_manage)
    monkeypatch.setattr(importlib.import_module("src.orwell_portraits"), "scrub_user", lambda u: None)

    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.post("/api/orwell/reset-progress", json={"confirm": True})
    assert r.status_code == 200 and r.json()["reset"] is True
    assert seen["op"] == "reset"
    assert orwell_seasons.get_season("default") == 2  # restart the LEVEL — the season is unchanged


def test_reset_progress_requires_confirm(tmp_path, monkeypatch):
    monkeypatch.setattr(orwell_seasons, "SEASONS_PATH", tmp_path / "s.json")
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.post("/api/orwell/reset-progress", json={})
    assert r.status_code == 400
