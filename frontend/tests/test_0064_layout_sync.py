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


# ── #637/#638: the SYNTHETIC synced fields (gadget order, panel side, popup dismiss) ──────────

def test_panel_side_is_a_bounded_enum():
    saved = layout.patch_layout("u", "panel", {"side": "right"})
    assert saved == {"side": "right"}
    assert layout.get_layout("u")["windows"]["panel"]["side"] == "right"
    # last-write-wins on the same field
    layout.patch_layout("u", "panel", {"side": "left"})
    assert layout.get_layout("u")["windows"]["panel"]["side"] == "left"


def test_panel_side_rejects_garbage_enum():
    # an out-of-enum side is dropped → empty state → nothing stored
    assert layout.patch_layout("u", "panel", {"side": "up"}) == {}
    assert layout.patch_layout("u", "panel", {"side": 1}) == {}
    assert layout.get_layout("u")["windows"] == {}


def test_gadget_order_is_a_bounded_clean_id_list():
    saved = layout.patch_layout("u", "gadget-rail",
                                {"order": ["orwell-status", "orwell-deals", "orwell-status", 7, ""]})
    # de-duplicated, non-string / empty ids dropped, original order preserved
    assert saved == {"order": ["orwell-status", "orwell-deals"]}
    assert layout.get_layout("u")["windows"]["gadget-rail"]["order"] == ["orwell-status", "orwell-deals"]


def test_gadget_order_empty_or_non_list_is_dropped():
    assert layout.patch_layout("u", "gadget-rail", {"order": []}) == {}
    assert layout.patch_layout("u", "gadget-rail", {"order": "nope"}) == {}
    assert layout.get_layout("u")["windows"] == {}


def test_gadget_order_is_length_bounded():
    big = ["g" + str(i) for i in range(500)]
    saved = layout.patch_layout("u", "gadget-rail", {"order": big})
    assert len(saved["order"]) == layout._MAX_ORDER_LEN


def test_popup_dismiss_is_a_synced_bool():
    saved = layout.patch_layout("u", "popup:premiere-tutorial", {"dismissed": True})
    assert saved == {"dismissed": True}
    assert layout.get_layout("u")["windows"]["popup:premiere-tutorial"]["dismissed"] is True


def test_gadget_collapse_is_a_synced_bool():
    # #640 (the OrwellGadget kit): a rail gadget's COLLAPSED state syncs through the SAME store
    # under a synthetic "gadget:<id>" id, reusing the per-field LWW merge + the fan-out.
    saved = layout.patch_layout("u", "gadget:orwell-status", {"collapsed": True})
    assert saved == {"collapsed": True}
    assert layout.get_layout("u")["windows"]["gadget:orwell-status"]["collapsed"] is True
    # last-write-wins flips it back
    layout.patch_layout("u", "gadget:orwell-status", {"collapsed": False})
    assert layout.get_layout("u")["windows"]["gadget:orwell-status"]["collapsed"] is False


def test_two_devices_converge_on_the_new_fields():
    """LWW parity: a write from 'device A' is what BOTH devices read back (the synced value is the
    single source of truth) — the cross-device convergence #637/#638 require."""
    layout.patch_layout("u", "panel", {"side": "right"})
    layout.patch_layout("u", "gadget-rail", {"order": ["orwell-deals", "orwell-status"]})
    layout.patch_layout("u", "popup:premiere-tutorial", {"dismissed": True})
    a = layout.get_layout("u")["windows"]
    b = layout.get_layout("u")["windows"]   # a second device reads the same store
    assert a == b
    assert a["panel"]["side"] == "right"
    assert a["gadget-rail"]["order"] == ["orwell-deals", "orwell-status"]
    assert a["popup:premiere-tutorial"]["dismissed"] is True


def test_new_fields_publish_layout_changed_for_the_mirror(monkeypatch):
    """A PATCH to a synthetic id must fan `layout-changed` over the canonical session (the realtime
    two-window mirror), carrying only the Vault-free field — never a body / Vault."""
    monkeypatch.setenv("AUTH_ENABLED", "false")
    monkeypatch.setattr(ogs, "get_game_session", lambda user: "sess-canon")
    published = []
    monkeypatch.setattr(session_events, "publish", lambda sid, ev, data=None: published.append((sid, ev, data)))

    client = TestClient(_app(), raise_server_exceptions=False)
    for wid, st in (("panel", {"side": "right"}),
                    ("gadget-rail", {"order": ["orwell-status", "orwell-deals"]}),
                    ("popup:premiere-tutorial", {"dismissed": True})):
        r = client.patch("/api/orwell/layout", json={"windowId": wid, "state": st, "origin": "tab-A"})
        assert r.status_code == 200
    assert len(published) == 3
    for sid, ev, data in published:
        assert sid == "sess-canon" and ev == "layout-changed" and data["origin"] == "tab-A"
        blob = repr(data).lower()
        assert "secret" not in blob and "vault" not in blob


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


# ── #637/#638: the synthetic-field consumers reuse the SAME seam (no parallel sync) ───────────

def test_layout_sync_seeds_non_kit_consumers():
    """The initial GET /layout must hand the synthetic-id state to non-kit consumers (the gadget
    rail / panel / popups) via a local apply event — not only the kit's window seed."""
    src = _read("static", "js", "orwellLayoutSync.js")
    assert "orwell:layout-seed" in src


def test_gadget_rail_order_syncs_through_the_layout_store():
    src = _read("static", "js", "orwellGadgetRail.js")
    # saveOrder emits through the SAME capture event the kit uses (no parallel sync)
    assert 'id: "gadget-rail"' in src and "order:" in src
    assert "orwell:window-layout" in src
    # and it applies a synced order arriving from the seed OR a peer window (the realtime mirror)
    assert "orwell:layout-seed" in src and "orwell:layout-changed" in src
    assert "applySyncedOrder" in src
    # localStorage stays as the offline/seed fallback
    assert "_orderKey" in src and "lsSet(_orderKey()" in src


def test_panel_side_syncs_through_the_layout_store():
    src = _read("static", "js", "sidebar-layout.js")
    assert "id: 'panel'" in src and "side:" in src
    assert "orwell:window-layout" in src
    assert "orwell:layout-seed" in src and "orwell:layout-changed" in src
    assert "_applySyncedSide" in src
    # the local Storage key is still written (the offline/seed fallback #552 reads read-only on mobile)
    assert "Storage.KEYS.SIDEBAR_SIDE" in src


def test_premiere_popup_dismiss_syncs_through_the_layout_store():
    src = _read("static", "js", "orwellPremiereTutorial.js")
    assert 'id: POPUP_ID' in src and 'POPUP_ID = "popup:premiere-tutorial"' in src
    assert "dismissed: true" in src
    assert "orwell:window-layout" in src
    assert "orwell:layout-seed" in src and "orwell:layout-changed" in src
    assert "applySyncedDismiss" in src
    # the per-user localStorage key remains the offline/seed fallback
    assert "dismissKey()" in src


def test_synthetic_field_consumers_never_dispatch_gamechanged():
    """g15 invariant: these new seams must only LISTEN; the single `orwell:gamechanged` dispatcher
    stays in platform.js. None of the three may mint one ad-hoc."""
    for f in ("orwellGadgetRail.js", "sidebar-layout.js", "orwellPremiereTutorial.js", "orwellLayoutSync.js"):
        src = _read("static", "js", f)
        assert "new CustomEvent('orwell:gamechanged'" not in src
        assert 'new CustomEvent("orwell:gamechanged"' not in src
