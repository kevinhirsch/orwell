"""Lane G / G2 — any launcher restores its minimized window (SOURCE-PINS).

User report: clicking the settings gear (#user-bar-settings) while the
settings window was minimized did nothing — the gear was not among the
modal's registered button ids, so the capture-phase interceptor never
matched, the tool's own open() removed `.hidden`, and the window stayed
`.modal-minimized` (display:none + pointer-events:none): visible to no one,
clickable by no one. The user wants EVERY window to restore from ANY
launcher.

The fix is two belts in static/js/modalManager.js:
  1. (launcher-agnostic) the auto-stack MutationObserver attached at
     register() detects "un-hidden while isMinimized is held" and runs the
     real restore path — so any code path that un-hides a window heals it;
  2. (id-list) the gear is listed in settings-modal's _AUTO_WIRE entry so
     the capture-phase interceptor restores even when the click never
     reaches the tool's own open().

These are wiring pins, NOT behavior coverage: the behavior (trusted gear
click restores a minimized settings window to a visible, un-minimized,
interactive state; an arbitrary un-hide heals theme-modal too) is exercised
for real in frontend/scripts/browser_smoke.py (the G2 block).

Kit windows (orwellWindow.js) already restore via Modals.restore — the kit
is intentionally untouched.
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


def test_sourcepin_observer_heals_unhidden_while_minimized():
    # Belt #1: the register()-time observer must detect the hidden→un-hidden
    # (or inline-display-turned-visible) transition while the minimized state
    # is held, and run the REAL restore path (restore(id)) — not just clear a
    # class.
    js = _read("static", "js", "modalManager.js")
    assert "G2 (launcher-agnostic restore)" in js
    assert "_mmLastHidden" in js
    assert "_mmLastInlineDisplay" in js
    # The transition signals…
    assert "const unHid = _modalEl._mmLastHidden && !nowHidden" in js
    assert "displayedInline" in js
    # …gate on held minimized state and dispatch into the real restore path.
    assert re.search(
        r"\(unHid \|\| displayedInline\)\s*"
        r"&& _state\.get\(id\)\?\.isMinimized\s*"
        r"&& _modalEl\.classList\.contains\('modal-minimized'\)",
        js,
    ), "the heal must require BOTH the un-hide transition and held minimized state"
    assert re.search(r"contains\('modal-minimized'\)\)\s*\{\s*restore\(id\);", js), \
        "the heal must run the real restore path (restore(id))"


def test_sourcepin_restore_is_the_full_path():
    # The healed path must be the same restore() everyone else uses: clears
    # .modal-minimized, re-renders the dock (chip removal), clears badges and
    # the isMinimized state. Pin restore()'s own obligations so the heal
    # can't be quietly rerouted to a classList shortcut.
    js = _read("static", "js", "modalManager.js")
    body = js.split("export function restore(id)")[1].split("export function")[0]
    assert "classList.remove('hidden', 'modal-minimized')" in body
    # Interop: app.js's legacy dock stamps its own `minimized` class
    # (display:none !important) — restore must scrub it or the window stays
    # invisible after a "successful" restore.
    assert "classList.remove('minimized')" in body
    assert "s.isMinimized = false" in body
    assert "_setBadge(s.btnIds, false)" in body
    assert "_renderDock()" in body


def test_sourcepin_gear_is_wired_as_a_settings_launcher():
    # Belt #2: the gear id rides settings-modal's _AUTO_WIRE entry so the
    # capture-phase interceptor matches it while the modal is minimized.
    js = _read("static", "js", "modalManager.js")
    entries = re.findall(r"'settings-modal':\s*\{[^}]*\}", js)
    wired = [e for e in entries if "tool-settings-btn" in e]
    assert wired, "_AUTO_WIRE must keep a settings-modal entry with the sidebar button"
    assert any("user-bar-settings" in e for e in wired), \
        "the gear (#user-bar-settings) must ride settings-modal's _AUTO_WIRE entry"
    # …and the interceptor that consumes btnIds still exists.
    assert "s.btnIds.includes(btnId)" in js
    assert "stopImmediatePropagation" in js


def test_sourcepin_gear_launcher_exists_in_markup():
    # The id the wiring names must be the real gear in the user bar.
    html = _read("static", "index.html")
    assert 'id="user-bar-settings"' in html


def test_smoke_exercises_the_launcher_restore_for_real():
    # The browser gate must drive the reported scenario with TRUSTED clicks:
    # minimize settings via the injected `_`, click the gear, assert visible +
    # un-minimized + interactive — and heal theme-modal from an arbitrary
    # un-hide (the launcher-agnostic belt).
    smoke = _read("scripts", "browser_smoke.py")
    assert "G2 (Lane G): launcher-agnostic restore" in smoke
    assert '"#settings-modal .modal-minimize-btn, #settings-modal .minimize-btn"' in smoke
    assert 'page.click("#user-bar-settings")' in smoke
    assert "RESTORES the minimized settings window" in smoke
    assert "trusted click inside lands" in smoke
    assert "heals the minimized theme window" in smoke
