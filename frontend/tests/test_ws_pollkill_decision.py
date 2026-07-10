"""WebSocket Phase-1 — poll-kill: the decision-card pending backstop.

Sibling to test_ws_pollkill_batch2.py (finale / cast / diary-room) and
test_ws_fallback_negotiation.py::test_hud_gadgets_cancel_their_polls_when_ws_is_active
(status + presence HUDs). This extends the SAME #1284 pattern to the LAST unconditional
game-state poll: orwellDecision.js's 2.5s pending-decision backstop.

That backstop fetches /api/orwell/status every 2.5s to surface a pending the chat narrated
past (or one another device advanced to) — the exact overlap of what the WS `state` push
delivers (server → orwell:gamechanged → rearmFromStatus, which surfaces the pending). So in
WS mode the 2.5s poll must STAND DOWN, while remaining the PERMANENT fallback when WS is
off/unavailable (without WS, orwell:gamechanged fires only on a LOCAL mutating tool, so a
narrated-past pending would otherwise sit unreachable until a reload).

DORMANT by construction: ORWELL_WS_TRANSPORT defaults OFF, so _wsActive() is always false in
production and the 2.5s interval arms exactly as before (byte-identical behavior). Source-pinned
convention checks so a revert fails. Structural only (no browser); roles only, no names.
"""

import os

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(name):
    with open(os.path.join(FRONTEND, "static", "js", name), encoding="utf-8") as f:
        return f.read()


DECISION = _read("orwellDecision.js")


def test_decision_reads_the_shared_ws_active_helper():
    # The exact helper #1284 uses (OrwellWs.isActive), defensively guarded — one source of truth.
    assert "_wsActive()" in DECISION, "decision backstop must gate on the WS-active check"
    assert "window.OrwellWs && window.OrwellWs.isActive && window.OrwellWs.isActive()" in DECISION, \
        "decision backstop must resolve activeness through OrwellWs.isActive()"


def test_decision_listens_for_both_mode_edges():
    assert "orwell:ws-active" in DECISION, "decision backstop must listen for orwell:ws-active (suspend)"
    assert "orwell:ws-inactive" in DECISION, "decision backstop must listen for orwell:ws-inactive (resume)"


def test_decision_backstop_poll_is_ws_guarded():
    # The 2.5s backstop is a managed interval that only arms while WS is inactive — the fallback
    # cadence is preserved and only ever suspended when WS is genuinely active.
    assert "if (!_wsActive()) _backstopTimer = setInterval(_backstopPending, 2500)" in DECISION
    # The old unconditional 2.5s interval is gone (routed through the guarded _startBackstop now).
    assert "setInterval(async () =>" not in DECISION, \
        "the old unconditional backstop setInterval must be replaced by the guarded helper"


def test_decision_keeps_its_gamechanged_listener():
    # The ONE dispatcher rule (g15) is untouched — the pending-surface edge still routes through
    # gamechanged (→ rearmFromStatus), which IS the WS refresh path in WS mode.
    assert 'window.addEventListener("orwell:gamechanged", rearmFromStatus)' in DECISION


def test_decision_backstop_still_fetches_status_as_fallback():
    # The fallback poll body is intact: it still reads the engine's own pending view and dispatches
    # orwell:pending, so with WS OFF the backstop behaves exactly as before.
    assert 'fetch("/api/orwell/status"' in DECISION
    assert 'new CustomEvent("orwell:pending"' in DECISION
    # And the fallback is armed on load (not gated away) — never leave the UI with no update path.
    assert "_startBackstop();" in DECISION
