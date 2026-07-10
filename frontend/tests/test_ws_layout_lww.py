"""WS Phase-1 (ADR 0017) — per-device layout LWW: the persist-key unit half.

The layout store is re-keyed by `(user, deviceId)` (ADR 0017, owner call 2026-07-09), superseding
0064-F's single shared per-user layout: geometry is remembered PER DEVICE and is NOT synced
cross-device (only game state syncs). This file is the store-level unit half of the test-plan
"Layout LWW" case (§d):

  - per-(user, deviceId) keying (two devices are independent stores);
  - LWW (last write per window field wins) within a device's own windows;
  - read-compatible migration of legacy per-user records (a record with no deviceId still resolves,
    doesn't crash, and a device's first write seeds from it);
  - origin echo-suppression (the descriptor round-trips `origin` so the caller can suppress the echo
    back to the originating device — a device never gets its own echo).

Store path redirected to a tmp file so the real data dir is never touched. Name-agnostic.
"""

import importlib
import json

import pytest

layout = importlib.import_module("src.orwell_layout")


@pytest.fixture(autouse=True)
def _tmp_store(tmp_path, monkeypatch):
    monkeypatch.setattr(layout, "LAYOUT_PATH", tmp_path / "orwell_layout.json")
    return tmp_path / "orwell_layout.json"


def _patch(user, device, wid, state, origin=""):
    return layout.patch_layout(user, device, {"windowId": wid, "state": state}, origin=origin)


# ── per-(user, deviceId) keying ───────────────────────────────────────────────

def test_two_devices_keep_independent_layouts():
    _patch("u", "desktop", "cast", {"x": 10, "y": 20})
    _patch("u", "phone", "cast", {"x": 800, "y": 40})
    assert layout.get_layout("u", "desktop")["windows"]["cast"] == {"x": 10.0, "y": 20.0}
    assert layout.get_layout("u", "phone")["windows"]["cast"] == {"x": 800.0, "y": 40.0}


def test_a_devices_write_is_invisible_to_another_device():
    _patch("u", "desktop", "hud-roster", {"open": True})
    assert layout.get_layout("u", "phone")["windows"] == {}


def test_same_user_same_device_across_tabs_shares_the_store():
    # Two tabs on ONE device present the SAME deviceId, so they share the per-device store (the
    # same-device mirror). LWW per field across the two writers.
    _patch("u", "desktop", "cast", {"x": 1, "y": 2}, origin="tab-A")
    _patch("u", "desktop", "cast", {"x": 9}, origin="tab-B")
    assert layout.get_layout("u", "desktop")["windows"]["cast"] == {"x": 9.0, "y": 2.0}


def test_device_id_is_stored_under_a_devices_subtree(_tmp_store):
    _patch("u", "desktop", "cast", {"x": 5})
    raw = json.loads(_tmp_store.read_text(encoding="utf-8"))
    # keyed under the user, then a per-device subtree — never a flat per-user "windows" for a
    # device write.
    assert raw["u"]["devices"]["desktop"]["windows"]["cast"]["x"] == 5.0


# ── LWW within a device ───────────────────────────────────────────────────────

def test_last_write_wins_per_field_within_a_device():
    _patch("u", "desktop", "cast", {"x": 10, "y": 20, "open": True})
    _patch("u", "desktop", "cast", {"x": 99})   # only x moves
    assert layout.get_layout("u", "desktop")["windows"]["cast"] == {"x": 99.0, "y": 20.0, "open": True}


def test_two_rapid_conflicting_moves_last_wins():
    _patch("u", "desktop", "cast", {"x": 100})
    _patch("u", "desktop", "cast", {"x": 250})
    assert layout.get_layout("u", "desktop")["windows"]["cast"]["x"] == 250.0


# ── read-compatible migration of legacy per-user records ──────────────────────

def _seed_legacy(path, user, windows):
    """Write a legacy 0064-F record (keyed by user, flat `windows`, no `devices` subtree)."""
    path.write_text(json.dumps({user: {"windows": windows}}), encoding="utf-8")


