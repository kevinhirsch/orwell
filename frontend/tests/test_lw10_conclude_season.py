"""LW10 (audit 2026-06-21) — POST /api/orwell/conclude-season.

When the PLAYER has been evicted PRE-JURY (their game is over but the house plays on), the route
fast-forwards the deterministic season to the finale (one `advance_to_finale` engine call) so the
player lands on the post-season recap + the keep/recast hand-off — instead of nudging the house
forward a week at a time with no terminal signal (0046's "terminal recap").

Gated on player.status == "evicted": a LIVE player (active) and a JUROR (who keeps a finale vote) are
both refused; idempotent once the season is over. Engine fully monkeypatched (no running engine).
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


def _client(monkeypatch, state, ff_called):
    async def fake_state(user=None, timeout=None):
        return state

    async def fake_ff(user=None):
        ff_called.append(user)
        return {"finished": True, "winnerName": "X", "weeks": 10, "playerPlacement": "8th", "started": True}

    async def fake_status(user=None):
        return {"finished": True, "winner": {"name": "X"}}

    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)
    monkeypatch.setattr(orwell_engine, "advance_to_finale", fake_ff)
    monkeypatch.setattr(orwell_engine, "game_status", fake_status)
    monkeypatch.setattr(orwell_engine, "remember_pending", lambda res, user=None: None)
    return TestClient(_app(), raise_server_exceptions=False)


def test_conclude_evicted_player_fast_forwards(monkeypatch):
    ff = []
    state = {"started": True, "finished": False, "moment": "eviction", "player": {"status": "evicted"}}
    r = _client(monkeypatch, state, ff).post("/api/orwell/conclude-season")
    assert r.status_code == 200
    assert r.json().get("finished") is True
    assert ff == [None]  # the deterministic loop was driven to the crown for THIS user


def test_conclude_refused_while_player_active(monkeypatch):
    ff = []
    state = {"started": True, "finished": False, "moment": "hoh-competition", "player": {"status": "active"}}
    r = _client(monkeypatch, state, ff).post("/api/orwell/conclude-season")
    assert r.status_code == 409
    assert ff == []  # NEVER fast-forwards a live player's game (no skipping a season you're still in)


def test_conclude_refused_for_juror(monkeypatch):
    ff = []
    state = {"started": True, "finished": False, "moment": "eviction", "player": {"status": "jury"}}
    r = _client(monkeypatch, state, ff).post("/api/orwell/conclude-season")
    assert r.status_code == 409
    assert ff == []  # a juror keeps their finale vote — they are NOT swept to the end


def test_conclude_idempotent_when_already_over(monkeypatch):
    ff = []
    state = {"started": True, "finished": True, "moment": "post-season", "player": {"status": "evicted"}}
    r = _client(monkeypatch, state, ff).post("/api/orwell/conclude-season")
    assert r.status_code == 200
    assert r.json().get("alreadyOver") is True
    assert ff == []  # no double fast-forward once the season is already over


def test_conclude_no_game(monkeypatch):
    ff = []
    r = _client(monkeypatch, {"started": False}, ff).post("/api/orwell/conclude-season")
    assert r.status_code == 409
    assert ff == []
