"""Game HUDs (status panel) — sidebar-chrome SOURCE-PINS (T20, refit by E64).

EXPLICIT SOURCE-PINS, NOT BEHAVIOR COVERAGE. Every assertion in this file greps the static JS
source; a passing grep proves the wiring is *present*, never that it *works*. The real
BEHAVIOR is exercised in the headless browser by `scripts/browser_smoke.py`. These pins remain
as cheap, browserless regression guards: if a refactor reverts a sidebar section to a floating
window, this file goes red in the fast pytest gate before the browser smoke even runs. Read
each `test_*` below as "the source still wires X", not "X behaves correctly".

History: T20 originally pinned the HUDs' minimize-to-dock wiring. Ruling #3/E64 moved the
status panel to sidebar chrome — so NO game HUD remains on the floating-window/dock contract
here. The finale (still a kit window) is pinned in test_f_window_kit.py and exercised for real
(T20/F1/F2) in browser_smoke.py.

Name-agnostic; no game state required.
"""

import os

STATIC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static", "js")


def _read(name: str) -> str:
    with open(os.path.join(STATIC, name), encoding="utf-8") as f:
        return f.read()


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
    # #640: it's a RAIL GADGET (composes the OrwellGadget kit), not a window — the kit owns the
    # mount (#gadget-rail-body → #sidebar → body), so the panel itself no longer hand-wires it.
    assert "OrwellGadgetKit.create(" in src, "#640: composes the gadget kit"
    assert "OrwellWindowKit.create(" not in src, "E64: still not a window"


def test_status_panel_keeps_poll_render_and_announcer():
    src = _read("orwellStatusPanel.js")
    for keep in ("aria-live", "announceDeltas", "orwell:gamechanged",
                 "os-stale", "PHASE_LABELS"):
        assert keep in src, f"E64 keeps the poll/render/announcer logic: {keep}"


def test_status_panel_backoff_recovers_on_success():
    # E68: one blip must not degrade a live game to 2-minute polls forever.
    src = _read("orwellStatusPanel.js")
    assert "_failures = 0; // E68" in src


def test_status_panel_has_no_eviction_ordinal_trail():
    # #955: the status panel's per-person name-list (and its "Nth out" eviction-seat ordinal
    # trail) was removed — it duplicated the cast photo gallery, now the single roster surface.
    # The ordinal() helper went with it, so the panel no longer carries the E69 ordinal logic.
    src = _read("orwellStatusPanel.js")
    assert "mod100 >= 11 && mod100 <= 13" not in src
    assert "function ordinal(" not in src


# ── F6 (#1023): pre-game terminal/night strings render FROM STATE, never baked static ──
# The status panel is hidden pre-game (week < 1 → hidePanel), but a stale terminal string baked
# into the static gadget innerHTML would be latent if the gadget ever rendered pre-game. The fix
# renders "Season complete" / "Nightfall" dynamically from state instead.

def test_status_panel_season_complete_is_not_a_static_template_literal():
    src = _read("orwellStatusPanel.js")
    # the terminal label must NOT be baked into the static body.innerHTML template (the #os-done div
    # holds an empty label span filled at render time).
    assert '<div class="os-done" id="os-done" hidden>Season complete' not in src, \
        "F6: 'Season complete' must not be a static template literal in the gadget innerHTML"
    assert 'id="os-done-label"' in src, "F6: the terminal label is an empty slot filled from state"
    # and it IS set dynamically in the finished-render branch (only when st.finished).
    assert 'lbl.textContent = "Season complete"' in src, \
        "F6: 'Season complete' is written from state in the done branch"


def test_night_gadget_chrome_is_built_only_when_the_clock_runs():
    # F6: the "Nightfall" gadget card must not be MOUNTED pre-game / clock-off, so its chrome
    # (the "Nightfall" title) is never a latent stale string in the DOM. render() only calls
    # ensureEl() once a valid time-of-day is present; pre-game it leaves the gadget unmounted.
    src = _read("orwellNightStatus.js")
    # the guard returns BEFORE ensureEl() when there is no running clock (no eager build at top).
    render_body = src[src.index("function render(state)"):]
    guard_at = render_body.index("if (!tod || !TOD[tod])")
    ensure_at = render_body.index("ensureEl()")
    assert guard_at < ensure_at, \
        "F6: the no-clock guard must return before ensureEl() — no eager gadget build pre-game"
