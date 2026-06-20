"""A5 / A6 — house-theme particles + the frosted-top clip (close-out ledger, ruling #18/#19 family).

Source-pinned (the FE pytest lane has no DOM runtime; the browser-smoke + responsive-matrix
gates cover live rendering). Here we pin the defaults + CSS structure that drive them.

A5 — every HOUSE theme ships a creative particles background, reusing the existing canvas
     particle machinery (behind the chat, perf-budgeted; the generators already honor
     prefers-reduced-motion / document.hidden). Each house theme maps to a real pattern.

A6 — the frosted-top cohesion is handled by the L34 frost rules (the titlebar rides the
     translucent+blur window root, no separate opaque fill). A blind `overflow: hidden` on the
     window root is FORBIDDEN here: with the 10px border-radius it clips the rounded-corner
     pointer region and defeats the L11 corner-resize grab (CI-caught). The seam refinement needs
     a live-browser audit, not a CSS guess — so we guard the regression instead.
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*rel):
    with open(os.path.join(FRONTEND, *rel), encoding="utf-8") as f:
        return f.read()


# The animated canvas particle generators registered in _CANVAS_PATTERNS.
_CANVAS_PATTERNS = {"synapse", "rain", "constellations", "perlin-flow", "petals", "sparkles", "embers"}


def _house_theme_names(js):
    body = re.search(r"export const THEMES = \{(.*?)\n\};", js, re.S).group(1)
    # a house theme line carries `house: true`
    return [m.group(1) for m in re.finditer(r"'([a-z0-9-]+)':\s*\{[^}]*house:\s*true", body)]


def _default_pattern_map(js):
    block = re.search(r"const THEME_DEFAULT_PATTERN\s*=\s*\{(.*?)\n\};", js, re.S).group(1)
    return dict(re.findall(r"'?([a-zA-Z0-9-]+)'?:\s*'([a-zA-Z0-9-]+)'", block))


# ── A5: per-theme particles ───────────────────────────────────────────────────

def test_a5_every_house_theme_has_a_particle_pattern():
    js = _read("static", "js", "theme.js")
    houses = _house_theme_names(js)
    assert len(houses) == 5, f"expected the 5 house themes, found {houses}"
    patterns = _default_pattern_map(js)
    for name in houses:
        assert name in patterns, f"house theme {name!r} has no default background pattern (A5)"
        assert patterns[name] in _CANVAS_PATTERNS, \
            f"house theme {name!r} pattern {patterns[name]!r} is not an animated particle pattern"


def test_a5_animated_particles_honor_prefers_reduced_motion():
    # A5 (ruling #18): the animated canvas generators must NOT spawn under
    # prefers-reduced-motion (static or off). applyBgPattern gates the canvas
    # init on the live media query; the static CSS base layer still paints.
    js = _read("static", "js", "theme.js")
    body = re.search(r"export function applyBgPattern\(pattern\) \{(.*?)\n\}", js, re.S).group(1)
    assert "_prefersReducedMotion()" in body, \
        "applyBgPattern must consult prefers-reduced-motion before starting the canvas generator"
    assert re.search(r"_CANVAS_PATTERNS\[p\]\s*&&\s*!_prefersReducedMotion\(\)", body), \
        "the animated canvas init must be skipped when reduced motion is requested"
    helper = re.search(r"function _prefersReducedMotion\(\) \{(.*?)\n\}", js, re.S).group(1)
    assert "prefers-reduced-motion" in helper and "matchMedia" in helper


def test_a5_house_particles_are_kept_subtle():
    # The house particles sit behind the frosted chrome — each has a sub-1.0 default intensity.
    js = _read("static", "js", "theme.js")
    block = re.search(r"const THEME_DEFAULT_INTENSITY\s*=\s*\{(.*?)\};", js, re.S).group(1)
    intensities = {k: float(v) for k, v in re.findall(r"'?([a-zA-Z0-9-]+)'?:\s*([0-9.]+)", block)}
    for name in _house_theme_names(js):
        assert name in intensities, f"house theme {name!r} should set a (subtle) particle intensity"
        assert 0 < intensities[name] < 1, f"house theme {name!r} intensity should be subtle (0<x<1)"


# ── A6: the frosted-top must NOT regress the L11 corner-resize ────────────────

def test_a6_window_root_does_not_overflow_clip_the_resize_corner():
    # REGRESSION GUARD: `overflow: hidden` on the rounded .ow-window root clips the corner
    # pointer region (10px radius) and breaks the L11 corner-resize grab (CI browser-smoke
    # caught this). The frosted-top cohesion rides the L34 style.css rules instead.
    kit = _read("static", "js", "orwellWindow.js")
    start = kit.index(".ow-window {")
    frame = kit[start:kit.index(".ow-window.window-resizing", start)]
    assert "overflow: hidden" not in frame, \
        "the .ow-window root must NOT overflow:hidden — it clips the rounded corner and defeats " \
        "the L11 corner-resize grab"
    assert "border-radius" in frame  # the rounded window aesthetic stays


def test_a6_titlebar_stays_background_less_so_the_frame_frost_shows_through():
    # Guard (same intent as the L34 kit guard): the title bar must not paint its own fill —
    # it rides the frosted frame (L34 style.css), so the header is cohesively glass.
    kit = _read("static", "js", "orwellWindow.js")
    bar = re.search(r"\.ow-titlebar\s*\{([^}]*)\}", kit).group(1)
    assert "background" not in bar
