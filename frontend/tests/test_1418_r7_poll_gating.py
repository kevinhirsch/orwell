"""#1418 / R7 · F-S1-D — the cast fast-poll cadence is gated to a MOUNTED cast surface.

The R7 audit finding (F-S1-D) worried that a faster-than-idle `/state` poll could keep hitting the
engine while no cast surface is visible (pre-game over-polling). It does not: the fast cadence is
bounded to the two moments a cast surface is actually mounted/live —

  • orwellCast.js — the adaptive roster poll only picks the `FAST_POLL_MS` cadence while a run is in
    flight, and the whole scheduler is short-circuited unless the panel is OPEN (`_open`). Closing the
    panel clears the timer and a cleared panel never re-arms; in WS mode the periodic timer is dropped
    entirely (the server `state`/`hud` push supersedes it).
  • orwellHeadshot.js — the 4s background re-check only calls `route()` while its box is mounted OR we
    are still in the pre-game window; once the season is underway (box unmounted, `_maybePregame`
    false) each tick is an inert pair of DOM reads, never a network poll.

The broad "coalesce every panel behind one shared poller" refactor is DEFERRED — superseded by
WS-transport-default-on (#1357, the periodic timers cancel on `orwell:ws-active`) and the g15
`orwell:gamechanged` push seam; see docs/REFACTOR-ROADMAP.md §R7 F-S1-D.

Source-level assertions (like test_g22 / test_l15) — CODE identifiers, never comment prose. No browser.
Roles only, no names.
"""

import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(name):
    with open(os.path.join(FRONTEND, "static", "js", name), encoding="utf-8") as f:
        return f.read()


def _block(text, start, end):
    i = text.index(start)
    j = text.index(end, i)
    return text[i:j]


CAST = _read("orwellCast.js")
HEADSHOT = _read("orwellHeadshot.js")


# ── orwellCast.js: the fast-poll scheduler is bounded to an OPEN panel ────────────────────────
def test_cast_scheduler_short_circuits_unless_the_panel_is_open():
    sched = _block(CAST, "function scheduleNextPoll()", "function togglePanel")
    # The scheduler never re-arms the periodic timer while the panel is unmounted.
    assert "if (!_open) return;" in sched, \
        "scheduleNextPoll must early-return unless the cast panel is OPEN (no poll while unmounted)"


def test_cast_scheduler_drops_the_periodic_timer_in_ws_mode():
    sched = _block(CAST, "function scheduleNextPoll()", "function togglePanel")
    # WS-transport-default-on supersedes the poll — the periodic re-arm is dropped when WS is active.
    assert "if (_wsActive()) return;" in sched, \
        "scheduleNextPoll must drop the periodic timer when the WS push is active (#1357)"


def test_cast_deferred_fetch_is_also_open_guarded():
    sched = _block(CAST, "function scheduleNextPoll()", "function togglePanel")
    # Even a timer that fired before a close re-checks _open before spending a roster fetch.
    assert "if (_open && !document.hidden) await refreshRoster();" in sched, \
        "the deferred roster fetch must re-check _open (a closed/hidden panel spends nothing)"


def test_cast_fast_cadence_only_applies_to_the_in_flight_roster_poll():
    # FAST_POLL_MS is chosen for _pollDelay only while generating/stale — it is the mounted-roster
    # cadence, not an always-on background poll. (Mirrors test_g22 / test_l15; pinned here under the
    # F-S1-D finding so a regression that lifts the fast cadence out of the _open gate fails loudly.)
    assert re.search(r"const FAST_POLL_MS\s*=\s*\d+", CAST), "FAST_POLL_MS (the in-flight cadence) must exist"
    assert re.search(r"_pollDelay\s*=\s*\(generating\s*\|\|\s*data\.stale\)\s*\?\s*FAST_POLL_MS", CAST), \
        "the fast cadence must be gated on an in-flight/stale roster, else the idle POLL_MS"


# ── orwellHeadshot.js: the 4s background re-check is inert once the season is underway ─────────
def test_headshot_background_recheck_is_gated_to_mounted_or_pregame():
    # The 4s interval must guard its route() on a mounted box OR the pre-game window, so a live
    # season with the box unmounted ticks a pair of DOM reads and does nothing (no network poll).
    m = re.search(
        r"setInterval\(function\s*\(\)\s*\{\s*(.+?)\s*\}\s*,\s*4000\)",
        HEADSHOT,
        re.DOTALL,
    )
    assert m, "the 4s headshot background re-check (setInterval(..., 4000)) must exist"
    body = m.group(1)
    assert "_maybePregame" in body, "the 4s re-check must gate route() on the pre-game window (_maybePregame)"
    assert "route()" in body, "the 4s re-check calls route() only inside its mounted/pre-game guard"
    # The guard is a mounted box OR pre-game — never an unconditional tick.
    assert "if (" in body and ")" in body, "route() must sit behind a guard, not fire unconditionally"
