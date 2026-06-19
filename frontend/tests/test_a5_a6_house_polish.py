"""A5 / A6 — house-theme particles + the frosted-top clip (close-out ledger, ruling #18/#19 family).

Source-pinned (the FE pytest lane has no DOM runtime; the browser-smoke + responsive-matrix
gates cover live rendering). Here we pin the defaults + CSS structure that drive them.

A5 — every HOUSE theme ships a creative particles background, reusing the existing canvas
     particle machinery (behind the chat, perf-budgeted; the generators already honor
     prefers-reduced-motion / document.hidden). Each house theme maps to a real pattern.

A6 — the frosted window is ONE clipped surface: the .ow-window root carries overflow:hidden so
     the radius clips the title bar + body together and the frost is continuous to the rounded
     edge (no opaque top seam). Complements the L34 frost rules (which make the chrome glass).
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


def test_a5_house_particles_are_kept_subtle():
    # The house particles sit behind the frosted chrome — each has a sub-1.0 default intensity.
    js = _read("static", "js", "theme.js")
    block = re.search(r"const THEME_DEFAULT_INTENSITY\s*=\s*\{(.*?)\};", js, re.S).group(1)
    intensities = {k: float(v) for k, v in re.findall(r"'?([a-zA-Z0-9-]+)'?:\s*([0-9.]+)", block)}
    for name in _house_theme_names(js):
        assert name in intensities, f"house theme {name!r} should set a (subtle) particle intensity"
        assert 0 < intensities[name] < 1, f"house theme {name!r} intensity should be subtle (0<x<1)"


# ── A6: the frosted-top clip ──────────────────────────────────────────────────

def test_a6_kit_window_clips_as_one_surface():
    kit = _read("static", "js", "orwellWindow.js")
    # The base `.ow-window {...}` rule, sliced to the next selector (the rule body contains the
    # `${Z_BASE}` interpolation whose brace defeats a naive [^}]* capture).
    start = kit.index(".ow-window {")
    frame = kit[start:kit.index(".ow-window.window-resizing", start)]
    assert "overflow: hidden" in frame, \
        "the .ow-window root must overflow:hidden so the radius clips the title bar + body as one " \
        "frosted surface (A6 — no opaque top seam)"
    # the frame still carries the radius the clip rounds to
    assert "border-radius" in frame


def test_a6_titlebar_stays_background_less_so_the_frame_frost_shows_through():
    # Guard (same intent as the L34 kit guard): the title bar must not paint its own fill —
    # it rides the frosted, now-clipped frame.
    kit = _read("static", "js", "orwellWindow.js")
    bar = re.search(r"\.ow-titlebar\s*\{([^}]*)\}", kit).group(1)
    assert "background" not in bar
