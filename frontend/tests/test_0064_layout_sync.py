"""WS Phase-1 (ADR 0017) — window/HUD layout store + routes (server side).

Covers the layout store (merge / isolation / clamping / bounds) and the routes
(`GET/PATCH /api/orwell/layout`), including that a PATCH fans a `layout-changed` event out over the
canonical game session's SSE channel carrying only ids + geometry (never a body / Vault).

**Policy flip (ADR 0017, supersedes 0064-F):** layout geometry is remembered PER DEVICE and is NO
LONGER synced cross-device — only game state syncs. The store is keyed by `(user, deviceId)`; a
legacy per-user record still resolves (migration). The old "layout syncs across devices" assertion is
therefore WRONG and is flipped below to "per-device independence." The per-(user,deviceId) keying,
LWW, migration, and origin echo-suppression unit half lives in ``test_ws_layout_lww.py``.

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

# A stable per-device token used throughout the store tests (ADR 0017: the store keys on it).
DEV = "dev-A"


@pytest.fixture(autouse=True)
def _tmp_store(tmp_path, monkeypatch):
    monkeypatch.setattr(layout, "LAYOUT_PATH", tmp_path / "orwell_layout.json")


def _app():
    app = FastAPI()
    app.include_router(orwell_routes.setup_orwell_routes())
    return app


def _patch(user, wid, state, device=DEV, origin=""):
    """New signature helper: patch_layout(user, deviceId, {windowId, state}, origin=…)."""
    return layout.patch_layout(user, device, {"windowId": wid, "state": state}, origin=origin)


# ── the store ────────────────────────────────────────────────────────────────

def test_patch_then_get_reflects():
    _patch("u", "cast", {"open": True, "x": 10, "y": 20, "w": 300, "h": 400})
    blob = layout.get_layout("u", DEV)
    assert blob["windows"]["cast"] == {"open": True, "x": 10.0, "y": 20.0, "w": 300.0, "h": 400.0}


def test_last_write_wins_per_field():
    _patch("u", "cast", {"x": 10, "y": 20})
    _patch("u", "cast", {"x": 99})  # only x moves; y is preserved
    assert layout.get_layout("u", DEV)["windows"]["cast"] == {"x": 99.0, "y": 20.0}


def test_per_user_isolation():
    _patch("alice", "cast", {"x": 1})
    _patch("bob", "cast", {"x": 2})
    assert layout.get_layout("alice", DEV)["windows"]["cast"]["x"] == 1.0
    assert layout.get_layout("bob", DEV)["windows"]["cast"]["x"] == 2.0


def test_unknown_fields_dropped_and_geometry_clamped():
    saved = _patch("u", "cast", {"open": 1, "evil": "x", "x": 999999})
    assert "evil" not in saved["state"]
    assert saved["state"]["open"] is True
    assert saved["state"]["x"] == 20000.0  # clamped to the max


def test_bad_window_id_or_empty_state_stores_nothing():
    assert _patch("u", "", {"x": 1}) == {}
    assert _patch("u", "cast", {}) == {}
    assert layout.get_layout("u", DEV)["windows"] == {}


# ── ADR 0017: PER-DEVICE, not cross-device ─────────────────────────────────────

def test_layout_is_per_device_not_synced_cross_device():
    """The 0064-F 'layout syncs across devices' assertion is now WRONG (ADR 0017). A window moved on
    one device must NOT appear on another device — geometry is per-device; only game state syncs."""
    _patch("u", "cast", {"x": 42}, device="desktop")
    # A second device keeps its own (independent, empty) arrangement.
    assert layout.get_layout("u", "phone")["windows"] == {}
    # The originating device still sees its own move.
    assert layout.get_layout("u", "desktop")["windows"]["cast"]["x"] == 42.0
    # A conflicting move on the second device does not disturb the first.
    _patch("u", "cast", {"x": 7}, device="phone")
    assert layout.get_layout("u", "desktop")["windows"]["cast"]["x"] == 42.0
    assert layout.get_layout("u", "phone")["windows"]["cast"]["x"] == 7.0


# ── #637/#638: the SYNTHETIC synced fields (gadget order, panel side, popup dismiss) ──────────

def test_panel_side_is_a_bounded_enum():
    saved = _patch("u", "panel", {"side": "right"})
    assert saved["state"] == {"side": "right"}
    assert layout.get_layout("u", DEV)["windows"]["panel"]["side"] == "right"
    # last-write-wins on the same field
    _patch("u", "panel", {"side": "left"})
    assert layout.get_layout("u", DEV)["windows"]["panel"]["side"] == "left"


def test_panel_side_rejects_garbage_enum():
    # an out-of-enum side is dropped → empty state → nothing stored
    assert _patch("u", "panel", {"side": "up"}) == {}
    assert _patch("u", "panel", {"side": 1}) == {}
    assert layout.get_layout("u", DEV)["windows"] == {}


def test_gadget_order_is_a_bounded_clean_id_list():
    saved = _patch("u", "gadget-rail",
                   {"order": ["orwell-status", "orwell-deals", "orwell-status", 7, ""]})
    # de-duplicated, non-string / empty ids dropped, original order preserved
    assert saved["state"] == {"order": ["orwell-status", "orwell-deals"]}
    assert layout.get_layout("u", DEV)["windows"]["gadget-rail"]["order"] == ["orwell-status", "orwell-deals"]


def test_gadget_order_empty_or_non_list_is_dropped():
    assert _patch("u", "gadget-rail", {"order": []}) == {}
    assert _patch("u", "gadget-rail", {"order": "nope"}) == {}
    assert layout.get_layout("u", DEV)["windows"] == {}


def test_gadget_order_is_length_bounded():
    big = ["g" + str(i) for i in range(500)]
    saved = _patch("u", "gadget-rail", {"order": big})
    assert len(saved["state"]["order"]) == layout._MAX_ORDER_LEN


def test_popup_dismiss_is_a_bool():
    saved = _patch("u", "popup:premiere-tutorial", {"dismissed": True})
    assert saved["state"] == {"dismissed": True}
    assert layout.get_layout("u", DEV)["windows"]["popup:premiere-tutorial"]["dismissed"] is True


def test_gadget_collapse_is_a_bool():
    # #640 (the OrwellGadget kit): a rail gadget's COLLAPSED state persists through the SAME store
    # under a synthetic "gadget:<id>" id, reusing the per-field LWW merge.
    saved = _patch("u", "gadget:orwell-status", {"collapsed": True})
    assert saved["state"] == {"collapsed": True}
    assert layout.get_layout("u", DEV)["windows"]["gadget:orwell-status"]["collapsed"] is True
    # last-write-wins flips it back
    _patch("u", "gadget:orwell-status", {"collapsed": False})
    assert layout.get_layout("u", DEV)["windows"]["gadget:orwell-status"]["collapsed"] is False


# ── #658/#659: the bounded, GENERIC non-geometry `value` scalar ────────────────────────────────

def test_value_accepts_a_string_number_or_bool_scalar():
    """A kit may persist a single non-geometry scalar per key — str / number / bool only, round-
    tripped intact through the same per-field LWW store."""
    saved = _patch("u", "gadget:filter", {"value": "trust-only"})
    assert saved["state"] == {"value": "trust-only"}
    assert layout.get_layout("u", DEV)["windows"]["gadget:filter"]["value"] == "trust-only"
    # a finite number survives
    _patch("u", "gadget:zoom", {"value": 1.5})
    assert layout.get_layout("u", DEV)["windows"]["gadget:zoom"]["value"] == 1.5
    # a bool survives as a bool (not coerced to a number)
    _patch("u", "gadget:pinned", {"value": True})
    assert layout.get_layout("u", DEV)["windows"]["gadget:pinned"]["value"] is True


def test_value_falsy_scalars_survive_round_trip():
    """0 / False / "" are VALID values — the drop path must key on a sentinel, not truthiness."""
    for scalar in (0, False, ""):
        _patch("u", "gadget:falsy", {"value": scalar})
        assert layout.get_layout("u", DEV)["windows"]["gadget:falsy"]["value"] == scalar
        # a bool must not be flattened into 0/1 (False is not 0 for our purposes)
        stored = layout.get_layout("u", DEV)["windows"]["gadget:falsy"]["value"]
        assert type(stored) is type(scalar)


def test_value_can_coexist_with_geometry_and_lww_merges():
    _patch("u", "cast", {"x": 10, "value": "a"})
    _patch("u", "cast", {"value": "b"})  # only value moves; geometry preserved
    win = layout.get_layout("u", DEV)["windows"]["cast"]
    assert win == {"x": 10.0, "value": "b"}


def test_value_drops_nested_blobs_none_oversized_and_non_finite():
    """A dict / list / None / oversized string / NaN / inf `value` is dropped silently (never
    raised); with no other field that leaves an empty state → nothing stored."""
    assert _patch("u", "k", {"value": {"nested": 1}}) == {}
    assert _patch("u", "k", {"value": [1, 2, 3]}) == {}
    assert _patch("u", "k", {"value": None}) == {}
    assert _patch("u", "k", {"value": "x" * (layout._MAX_VALUE_LEN + 1)}) == {}
    assert _patch("u", "k", {"value": float("nan")}) == {}
    assert _patch("u", "k", {"value": float("inf")}) == {}
    assert _patch("u", "k", {"value": float("-inf")}) == {}
    assert layout.get_layout("u", DEV)["windows"] == {}


def test_value_huge_arbitrary_precision_int_is_dropped_never_raises():
    """A JSON `value` of `10**10000` is an arbitrary-precision int; `math.isfinite` on it would
    raise OverflowError (coercion to a C double). The bounded int path must DROP it cleanly — no
    raise, empty state, nothing stored. (greptile P1 regression.)"""
    huge = 10 ** 10000
    assert layout._clean_state({"value": huge}) == {}          # direct _clean_state path — no raise
    assert _patch("u", "k", {"value": huge}) == {}             # and through patch_layout
    assert _patch("u", "k", {"value": -huge}) == {}
    # a just-over-bound int is dropped; the bound itself survives
    assert _patch("u", "k", {"value": layout._MAX_ABS_INT + 1}) == {}
    at_bound = _patch("u", "at-bound", {"value": layout._MAX_ABS_INT})
    assert at_bound["state"]["value"] == layout._MAX_ABS_INT
    assert layout.get_layout("u", DEV)["windows"].get("k") is None


def test_value_at_the_length_cap_survives():
    at_cap = "y" * layout._MAX_VALUE_LEN
    saved = _patch("u", "gadget:note", {"value": at_cap})
    assert saved["state"]["value"] == at_cap


def test_absent_value_is_byte_identical_backcompat():
    """A geometry-only patch (no `value` key) is untouched — no spurious `value` appears."""
    saved = _patch("u", "cast", {"open": True, "x": 5})
    assert "value" not in saved["state"]
    assert layout.get_layout("u", DEV)["windows"]["cast"] == {"open": True, "x": 5.0}


def test_new_fields_publish_layout_changed_for_the_mirror(monkeypatch):
    """A PATCH to a synthetic id must fan `layout-changed` over the canonical session (the SAME
    device's other-tab mirror), carrying only the Vault-free field + the deviceId scope — never a
    body / Vault."""
    monkeypatch.setenv("AUTH_ENABLED", "false")
    monkeypatch.setattr(ogs, "get_game_session", lambda user: "sess-canon")
    published = []
    monkeypatch.setattr(session_events, "publish", lambda sid, ev, data=None: published.append((sid, ev, data)))

    client = TestClient(_app(), raise_server_exceptions=False)
    for wid, st in (("panel", {"side": "right"}),
                    ("gadget-rail", {"order": ["orwell-status", "orwell-deals"]}),
                    ("popup:premiere-tutorial", {"dismissed": True})):
        r = client.patch("/api/orwell/layout",
                         json={"windowId": wid, "state": st, "origin": "tab-A", "deviceId": DEV})
        assert r.status_code == 200
    assert len(published) == 3
    for sid, ev, data in published:
        assert sid == "sess-canon" and ev == "layout-changed" and data["origin"] == "tab-A"
        assert data["deviceId"] == DEV
        blob = repr(data).lower()
        assert "secret" not in blob and "vault" not in blob


# ── the routes ───────────────────────────────────────────────────────────────

def test_get_layout_empty_default(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    client = TestClient(_app(), raise_server_exceptions=False)
    assert client.get("/api/orwell/layout", params={"deviceId": DEV}).json() == {"windows": {}}


def test_patch_route_persists_and_returns(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.patch("/api/orwell/layout",
                     json={"windowId": "finale", "state": {"minimized": True}, "deviceId": DEV})
    assert r.status_code == 200
    assert r.json() == {"windowId": "finale", "state": {"minimized": True}}
    got = client.get("/api/orwell/layout", params={"deviceId": DEV}).json()
    assert got["windows"]["finale"] == {"minimized": True}


def test_patch_route_rejects_empty(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.patch("/api/orwell/layout",
                     json={"windowId": "finale", "state": {}, "deviceId": DEV})
    assert r.status_code == 400


def test_patch_publishes_layout_changed_event(monkeypatch):
    """A PATCH must fan a `layout-changed` event over the canonical session, ids + geometry + the
    deviceId scope only."""
    monkeypatch.setenv("AUTH_ENABLED", "false")
    monkeypatch.setattr(ogs, "get_game_session", lambda user: "sess-canon")
    published = []
    monkeypatch.setattr(session_events, "publish", lambda sid, ev, data=None: published.append((sid, ev, data)))

    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.patch("/api/orwell/layout",
                     json={"windowId": "cast", "state": {"x": 5, "y": 6}, "origin": "tab-7", "deviceId": DEV})
    assert r.status_code == 200
    assert len(published) == 1
    sid, ev, data = published[0]
    assert sid == "sess-canon" and ev == "layout-changed"
    assert data["windowId"] == "cast" and data["origin"] == "tab-7" and data["deviceId"] == DEV
    assert data["state"] == {"x": 5.0, "y": 6.0}
    # the payload carries only ids + geometry — no message body / Vault-ish content
    blob = repr(data).lower()
    assert "content" not in blob and "secret" not in blob and "vault" not in blob


def test_patch_no_canonical_session_still_persists(monkeypatch):
    """With no bound game session, the PATCH still persists; it just has nobody to broadcast to."""
    monkeypatch.setenv("AUTH_ENABLED", "false")
    monkeypatch.setattr(ogs, "get_game_session", lambda user: None)
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.patch("/api/orwell/layout",
                     json={"windowId": "cast", "state": {"docked": True}, "deviceId": DEV})
    assert r.status_code == 200
    got = client.get("/api/orwell/layout", params={"deviceId": DEV}).json()
    assert got["windows"]["cast"] == {"docked": True}


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
    # and it applies a synced order arriving from the seed OR a peer window (the same-device mirror)
    assert "orwell:layout-seed" in src and "orwell:layout-changed" in src
    assert "applySyncedOrder" in src
    # localStorage stays as the offline/seed fallback — the per-user key is derived through the
    # shared fail-closed helper (R5/#1416) and the write is null-guarded (skipped when no data-user).
    assert "_orderKey" in src and "if (k) lsSet(k" in src


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
