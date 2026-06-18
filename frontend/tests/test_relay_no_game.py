"""Round-2 playtest finding: a benign "no active game" engine refusal must NOT surface as a false
`502 engine unreachable`. The engine is reachable — it intentionally refused (404). The player-
reachable /diary-room and /decision routes (and /retrospective) used a blanket `except` → 502,
unlike /status which already mapped no_game to a clean state. Roles only — ids are not names.
"""
import importlib

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

orwell_engine = importlib.import_module("src.orwell_engine")
orwell_routes = importlib.import_module("routes.orwell_routes")
EngineToolError = orwell_engine.EngineToolError


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(orwell_routes.setup_orwell_routes())
    return TestClient(app)


async def _no_game(*a, **k):
    raise EngineToolError("no active game for this user")  # constructor sets no_game=True


async def _real_outage(*a, **k):
    raise EngineToolError("connection refused")  # no_game=False → a genuine engine error


def test_diary_room_no_game_is_409_not_false_502(client, monkeypatch):
    monkeypatch.setattr(orwell_engine, "diary_room", _no_game)
    r = client.post("/api/orwell/diary-room", json={"entry": "hello"})
    assert r.status_code == 409, r.status_code
    assert r.json().get("started") is False
    assert "unreachable" not in r.text.lower()


def test_decision_no_game_is_409_not_false_502(client, monkeypatch):
    monkeypatch.setattr(orwell_engine, "submit_decision", _no_game)
    r = client.post("/api/orwell/decision", json={"kind": "comp-intent", "intent": "compete"})
    assert r.status_code == 409, r.status_code
    assert "unreachable" not in r.text.lower()


def test_retrospective_no_game_is_404_not_false_502(client, monkeypatch):
    monkeypatch.setattr(orwell_engine, "season_retrospective", _no_game)
    r = client.get("/api/orwell/retrospective")
    assert r.status_code == 404, r.status_code
    assert "unreachable" not in r.text.lower()


def test_genuine_engine_error_still_502(client, monkeypatch):
    # The outage signal is preserved for a REAL engine error (no_game False).
    monkeypatch.setattr(orwell_engine, "submit_decision", _real_outage)
    r = client.post("/api/orwell/decision", json={"kind": "eviction-vote", "vote": "npc:1"})
    assert r.status_code == 502, r.status_code
