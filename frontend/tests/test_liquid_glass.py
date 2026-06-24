"""Liquid glass — SVG-refraction progressive enhancement (SOURCE-PINS).

Pins the wiring + the hard contracts that are easy to break by accident:
  1. the module exists and is LOADED in index.html (after the kit scripts);
  2. it FEATURE-DETECTS — Chromium gate + the `backdrop-filter: url(#x)` capability
     test — and is FAIL-SOFT (every apply path drops to the CSS glass on error);
  3. it carries the kube.io technique (feImage → feDisplacementMap with R/G channel
     selectors, a squircle edge profile, 128-neutral encoding);
  4. it EXCLUDES the gating #orwell-headshot dialog (stays opaque);
  5. the CSS blur-glass FALLBACK rules still exist in style.css — a regression guard
     so a future edit can't delete the baseline the SVG layer enhances.

The live visual behavior (edges refract over busy content, center stays crisp,
fallback intact) is proven by the Playwright screenshots captured in the PR.
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


JS = _read("static", "js", "liquidGlass.js")
INDEX = _read("static", "index.html")
CSS = _read("static", "style.css")


# ── 1. module exists + is loaded after the kits ───────────────────────────────

def test_module_file_exists_and_is_nonempty():
    assert len(JS) > 500


def test_module_loaded_in_index_after_the_kits():
    assert "liquidGlass.js" in INDEX
    # must load AFTER the window + gadget kits so .ow-*/.og-* surfaces exist.
    win = INDEX.index("orwellWindow.js")
    gad = INDEX.index("orwellGadget.js")
    lg = INDEX.index("liquidGlass.js")
    assert lg > win and lg > gad


# ── 2. feature-detection (Chromium gate) + fail-soft ──────────────────────────

def test_feature_detects_backdrop_filter_url_support():
    assert "CSS.supports" in JS
    assert 'backdrop-filter", "url(#x)"' in JS or "backdrop-filter','url(#x)'" in JS


def test_feature_detects_chromium_engine_and_excludes_firefox_safari():
    # Chrome-gate: include Chromium, exclude the engines that lie about support.
    assert "Firefox" in JS  # Gecko exclusion
    assert "Safari" in JS   # Safari exclusion
    assert re.search(r"Chrome\|Chromium\|CriOS", JS)


def test_unsupported_is_a_noop_marker_not_a_surface_touch():
    # On the unsupported path the module sets supported:false and must NOT clear or
    # set backdrop-filter on anything — the CSS glass stands untouched.
    assert "supported: false" in JS
    assert "function () {}" in JS  # the no-op refresh on the unsupported marker


def test_fail_soft_paths_drop_to_css_glass():
    # apply errors fall back to clearFrom (removes our override → CSS glass);
    # boot errors clearAll. Both wrapped in try/catch.
    assert "clearFrom(el)" in JS
    assert "clearAll()" in JS
    assert JS.count("catch (_)") >= 5  # pervasive fail-soft


# ── 3. the kube.io SVG-refraction technique is present ────────────────────────

def test_uses_feimage_and_fedisplacementmap_with_rg_channels():
    assert "feImage" in JS
    assert "feDisplacementMap" in JS
    assert 'xChannelSelector", "R"' in JS
    assert 'yChannelSelector", "G"' in JS
    assert '"in", "SourceGraphic"' in JS
    assert '"in2", "displacement_map"' in JS


def test_displacement_map_uses_squircle_edge_and_neutral_128():
    assert "squircle" in JS.lower()
    assert "SQUIRCLE_N" in JS
    # 128 = neutral displacement encoding (R=x, G=y).
    assert "128 + dr * 127" in JS
    assert "128 + dg * 127" in JS


def test_applied_via_backdrop_filter_url():
    assert "url(#" in JS
    assert "backdropFilter" in JS
    assert "webkitBackdropFilter" in JS


def test_tunable_constants_exist_at_top():
    for c in ("SCALE", "RADIUS", "EDGE", "SQUIRCLE_N"):
        assert re.search(r"var " + c + r"\s*=", JS), c


# ── 4. the gating dialog stays opaque (excluded) ──────────────────────────────

def test_orwell_headshot_is_excluded_from_refraction():
    assert "orwell-headshot" in JS
    assert "EXCLUDE_IDS" in JS


# ── perf posture: capped, ResizeObserver (not poll), debounced ────────────────

def test_perf_posture_capped_and_observer_based():
    assert "MAX_LIVE_SURFACES" in JS
    assert "ResizeObserver" in JS
    assert "DEBOUNCE" in JS
    # active only under the frosted theme.
    assert "theme-frosted" in JS


def test_reduced_motion_safe():
    assert "prefers-reduced-motion" in JS
    assert "SCALE_REDUCED" in JS


# ── 5. the CSS blur-glass FALLBACK must remain intact (regression guard) ───────

def test_css_blur_glass_baseline_still_exists():
    # The shipped frosted baseline the SVG layer enhances — these must NOT be
    # deleted by a future edit (non-Chrome relies entirely on them).
    assert "body.theme-frosted .ow-window" in CSS
    assert "body.theme-frosted .og-card" in CSS
    assert "body.theme-frosted .chat-input-bar" in CSS
    # the baseline uses a real backdrop blur (the fallback frost).
    assert re.search(r"body\.theme-frosted \.ow-window\s*\{[^}]*backdrop-filter:\s*blur", CSS, re.S)


def test_headshot_stays_opaque_in_css():
    # the gating dialog's opaque override survives (no refraction + no blur on it).
    assert "body.theme-frosted #orwell-headshot.ow-window" in CSS


# ── 6. Control-Center dock glass (scope: iOS Control Center) ───────────────────

def test_control_center_dock_is_glassed():
    # The minimized-window dock reads as an iOS Control-Center module grid: rounded
    # translucent glass shell + chip TILES in a wrapping row.
    assert "body.theme-frosted #minimized-dock.ow-has-rows" in CSS
    assert re.search(r"#minimized-dock\.ow-has-rows[^}]*backdrop-filter", CSS, re.S) \
        or re.search(r"#minimized-dock\.ow-has-rows[^}]*--ow-glass-backdrop", CSS, re.S)
    # chips become a wrapping tile grid (row + wrap), not a stacked list.
    assert re.search(r"#minimized-dock \.minimized-dock-rows[^}]*flex-wrap:\s*wrap", CSS, re.S)
    # the dock is a refraction target in the JS too.
    assert "minimized-dock" in JS


# ── 7. animated-bg default + reduced-motion gate (scope: alive backdrop) ───────

def test_game_build_default_theme_has_animated_bg():
    theme = _read("static", "js", "theme.js")
    # The default theme ships an animated canvas background so the glass has dynamic
    # content to refract (telescreen → perlin-flow). The fresh-session resolver must
    # apply the default theme's pattern (not drop to 'none').
    assert "DEFAULT_THEME = 'telescreen'" in theme
    assert "'telescreen': 'perlin-flow'" in theme
    # fresh session resolves the active theme's pattern, not 'none'.
    assert "THEME_DEFAULT_PATTERN[activeName]" in theme


def test_animated_bg_is_reduced_motion_gated():
    theme = _read("static", "js", "theme.js")
    # canvas patterns freeze to a STILL frame under reduced-motion (no dead bg, no motion).
    assert "_bgStaticInit" in theme
    assert "_prefersReducedMotion()" in theme


# ── 8. adaptive-contrast / always-readable text floor ─────────────────────────

def test_adaptive_contrast_tint_floor_exists():
    # text contrast is computed against the GLASS TINT (a min-opacity floor), not the
    # raw animated bg — the structural "always readable" guarantee.
    assert "--ow-glass-tint-floor" in CSS
    assert "--ow-glass-text-shadow" in CSS


def test_luminance_helper_available_for_contrast():
    # the existing WCAG luminance helpers (reused pattern) are present + exported.
    hexjs = _read("static", "js", "color", "hex.js")
    assert "relativeLuminance" in hexjs
    assert "contrastRatioFromLum" in hexjs
    assert "onAccentColor" in hexjs


# ── 9. Apple HIG accessibility trio (reduced-transparency / contrast) ──────────

def test_reduced_transparency_solid_fallback():
    # prefers-reduced-transparency → SOLID surfaces (no translucency/blur/refraction).
    assert "@media (prefers-reduced-transparency: reduce)" in CSS
    # the solid fallback drops backdrop-filter to none under that query.
    block = CSS[CSS.index("@media (prefers-reduced-transparency: reduce)"):]
    assert "backdrop-filter: none" in block[:1200]
    # the JS ALSO bails (no inline filter that would defeat the CSS solid fallback).
    assert "reducedTransparency" in JS
    assert "prefers-reduced-transparency" in JS


def test_increased_contrast_bumps_the_floor():
    assert "@media (prefers-contrast: more)" in CSS
    block = CSS[CSS.index("@media (prefers-contrast: more)"):]
    assert "--ow-glass-tint-floor" in block[:600]


# ── 10. Apple HIG visual language (concentric radii, luminous edge, float) ─────

def test_apple_language_tokens_present():
    assert "--ow-glass-radius" in CSS          # very-rounded surface radius
    assert "--ow-glass-radius-inner" in CSS    # concentric inner-control radius
    assert "--ow-glass-edge" in CSS            # luminous edge highlight
    assert "--ow-glass-float" in CSS           # soft outer float shadow


def test_functional_layer_only_content_not_glassed():
    # Apple: glass is the chrome layer; content/messages stay opaque. Guard that the
    # chat message bubbles are NOT in the frosted glass selectors.
    # (The only 'message' hit must be the composer textarea#message, which is chrome.)
    frosted_lines = [ln for ln in CSS.splitlines()
                     if "theme-frosted" in ln and ("message" in ln.lower() or "bubble" in ln.lower())]
    for ln in frosted_lines:
        assert "textarea#message" in ln, f"content surface glassed: {ln}"
    # the JS refraction selectors never target message/bubble content.
    assert ".message" not in JS and ".bubble" not in JS


# ── 11. typography legibility on glass (no thin weights) ───────────────────────

def test_no_thin_font_weights_on_glass():
    # Apple HIG Typography: floor glass text at Regular (400); clamp stray thin weights.
    assert "font-weight: 400" in CSS
    assert 'font-weight:300' in CSS  # the clamp targets stray inline thin weights


# ── 12. perf: mobile element cap (scope: mobile-friendly) ──────────────────────

def test_mobile_hard_caps_refracted_count():
    assert "MAX_LIVE_SURFACES_MOBILE" in JS
    assert "activeMaxSurfaces" in JS
    # the mobile cap is strictly lower than desktop.
    m_desktop = int(re.search(r"MAX_LIVE_SURFACES\s*=\s*(\d+)", JS).group(1))
    m_mobile = int(re.search(r"MAX_LIVE_SURFACES_MOBILE\s*=\s*(\d+)", JS).group(1))
    assert m_mobile < m_desktop


# ── 13. Apple-parity material: luminous (not darkening) + specular + float ──────

def test_glass_material_is_luminous_not_a_dark_slab():
    # Apple's regular glass is LIGHT/LUMINOUS: a luminous white-ish wash + a backdrop
    # brightness LIFT, not a heavy dark tint. The dark tint floor must be modest.
    assert "--ow-glass-lumin" in CSS
    floor = int(re.search(r"--ow-glass-tint-floor:\s*(\d+)%", CSS).group(1))
    assert floor <= 30, f"tint floor too heavy ({floor}%) — glass would read as a dark slab"
    # the backdrop filter lifts luminosity (brightness > 1.2 = a real lift).
    m = re.search(r"--ow-glass-backdrop:\s*[^;]*brightness\(([\d.]+)\)", CSS)
    assert m and float(m.group(1)) >= 1.2, "backdrop brightness lift too weak for luminous glass"


def test_specular_highlight_reads_as_a_light_source():
    # a top-left specular sheen (radial-gradient) + a bright thin top rim, not a flat border.
    assert "radial-gradient(120% 80% at 18% 0%" in CSS  # the top-left light source
    # the rim/bloom inset shadows (the specular catch + the bloom).
    assert re.search(r"inset 8px 10px 22px -12px", CSS)  # top-left bloom


def test_soft_outer_float_shadow_is_genuine_elevation():
    m = re.search(r"--ow-glass-float:\s*([^;]+);", CSS)
    assert m
    # a wide soft ambient shadow (>= ~40px blur) = real elevation off the content.
    blurs = [int(x) for x in re.findall(r"\d+px\s+(\d+)px", m.group(1))]
    assert blurs and max(blurs) >= 40, "float shadow too tight to read as elevation"


# ── 14. Fluid morph on interaction (Apple: controls come to life) ──────────────

def test_controls_morph_on_hover_and_press():
    # glass controls lighten + lift on hover, depress on press — reduced-motion gated.
    assert "Fluid morph on interaction" in CSS
    assert "translateY(-1px) scale(1.015)" in CSS   # hover lift
    assert "scale(0.97)" in CSS                       # press depress
    # reduced-motion strips the transition/transform.
    rm_blocks = re.findall(r"@media \(prefers-reduced-motion: reduce\)\s*\{(.*?)\n\}", CSS, re.S)
    assert any("transform: none" in b for b in rm_blocks)
