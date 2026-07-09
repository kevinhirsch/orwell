"""#738 item #19 — APCA + OKLCH increment on adaptiveGlass (SHIP-FIRST).

Item #19 extends the #744/#738-1 received-transcript legibility increment in three ways, all
source-pinned here (convention checks, not live render — the live proof is
scripts/browser_smoke.py's #744 / #738-1 blocks, which measure `data-apca-lc` per bubble):

  1. FLOOR-HARDENING is ABSOLUTE. The existing polarity-flip + per-bubble scrim escalation
     (#744) and stronger-polarity fallback (#738-1) can, over a badly starved mid-tone, still
     leave the BEST polarity below the APCA floor at the scrim cap. Item #19 adds a further
     escalate/clamp step — push the ink toward its polarity extreme, then clamp the scrim SOLID
     as a last resort — so the floor is ALWAYS met. The floor is non-negotiable.
  2. A Safari `contrast-color()` PROGRESSIVE-ENHANCEMENT branch, feature-detected via
     `CSS.supports`, hands the ink pick to the browser where available and falls back to the
     existing JS APCA computation everywhere else.
  3. OKLCH is considered for the scrim/ink mix but DEFERRED: the browser composites the frost
     fill in sRGB, so the JS estimate must stay sRGB to remain faithful to what renders. The
     composite stays byte-identical (no regression).

These are additive to #744/#738-1 — the existing gates (test_0744_transcript_legibility.py,
test_adaptive_glass.py) must stay green.
"""

import re
from pathlib import Path

import pytest

FRONTEND = Path(__file__).resolve().parents[1]
ADAPTIVE = FRONTEND / "static" / "js" / "adaptiveGlass.js"


@pytest.fixture(scope="module")
def js():
    return ADAPTIVE.read_text(encoding="utf-8")


# ── 1. Absolute floor-hardening (the non-negotiable guarantee) ────────────────

def test_hardening_step_is_factored(js):
    """A dedicated harden step exists — escalating the ink toward its polarity extreme against
    the resolved surface until the APCA floor is met."""
    assert "function _hardenToFloor" in js, \
        "a _hardenToFloor() step must exist (the further escalate/clamp beyond scrim escalation)"
    # it escalates the ink toward the polarity extreme (pure black / pure white).
    assert re.search(r"var target\s*=\s*dark\s*\?\s*\[0,\s*0,\s*0\]\s*:\s*\[255,\s*255,\s*255\]", js), \
        "harden must push the ink toward pure black (dark) / pure white (light)"
    # it keeps climbing while below the floor and stops once cleared.
    assert re.search(r"lc\s*>=\s*APCA_FLOOR", js), \
        "harden must stop once |Lc| >= APCA_FLOOR"


def test_solid_scrim_is_the_last_resort_backstop(js):
    """When even the pure-extreme ink can't clear the floor over a starved mid-tone, the scrim
    clamps fully SOLID so the ink sits on the frost tint alone — a guaranteed terminator. The
    floor is non-negotiable; at the very edge the glass look yields to legibility."""
    assert re.search(r"SCRIM_SOLID\s*=\s*1(\.0)?\b", js), \
        "a SCRIM_SOLID = 1.0 last-resort clamp must exist"
    assert "a = SCRIM_SOLID" in js, \
        "harden must clamp the scrim to SCRIM_SOLID as the last resort"
    # SOLID must be a HARDER clamp than the normal escalation cap (it is only reached past it).
    solid = float(re.search(r"SCRIM_SOLID\s*=\s*([0-9.]+)", js).group(1))
    cap = float(re.search(r"SCRIM_MAX\s*=\s*([0-9.]+)", js).group(1))
    assert solid > cap, f"SCRIM_SOLID ({solid}) must be a harder clamp than SCRIM_MAX ({cap})"


def test_resolve_bubble_scrim_invokes_the_harden_step(js):
    """resolveBubbleScrim must run the harden step when the best polarity still misses the floor
    — AFTER the existing stronger-polarity fallback (#738-1), not instead of it."""
    tail = js[js.index("function resolveBubbleScrim"):]
    tail = tail[: tail.index("return { ink: ink, frostRgb: frost, scrimAlpha: a, lc: lc, dark: dark };")]
    # the #738-1 fallback (stronger polarity) still precedes the harden step …
    assert re.search(r"pref\.lc\s*<\s*APCA_FLOOR", tail), \
        "the #738-1 stronger-polarity fallback must remain"
    # … then the harden step fires on the FINAL best `lc` if it is still short.
    assert re.search(r"if\s*\(\s*lc\s*<\s*APCA_FLOOR\s*\)\s*\{\s*\n\s*var hard\s*=\s*_hardenToFloor", tail), \
        "resolveBubbleScrim must call _hardenToFloor when the best polarity is still below the floor"


