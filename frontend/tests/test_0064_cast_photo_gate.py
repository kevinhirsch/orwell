"""Feature 0064 — the cast-photo onboarding window (placement + synced set-state close).

The field bug: the "Your Cast Photo" window floated mid-screen at the wrong place and stayed stuck
OPEN on a second device even after the headshot was set on the first (per-tab local state, not the
synced canonical game state). This pins the two fixes in the source (the surface itself is exercised
by the browser/responsive smokes):

  * PLACEMENT — the gate pins viewport-centered with !important on every positioning property, so the
    slot stacker can't strand it (the old rule pinned only `left`, dropping the recenter transform);
  * SYNCED CLOSE — the gate is driven by the server-authoritative intake.finalized: once ANY device
    sets the headshot, every device reflects it and the window CLOSES (no per-tab re-prompt); a light
    poll + the avatarchanged/gamechanged signals re-route so the second device closes promptly;
  * the chat gate (orwellChatGate.js) also re-derives from the synced finalized-state while blocked.

JS-source drift pins (the build gate has no JSDOM); roles only.
"""

import os


def _read(rel):
    path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static", "js", rel
    )
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def test_headshot_window_pins_centered_with_important():
    js = _read("orwellHeadshot.js")
    block = js.split("#${ID} {")[1].split("}")[0]
    # Every positioning axis is !important so the slot system's inline writes can't strand it.
    assert "left: 50% !important" in block
    assert "transform: translateX(-50%) !important" in block
    assert "!important" in block.split("top:")[1].split(";")[0]  # top is pinned too (was the gap)


def test_headshot_route_closes_on_synced_finalized_state():
    js = _read("orwellHeadshot.js")
    block = js.split("async function route()")[1].split("window.addEventListener")[0]
    # Drives from the per-user, server-authoritative intake — not per-tab local state.
    assert "/api/orwell/portrait/intake" in block
    assert "finalized" in block
    assert "unmount()" in block  # closes once secured (on any device)


def test_headshot_listens_for_cross_device_signals():
    js = _read("orwellHeadshot.js")
    assert 'window.addEventListener("orwell:avatarchanged", route)' in js
    assert 'window.addEventListener("orwell:gamechanged", route)' in js
    assert "setInterval(" in js  # the bounded re-check so a second device closes promptly


def test_chat_gate_re_derives_from_synced_state_while_blocked():
    js = _read("orwellChatGate.js")
    assert "setInterval(" in js
    assert "if (isBlocked()) recompute()" in js


def test_sessionsync_redispatches_gamechanged_on_game_updated():
    js = _read("sessionSync.js")
    assert "game-updated" in js
    assert "orwell:gamechanged" in js  # reused so every HUD reconciles instantly


def test_chat_enters_spectator_mode_on_409_turn_in_progress():
    js = _read("chat.js")
    assert "turn-in-progress" in js
    assert "enterSpectatorMode" in js
    assert "exitSpectatorMode" in js
    assert "driver_token" in js  # the per-tab driver identity for the turn lock