def test_legacy_record_resolves_for_a_device_read(_tmp_store):
    _seed_legacy(_tmp_store, "u", {"cast": {"x": 11.0, "y": 22.0}})
    # A device read with no per-device record yet falls back to the legacy per-user layout.
    blob = layout.get_layout("u", "desktop")
    assert blob["windows"]["cast"] == {"x": 11.0, "y": 22.0}


def test_legacy_record_resolves_without_a_device_id(_tmp_store):
    _seed_legacy(_tmp_store, "u", {"cast": {"open": True}})
    # No deviceId ⇒ the legacy per-user scope (backward compatible), never a crash.
    assert layout.get_layout("u")["windows"]["cast"] == {"open": True}


def test_first_device_write_seeds_from_legacy_then_diverges(_tmp_store):
    _seed_legacy(_tmp_store, "u", {"cast": {"x": 11.0, "y": 22.0}, "finale": {"open": True}})
    # First write for the device seeds a COPY of the legacy windows, then applies the patch — so the
    # existing arrangement carries onto the device and other legacy windows survive.
    _patch("u", "desktop", "cast", {"x": 500})
    desk = layout.get_layout("u", "desktop")["windows"]
    assert desk["cast"] == {"x": 500.0, "y": 22.0}          # patched field wins, y seeded
    assert desk["finale"] == {"open": True}                 # untouched legacy window carried over
    # The legacy per-user blob is untouched (the device holds its own copy now).
    raw = json.loads(_tmp_store.read_text(encoding="utf-8"))
    assert raw["u"]["windows"]["cast"] == {"x": 11.0, "y": 22.0}


def test_a_corrupt_store_never_crashes(_tmp_store):
    _tmp_store.write_text("{ not json", encoding="utf-8")
    assert layout.get_layout("u", "desktop") == {"windows": {}}
    # a write over a corrupt store still succeeds (falls back to "no saved layout")
    saved = _patch("u", "desktop", "cast", {"x": 1})
    assert saved["state"] == {"x": 1.0}


# ── origin echo-suppression (descriptor round-trips origin) ───────────────────

def test_patch_returns_broadcast_descriptor_with_origin_and_device():
    saved = _patch("u", "desktop", "cast", {"x": 5}, origin="tab-7")
    assert saved == {"windowId": "cast", "state": {"x": 5.0}, "origin": "tab-7", "deviceId": "desktop"}


def test_origin_defaults_to_empty_when_omitted():
    saved = _patch("u", "desktop", "cast", {"x": 5})
    assert saved["origin"] == ""


def test_no_op_write_returns_falsy_descriptor():
    # unusable window id / empty state ⇒ {} (falsy) so the caller broadcasts nothing (no echo)
    assert _patch("u", "desktop", "", {"x": 1}) == {}
    assert _patch("u", "desktop", "cast", {}) == {}
    assert layout.patch_layout("u", "desktop", "not-a-dict", origin="x") == {}


# ── deviceId coercion & bounds ────────────────────────────────────────────────

def test_blank_device_id_falls_back_to_legacy_per_user_scope(_tmp_store):
    # An empty/whitespace deviceId ⇒ the legacy per-user top-level windows (not a "devices" subtree).
    layout.patch_layout("u", "   ", {"windowId": "cast", "state": {"x": 3}})
    raw = json.loads(_tmp_store.read_text(encoding="utf-8"))
    assert raw["u"]["windows"]["cast"]["x"] == 3.0
    assert "devices" not in raw["u"]


def test_devices_per_user_are_capped():
    # Introducing more than the cap of NEW devices is refused (bounded store); existing devices are
    # never evicted.
    for i in range(layout._MAX_DEVICES):
        assert _patch("u", f"dev-{i}", "cast", {"x": i})
    # one past the cap → refused
    assert _patch("u", "dev-overflow", "cast", {"x": 1}) == {}
    # an EXISTING device can still be updated after the cap is hit
    assert _patch("u", "dev-0", "cast", {"x": 999})["state"]["x"] == 999.0
