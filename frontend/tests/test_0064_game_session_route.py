"""Feature 0064 — the GET /api/orwell/game-session route + reset rotation + once-only kickoff.

  * the route resolves-or-mints THIS user's canonical session and returns {sessionId, created};
  * two opens return the SAME id (idempotent — never two sessions for one user);
  * a reset door (new-game / next-season / reset-progress) clears the binding so the next open mints
    a clean session (no dead-season transcript bleed);
  * the response is Vault-free (a session id + a created flag only, no game state);
  * once-only kickoff: the client fires the producers' opener only when the conversation is empty
    (drift-pinned in the onboarding JS — the source of the field bug).

The session minting/exists hooks and the engine are monkeypatched, so the suite needs no DB or
running engine. Roles only.
"""

import importlib
import os

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

orwell_routes = importlib.import_module("routes.orwell_routes")
ogs = importlib.import_module("src.orwell_game_session")
orwell_engine = importlib.import_module("src.orwell_engine")


VAULT_SENTINEL = "__VAULT_SECRET__"


@pytest.fixture(autouse=True)
def _isolate(tmp_path, monkeypatch):
    monkeypatch.setattr(ogs, "GAME_SESSION_PATH", tmp_path / "orwell_game_session.json")
    # A deterministic, monotonic minter so a duplicate mint is observable.
    box = {"n": 0, "live": set()}

    def fake_mint(user):
        box["n"] += 1
        sid = f"sess-{box['n']}"
        box["live"].add(sid)
        return sid

    monkeypatch.setattr(orwell_routes, "_mint_game_session", fake_mint)
    monkeypatch.setattr(
        orwell_routes, "_session_exists_for_user", lambda sid, user: sid in box["live"]
    )
    yield box


def _app():
    app = FastAPI()
    app.include_router(orwell_routes.setup_orwell_routes())
    return app


def _client():
    return TestClient(_app(), raise_server_exceptions=False)


def test_first_open_mints_and_binds(_isolate):
    r = _client().get("/api/orwell/game-session")
    assert r.status_code == 200
    body = r.json()
    assert body["created"] is True
    assert body["sessionId"]


def test_second_open_reuses_the_same_session(_isolate):
    c = _client()
    a = c.get("/api/orwell/game-session").json()
    b = c.get("/api/orwell/game-session").json()
    assert a["sessionId"] == b["sessionId"]
    assert b["created"] is False
    assert _isolate["n"] == 1  # no second mint


def test_response_is_vault_free(_isolate):
    r = _client().get("/api/orwell/game-session")
    assert VAULT_SENTINEL not in r.text
    # Only the two contracted keys cross — never game state.
    assert set(r.json().keys()) == {"sessionId", "created"}


def test_reset_progress_rotates_the_binding(monkeypatch, _isolate):
    """A reset clears the binding so the next /game-session mints a clean session (no dead-season
    transcript as narrator context)."""
    async def fake_reset(action, user=None):
        return {"started": False}

    monkeypatch.setattr(orwell_engine, "manage_sandbox", fake_reset)
    monkeypatch.setattr(orwell_engine, "remember_pending", lambda *a, **k: None)

    c = _client()
    first = c.get("/api/orwell/game-session").json()["sessionId"]
    r = c.post("/api/orwell/reset-progress", json={"confirm": True})
    assert r.status_code == 200
    assert ogs.get_game_session(None) is None  # the binding was cleared
    second = c.get("/api/orwell/game-session").json()["sessionId"]
    assert second != first  # a fresh season binds a fresh session


def test_reset_source_clears_each_door():
    """Drift pin: all three reset doors rotate the canonical session."""
    src_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "routes", "orwell_routes.py"
    )
    with open(src_path, "r", encoding="utf-8") as f:
        src = f.read()
    for door in ("/new-game", "/next-season", "/reset-progress"):
        block = src.split(f'@router.post("{door}")')[1].split("@router.")[0]
        assert "orwell_game_session.clear_game_session(user)" in block, door


def test_kickoff_is_once_per_game_in_source():
    """0064 §D — the producers' opener fires ONCE per game, not once per device. The onboarding JS
    must not fire the cue when an assistant turn is already present (a second device that received
    the opener via sync must not re-prompt)."""
    js_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "static", "js", "orwellOnboarding.js",
    )
    with open(js_path, "r", encoding="utf-8") as f:
        js = f.read()
    assert "_conversationHasAssistantTurn" in js
    block = js.split("_orwellOpenGameAfterCasting = function")[1]
    assert "_conversationHasAssistantTurn()" in block.split("setTimeout")[0]


def test_onboarding_resolves_the_canonical_session_in_source():
    """0064 §A — every device opens the SAME canonical session instead of minting a device-local
    '+ New chat'."""
    js_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "static", "js", "orwellOnboarding.js",
    )
    with open(js_path, "r", encoding="utf-8") as f:
        js = f.read()
    assert "/api/orwell/game-session" in js
    assert "selectSession" in js


def test_decision_route_publishes_game_updated_in_source():
    """0064 §B.3 — the binding-decision / self-evict routes ping `game-updated` so a non-driving
    device reconciles its HUD instantly."""
    src_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "routes", "orwell_routes.py"
    )
    with open(src_path, "r", encoding="utf-8") as f:
        src = f.read()
    assert src.count("_publish_game_updated(") >= 3  # decision + self-evict request + cancel
    assert 'session_events.publish(sid, "game-updated")' in src
