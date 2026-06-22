"""The shared HUD /state read is a POLLER, not the chat-blocking frame, so it must use the wider
poll timeout — not the tight 3s framing default.

Prod bundle 2026-06-22: the /state route logged `state failed: ReadTimeout` during a casting-load
spike (portrait/cast generation in flight made a state read exceed 3s), because the route called
get_game_state with the framing default. Pollers tolerate a busier engine — they log a blip / serve
last-good instead of 502-ing every poll. This pins the poll bound and that the route uses it.

Harness mirrors test_0064_salvage.py (build the real router + TestClient, mock the engine seam).
"""

import importlib

from fastapi import FastAPI
from fastapi.testclient import TestClient

orwell_routes = importlib.import_module("routes.orwell_routes")
orwell_engine = importlib.import_module("src.orwell_engine")


def _app():
    app = FastAPI()
    app.include_router(orwell_routes.setup_orwell_routes())
    return app


def test_poll_timeout_is_wider_than_the_frame_but_still_bounded():
    # A poller tolerates a busier engine than the chat-blocking frame, but must stay bounded
    # (never the full default) so a truly hung engine can't wedge a panel poll for 30s.
    assert orwell_engine._FRAMING_TIMEOUT < orwell_engine._POLL_TIMEOUT <= orwell_engine._TIMEOUT


def test_state_route_uses_the_poll_timeout_not_the_framing_default(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    seen = {}

    async def fake_state(user=None, timeout=None):
        seen["timeout"] = timeout
        return {"started": False}

    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)

    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.get("/api/orwell/state")
    assert r.status_code == 200
    # The route must pass an explicit POLL timeout — not None (which would inherit the tight 3s
    # framing default and ReadTimeout on a generation-busy engine, the exact prod regression).
    assert seen.get("timeout") == orwell_engine._POLL_TIMEOUT
    assert seen["timeout"] > orwell_engine._FRAMING_TIMEOUT