def test_apply_uses_the_hardened_ink_not_a_fixed_constant(js):
    """The received-bubble DARK branch must apply the RESOLVED (hardened) ink — byte-identical to
    INK_DARK in the common case, darker only when a starved mid-tone forced the harden. A fixed
    INK_DARK constant here would ignore the harden step (data-apca-lc would over-report)."""
    # the bubble dark branch drives the resolved s.ink (rgb of the hardened ink) …
    assert '"rgb(" + s.ink[0] + "," + s.ink[1] + "," + s.ink[2]' in js, \
        "the bubble dark branch must apply the resolved s.ink (hardening-aware), not a fixed constant"
    # INK_DARK stays #11151c so the common-case ink is byte-identical (17,21,28).
    assert re.search(r'INK_DARK\s*=\s*"#11151c"', js), \
        "INK_DARK must stay #11151c (the common-case ink is byte-identical to rgb(17,21,28))"


# ── 2. Safari contrast-color() progressive-enhancement branch ─────────────────

def test_contrast_color_branch_is_feature_detected(js):
    """The Safari contrast-color() path is feature-detected via CSS.supports and cached — never
    assumed present."""
    assert "function supportsContrastColor" in js, "a supportsContrastColor() detector must exist"
    assert re.search(r'CSS\.supports\(\s*"color"\s*,\s*"contrast-color\(', js), \
        "the detector must use CSS.supports('color', 'contrast-color(...)')"


def test_contrast_color_is_used_for_ink_when_supported(js):
    """Where supported, the ink is set to contrast-color() against the resolved surface (the frost
    composited over the wallpaper) — the native max-contrast pick."""
    assert '"contrast-color(rgb(" + _surf[0]' in js, \
        "the ink must be contrast-color(rgb(<surface>)) when supported"
    # the surface handed to contrast-color is the composited scrim surface (same input as APCA).
    assert re.search(r"_surf\s*=\s*compositeOver\(s\.frostRgb,\s*s\.scrimAlpha,\s*bg\)", js), \
        "contrast-color must be measured against the same composited surface the APCA floor uses"


def test_contrast_color_falls_back_to_js_apca_ink(js):
    """Everywhere contrast-color() is absent, the module falls back to the JS-resolved ink — the
    APCA computation stays the fallback path (never removed)."""
    # the ternary keeps a null when unsupported, and the dark branch applies s.ink in that case.
    assert "supportsContrastColor()" in js and '? "contrast-color(rgb("' in js, \
        "contrast-color must be gated behind supportsContrastColor() with a null (fallback) branch"
    assert ': null;' in js, "the contrast-color ternary must yield null (the fallback signal) when unsupported"
    assert '_ccInk || ("rgb(" + s.ink' in js, \
        "the dark branch must fall back to the JS-resolved s.ink when contrast-color is unsupported"
    # the JS APCA helper is still present and load-bearing (the fallback engine).
    assert "function apcaContrast" in js, "the JS APCA helper (the fallback path) must remain"


def test_contrast_color_never_replaces_the_scrim_or_halo(js):
    """contrast-color() only picks the INK — the per-bubble scrim escalation + halo stay JS-driven
    (contrast-color can't escalate a scrim). No regression to the floor machinery."""
    # the scrim var is still driven from the JS-resolved alpha regardless of contrast-color.
    assert re.search(r'setProperty\("--ai-scrim-alpha",\s*s\.scrimAlpha', js), \
        "the per-bubble scrim alpha must stay JS-driven (contrast-color does not touch it)"


# ── 3. OKLCH considered, deferred, byte-identical sRGB composite ──────────────

def test_composite_stays_srgb_oklch_deferred(js):
    """OKLCH was considered for the scrim/ink mix but DEFERRED — the browser composites the frost
    fill in sRGB, so the JS estimate must mirror that space to stay faithful to what renders. The
    composite must remain a plain sRGB src-over blend (byte-identical, no regression)."""
    # the composite math is the straight sRGB src-over blend: tint*a + backdrop*(1-a) per channel.
    assert re.search(r"tint\[0\]\s*\*\s*a\s*\+\s*backdrop\[0\]\s*\*\s*\(1\s*-\s*a\)", js), \
        "compositeOver must stay a plain sRGB src-over blend (tint*a + backdrop*(1-a))"
    # the deferral is documented so a future reader knows it was a deliberate call, not an omission.
    assert re.search(r"OKLCH[^\n]*(deferred|Deferred)", js) or re.search(r"(deferred|Deferred)[^\n]*OKLCH", js) \
        or "OKLCH mix was considered" in js, \
        "the OKLCH deferral rationale must be documented in adaptiveGlass.js"


# ── 4. Non-regression: the #744 / #738-1 machinery is intact ──────────────────

def test_existing_744_and_738_1_machinery_intact(js):
    """Item #19 is ADDITIVE — the #744 escalation + #738-1 fallback + the Lc-60 floor stay."""
    assert re.search(r"APCA_FLOOR\s*=\s*60\b", js), "the APCA floor stays Lc 60"
    assert "function _escalateScrim" in js, "the #744 per-polarity scrim escalation stays"
    assert "function resolveBubbleScrim" in js, "the per-bubble scrim resolver stays"
    assert re.search(r"alt\.lc\s*>\s*pref\.lc", js), "the #738-1 stronger-polarity fallback stays"
    assert "SCRIM_STEP" in js and "SCRIM_MAX" in js, "the escalation band constants stay"
    assert 'BUBBLE_ADAPTIVE = ".msg-ai"' in js, "the adaptive bubble is still the received bubble only"
