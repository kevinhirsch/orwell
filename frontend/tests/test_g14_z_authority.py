"""Lane G / G14 — ONE z-authority for the .modal family (SOURCE-PINS).

DWE audit F9b: two competing z escalators — ui.js's `_zCounter` (plain
inline, 1000s, promotes any visible .modal; the Escape arbiter's
pickTopModal reads the same ladder) and modalManager's `_modalTopZ` (300s,
stamped with `!important` at register/auto-stack/dock-restore). Verified
live pre-fix (2026-06-11, build=0): a minimized window held
`z-index: 301 !important` for its whole parked life (ui.js's reconciler
skips hidden modals), and every dock restore wrote z three times
(301!important -> 302!important -> the ui.js counter). The final order
survived only because (a) ui.js's body-wide MutationObserver predates every
lazily-attached per-modal observer and so always got the last write, and
(b) this Chromium's `style.zIndex = x` drops an existing !important inline
declaration — two unstated, fragile invariants. On engines without (b), a
dock-restored window keeps the stamp and the Escape arbiter's pickTopModal
(computed z) disagrees with the paint order. Correctness by race, not
design.

The fix: modalManager's `_bringToFront` defers to ui.js's counter
(`window._owPromoteModal`) — one ladder, plain inline, never !important —
and the `_modalTopZ` machinery is deleted. Its fallback (ui.js absent)
raises above the family's top inline z, also plain. _bringToFront scopes
itself to `.modal`: kit windows (.ow-window) keep their own 500-980 band
(orwellWindow.js raise()/_afterDockRestore()), untouched. The chip
drag-ghost's z write went plain too (no class rule fights it), so the
whole module carries NO z-index priority stamp.

These are wiring pins, NOT behavior coverage: the behavior (dock-restore
then a fresh open => the fresh open sits visually above at the content
overlap; Escape closes top-first in the same order; no .modal carries an
inline !important z) is exercised for real in
frontend/scripts/browser_smoke.py (the G14 block).
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


def test_sourcepin_no_important_z_stamp_in_modal_manager():
    # The whole module must carry NO setProperty('z-index', ..., 'important')
    # — neither the old _bringToFront stamp nor the chip-drag copy.
    js = _read("static", "js", "modalManager.js")
    assert not re.search(
        r"setProperty\(\s*['\"]z-index['\"][^)]*['\"]important['\"]\s*\)", js
    ), "modalManager must never stamp a z-index with !important"


def test_sourcepin_the_second_z_counter_is_gone():
    js = _read("static", "js", "modalManager.js")
    assert "_modalTopZ" not in js, "the second z counter machinery must stay deleted"


def test_sourcepin_bring_to_front_defers_to_the_one_authority():
    js = _read("static", "js", "modalManager.js")
    m = re.search(r"function _bringToFront\(modal\)\s*\{(.*?)\n\}", js, re.S)
    assert m, "_bringToFront must exist (restore/auto-stack still surface windows)"
    body = m.group(1)
    assert "window._owPromoteModal" in body, \
        "_bringToFront must defer to ui.js's counter (the one z-authority)"
    # The one ladder is plain inline — no priority API anywhere in the body.
    assert "important" not in body
    assert "setProperty" not in body
    # Kit windows are not .modal — modalManager must not stamp them (the kit
    # re-asserts its own 500-980 band in raise()/_afterDockRestore()).
    assert re.search(r"classList\.contains\('modal'\)", body), \
        "_bringToFront must scope itself to the .modal family"


def test_sourcepin_ui_exposes_the_promote_helper():
    # ui.js owns the ONE counter and must export its promote for modalManager;
    # the ladder it exposes is the same one the Escape arbiter reads.
    ui = _read("static", "js", "ui.js")
    assert re.search(r"window\._owPromoteModal\s*=\s*_promote", ui), \
        "ui.js must expose _promote as window._owPromoteModal"
    assert "pickTopModal" in ui
    # The counter it guards stays plain-inline (the IDL setter, no priority).
    promote_body = ui.split("const _promote = (m) =>")[1].split("};")[0]
    assert "m.style.zIndex = String(++_zCounter)" in promote_body
    assert "important" not in promote_body


def test_smoke_exercises_the_z_authority_for_real():
    # The browser gate must drive the F9b pin with TRUSTED clicks: open theme,
    # park it, restore from the chip, open settings fresh; prove visual order
    # at the content overlap (elementFromPoint), the Escape order, and the
    # no-inline-important sweep across every .modal.
    smoke = _read("scripts", "browser_smoke.py")
    assert "G14 (DWE audit F9b)" in smoke
    assert "page.click(\"#minimized-dock .minimized-dock-chip[data-modal-id='theme-modal']\")" in smoke
    assert "elementFromPoint" in smoke
    assert "ABOVE the dock-restored window" in smoke
    assert "no .modal carries an inline !important z-index" in smoke
    assert "parked window holds NO inline !important z" in smoke
    assert "Escape closes the top window (settings) FIRST" in smoke
    assert "second Escape closes the dock-restored window" in smoke
