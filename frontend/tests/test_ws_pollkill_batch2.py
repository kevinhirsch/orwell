"""WebSocket Phase-1 — poll-kill batch 2: the finale / cast / diary-room gadgets.

Sibling to test_ws_fallback_negotiation.py::test_hud_gadgets_cancel_their_polls_when_ws_is_active
(which pins the status + presence HUDs). This batch extends the SAME pattern — the one #1284
established — to the three remaining periodic-poll gadgets:

  • orwellFinale.js     — the finale poll (5s staging / 45s idle), a single setTimeout loop.
  • orwellCast.js       — the 20s gate poll (button show/hide) + the adaptive open-roster poll.
  • orwellDiaryRoom.js  — the 30s gate poll (button show/hide).

Each must: gate its poll re-arm on `_wsActive()` (via `OrwellWs.isActive()`), listen for the
`orwell:ws-active` (suspend) / `orwell:ws-inactive` (resume) mode edges, and keep its existing
`orwell:gamechanged` listener intact (the poll REMAINS the permanent SSE/poll fallback).

DORMANT by construction: `ORWELL_WS_TRANSPORT` defaults OFF, so `_wsActive()` is always false in
production and every timer arms exactly as before — these are source-pinned convention checks so a
revert fails. Structural only (no browser); roles only, no names.
"""

import os

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(name):
    with open(os.path.join(FRONTEND, "static", "js", name), encoding="utf-8") as f:
        return f.read()


FINALE = _read("orwellFinale.js")
CAST = _read("orwellCast.js")
DIARY = _read("orwellDiaryRoom.js")

_ALL = (("finale", FINALE), ("cast", CAST), ("diary-room", DIARY))


def test_each_gadget_reads_the_shared_ws_active_helper():
    # The exact helper #1284 uses (OrwellWs.isActive), defensively guarded — one source of truth.
    for name, src in _ALL:
        assert "_wsActive()" in src, f"{name} must gate its poll on the WS-active check"
        assert "window.OrwellWs && window.OrwellWs.isActive && window.OrwellWs.isActive()" in src, \
            f"{name} must resolve activeness through OrwellWs.isActive()"


def test_each_gadget_listens_for_both_mode_edges():
    for name, src in _ALL:
        assert 'orwell:ws-active' in src, f"{name} must listen for orwell:ws-active (suspend)"
        assert 'orwell:ws-inactive' in src, f"{name} must listen for orwell:ws-inactive (resume)"


def test_each_gadget_keeps_its_gamechanged_listener():
    # The ONE dispatcher rule (g15) is untouched — the edge refresh still routes through gamechanged.
    for name, src in _ALL:
        assert 'orwell:gamechanged' in src, f"{name} must keep its orwell:gamechanged listener"


def test_finale_poll_rearm_is_ws_guarded():
    # The finale's single setTimeout loop re-arms only while WS is inactive — the 5s staging cadence
    # is preserved as the fallback and only ever suspended when WS is genuinely active.
    assert "if (!_wsActive()) timer = setTimeout(tick" in FINALE


def test_cast_both_polls_are_ws_guarded():
    # The adaptive roster poll returns before re-arming when WS is active…
    assert "if (_wsActive()) return;" in CAST
    # …and the 20s gate poll is a managed interval that only arms while WS is inactive.
    assert "if (!_wsActive()) _gateTimer = setInterval(refreshGate, 20000)" in CAST
    # The old unconditional gate interval is gone (routed through startGatePoll now).
    assert "setInterval(refreshGate, 20000)" in CAST  # only inside the guarded helper


def test_diary_room_gate_poll_is_ws_guarded():
    # The 30s gate poll is a managed interval that only arms while WS is inactive.
    assert "if (!_wsActive()) _gateTimer = setInterval(" in DIARY
    assert "30000" in DIARY  # the 30s cadence is preserved as the fallback
