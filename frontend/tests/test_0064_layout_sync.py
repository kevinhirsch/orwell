"""Feature 0064 Part F — window/HUD layout sync across devices (server side).

Covers the per-user layout store (merge / isolation / clamping / bounds) and the routes
(`GET/PATCH /api/orwell/layout`), including that a PATCH fans a `layout-changed` event out over the
canonical game session's SSE channel carrying only ids + geometry (never a body / Vault).

Name-agnostic; store path redirected to a tmp file so the real data dir is never touched.
"""

import importlib

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

orwell_routes = importlib.import_module("routes.orwell_routes")
layout = importlib.import_module("src.orwell_layout")
ogs = importlib.import_module("src.orwell_game_session")
session_events = importlib.import_module("src.session_events")


@pytest.fixture(autouse=True)
def _tmp_store(tmp_path, monkeypatch):
    monkeypatch.setattr(layout, "LAYOUT_PATH", tmp_path / "orwell_layout.json")


def _app():
    app = FastAPI()
    app.include_router(orwell_routes.setup_orwell_routes())
    return app


# ── the store ────────────────────────────────────────────────────────────────

def test_patch_then_get_reflects():
    layout.patch_layout("u", "cast", {"open": True, "x": 10, "y": 20, "w": 300, "h": 400})
    blob = layout.get_layout("u")
    assert blob["windows"]["cast"] == {"open": True, "x": 10.0, "y": 20.0, "w": 300.0, "h": 400.0}


def test_last_write_wins_per_field():
    layout.patch_layout("u", "cast", {"x": 10, "y": 20})
    layout.patch_layout("u", "cast", {"x": 99})  # only x moves; y is preserved
    assert layout.get_layout("u")["windows"]["cast"] == {"x": 99.0, "y": 20.0}


def test_per_user_isolation():
    layout.patch_layout("alice", "cast", {"x": 1})
    layout.patch_layout("bob", "cast", {"x": 2})
    assert layout.get_layout("alice")["windows"]["cast"]["x"] == 1.0
    assert layout.get_layout("bob")["windows"]["cast"]["x"] == 2.0


def test_unknown_fields_dropped_and_geometry_clamped():
    saved = layout.patch_layout("u", "cast", {"open": 1, "evil": "x", "x": 999999})
    assert "evil" not in saved
    assert saved["open"] is True
    assert saved["x"] == 20000.0  # clamped to the max


def test_bad_window_id_or_empty_state_stores_nothing():
    assert layout.patch_layout("u", "", {"x": 1}) == {}
    assert layout.patch_layout("u", "cast", {}) == {}
    assert layout.get_layout("u")["windows"] == {}


# ── the routes ───────────────────────────────────────────────────────────────

def test_get_layout_empty_default(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    client = TestClient(_app(), raise_server_exceptions=False)
    assert client.get("/api/orwell/layout").json() == {"windows": {}}


def test_patch_route_persists_and_returns(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.patch("/api/orwell/layout", json={"windowId": "finale", "state": {"minimized": True}})
    assert r.status_code == 200
    assert r.json() == {"windowId": "finale", "state": {"minimized": True}}
    assert client.get("/api/orwell/layout").json()["windows"]["finale"] == {"minimized": True}


def test_patch_route_rejects_empty(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.patch("/api/orwell/layout", json={"windowId": "finale", "state": {}})
    assert r.status_code == 400


def test_patch_publishes_layout_changed_event(monkeypatch):
    """A PATCH must fan a `layout-changed` event over the canonical session, ids + geometry only."""
    monkeypatch.setenv("AUTH_ENABLED", "false")
    monkeypatch.setattr(ogs, "get_game_session", lambda user: "sess-canon")
    published = []
    monkeypatch.setattr(session_events, "publish", lambda sid, ev, data=None: published.append((sid, ev, data)))

    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.patch("/api/orwell/layout",
                     json={"windowId": "cast", "state": {"x": 5, "y": 6}, "origin": "tab-7"})
    assert r.status_code == 200
    assert len(published) == 1
    sid, ev, data = published[0]
    assert sid == "sess-canon" and ev == "layout-changed"
    assert data["windowId"] == "cast" and data["origin"] == "tab-7"
    assert data["state"] == {"x": 5.0, "y": 6.0}
    # the payload carries only ids + geometry — no message body / Vault-ish content
    blob = repr(data).lower()
    assert "content" not in blob and "secret" not in blob and "vault" not in blob


def test_patch_no_canonical_session_still_persists(monkeypatch):
    """With no bound game session, the PATCH still persists; it just has nobody to broadcast to."""
    monkeypatch.setenv("AUTH_ENABLED", "false")
    monkeypatch.setattr(ogs, "get_game_session", lambda user: None)
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.patch("/api/orwell/layout", json={"windowId": "cast", "state": {"docked": True}})
    assert r.status_code == 200
    assert client.get("/api/orwell/layout").json()["windows"]["cast"] == {"docked": True}


# ── client wiring drift-pins (cheap, no browser) ──────────────────────────────

def _read(*parts):
    import os
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(root, *parts), "r", encoding="utf-8") as f:
        return f.read()


def test_kit_captures_and_applies_layout():
    """The window kit must emit local changes for sync and expose a remote-apply seam."""
    src = _read("static", "js", "orwellWindow.js")
    assert "orwell:window-layout" in src              # capture event
    assert "_orwellApplyRemoteLayout" in src          # remote-apply seam
    assert "_applyLayout" in src                      # the per-window applier
    # capture is wired at the geometry + state seams. The kit funnels every seam through the
    # _emit() wrapper (which gates on _applyingRemote AND the D1 persistLayout:false opt-out), so the
    # capture sites are counted as this._emit(...) calls, not raw emitWindowLayout( calls.
    assert "onResizeEnd" in src
    assert "_emit(state)" in src                      # the single capture funnel
    assert src.count("this._emit(") >= 5              # persist + resize + min + restore + dock + open/close
    assert "emitWindowLayout(" in src                 # _emit still delegates to the module emitter


def test_layout_sync_module_present_and_registered():
    src = _read("static", "js", "orwellLayoutSync.js")
    assert "/api/orwell/layout" in src and "PATCH" in src
    assert "orwell:window-layout" in src and "orwell:layout-changed" in src
    assert "origin" in src.lower()                    # self-echo guard
    html = _read("static", "index.html")
    assert "orwellLayoutSync.js" in html


def test_sessionsync_dispatches_layout_changed():
    src = _read("static", "js", "sessionSync.js")
    assert "layout-changed" in src
    assert "orwell:layout-changed" in src
