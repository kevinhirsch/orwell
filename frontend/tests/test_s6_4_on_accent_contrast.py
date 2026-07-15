"""S6-4 — luminance-aware on-accent text color (WCAG AA on accent CTAs).

White text on the brand red (#e06c75 ≈ 3.2:1) and on the per-house / user-
customizable accent fails WCAG AA (needs >=4.5:1 for normal text). The accent
(`--accent`, falling back to `--red`/#e06c75) is theme-set AND user-customizable
via the theme picker, so this CANNOT be fixed with a static color.

The fix: a luminance-aware `--on-accent` text-color token. `onAccentColor()` in
static/js/color/hex.js picks whichever of near-white / near-dark clears the
higher WCAG contrast against the resolved accent; it's set
  - statically in style.css :root (first-paint / SSR default for #e06c75),
  - by the early-paint head script in index.html (per saved theme, before JS),
  - by theme.js applyColors() (per theme / custom accent, the live path),
and the accent-backed CTAs consume `var(--on-accent, #fff)`.

This test pins the wiring AND recomputes the WCAG math so the default (and the
five house-theme accents) provably clear AA. Mirrors the source-pinned style of
test_wcag_polish_cluster.py + the contrast helpers in test_g4_visual_tokens.py.
"""
import os
import re

FE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# The default near-dark / near-white candidates — keep in lockstep with the
# ON_ACCENT_DARK / ON_ACCENT_LIGHT consts in static/js/color/hex.js.
ON_ACCENT_DARK = "#10151b"
ON_ACCENT_LIGHT = "#ffffff"
AA_NORMAL = 4.5


def _read(rel):
    with open(os.path.join(FE, rel), encoding="utf-8") as fh:
        return fh.read()


# ── WCAG relative luminance + contrast (sRGB) ────────────────────────────────

def _lum(hexstr):
    h = hexstr.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def _ratio(a, b):
    l1, l2 = sorted((_lum(a), _lum(b)), reverse=True)
    return (l1 + 0.05) / (l2 + 0.05)


def _on_accent(accent):
    """Mirror of onAccentColor(): the candidate with the higher contrast."""
    return ON_ACCENT_DARK if _ratio(accent, ON_ACCENT_DARK) > _ratio(accent, ON_ACCENT_LIGHT) else ON_ACCENT_LIGHT


# ── the math: the default --on-accent clears AA on the brand red ─────────────

def test_default_on_accent_clears_aa_against_brand_red():
    # The historical defect: white on the brand red is ~3.2:1 (fails AA).
    assert _ratio("#e06c75", ON_ACCENT_LIGHT) < AA_NORMAL, (
        "sanity: white-on-brand-red should be the failing baseline (~3.2:1)."
    )
    # The chosen default --on-accent (dark ink) must clear AA.
    ratio = _ratio("#e06c75", ON_ACCENT_DARK)
    assert ratio >= AA_NORMAL, (
        f"default --on-accent ({ON_ACCENT_DARK}) on brand red #e06c75 is {ratio:.2f}:1, "
        f"must be >= {AA_NORMAL}:1."
    )
    # And the luminance-aware picker must select that dark default for #e06c75.
    assert _on_accent("#e06c75") == ON_ACCENT_DARK


def test_on_accent_picker_clears_aa_for_every_builtin_theme_accent():
    """Pull every preset accent (the `red:` field) out of theme.js and confirm
    the luminance-aware pick clears AA — including the five HOUSE themes."""
    theme_js = _read("static/js/theme.js")
    accents = re.findall(r"red:\s*'(#[0-9a-fA-F]{6})'", theme_js)
    assert len(accents) >= 20, f"expected the full preset table, found {len(accents)} accents"
    # The five 0052 house-theme accents must be present (spot-check anchors).
    house = {"#ff3b30", "#56c8e8", "#d92e2e", "#e8b35a", "#c9a227"}
    assert house.issubset(set(accents)), (
        f"house-theme accents missing from theme.js: {house - set(accents)}"
    )
    failures = []
    for acc in set(accents):
        on = _on_accent(acc)
        r = _ratio(acc, on)
        if r < AA_NORMAL:
            failures.append((acc, on, round(r, 2)))
    assert not failures, f"accents whose on-accent pick fails AA: {failures}"


# ── the wiring: the token is defined, set on every accent path ───────────────

def test_root_default_on_accent_matches_the_dark_default():
    css = _read("static/style.css")
    m = re.search(r"--on-accent:\s*([^;]+);", css)
    assert m, ":root must define --on-accent (the first-paint / SSR default)."
    assert m.group(1).strip().lower() == ON_ACCENT_DARK, (
        f":root --on-accent must be the AA-clearing dark default {ON_ACCENT_DARK} for #e06c75."
    )


def test_theme_apply_sets_on_accent_from_the_luminance_helper():
    theme_js = _read("static/js/theme.js")
    assert "onAccentColor" in theme_js, "theme.js must import the luminance helper."
    assert re.search(r"setProperty\(\s*'--on-accent'\s*,\s*onAccentColor\(", theme_js), (
        "applyColors() must set --on-accent from onAccentColor(the resolved accent)."
    )


def test_head_script_sets_on_accent_on_first_paint():
    html = _read("static/index.html")
    assert "--on-accent" in html, (
        "the early-paint head script must set --on-accent before theme.js boots "
        "(so first paint is already AA)."
    )


