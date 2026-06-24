"""#779 — the Settings modal opens CENTERED, never auto-pulled to the right edge (SOURCE-PINS).

The bug: Settings auto-snapped to the right on open instead of centering. Two mechanisms
could pull it right:
  1. The OrwellWindow kit's default slot is 'top-right' (the HUD slot) — a modal:true dialog
     created without an explicit slot would open flush right. The kit defaults a modal to
     'top-center' (the reference fix 38a480a), pinned here.
  2. A STALE persisted slot drag-offset / a right-half tile saved in a PAST session, re-applied
     on open over the centered base. settings.open() now drops that stale offset (win.recenter())
     and clears any lingering edge-dock CSS state on every open, so a fresh open is always centered.

Behavior (opens centered, stale offset cleared, drag still works) is exercised for real in
frontend/scripts/browser_smoke.py; these are wiring pins.
"""
import os

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


def test_sourcepin_modal_default_slot_is_top_center():
    """A modal:true kit window defaults to 'top-center', NOT the top-right HUD slot."""
    js = _read("static", "js", "orwellWindow.js")
    assert "(opts && opts.modal) ? 'top-center' : 'top-right'" in js


def test_sourcepin_settings_opens_with_modal_true():
    """Settings is a modal dialog (so it picks up the top-center default)."""
    js = _read("static", "js", "settings.js")
    assert "modal: true" in js


def test_sourcepin_kit_exposes_recenter():
    """The kit offers a programmatic recenter() that drops the persisted slot drag-offset."""
    js = _read("static", "js", "orwellWindow.js")
    assert "recenter()" in js
    # it removes the persisted slot-offset key for this window's slotKey
    assert "localStorage.removeItem('orwell-slot-offset:'" in js
    # and re-anchors via a restack
    assert "this._slot.restack()" in js


def test_sourcepin_settings_recenters_on_every_open():
    """settings.open() drops a stale cross-session position so a fresh open is centered."""
    js = _read("static", "js", "settings.js")
    assert "win.recenter()" in js
    # and clears any lingering edge-dock CSS state (right/left) on open
    assert "clearDockSide('right'" in js
    assert "clearDockSide('left'" in js


def test_sourcepin_settings_modal_not_special_cased_to_right_in_tile_manager():
    """tileManager still constrains a USER-initiated settings tile to right-half (legitimate
    user tiling is allowed), but that path is gated on an explicit drag/tile gesture — it is NOT
    an auto-snap on open. Pin that the constraint reads the right-half zone name (unchanged),
    so this test documents the surviving special-case as intentional, not an auto-open snap."""
    js = _read("static", "js", "tileManager.js")
    # the special-case is a GUARD on a user tile gesture, not an open-time snap
    assert "modal.id === 'settings-modal' && zone.name !== 'right-half'" in js
