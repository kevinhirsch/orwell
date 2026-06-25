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
    # ui.js owns the ONE authority and must export its promote for modalManager;
    # the ladder it exposes is the same one the Escape arbiter reads.
    ui = _read("static", "js", "ui.js")
    assert re.search(r"window\._owPromoteModal\s*=\s*_promote", ui), \
        "ui.js must expose _promote as window._owPromoteModal"
    assert "pickTopModal" in ui
    # The promote stamps a plain-inline z drawn from the single authority's modal
    # ladder (the IDL setter, no !important priority).
    promote_body = ui.split("const _promote = (m) =>")[1].split("};")[0]
    assert "OrwellZ.nextModalZ()" in promote_body, \
        "promote must draw from the single OrwellZ authority's modal ladder"
    assert "important" not in promote_body


def test_sourcepin_one_z_authority_object_unifies_both_bands():
    # A2 (#573, DWE audit F9): the kit's old private `_zTop` and ui.js's old
    # `_zCounter` are now ONE authority object — OrwellZ — that advances one
    # monotonic tick and offers a band per family. The kit's non-modal band is
    # allocated through it (window._owNextWindowZ) and its modal tier through
    # window._owNextModalZ, so "topmost / focused" has a single source of truth.
    ui = _read("static", "js", "ui.js")
    assert "const OrwellZ = (() =>" in ui, "ui.js must define the single OrwellZ authority"
    assert "window._owNextModalZ = () => OrwellZ.nextModalZ()" in ui
    assert "window._owNextWindowZ = (restack) => OrwellZ.nextWindowZ(restack)" in ui
    # The kit must no longer own a private z counter — it draws from the authority.
    win = _read("static", "js", "orwellWindow.js")
    assert "window._owNextWindowZ" in win, \
        "the kit must allocate its non-modal band through window._owNextWindowZ"
    assert "let _zTop" not in win, "the kit's private _zTop counter must be gone"


def test_sourcepin_one_focus_return_implementation():
    # A2: the two focus-return paths (the .modal observer's _restoreFocus and the
    # kit's _teardown copy) are unified onto one helper — window._owReturnFocus.
    ui = _read("static", "js", "ui.js")
    assert "window._owReturnFocus = _returnFocus" in ui, \
        "ui.js must expose the single focus-return helper"
    # _restoreFocus (the .modal observer) delegates to the shared helper.
    restore_body = ui.split("const _restoreFocus = (m) =>")[1].split("};")[0]
    assert "_returnFocus(opener, m)" in restore_body, \
        ".modal focus-return must delegate to the shared helper"
    # The kit delegates to the same helper on close.
    win = _read("static", "js", "orwellWindow.js")
    assert "window._owReturnFocus(opener" in win, \
        "the kit must delegate focus-return to window._owReturnFocus"


def test_smoke_exercises_the_z_authority_for_real():
    # The browser gate drives the F9b pin across TWO kit modals (theme migrated to
    # the OrwellWindow kit, like settings): open theme, open settings ON TOP, prove
    # the fresh kit modal sits visually ABOVE at the content overlap
    # (elementFromPoint), the Escape order (top-first), and the no-inline-important
    # sweep across every kit window.
    smoke = _read("scripts", "browser_smoke.py")
    assert "G14 (DWE audit F9b)" in smoke
    assert "elementFromPoint" in smoke
    assert "a fresh kit modal sits visually ABOVE the earlier one" in smoke
    assert "no kit window carries an inline !important z-index" in smoke
    assert "Escape closes the TOP kit modal (settings) FIRST" in smoke
    assert "the second Escape closes the remaining kit modal (theme)" in smoke
