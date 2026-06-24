"""adaptiveGlass.js — DYNAMIC legibility for Liquid Glass over ANY background.

Apple's Regular variant "adjusts the luminosity of background content to maintain
legibility." A single static veil can't: translucent-for-dark fails over a bright
photo; opaque-for-bright is a slab over dark. So this module samples the backdrop
luminance behind each glass surface and scales the neutral --panel veil opacity —
gentle over dark, muted over bright — so the theme's --fg text stays legible over
anything (a photo like Tuscany, a light theme, a gradient, the dark chat).

Source-pinned (the FE has no DOM runtime in the pytest lane; the browser-smoke +
responsive-matrix gates cover live DOM). These pin the load wiring + the algorithm
contract so the behavior can't silently regress.
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*rel):
    with open(os.path.join(FRONTEND, *rel), encoding="utf-8") as f:
        return f.read()


JS = _read("static", "js", "adaptiveGlass.js")
INDEX = _read("static", "index.html")


def test_module_exists_and_loaded_after_liquid_glass():
    assert JS.strip(), "adaptiveGlass.js must be non-empty"
    assert "adaptiveGlass.js" in INDEX, "adaptiveGlass.js must be loaded in index.html"
    # it must load AFTER liquidGlass.js (so the refraction's surfaces/markers exist) but
    # both run independently — adaptive sets background-color, refraction backdrop-filter.
    assert INDEX.index("liquidGlass.js") < INDEX.index("adaptiveGlass.js")


def test_runs_on_every_engine_not_chromium_gated():
    # Unlike the refraction (Chromium-only), adaptive legibility must run everywhere —
    # the fallback (CSS-blur) build also needs to stay legible over any backdrop. So NO
    # Chromium UA gate / no backdrop-filter:url support check in this module.
    assert "navigator.userAgent" not in JS, "adaptive must NOT gate on a Chromium UA"
    assert "url(#x)" not in JS


def test_samples_backdrop_luminance():
    # it computes a relative luminance from sampled backdrop pixels (Rec. 709 coeffs).
    assert "0.2126" in JS and "0.7152" in JS and "0.0722" in JS
    assert "getImageData" in JS                      # samples the backdrop image pixels
    assert "elementsFromPoint" in JS                 # fallback: element-behind bg color


def test_size_aware_flip_small_clear_large_muted():
    # Apple (WWDC25 219): SMALL bars/tiles flip symbols + stay clear; LARGE surfaces
    # (sidebars/windows/menus) DON'T flip ("surface area too big") — the glass adapts
    # (mutes) instead. So small surfaces get a low veil cap, large a higher one, and only
    # small surfaces flip ink.
    assert "FLIP_SET" in JS
    assert "VEIL_MAX_SMALL" in JS and "VEIL_MAX_LARGE" in JS
    small = int(re.search(r"VEIL_MAX_SMALL\s*=\s*(\d+)", JS).group(1))
    large = int(re.search(r"VEIL_MAX_LARGE\s*=\s*(\d+)", JS).group(1))
    assert small <= 34, f"small bars must stay CLEAR ({small}%) — the flip does the work"
    assert large > small, "large surfaces mute more (they don't flip)"
    assert "el.matches(FLIP_SET)" in JS
    # only SMALL + bright flips to dark ink.
    assert re.search(r"small\s*&&\s*L\s*>=?\s*INK_THRESHOLD", JS)


def test_linear_luminance_and_threshold():
    # proper sRGB→linear luminance (not gamma-encoded). Flip at the WCAG black-vs-white
    # crossover (L≈0.18), nudged up to 0.22 for the small bar's own veil darkening — 0.36
    # fired far too late (a perceptually half-bright backdrop kept light ink and washed out).
    assert "0.2126" in JS and "Math.pow" in JS and "12.92" in JS  # sRGB→linear
    assert re.search(r"INK_THRESHOLD\s*=\s*0\.22", JS)
    assert "INK_DARK" in JS and 'setProperty("color", INK_DARK' in JS
    assert "data-adaptive-ink" in JS


def test_accessibility_increase_contrast_drops_the_flip():
    # Increase Contrast supersedes the subtle flip (black/white + border via CSS) — the
    # module drops its overrides under prefers-contrast: more.
    assert "prefersContrast" in JS
    assert "(prefers-contrast: more)" in JS


def test_fail_soft_and_frosted_gated():
    # only active under the frosted theme; clears its overrides otherwise (static CSS veil stands).
    assert "theme-frosted" in JS
    assert 'removeProperty("background-color")' in JS
    # debounced (no per-frame thrash); re-samples on resize/scroll/bg-change.
    assert "DEBOUNCE" in JS and "addEventListener" in JS
    # the gating dialog is excluded (kept opaque).
    assert "orwell-headshot" in JS
