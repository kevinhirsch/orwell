"""Owner ruling 2026-07-17 — hide non-game session rows from the drawer once a game has started.

PR #1696 fixed the *rename* half: a started game's canonical session (0064) is renamed
"Season {N}" by ``rename_canonical_session_for_season_start`` (routes/chat_helpers.py). That
alone still left every OTHER session row (casting attempts on other tabs/devices, orphaned
scaffolding — casting is deliberately per-tab per ADR 0008/0012) visible in the drawer,
confusing the player about which conversation is their actual game.

This pins the remaining fix: once the game-build user's canonical session has been renamed to
"Season N" (the established started-signal), ``GET /api/sessions`` returns ONLY that session —
display-layer only. Before that rename (still casting) every row stays visible, matching current
behavior; the full inherited-workspace build (``ORWELL_GAME_BUILD=0``) is never filtered.

Deliberately does NOT touch canonical binding / delete / unbind machinery — a hidden row is still
a normal session under the hood (addressable by id via /api/history, /api/session/{id}, etc.),
only the LIST is trimmed. Roles-only; no names.
"""

import importlib
import types

import pytest
from fastapi import APIRouter, FastAPI
from fastapi.testclient import TestClient

session_routes = importlib.import_module("routes.session_routes")
settings = importlib.import_module("src.settings")
ogs = importlib.import_module("src.orwell_game_session")


@pytest.fixture(autouse=True)
def _tmp_store(tmp_path, monkeypatch):
    # Never touch the real data dir (mirrors tests/test_canonical_session_liveness.py).
    monkeypatch.setattr(ogs, "GAME_SESSION_PATH", tmp_path / "orwell_game_session.json")


class _StubSessionManager:
    """Just enough of SessionManager for list_sessions: an in-memory {id: session} map."""

    def __init__(self, sessions):
        self.sessions = sessions

    def get_sessions_for_user(self, username=None):
        return dict(self.sessions)


def _session(sid, name):
    return types.SimpleNamespace(
        id=sid, name=name, model="some/model", endpoint_url="http://x",
        rag=None, archived=False, owner=None,
    )


def _client(monkeypatch, sessions, game_build=True):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    monkeypatch.setattr(settings, "game_build_enabled", lambda: game_build)
    monkeypatch.setattr(session_routes, "game_build_enabled", lambda: game_build)
    # `session_routes.router` is a MODULE-GLOBAL APIRouter that setup_session_routes()
    # decorates onto every time it's called — reusing it across tests would accumulate
    # duplicate "/sessions" handlers and silently dispatch to the FIRST test's closure
    # forever. Swap in a fresh router per test so each app only ever sees its own stub.
    monkeypatch.setattr(session_routes, "router", APIRouter(prefix="/api", tags=["sessions"]))
    sm = _StubSessionManager(sessions)
    app = FastAPI()
    app.include_router(session_routes.setup_session_routes(sm, {"REQUEST_TIMEOUT": 2}))
    return TestClient(app, raise_server_exceptions=False)


def test_started_game_hides_every_row_but_the_canonical_season_session(monkeypatch):
    """Once the canonical session is renamed 'Season N', the drawer shows exactly one row."""
    sessions = {
        "canon": _session("canon", "Season 1"),
        "stray-tab": _session("stray-tab", "Casting interview"),
        "orphan": _session("orphan", "Chat: 2026-07-16"),
    }
    ogs.bind_game_session(None, "canon")
    client = _client(monkeypatch, sessions)
    res = client.get("/api/sessions")
    assert res.status_code == 200
    ids = [s["id"] for s in res.json()]
    assert ids == ["canon"], f"expected only the canonical game session, got {ids}"


def test_pregame_casting_leaves_every_row_visible(monkeypatch):
    """Before the started-edge rename (still 'Casting interview'), nothing is hidden — casting
    is deliberately per-tab (ADR 0008/0012) and the player may legitimately have several rows."""
    sessions = {
        "canon": _session("canon", "Casting interview"),
        "stray-tab": _session("stray-tab", "Casting interview"),
    }
    ogs.bind_game_session(None, "canon")
    client = _client(monkeypatch, sessions)
    res = client.get("/api/sessions")
    assert res.status_code == 200
    ids = {s["id"] for s in res.json()}
    assert ids == {"canon", "stray-tab"}


def test_no_canonical_binding_leaves_every_row_visible(monkeypatch):
    """No canonical session bound yet (fresh account, nothing cast) — no filter applies."""
    sessions = {
        "a": _session("a", "Chat: 2026-07-16"),
        "b": _session("b", "Chat: 2026-07-16 (2)"),
    }
    client = _client(monkeypatch, sessions)
    res = client.get("/api/sessions")
    assert res.status_code == 200
    ids = {s["id"] for s in res.json()}
    assert ids == {"a", "b"}


def test_full_workspace_build_is_never_filtered(monkeypatch):
    """ORWELL_GAME_BUILD=0 (the full inherited workspace) must be completely unaffected — even
    with a canonical session renamed to 'Season N', every row stays visible."""
    sessions = {
        "canon": _session("canon", "Season 1"),
        "other": _session("other", "Unrelated chat"),
    }
    ogs.bind_game_session(None, "canon")
    client = _client(monkeypatch, sessions, game_build=False)
    res = client.get("/api/sessions")
    assert res.status_code == 200
    ids = {s["id"] for s in res.json()}
    assert ids == {"canon", "other"}


def test_stale_canonical_binding_leaves_every_row_visible(monkeypatch):
    """A canonical id bound to a session that no longer exists in this user's set (e.g. it was
    deleted out from under the binding) must fail OPEN — never hide everything."""
    sessions = {
        "a": _session("a", "Season 1"),
    }
    ogs.bind_game_session(None, "does-not-exist")
    client = _client(monkeypatch, sessions)
    res = client.get("/api/sessions")
    assert res.status_code == 200
    ids = {s["id"] for s in res.json()}
    assert ids == {"a"}
