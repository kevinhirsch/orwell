"""Feature 0065 — the cast pre-warm state is explicitly cleared when a new season/game starts.

The pre-warm orchestrator (`src.orwell_prewarm`) holds a process-local per-user warm gate.
It self-resets when the engine seed changes, but the three season-reset routes ALSO call
`orwell_prewarm.reset(user)` explicitly (belt-and-suspenders) so a stale warm gate can never
bleed into a fresh cast.

This proves each of the three routes — /new-game, /next-season, /reset-progress — invokes
`orwell_prewarm.reset(user)`. Name-agnostic; the engine + portraits + seasons store are
monkeypatched (no running engine, no real files).
"""

import importlib

from fastapi import FastAPI
from fastapi.testclient import TestClient

orwell_engine = importlib.import_module("src.orwell_engine")
orwell_routes = importlib.import_module("routes.orwell_routes")
orwell_seasons = importlib.import_module("src.orwell_seasons")
orwell_portraits = importlib.import_module("src.orwell_portraits")
orwell_prewarm = importlib.import_module("src.orwell_prewarm")


def _app():
    app = FastAPI()
    app.include_router(orwell_routes.setup_orwell_routes())
    return app


def _spy_prewarm_reset(monkeypatch):
    """Replace orwell_prewarm.reset with a spy that records the users it was called with.
    The routes import `orwell_prewarm` locally from `src`, so patching the module attribute
    is what the route resolves at call time."""
    seen = []
    monkeypatch.setattr(orwell_prewarm, "reset", lambda user=None: seen.append(user))
    # The routes also scrub portraits right beside the reset — neutralize it so neither call
    # depends on real files.
    monkeypatch.setattr(orwell_portraits, "scrub_user", lambda u: None)
    return seen


# In this unauthenticated harness `_current_user(request)` resolves to None, so the route resets
# the warm state for that same (None) user — exactly the user it scrubs portraits for. The point is
# that reset is called with the SAME user the route operates on (one call, co-located with scrub).
_THIS_USER = None


# ── POST /new-game ─────────────────────────────────────────────────────────────────────────────

def test_new_game_resets_prewarm(monkeypatch):
    # /new-game is admin-gated (E70); AUTH_ENABLED=false lets the route run (deploy-smoke posture).
    monkeypatch.setenv("AUTH_ENABLED", "false")
    seen = _spy_prewarm_reset(monkeypatch)

    async def fake_state(user=None):
        return {"started": False}

    async def fake_create(name, **kwargs):
        return {"started": True}

    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)
    monkeypatch.setattr(orwell_engine, "create_character", fake_create)

    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.post("/api/orwell/new-game", json={"playerName": "P"})
    assert r.status_code == 200
    assert seen == [_THIS_USER]  # the route cleared THIS user's warm state


# ── POST /next-season ────────────────────────────────────────────────────────────────────────

def _finished_state(monkeypatch):
    async def fake_state(user=None):
        return {"started": True, "finished": True}
    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)


def test_next_season_keep_resets_prewarm(tmp_path, monkeypatch):
    monkeypatch.setattr(orwell_seasons, "SEASONS_PATH", tmp_path / "s.json")
    _finished_state(monkeypatch)
    seen = _spy_prewarm_reset(monkeypatch)

    async def fake_create(name, **kwargs):
        return {"started": True}

    monkeypatch.setattr(orwell_engine, "create_character", fake_create)

    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.post("/api/orwell/next-season", json={"keep": True, "confirm": True})
    assert r.status_code == 200
    assert seen == [_THIS_USER]


def test_next_season_recreate_resets_prewarm(tmp_path, monkeypatch):
    monkeypatch.setattr(orwell_seasons, "SEASONS_PATH", tmp_path / "s.json")
    _finished_state(monkeypatch)
    seen = _spy_prewarm_reset(monkeypatch)

    async def fake_manage(op=None, user=None):
        return {"started": False}

    monkeypatch.setattr(orwell_engine, "manage_sandbox", fake_manage)

    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.post("/api/orwell/next-season", json={"keep": False, "confirm": True})
    assert r.status_code == 200
    assert seen == [_THIS_USER]


# ── POST /reset-progress ─────────────────────────────────────────────────────────────────────

def test_reset_progress_resets_prewarm(tmp_path, monkeypatch):
    monkeypatch.setattr(orwell_seasons, "SEASONS_PATH", tmp_path / "s.json")
    seen = _spy_prewarm_reset(monkeypatch)

    async def fake_manage(op=None, user=None):
        return {"started": False}

    monkeypatch.setattr(orwell_engine, "manage_sandbox", fake_manage)

    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.post("/api/orwell/reset-progress", json={"confirm": True})
    assert r.status_code == 200 and r.json()["reset"] is True
    assert seen == [_THIS_USER]


# ── End-to-end via the real warm state (no spy): a route flips a seeded gate OFF ───────────────

def test_reset_progress_clears_live_warm_state(tmp_path, monkeypatch):
    """Belt: seed the REAL _STATE for the user, then prove the route drops it (authorStarted False)."""
    monkeypatch.setattr(orwell_seasons, "SEASONS_PATH", tmp_path / "s.json")
    monkeypatch.setattr(orwell_portraits, "scrub_user", lambda u: None)

    async def fake_manage(op=None, user=None):
        return {"started": False}

    monkeypatch.setattr(orwell_engine, "manage_sandbox", fake_manage)

    # Seed a warm gate for "default" directly via the module's own state machine.
    st = orwell_prewarm._state("default")
    st.author_started = True
    st.seed = 123
    st.prompts = [{"id": "x"}]
    assert orwell_prewarm.warm_state("default")["authorStarted"] is True

    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.post("/api/orwell/reset-progress", json={"confirm": True})
    assert r.status_code == 200
    # The route's explicit reset dropped the stale gate.
    assert orwell_prewarm.warm_state("default")["authorStarted"] is False
