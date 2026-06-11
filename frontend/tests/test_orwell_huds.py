"""Game HUDs (status + social) — sidebar-chrome SOURCE-PINS (T20, refit by E64 + H5).

EXPLICIT SOURCE-PINS, NOT BEHAVIOR COVERAGE. Every assertion in this file greps the static JS
source; a passing grep proves the wiring is *present*, never that it *works*. The real
BEHAVIOR is exercised in the headless browser by `scripts/browser_smoke.py`. These pins remain
as cheap, browserless regression guards: if a refactor reverts a sidebar section to a floating
window, this file goes red in the fast pytest gate before the browser smoke even runs. Read
each `test_*` below as "the source still wires X", not "X behaves correctly".

History: T20 originally pinned the HUDs' minimize-to-dock wiring. Ruling #3/E64 moved the
status panel to sidebar chrome; H5/G7 (2026-06-11, user verdict on "The House") then folded
the social/approaches surface into the sidebar the same way — so NO game HUD remains on the
floating-window/dock contract here. The finale (still a kit window) is pinned in
test_f_window_kit.py and exercised for real (T20/F1/F2) in browser_smoke.py; the H5 sidebar
contract for the social section is pinned in test_h5_house_in_sidebar.py and mirrored below.

Name-agnostic; no game state required.
"""

import os

STATIC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static", "js")


def _read(name: str) -> str:
    with open(os.path.join(STATIC, name), encoding="utf-8") as f:
        return f.read()


# ── H5/G7 (user verdict): the social surface is a sidebar section, never a window ──
# SOURCE-PINS: these grep orwellSocial.js for "is sidebar chrome" markers, mirroring the
# E64 status-panel pins below. The BEHAVIORAL counterpart — the section actually mounts
# inside #sidebar, shows nothing while empty, and is never fixed-position — is asserted
# in browser_smoke.py (the H5 block).

def test_sourcepin_social_is_sidebar_chrome_not_a_window():
    src = _read("orwellSocial.js")
    assert "position: fixed" not in src, "H5: the social section must not be fixed-position"
    assert "makeWindowDraggable" not in src, "H5: no drag"
    assert "modalManager" not in src, "H5: no dock/minimize"
    assert "OrwellWindowKit" not in src, "H5: the window kit is composed by WINDOWS — this is chrome"
    assert "OrwellSlots" not in src, "H5: no slot placement — static sidebar flow"
    assert 'getElementById("sidebar")' in src, "H5: mounts inside #sidebar"
    assert '"sessions-section"' in src, "H5: anchors near the session list / status section"


def test_sourcepin_social_keeps_poll_render_and_seams():
    src = _read("orwellSocial.js")
    for keep in ("orwell:gamechanged", "_orwellSocialEnsure", "_orwellSocialDriveApproaches",
                 "MOTIVE_FRAMING", "firstCeremonyResolved", "MAX_APPROACHES"):
        assert keep in src, f"H5 keeps the poll/render/seam logic: {keep}"


def test_sourcepin_social_dropped_dock_state_bookkeeping():
    # The dock-era state (isMinimized guards, the C26 mobile auto-park) is gone with the
    # window; the sidebar drawer owns narrow viewports like every other section.
    src = _read("orwellSocial.js")
    assert "isMinimized" not in src, "H5: no minimized-state bookkeeping for a sidebar section"
    assert "_mobileParkedOnce" not in src, "H5: no mobile auto-park — the drawer owns narrow"


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