def test_color_helper_exports_luminance_aware_on_accent():
    js = _read("static/js/color/hex.js")
    for sym in ("relativeLuminance", "contrastRatio", "onAccentColor", "ON_ACCENT_DARK", "ON_ACCENT_LIGHT"):
        assert sym in js, f"color/hex.js must export {sym}."


# ── the consumers: accent-backed CTAs read var(--on-accent) ──────────────────

def test_decision_card_ctas_use_on_accent_token():
    """The player's decision card — the most game-critical accent CTAs."""
    js = _read("static/js/orwellDecision.js")
    # both the confirm button and the selected option sit on the accent.
    assert "background: var(--accent, #e06c75); color: var(--on-accent, #fff)" in js, (
        ".odec-confirm must use var(--on-accent) on its accent background."
    )
    assert 'background: var(--accent, #e06c75); color: var(--on-accent, #fff); }' in js, (
        ".odec-opt[aria-pressed] (selected) must use var(--on-accent) on its accent background."
    )
    # the old hard white must be gone from the accent CTAs.
    assert "background: var(--accent, #e06c75); color: #fff" not in js


def test_css_accent_ctas_use_on_accent_token():
    """Key accent-backed CTAs in style.css read the token, not hard white."""
    css = _read("static/style.css")
    # The send button (background: var(--send-btn-bg, var(--red))).
    assert re.search(
        r"background:\s*var\(--send-btn-bg,\s*var\(--red\)\);\s*\n\s*color:\s*var\(--on-accent,\s*#fff\);",
        css,
    ), "the send button must use var(--on-accent) on its accent background."
    # The primary confirm dialog button.
    assert "background:var(--accent-primary, var(--red, #4a9eff)); color:var(--on-accent, #fff)" in css, (
        ".confirm-btn-primary must use var(--on-accent)."
    )
    # There should be many converted sites (the full accent-CTA sweep).
    assert css.count("var(--on-accent, #fff)") >= 40, (
        "expected the accent-backed CTA sweep to convert ~45 sites."
    )


def test_js_injected_accent_ctas_use_on_accent_token():
    """JS-injected accent-backed CTAs must read the token too, not the theme --bg as ink.
    The J2-17 remainder: the headshot 'Make AI studio portraits' CTA and the onboarding primary
    button (.ob-btn-primary) both painted `color: var(--bg)` on an accent background — not
    guaranteed AA (the bg<->accent contrast varies per theme; the audit measured ~3.29:1).
    #1638 total kit migration: like onboarding (#709), the headshot studio's CTAs no longer
    hand-roll an accent fill — they compose the element kit's .ow-btn-prominent (kit-owned,
    legible glass + flat styling), so there is no bespoke accent-backed headshot CTA to
    contrast-check here (the deleted .hs-btn accent fallback took the last one with it)."""
    hs = _read("static/js/orwellHeadshot.js")
    assert "ow-btn ow-btn-prominent" in hs, (
        "the headshot studio's primary CTAs ('Make AI studio portraits' / 'Use this one') must "
        "compose the element kit's .ow-btn-prominent."
    )
    assert "background: var(--brand-color, var(--accent, #4a9)); color: var(--on-accent" not in hs, (
        "the bespoke .hs-btn accent fill was removed in the #1638 kit migration — the kit owns "
        "the accent-CTA chrome + label legibility now."
    )
    # #709: the onboarding primary CTA no longer hand-rolls an accent fill — it composes the element
    # kit's .ow-btn-prominent (kit-owned, legible glass styling), and the modal is RECREATED on the
    # OrwellWindow kit. So there is no bespoke accent-backed onboarding CTA to contrast-check here, and
    # NO red anywhere in the overlay (the kit chrome is colorless).
    ob = _read("static/js/orwellOnboarding.js")
    assert "ow-btn-prominent" in ob, (
        "the onboarding primary CTA must compose the element kit's .ow-btn-prominent."
    )
    assert "var(--red, #e06c75)" not in ob, "no red accent may survive in the kit-rebuilt overlay."
    # the old dark-on-accent anti-pattern (color: var(--bg)) must be gone from the headshot CTA too.
    assert "var(--accent, #4a9)); color: var(--bg" not in hs


def test_non_accent_white_ctas_are_left_alone():
    """Guard against over-reach: white text on NON-accent backgrounds
    (semantic danger / recording / dark image overlays) must stay white."""
    css = _read("static/style.css")
    # danger/error/recording buttons keep white on their own semantic bg.
    # #1605: --color-danger is now the system red #ff453a (white ~3.4:1, fails AA on a
    # solid fill), so the solid danger BUTTON uses the AA-safe darker pair
    # --color-danger-strong — still WHITE text (not rewritten to dark --on-accent ink),
    # which is what this guard protects.
    assert "background:var(--color-danger-strong); color:#fff" in css, (
        ".confirm-btn-danger (semantic danger bg) must keep white text (via the AA-safe "
        "--color-danger-strong), NOT be rewritten to --on-accent."
    )
    assert re.search(r"background:\s*var\(--color-error\);[^}]*\n?\s*color:\s*#fff", css) or \
        "background: var(--color-error)" in css and "color: #fff" in css, (
        "semantic-error backgrounds keep white text."
    )
    # an image-overlay control on rgba(0,0,0,…) keeps white.
    assert "background: rgba(0, 0, 0, 0.55);" in css, "sanity: dark-overlay rule present"
