"""Lane F / F-1 — the window kit + the F1/F2 structural fixes (SOURCE-PINS).

Wiring pins, NOT behavior coverage: the behavior (dock visible while holding
chips, trusted-click restore, drag moves + offset persists + survives restack,
kit chrome/Escape/focus-return) is exercised for real in
frontend/scripts/browser_smoke.py (the headless-browser keep-set gate).
Provenance: docs/audits/2026-06-11-dwe-window-audit.md (findings F1, F2, F4,
F5, F7, F8, F10) and the Lane F queue entry.
"""
import os

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


def test_sourcepin_f1_dock_visibility_is_class_driven():
    js = _read("static", "js", "modalManager.js")
    assert "ow-has-rows" in js                       # class-driven reveal
    assert js.count("classList.add('ow-has-rows')") == 1
    assert js.count("classList.remove('ow-has-rows')") == 1
    assert "dock.style.display = ''" not in js       # the inline-'' reveal is gone
    css = _read("static", "style.css")
    assert "#minimized-dock.ow-has-rows" in css      # the showing rule exists


def test_sourcepin_f1_dock_flip_respects_reduced_motion():
    js = _read("static", "js", "modalManager.js")
    assert "prefers-reduced-motion" in js


def test_sourcepin_f2_restack_stands_down_during_drag():
    js = _read("static", "js", "orwellSlots.js")
    assert "modal-dragging" in js                    # the drag-in-progress gate
    assert "dragInProgress" in js
    assert "_restacking" in js                       # reentrancy guard


def test_sourcepin_f5_finale_has_one_position_system():
    js = _read("static", "js", "orwellFinale.js")
    assert "saveDragOffset" in js                    # slot-offset persistence
    assert "localStorage.setItem(POS_KEY" not in js  # the custom writer is gone
    assert "removeItem(POS_KEY)" in js               # stale keys are cleared
    assert "mobileSkip: 0" not in js                 # no touch-drag against sheet CSS


def test_sourcepin_kit_owns_the_contracts():
    js = _read("static", "js", "orwellWindow.js")
    for needle in (
        "data-ow-window",                            # the ratchet's selector
        "ow-titlebar", "ow-controls", "ow-body",     # the one chrome family
        "prefers-reduced-motion",                    # animations strip (F4)
        "clampPos",                                  # explicit clamp (norm c)
        "saveDragOffset",                            # ONE persistence scheme (F5)
        "dismissTop",                                # Escape participation (F7)
        "opener",                                    # focus-return (F8)
        "ArrowLeft",                                 # keyboard move (F10)
        "AbortController",                           # teardown (norm j)
    ):
        assert needle in js, needle
    assert "OrwellWindowKit" in js                   # the seam the gates drive


def test_sourcepin_kit_is_loaded_and_escape_spliced():
    html = _read("static", "index.html")
    assert "orwellWindow.js" in html
    ui = _read("static", "js", "ui.js")
    assert "OrwellWindowKit.dismissTop()" in ui      # menus -> kit windows -> modals


def test_smoke_exercises_the_kit_for_real():
    smoke = _read("scripts", "browser_smoke.py")
    assert "F1: the Windows dock is VISIBLE" in smoke
    assert "F2: dragging the title bar MOVES the panel" in smoke
    assert "ow-smoke-window" in smoke                # a real kit window end-to-end
    assert 'page.click("#orwell-social .ow-min")' in smoke  # trusted, not evaluate()


# ── Lane F / F-2 wave 1 pins ──────────────────────────────────────────────

def test_sourcepin_wave1_social_composes_the_kit():
    js = _read("static", "js", "orwellSocial.js")
    assert "OrwellWindowKit.create(" in js          # the kit owns the chrome
    assert "makeWindowDraggable" not in js          # bespoke drag wiring deleted
    assert "osoc-hdr" not in js                     # bespoke titlebar deleted
    assert "osoc-min" not in js                     # bespoke minimize button deleted
    assert "modalManager.register(" not in js       # the kit registers, not the panel


def test_sourcepin_wave1_sheet_host_owns_narrow():
    slots = _read("static", "js", "orwellSlots.js")
    assert "restackNarrowSheets" in slots           # the F3 sheet host exists
    for f in ("orwellSocial.js", "orwellFinale.js"):
        js = _read("static", "js", f)
        assert "top: 44px !important" not in js, f  # per-panel pins are gone
        assert "left: 0 !important" not in js, f


def test_sourcepin_wave1_finale_seam_for_the_gate():
    js = _read("static", "js", "orwellFinale.js")
    assert "_orwellFinaleEnsure" in js


def test_smoke_asserts_f3_for_real():
    smoke = _read("scripts", "browser_smoke.py")
    assert "F3: both sheets visible without overlap" in smoke
