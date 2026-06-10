"""Game HUDs (status + social) — minimize-to-dock wiring contract.

The two floating game panels (the Status HUD and "The House" social panel) must minimize
into the SHARED chip dock — the same fly-out strip every other tool minimizes to — instead
of collapsing in place. This is a static source contract so an accidental refactor that drops
the dock wiring (and silently reverts to in-place collapse) fails CI without needing a browser.

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


def test_huds_import_modal_manager():
    for f in HUDS:
        src = _read(f)
        assert "modalManager" in src and "modalManager.js" in src, f"{f} must import modalManager"


def test_huds_register_with_the_dock():
    for f in HUDS:
        src = _read(f)
        assert "modalManager.register(" in src, f"{f} must register with the dock"
        # A label + icon make the chip identifiable in the fly-out.
        assert "restoreFn" in src and "icon" in src, f"{f} must supply restoreFn + icon"


def test_huds_minimize_routes_to_the_dock():
    for f in HUDS:
        src = _read(f)
        assert "modalManager.minimize(" in src, f"{f} minimize must go to the dock"


def test_huds_poll_loop_respects_minimized_state():
    # The panels poll on a timer; while docked they must NOT force themselves back open.
    for f in HUDS:
        src = _read(f)
        assert "isMinimized()" in src, f"{f} must guard its poll loop with isMinimized()"


def test_huds_dropped_in_place_collapse():
    # The old in-place collapse (localStorage MIN_KEY + os-/osoc-collapsed) is gone.
    for f in HUDS:
        src = _read(f)
        assert "MIN_KEY" not in src, f"{f} still references the old in-place-collapse MIN_KEY"
        assert "-collapsed" not in src, f"{f} still toggles the old in-place collapse class"


# ── E64 (ruling #3): the status panel is a sidebar section, never a window ──

def test_status_panel_is_sidebar_chrome_not_a_window():
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
