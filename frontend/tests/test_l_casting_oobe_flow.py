"""Casting / OOBE flow fixes (L1–L5) — SOURCE-PINS.

A live OOBE play-through surfaced a cluster of casting/headshot handoff bugs:

  L1 — the headshot studio rode up under the "orwell" header and covered the logo
       (the welcome-screen lifts the composer ~30vh; the casting card above it climbed
       into the header). Fixed by dropping the lift + capping the card while casting.
  L2 — the J4 "Open Settings" button only un-hid the sidebar (it clicked #rail-settings,
       which never opens the modal); and it was gated on `window._isAdmin`, which nothing
       sets, so it never rendered. Fixed: open via the real gear (#user-bar-settings) and
       gate on the real /api/auth/status probe.
  L3 — generated photos must show EXPANDED; the card must never auto-collapse on generate.
  L4 — picking a headshot must DISMISS the picker and hand off into the game, not park on
       "Make another"/"Remove" still covering the logo.
  L5 — after casting + headshot, the PRODUCERS open the show with the first message — the
       player never types the opening word.

These are wiring pins (JS/CSS-as-text); the behaviour is exercised by the browser smoke.
No fixture names — roles only.
"""

import os

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


# ── L1: the studio never rides up under the header ──────────────────────────────────

def test_l1_casting_card_drops_the_welcome_lift_and_caps_height():
    css = _read("static", "css", "game-trim.css")
    # While the casting card is mounted, the welcome-active composer lift is dropped so the
    # card sits near the bottom (clear of the header).
    assert ".ow-casting-headshot-open" in css
    assert "welcome-active" in css and "chat-input-bar" in css
    js = _read("static", "js", "orwellHeadshot.js")
    # the card carries a max-height cap + internal scroll so it can never grow into the header
    assert "max-height" in js
    assert "ow-casting-headshot-open" in js  # the body flag is added on mount


def test_l1_body_flag_is_toggled_on_mount_and_unmount():
    js = _read("static", "js", "orwellHeadshot.js")
    assert 'classList.add("ow-casting-headshot-open")' in js
    assert 'classList.remove("ow-casting-headshot-open")' in js


# ── L2: the OOBE settings button actually opens settings ────────────────────────────

def test_l2_open_settings_prefers_the_real_gear_not_the_rail():
    js = _read("static", "js", "orwellOnboarding.js")
    # #rail-settings only un-hides the sidebar (app.js); the gear opens the modal. Prefer it.
    assert "user-bar-settings" in js
    # the gear is tried BEFORE the rail button in openSettings()
    open_fn = js[js.index("function openSettings"):]
    open_fn = open_fn[: open_fn.index("\n  }")]
    assert open_fn.index("user-bar-settings") < open_fn.index("rail-settings")


def test_l2_admin_gate_uses_the_real_probe_not_the_unset_global():
    js = _read("static", "js", "orwellOnboarding.js")
    # the live admin probe replaces the never-set window._isAdmin gate for the J4 card
    assert "/api/auth/status" in js
    assert "async function isAdmin" in js
    assert "await isAdmin()" in js
    # the J4 button + copy branch on the probe result, not on the dead global
    assert "admin ? [{ label: \"Open Settings\"" in js


# ── L3: generated photos show expanded, never auto-collapse ─────────────────────────

def test_l3_studio_keeps_the_card_open_when_options_appear():
    js = _read("static", "js", "orwellHeadshot.js")
    assert "ensureOpen" in js
    # generate + the G32 restore-on-refresh path both re-assert open
    gen = js[js.index("async function studioGenerate"):]
    gen = gen[: gen.index("\n    }")]
    assert "ensureOpen()" in gen
    # P1 OOBE overhaul: the studio now mounts inside the OrwellWindow kit, whose .ow-body
    # scrolls internally (overflow:auto) — the casting window caps its body height so the
    # generated photos never grow the surface up into the header.
    assert "> .ow-body { max-height" in js


# ── L4: picking a headshot dismisses the picker and hands off ────────────────────────

def test_l4_finalize_hands_off_instead_of_painting_the_finalized_state():
    js = _read("static", "js", "orwellHeadshot.js")
    # both finalize paths (studio finalize + library select) call the handoff and bail
    assert "onFinalized" in js
    assert "if (handoff()) return" in js
    # the host wires the handoff to unmount the card + open the game
    assert "onCastingHeadshotChosen" in js
    chosen = js[js.index("function onCastingHeadshotChosen"):]
    chosen = chosen[: chosen.index("\n  }")]
    # tear the WINDOW down (item 6: keep the composer-lift drop through the handoff) and
    # hand off into the producers' open
    assert "teardownWindow()" in chosen
    assert "_orwellOpenGameAfterCasting" in chosen


# ── L5: the producers send the first message automatically ──────────────────────────

def test_l5_producers_auto_open_the_game_after_casting():
    js = _read("static", "js", "orwellOnboarding.js")
    assert "window._orwellOpenGameAfterCasting" in js
    seg = js[js.index("window._orwellOpenGameAfterCasting"):]
    seg = seg[: seg.index("\n  };")]
    # it AUTO-SENDS (this single cutover departs from the prefill-only rule)
    assert "handleChatSubmit" in seg
    # ...but only once, only on the game build, and never over the player's own typing /
    # an in-flight stream
    assert "data-game-build" in seg
    assert "_openSent" in seg
    assert "value.trim()" in seg
    assert "hasActiveStream" in seg


def test_l5_headshot_module_triggers_the_producer_open():
    js = _read("static", "js", "orwellHeadshot.js")
    assert "window._orwellOpenGameAfterCasting" in js
