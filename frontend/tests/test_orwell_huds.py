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


HUDS = ["orwellStatusPanel.js", "orwellSocial.js"]


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
