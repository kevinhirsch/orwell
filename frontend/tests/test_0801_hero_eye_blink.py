"""#801 / #802 — the Orwell hero eye blinks; the hero never crowds the composer.

Source-pinned (the live FE/engine can't run in this gate), in three parts:

  #801a  ONE shared blink MECHANISM exists (eyeBlink.js + eyeBlink.css) — a CSS
         lid keyframe + a JS interval with randomized ~7-10s timing and an
         occasional double-blink, reduced-motion gated.
  #801b  BOTH heroes use it: the in-app welcome hero (#welcome-screen .welcome-eye)
         AND the login hero (.logo-eye-lid) carry the shared [data-eye-lid] +
         .eye-blink-wrap and load the shared module/stylesheet. No hero keeps its
         own ad-hoc blink loop (DRY).
  #802   A guaranteed, FLUID min gap between the welcome hero and the composer so
         they can never crowd/touch — at any viewport height.
"""
import os

FE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(rel):
    with open(os.path.join(FE, rel), encoding="utf-8") as fh:
        return fh.read()


# ─────────────────────────────────────────────────────────────────────────────
# #801a — the shared blink mechanism (CSS look + JS rhythm)
# ─────────────────────────────────────────────────────────────────────────────

def test_shared_blink_module_exists():
    js = _read("static/js/eyeBlink.js")
    css = _read("static/css/eyeBlink.css")
    assert js and css, "the shared eyeBlink.js + eyeBlink.css must both exist"


def test_blink_css_owns_a_lid_keyframe_single_and_double():
    css = _read("static/css/eyeBlink.css")
    # A single natural blink and an occasional double-blink, both as lid sweeps.
    assert "@keyframes eye-blink-single" in css
    assert "@keyframes eye-blink-double" in css
    # The lid is driven by one-shot classes the JS toggles.
    assert ".eye-blinking" in css
    assert ".eye-blinking-double" in css
    # The lid scales shut (an eyelid, not a fade).
    assert "scaleY(1)" in css and "scaleY(0)" in css


def test_blink_js_uses_randomized_7_to_10s_cadence():
    js = _read("static/js/eyeBlink.js")
    # Randomized cadence in the ~7-10s window (not a fixed metronome).
    assert "7000" in js, "minimum blink gap must be ~7s"
    assert "10000" in js, "maximum blink gap must be ~10s"
    # The gap is randomized between min and max each cycle.
    assert "Math.random()" in js
    # An occasional double-blink for realism/creep.
    assert "doubleChance" in js.lower() or "double_blink_chance" in js.lower() \
        or "eye-blinking-double" in js


def test_blink_is_reduced_motion_safe():
    css = _read("static/css/eyeBlink.css")
    js = _read("static/js/eyeBlink.js")
    # CSS hard-freezes the lid open under reduced motion (belt).
    assert "prefers-reduced-motion: reduce" in css
    # JS never schedules a blink under reduced motion (suspenders).
    assert "prefers-reduced-motion" in js


# ─────────────────────────────────────────────────────────────────────────────
# #801b — BOTH heroes use the ONE shared mechanism (DRY)
# ─────────────────────────────────────────────────────────────────────────────

def test_inapp_welcome_hero_uses_shared_blink():
    html = _read("static/index.html")
    # The welcome eye carries the shared lid marker + wrap and loads the module/css.
    assert "data-eye-lid" in html, "the in-app welcome eye needs a lid marked [data-eye-lid]"
    assert "eye-blink-wrap" in html
    assert "/static/js/eyeBlink.js" in html
    assert "/static/css/eyeBlink.css" in html


def test_login_hero_uses_shared_blink():
    html = _read("static/login.html")
    assert "data-eye-lid" in html, "the login eye needs a lid marked [data-eye-lid]"
    assert "eye-blink-wrap" in html
    assert "/static/js/eyeBlink.js" in html
    assert "/static/css/eyeBlink.css" in html


def test_login_dropped_its_own_metronomic_blink_loop():
    # DRY: the old fixed 10s pure-CSS loop must be gone — the shared mechanism owns it now.
    html = _read("static/login.html")
    assert "@keyframes logo-eye-blink" not in html, \
        "login must not keep its own ad-hoc blink keyframe (use the shared mechanism)"
    assert "animation: logo-eye-blink" not in html


# ─────────────────────────────────────────────────────────────────────────────
# #802 — a guaranteed, fluid gap between the welcome hero and the composer
# ─────────────────────────────────────────────────────────────────────────────

def test_welcome_composer_gap_is_fluid_not_flat():
    css = _read("static/style.css")
    # The welcome-active composer push must be fluid (clamp/min/clamp-by-vh), not a
    # flat 30vh that crowds the hero on short screens.
    block = css[css.index(".chat-container.welcome-active .chat-input-bar"):]
    block = block[: block.index("}") + 1]
    assert "clamp(" in block or "min(" in block, \
        "the hero↔composer gap must be FLUID so it stays comfy as the viewport shrinks"


def test_welcome_composer_gap_shrinks_on_short_viewports():
    css = _read("static/style.css")
    # There must be short-height overrides that shrink the composer push (freeing
    # room for the hero) so they never crowd on short laptop screens.
    assert "max-height: 650px" in css
    # A dedicated welcome-active short-height composer override exists.
    assert "max-height: 500px" in css
    # The hero block reserves a fluid min gap beneath it.
    assert "#welcome-screen" in css and "padding-bottom: clamp(" in css
