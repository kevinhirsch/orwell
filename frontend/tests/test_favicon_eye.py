"""Blinking favicon — the surveillance eye blinks in the browser tab, in lockstep
with the on-screen hero/login eye.

Source-pinned (the live FE/engine can't run in this gate). The contract:

  1. A controller module (faviconEye.js) exists and is the SINGLE owner of the
     <link rel="icon"> href — it holds { accent, route, blinkState } and renders
     the href from all three, so blink never fights accent/route and vice-versa.
  2. It REUSES eyeBlink.js's cadence (imports BLINK_MIN_MS / BLINK_MAX_MS) — one
     timing source for the DOM lid and the tab, not a second invented rhythm.
  3. It blinks by SWAPPING the icon href between an open-eye SVG and a closed-lid
     (filled-almond) SVG — browsers won't animate an SVG/GIF favicon.
  4. reduced-motion: never schedules a blink (the eye holds its stare).
  5. document.hidden / visibilitychange: pauses blinking while backgrounded.
  6. The two pre-existing favicon writers (the accent-color updater and the
     per-route swap, both inline in index.html) route THROUGH the controller
     (set state on it) instead of writing href ad-hoc as the sole owner.
  7. The page loads the module.

The live half (the tab href actually swaps open<->closed on the cadence, and
stays open under reduced-motion / when hidden) is proven by the headless capture
under scripts/ and saved evidence — the source pins below are the durable gate.
"""
import os

FE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(rel):
    with open(os.path.join(FE, rel), encoding="utf-8") as fh:
        return fh.read()


# ─────────────────────────────────────────────────────────────────────────────
# 1 — the controller exists and is the single href owner
# ─────────────────────────────────────────────────────────────────────────────

def test_favicon_controller_module_exists():
    js = _read("static/js/faviconEye.js")
    assert js, "faviconEye.js (the blinking-favicon controller) must exist"


def test_controller_holds_accent_route_blink_state():
    js = _read("static/js/faviconEye.js")
    # The controller composes all three so they never clobber each other.
    assert "setAccent" in js
    assert "setRoute" in js
    assert "setBlink" in js
    # A single render() is the ONE place the href is written.
    assert "function render" in js
    assert "fav.href" in js


def test_controller_is_published_for_the_inline_updaters():
    js = _read("static/js/faviconEye.js")
    # Published on window so the inline head updaters (which run first) route here.
    assert "OrwellFaviconEye" in js


# ─────────────────────────────────────────────────────────────────────────────
# 2 — reuse the eyeBlink.js cadence (one rhythm, not two)
# ─────────────────────────────────────────────────────────────────────────────

def test_controller_reuses_eyeblink_cadence():
    js = _read("static/js/faviconEye.js")
    # It imports the shared cadence bounds from eyeBlink.js — DRY (#801 principle).
    assert "from './eyeBlink.js'" in js
    assert "BLINK_MIN_MS" in js and "BLINK_MAX_MS" in js
    # The schedule jitters between those bounds (not a fixed metronome).
    assert "Math.random()" in js
    # An occasional double-blink, mirroring eyeBlink.js.
    assert "double" in js.lower()


# ─────────────────────────────────────────────────────────────────────────────
# 3 — blink by swapping the href between an open eye and a closed lid
# ─────────────────────────────────────────────────────────────────────────────

def test_controller_swaps_open_and_closed_eye_svgs():
    js = _read("static/js/faviconEye.js")
    assert "openEyeSvg" in js, "an open-eye SVG variant must exist"
    assert "closedEyeSvg" in js, "a closed-lid SVG variant must exist"
    # The open eye keeps the outline + pupil; the closed lid is the filled almond
    # (reuses the hero .welcome-eye / .welcome-eye-lid paths).
    assert "fill='none'" in js, "the open eye is an outline (fill='none') + pupil"
    assert "circle" in js, "the open eye has a pupil circle"
    # The shared almond path is present (same glyph as the hero/default favicon).
    assert "M2 16Q9 7 16 7" in js


# ─────────────────────────────────────────────────────────────────────────────
# 4 — reduced-motion: never schedule a blink
# ─────────────────────────────────────────────────────────────────────────────

def test_controller_is_reduced_motion_safe():
    js = _read("static/js/faviconEye.js")
    assert "prefers-reduced-motion" in js
    # The blink eligibility gate consults reduced motion.
    assert "prefersReducedMotion" in js


# ─────────────────────────────────────────────────────────────────────────────
# 5 — pause while the tab is backgrounded
# ─────────────────────────────────────────────────────────────────────────────

def test_controller_pauses_while_tab_hidden():
    js = _read("static/js/faviconEye.js")
    assert "visibilitychange" in js
    assert "document.hidden" in js or "hidden" in js


# ─────────────────────────────────────────────────────────────────────────────
# 6 — the accent + route updaters route THROUGH the controller
# ─────────────────────────────────────────────────────────────────────────────

def test_accent_updater_routes_through_controller():
    html = _read("static/index.html")
    # The accent-color updater sets ACCENT STATE on the controller (or stashes it
    # for adoption) — it is no longer the sole ad-hoc href writer.
    assert "OrwellFaviconEye" in html and "setAccent" in html
    assert "__orwellFaviconState" in html


def test_route_updater_routes_through_controller():
    html = _read("static/index.html")
    # The per-route swap tells the controller it's a non-eye glyph (no blink).
    assert "setRoute" in html


# ─────────────────────────────────────────────────────────────────────────────
# 7 — the page loads the module
# ─────────────────────────────────────────────────────────────────────────────

def test_index_loads_the_controller_module():
    html = _read("static/index.html")
    assert "/static/js/faviconEye.js" in html
    # It loads as an ES module (it imports from eyeBlink.js).
    assert 'src="/static/js/faviconEye.js"' in html
