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


def test_keeps_glass_clear_with_a_gentle_veil():
    # The glass stays CLEAR (Apple's bright-media legibility is NOT "darken the glass").
    # The veil is a GENTLE --panel mix, scaled by luminance but capped low (not a slab).
    assert "VEIL_MIN" in JS and "VEIL_MAX" in JS
    assert "VEIL_MIN + (VEIL_MAX - VEIL_MIN)" in JS
    assert 'setProperty("background-color"' in JS and "var(--panel" in JS
    vmax = int(re.search(r"VEIL_MAX\s*=\s*(\d+)", JS).group(1))
    assert vmax <= 40, f"veil too strong ({vmax}%) — glass must stay clear, not muted"


def test_adaptive_ink_flips_symbols_dark_over_bright():
    # The REAL Apple lever (HIG Color): "symbols and text become darker when the underlying
    # content is light, and lighter when it's dark." So over a BRIGHT backdrop the surface's
    # ink flips DARK (like the share-button-over-Fuji reference) while the glass stays clear.
    assert "INK_THRESHOLD" in JS and "INK_DARK" in JS
    assert re.search(r"L\s*>=?\s*INK_THRESHOLD", JS)
    assert 'setProperty("color", INK_DARK' in JS
    assert "data-adaptive-ink" in JS


def test_fail_soft_and_frosted_gated():
    # only active under the frosted theme; clears its overrides otherwise (static CSS veil stands).
    assert "theme-frosted" in JS
    assert 'removeProperty("background-color")' in JS
    # debounced (no per-frame thrash); re-samples on resize/scroll/bg-change.
    assert "DEBOUNCE" in JS and "addEventListener" in JS
    # the gating dialog is excluded (kept opaque).
    assert "orwell-headshot" in JS
