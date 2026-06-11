"""Game HUDs (status + social) — minimize-to-dock SOURCE-PINS (T20).

EXPLICIT SOURCE-PINS, NOT BEHAVIOR COVERAGE. Every assertion in this file greps the static JS
source (`"modalManager.register(" in src`, etc.); a passing grep proves the wiring is *present*,
never that it *works*. The real BEHAVIOR — minimize hides the social HUD and parks a dock chip,
and restoring from the chip re-opens it — is exercised in the headless browser by
`scripts/browser_smoke.py` (search "T20" there). These pins remain as cheap, browserless
regression guards: if a refactor deletes the dock wiring, this file goes red in the fast pytest
gate before the browser smoke even runs. Read each `test_*` below as "the source still wires X",
not "X behaves correctly".

Name-agnostic; no game state required.
"""

import os

STATIC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static", "js")


def _read(name: str) -> str:
    with open(os.path.join(STATIC, name), encoding="utf-8") as f:
        return f.read()


# E64 (ruling #3): the status panel is SIDEBAR CHROME now — not a window, no dock.
# Only the social HUD remains on the floating-window/dock contract here.
HUDS = ["orwellSocial.js"]


def test_sourcepin_huds_import_modal_manager():
    # SOURCE-PIN (T20): the wiring is present. The minimize/restore BEHAVIOR is in browser_smoke.py.
    for f in HUDS:
        src = _read(f)
        assert "modalManager" in src and "modalManager.js" in src, f"{f} must import modalManager"


def test_sourcepin_huds_register_with_the_dock():
    # SOURCE-PIN (T20). Behavior (chip appears on minimize) is in browser_smoke.py.
    for f in HUDS:
        src = _read(f)
        assert "modalManager.register(" in src, f"{f} must register with the dock"
        # A label + icon make the chip identifiable in the fly-out.
        assert "restoreFn" in src and "icon" in src, f"{f} must supply restoreFn + icon"


def test_sourcepin_huds_minimize_routes_to_the_dock():
    # SOURCE-PIN (T20). Behavior (panel hides on minimize) is in browser_smoke.py.
    for f in HUDS:
        src = _read(f)
        assert "modalManager.minimize(" in src, f"{f} minimize must go to the dock"


def test_sourcepin_huds_poll_loop_respects_minimized_state():
    # SOURCE-PIN (T20): the panels poll on a timer; while docked they must NOT force themselves
    # back open. (The live poll-vs-minimized behavior is hard to exercise headlessly without
    # waiting on timers, so this stays a source-pin by design.)
    for f in HUDS:
        src = _read(f)
        assert "isMinimized()" in src, f"{f} must guard its poll loop with isMinimized()"


def test_sourcepin_huds_dropped_in_place_collapse():
    # SOURCE-PIN (T20): the old in-place collapse (localStorage MIN_KEY + os-/osoc-collapsed) is gone.
    for f in HUDS:
        src = _read(f)
        assert "MIN_KEY" not in src, f"{f} still references the old in-place-collapse MIN_KEY"
        assert "-collapsed" not in src, f"{f} still toggles the old in-place collapse class"


# ── E64 (ruling #3): the status panel is a sidebar section, never a window ──
# SOURCE-PINS (T20): these grep orwellStatusPanel.js for "is sidebar chrome" markers. The
# BEHAVIORAL counterpart — the status panel actually mounts inside #sidebar and is never
# fixed-position on a phone — is asserted in browser_smoke.py (hud_geo.inSidebar / .fixed). Kept
# as cheap browserless guards against a refactor reverting it to a floating window.

def test_sourcepin_status_panel_is_sidebar_chrome_not_a_window():
    src = _read("orwellStatusPanel.js")
    assert "position: fixed" not in src, "E64: the status panel must not be fixed-position"
    assert "makeWindowDraggable" not in src, "E64: no drag"
    assert "modalManager" not in src, "E64: no dock/minimize"
    assert "POS_KEY" not in src, "E64: no saved window position"
    assert 'getElementById("sidebar")' in src, "E64: mounts inside #sidebar"
    assert '"sessions-section"' in src, "E64: docks below the session list"


def test_status_panel_keeps_poll_render_and_announcer():
    src = _read("orwellStatusPanel.js")
    for keep in ("aria-live", "announceDeltas", "orwell:gamechanged",
                 "os-stale", "PHASE_LABELS"):
        assert keep in src, f"E64 keeps the poll/render/announcer logic: {keep}"


def test_status_panel_backoff_recovers_on_success():
    # E68: one blip must not degrade a live game to 2-minute polls forever.
    src = _read("orwellStatusPanel.js")
    assert "_failures = 0; // E68" in src


def test_status_panel_ordinals_are_english():
    # E69: 11th/12th/13th — never 11st/12nd/13rd.
    src = _read("orwellStatusPanel.js")
    assert "mod100 >= 11 && mod100 <= 13" in src
