"""Apple macOS OVERLAY scrollbars for the OrwellWindow kit (#709 follow-up).

Source-pinned (the FE has no DOM runtime in the pytest lane). Pins:
  • the dedicated scrollbar region exists at the END of style.css (not interleaved
    with the window-material rules a concurrent agent owns);
  • the kit scroll container (.ow-window .ow-body) gets the THIN / ROUNDED /
    TRANSLUCENT / OVERLAY scrollbar — webkit (::-webkit-scrollbar*) AND Firefox
    (scrollbar-width: thin; scrollbar-color: <thumb> transparent);
  • the thumb is NEUTRAL (sourced from --fg, NO accent hue / no --red);
  • the track is transparent (no solid track);
  • overlay: the bar does not reserve gutter (scrollbar-gutter: auto / overflow: overlay);
  • accessibility: prefers-reduced-motion (no fade) + prefers-reduced-transparency
    (more opaque thumb) are honoured;
  • the JS module exists, is wired into the served shell AFTER the window kit, and
    drives the reveal-on-scroll / idle-fade-out / hover-expand class toggling.
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*p):
    with open(os.path.join(FRONTEND, *p), encoding="utf-8") as f:
        return f.read()


CSS = _read("static", "style.css")
JS = _read("static", "js", "orwellScrollbars.js")
INDEX = _read("static", "index.html")

# The dedicated region's text (everything after the banner) — the scrollbar rules MUST
# live here so the test reasons about the right block, not some other surface's bar.
REGION_MARKER = "APPLE OVERLAY SCROLLBARS (window kit)"
REGION = CSS.split(REGION_MARKER, 1)[1] if REGION_MARKER in CSS else ""
# Bound the region at the start of the NEXT appended end-region (the liquid-glass craft
# region #757, and after it the OrwellSheet kit #753 — which legitimately uses
# var(--accent)/var(--red) for the anchored sheet rim). Without this bound the scrollbar
# "no accent" pins would over-reach into a sibling surface's CSS appended later.
for _next_region in ("LIQUID-GLASS CRAFT REGION", "OrwellSheet — THE iOS bottom-sheet kit"):
    if _next_region in REGION:
        REGION = REGION.split(_next_region, 1)[0]
        break
# REGION_CODE = the rules only (comments stripped) for "no accent in the actual rules"
# checks. The marker sits INSIDE the banner comment, so REGION opens mid-comment; drop
# everything through the banner's closing */ first, then strip any remaining comments.
_after_banner = REGION.split("*/", 1)[1] if "*/" in REGION else REGION
REGION_CODE = re.sub(r"/\*.*?\*/", "", _after_banner, flags=re.S)


def test_dedicated_region_exists_at_end():
    assert REGION_MARKER in CSS, "scrollbar region banner missing"
    # It must be near the END of the file (a NEW end-region, not interleaved).
    idx = CSS.index(REGION_MARKER)
    assert idx > len(CSS) * 0.95, "region is not at the end of style.css"


def test_targets_kit_scroll_container():
    assert ".ow-window .ow-body::-webkit-scrollbar" in REGION
    assert ".ow-window .ow-body::-webkit-scrollbar-thumb" in REGION


def test_thin_thumb():
    # webkit box ~8-9px (thin pill); FF scrollbar-width: thin.
    assert re.search(r"--ow-sb-size:\s*[89](\.\d+)?px", REGION)
    assert "scrollbar-width: thin" in REGION


def test_rounded_pill():
    # radius is ~half the box (a pill).
    assert "--ow-sb-radius" in REGION
    assert re.search(r"border-radius:\s*var\(--ow-sb-radius\)", REGION)


def test_translucent_neutral_thumb_no_accent():
    # thumb is a NEUTRAL mid-grey with alpha (reads on both light and dark glass) — the
    # authentic macOS overlay behaviour, not theme-ink. One grey token, translucent.
    assert re.search(r"--ow-sb-grey:\s*\d+,\s*\d+,\s*\d+", REGION)
    assert re.search(r"--ow-sb-thumb:\s*rgba\(var\(--ow-sb-grey\),\s*0?\.\d+\)", REGION)
    # the grey is genuinely neutral (R==G==B).
    m = re.search(r"--ow-sb-grey:\s*(\d+),\s*(\d+),\s*(\d+)", REGION)
    assert m and m.group(1) == m.group(2) == m.group(3), "thumb grey must be neutral (R==G==B)"
    # NO accent hue in the actual rules (the glass is colorless; comments may name the
    # --red bar this region overrides).
    assert "--red" not in REGION_CODE
    assert "--accent" not in REGION_CODE
    assert "var(--blue" not in REGION_CODE


def test_transparent_track_no_solid():
    # the track / corner are transparent (no solid slab).
    assert re.search(r"::-webkit-scrollbar-track[^{]*\{[^}]*background:\s*transparent", REGION, re.S)
    assert re.search(r"::-webkit-scrollbar-corner", REGION)


def test_overlay_no_reserved_gutter():
    # overlay where supported + explicitly do NOT reserve track width.
    assert "overflow: overlay" in REGION
    assert re.search(r"scrollbar-gutter:\s*auto", REGION)


def test_firefox_scrollbar_color_thumb_transparent():
    assert re.search(r"scrollbar-color:\s*var\(--ow-sb-thumb\)\s+transparent", REGION)
    # the FF rules MUST be gated to non-webkit engines so Chromium keeps the ::-webkit
    # treatment (setting scrollbar-width on the same element makes Chromium drop the pseudo).
    assert "@supports not selector(::-webkit-scrollbar)" in REGION


def test_auto_hide_reveal_classes():
    # hidden at rest, revealed by the JS-driven .ow-scrolling class. The auto-hide is driven
    # by background-color (Chromium ignores opacity on the scrollbar pseudo) — transparent at
    # rest, grey when .ow-scrolling. opacity is kept as a belt for engines that honour it.
    assert re.search(r"::-webkit-scrollbar-thumb\s*\{[^}]*background-color:\s*transparent", REGION, re.S)
    assert re.search(r"::-webkit-scrollbar-thumb\s*\{[^}]*opacity:\s*0", REGION, re.S)
    assert re.search(r"\.ow-body\.ow-scrolling::-webkit-scrollbar-thumb\s*\{[^}]*background-color:\s*var\(--ow-sb-thumb\)", REGION, re.S)
    assert "opacity: 1" in REGION


def test_hover_expand_widen_darken():
    # hover over the thumb widens + darkens it (the macOS expand affordance).
    assert ".ow-body.ow-scroll-hover::-webkit-scrollbar" in REGION
    assert "--ow-sb-size-hover" in REGION
    assert "--ow-sb-thumb-hover" in REGION


def test_reduced_motion_and_transparency():
    assert "prefers-reduced-motion" in REGION
    assert re.search(r"prefers-reduced-motion[^}]*transition:\s*none", REGION, re.S)
    assert "prefers-reduced-transparency" in REGION
    # under reduced transparency the thumb gets MORE opaque (higher alpha on the grey).
    assert re.search(r"prefers-reduced-transparency.*--ow-sb-thumb:\s*rgba\(var\(--ow-sb-grey\),\s*0\.7", REGION, re.S)


# ── JS module ──

def test_js_module_present_and_iife():
    assert "orwellScrollbars" in JS or "ow-scrolling" in JS
    assert "ow-scrolling" in JS
    assert "ow-scroll-hover" in JS


def test_js_wires_reveal_idle_and_hover():
    # a scroll listener that reveals + a debounced idle fade-out + pointer hover/expand.
    assert "'scroll'" in JS or '"scroll"' in JS
    assert "setTimeout" in JS and "IDLE_MS" in JS
    assert "pointerenter" in JS
    assert "pointerleave" in JS
    assert "pointermove" in JS


def test_js_targets_kit_body_and_observes_new():
    assert ".ow-window .ow-body" in JS
    assert "MutationObserver" in JS


def test_js_loaded_after_window_kit_in_shell():
    assert "orwellScrollbars.js" in INDEX, "module not included in the served shell"
    # it must load AFTER the window kit so the .ow-body bodies exist when it scans.
    assert INDEX.index("orwellWindow.js") < INDEX.index("orwellScrollbars.js")
