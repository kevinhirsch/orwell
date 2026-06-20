"""Feature 0064 (stopgap) — the canonical game chat session.

Two devices on one account must converge on ONE chat session id, so the existing cross-device
live-sync engages instead of each device running its own parallel casting interview. This covers
the server foundation: the per-user store (first-writer-wins, isolated, atomic) and the two routes
(`GET/POST /api/orwell/game-session`), plus that the reset doors rotate the binding.

Name-agnostic; the engine is monkeypatched (no running engine needed); the store path is redirected
to a tmp file so the test never touches the real data dir.
"""

import importlib

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

orwell_engine = importlib.import_module("src.orwell_engine")
orwell_routes = importlib.import_module("routes.orwell_routes")
ogs = importlib.import_module("src.orwell_game_session")


@pytest.fixture(autouse=True)
def _tmp_store(tmp_path, monkeypatch):
    """Redirect the store to a throwaway path so tests never touch the real data dir."""
    monkeypatch.setattr(ogs, "GAME_SESSION_PATH", tmp_path / "orwell_game_session.json")


def _app():
    app = FastAPI()
    app.include_router(orwell_routes.setup_orwell_routes())
    return app


# ── the store ────────────────────────────────────────────────────────────────

def test_store_first_writer_wins():
    assert ogs.get_game_session("u") is None
    assert ogs.bind_game_session("u", "sess-A") == "sess-A"
    # a racing second device adopts the already-bound id, never overwrites it
    assert ogs.bind_game_session("u", "sess-B") == "sess-A"
    assert ogs.get_game_session("u") == "sess-A"


def test_store_is_per_user_isolated():
    ogs.bind_game_session("alice", "sess-A")
    ogs.bind_game_session("bob", "sess-B")
    assert ogs.get_game_session("alice") == "sess-A"
    assert ogs.get_game_session("bob") == "sess-B"


def test_store_clear_unbinds():
    ogs.bind_game_session("u", "sess-A")
    ogs.clear_game_session("u")
    assert ogs.get_game_session("u") is None
    # after a clear, the NEXT device's bind wins fresh (season rotation)
    assert ogs.bind_game_session("u", "sess-2") == "sess-2"


def test_store_empty_id_never_binds():
    assert ogs.bind_game_session("u", "") == ""
    assert ogs.get_game_session("u") is None


# ── the routes ───────────────────────────────────────────────────────────────

def test_route_resolve_then_bind_idempotent(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    client = TestClient(_app(), raise_server_exceptions=False)

    # nothing bound yet
    r = client.get("/api/orwell/game-session")
    assert r.status_code == 200 and r.json()["sessionId"] is None

    # first device binds
    r = client.post("/api/orwell/game-session", json={"sessionId": "sess-A"})
    assert r.status_code == 200 and r.json() == {"sessionId": "sess-A", "bound": True}

    # second device races a DIFFERENT id -> adopts the first, bound:false
    r = client.post("/api/orwell/game-session", json={"sessionId": "sess-B"})
    assert r.status_code == 200 and r.json() == {"sessionId": "sess-A", "bound": False}

    # every device now resolves the same id
    assert client.get("/api/orwell/game-session").json()["sessionId"] == "sess-A"


def test_route_bind_requires_id(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.post("/api/orwell/game-session", json={"sessionId": ""})
    assert r.status_code == 400


def test_reset_progress_rotates_binding(monkeypatch):
    """A season reset must unbind the canonical session so the new level opens in a fresh chat."""
    monkeypatch.setenv("AUTH_ENABLED", "false")

    async def fake_reset(op=None, user=None):
        return {"started": False}

    monkeypatch.setattr(orwell_engine, "manage_sandbox", fake_reset)
    monkeypatch.setattr(orwell_engine, "remember_pending", lambda *a, **k: None)
    monkeypatch.setattr(orwell_routes.orwell_portraits, "scrub_user", lambda *a, **k: None)

    client = TestClient(_app(), raise_server_exceptions=False)
    client.post("/api/orwell/game-session", json={"sessionId": "sess-A"})
    assert client.get("/api/orwell/game-session").json()["sessionId"] == "sess-A"

    r = client.post("/api/orwell/reset-progress", json={"confirm": True})
    assert r.status_code == 200
    # the binding is gone — devices will rebind to a fresh chat for the restarted level
    assert client.get("/api/orwell/game-session").json()["sessionId"] is None


# ── wiring drift-pins (cheap, no heavy imports) ───────────────────────────────

def _read(*parts):
    import os
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(root, *parts), "r", encoding="utf-8") as f:
        return f.read()


def test_onboarding_resolves_and_opens_canonical_session():
    """The client onboarding must resolve the canonical session and open it (not blindly mint a new
    chat per device)."""
    src = _read("static", "js", "orwellOnboarding.js")
    assert "/api/orwell/game-session" in src
    assert "selectSession" in src


def test_framing_binds_canonical_session():
    """apply_game_framing must bind the driving session as canonical in BOTH the game-active and the
    casting branches, so every device converges (first-writer-wins)."""
    src = _read("routes", "chat_helpers.py")
    # the helper delegates to the store's first-writer-wins bind
    assert "def _bind_canonical_game_session" in src
    assert "orwell_game_session.bind_game_session" in src
    # called from both framing branches
    assert src.count("_bind_canonical_game_session(user, session_id)") >= 2


def test_reset_doors_clear_canonical_session():
    """All three reset doors must rotate (clear) the binding so a new season opens in a fresh chat."""
    src = _read("routes", "orwell_routes.py")
    assert src.count("orwell_game_session.clear_game_session(user)") >= 3
