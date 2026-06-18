"""Feature 0036 / C10 — the front-end social routes (NPC approaches + Diary Room).

Name-agnostic (no houseguest names). Verifies the route logic — pass-through of the
engine's Vault-free results and the FAIL-OPEN behaviour — with the engine calls
monkeypatched, so the tests are deterministic and need no running engine.
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


# --- tagline (0033): pass through, fail open ----------------------------------

def test_tagline_passthrough(client, monkeypatch):
    async def fake(user=None):
        return {"text": "On the block and on camera. Smile."}
    monkeypatch.setattr(orwell_engine, "player_tagline", fake)
    r = client.get("/api/orwell/tagline")
    assert r.status_code == 200
    assert r.json()["text"] == "On the block and on camera. Smile."


def test_tagline_fails_open_to_default(client, monkeypatch):
    monkeypatch.setattr(orwell_engine, "player_tagline", _raise)
    r = client.get("/api/orwell/tagline")
    assert r.status_code == 200
    assert r.json()["text"] == "The house is waiting."  # never blank, never blocks


# --- diary room (0036): requires an entry; records; surfaces engine failure ---

def test_diary_room_requires_entry(client):
    r = client.post("/api/orwell/diary-room", json={"entry": "   "})
    assert r.status_code == 400


def test_diary_room_records(client, monkeypatch):
    captured = {}
    async def fake(entry, user=None):
        captured["entry"] = entry
        return {"recorded": True}
    monkeypatch.setattr(orwell_engine, "diary_room", fake)
    r = client.post("/api/orwell/diary-room", json={"entry": "I am quietly targeting the HOH"})
    assert r.status_code == 200
    assert r.json() == {"recorded": True}
    assert captured["entry"] == "I am quietly targeting the HOH"  # trimmed, forwarded


def test_diary_room_reports_engine_failure(client, monkeypatch):
    monkeypatch.setattr(orwell_engine, "diary_room", _raise)
    r = client.post("/api/orwell/diary-room", json={"entry": "something"})
    assert r.status_code == 502  # the DR write is not fail-open to a false success
