"""#794 — the Settings (and every kit) window must fly IN to its final centered
position in ONE clean motion, never "fly to the right first, then move to center".

SOURCE-PINS (the real motion is captured/asserted in scripts/_capture_794_flyin.py
and exercised live in scripts/browser_smoke.py). Root cause: a legacy .modal-family
rule in style.css groups the kit ids settings-modal + theme-modal under
"transition: left .25s, width .25s" (meant to glide those modals with the sidebar
collapse). That leaks onto the OrwellWindow kit, whose slot system writes the
centered inline `left` on open — so the browser ANIMATES the left change, sliding
the window into center after it appears. THE fix neutralises the geometry
(left/top/width/height) transitions on every .ow-window from the kit's own CSS;
a belt-and-braces forced reflow + re-restack also removes a one-frame measurement
wobble so the centered left is correct from the first frame.
"""
import os

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


def test_sourcepin_kit_suppresses_geometry_transitions():
    """THE fix: the kit's injected CSS pins .ow-window's transition-property so the
    geometry longhands (left/top/width/height) never transition — a slot re-anchor
    applies instantly, never as a visible slide."""
    js = _read("static", "js", "orwellWindow.js")
    assert "transition-property: opacity, transform" in js          # an explicit allow-list
    # The four geometry longhands must NOT be in the kit's transition allow-list.
    rule_line = next(l for l in js.splitlines() if "transition-property: opacity, transform" in l)
    for geom in ("left", "top", "width", "height"):
        assert geom not in rule_line, f"{geom} must not be transitioned on .ow-window"
    assert "!important" in rule_line                                 # beats the offending ID rule


def test_sourcepin_open_recenters_with_a_forced_reflow_before_the_animation():
    """Belt-and-braces: the centered left is computed against the real laid-out width
    (forced reflow + re-restack) BEFORE the open-animation class is added."""
    js = _read("static", "js", "orwellWindow.js")
    assert "void el.offsetWidth" in js                              # forced synchronous reflow
    assert "this._slot.restack()" in js                            # re-anchor with the right width
    reflow_at = js.index("void el.offsetWidth")
    anim_at = js.index("'ow-anim-open'")
    assert reflow_at < anim_at, "the re-anchor must run BEFORE ow-anim-open (no fly-right-then-center)"


def test_sourcepin_reflow_is_in_the_slot_register_block():
    """The re-anchor lives in the floating-open path, between the slot register and
    Modals.register, guarded on a real slot handle (docked/parked windows untouched)."""
    js = _read("static", "js", "orwellWindow.js")
    assert "this._slot && typeof this._slot.restack === 'function'" in js
    register_at = js.index("window.OrwellSlots.register(el")
    modals_at = js.index("Modals.register(this.o.id")
    reflow_at = js.index("void el.offsetWidth")
    assert register_at < reflow_at < modals_at


def test_sourcepin_settings_drops_the_legacy_dock_seam():
    """Settings hands geometry entirely to the kit — the stale modalSnap dock import
    (which could re-anchor AFTER the fly-in) is gone."""
    js = _read("static", "js", "settings.js")
    assert "from './modalSnap.js'" not in js                       # the legacy dock-seam import is gone
    assert "clearDockSide(" not in js                              # ...and there is no call to it
    assert "win.open(" in js                                       # still opens through the kit


def test_sourcepin_modal_default_slot_is_centered():
    """A modal kit window (Settings, Theme) defaults to top-center so the fly-in
    targets the centre, not the top-right HUD slot."""
    js = _read("static", "js", "orwellWindow.js")
    assert "(opts && opts.modal) ? 'top-center' : 'top-right'" in js


def test_capture_script_exists_for_the_real_motion():
    """The frame-sampling capture (BEFORE/AFTER evidence for #794) ships with the fix."""
    cap = _read("scripts", "_capture_794_flyin.py")
    assert "dx_from_center" in cap                                 # the centered-on-every-frame metric
    assert "settings.js" in cap                                    # opens Settings the app way
