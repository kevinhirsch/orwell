"""HIG audit (2026-07-09) — F-CONTRAST-1 (P2): secondary `--fg-muted` text over glass.

Broadens #738 item 19 / the #744 received-transcript floor to the muted secondary text
(`--fg-muted`, de-facto #888) rendered over the fixed light glass — captions, gadget rows,
settings sub-labels. Under the glass theme adaptiveGlass stands the chrome DOWN (a fixed light
glass), so #744's per-bubble floor never reached that muted text; over a dark backdrop showing
through the 0.60 white fill, #888 drops well under a legible floor.

Source-pinned convention gates (the FE has no DOM runtime in this pytest lane). The LIVE proof —
that the resolved muted ink clears the APCA floor over a backdrop sweep — is in
`scripts/browser_smoke.py` (the F-CONTRAST-1 block), which calls `resolveMutedInk` and re-measures
APCA per backdrop. These gates freeze the mechanism so it can't silently regress.
"""
import re
from pathlib import Path

import pytest

FRONTEND = Path(__file__).resolve().parents[1]
ADAPTIVE = FRONTEND / "static" / "js" / "adaptiveGlass.js"
CSS = FRONTEND / "static" / "style.css"


@pytest.fixture(scope="module")
def js():
    return ADAPTIVE.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def css():
    return CSS.read_text(encoding="utf-8")


# ── the escalation logic (mirrors the received-bubble / hero floor) ───────────

def test_resolve_muted_ink_exists(js):
    assert "function resolveMutedInk" in js, \
        "a resolveMutedInk() must exist (the token-level muted-text floor)"


def test_muted_floor_constant_is_a_secondary_text_floor(js):
    """MUTED_FLOOR is the APCA secondary-text floor (Lc 45) — deliberately BELOW the body-prose
    bubble floor (Lc 60) so muted text stays de-emphasized, not promoted to full --fg."""
    m = re.search(r"MUTED_FLOOR\s*=\s*([0-9]+)", js)
    assert m, "a MUTED_FLOOR constant must exist"
    floor = int(m.group(1))
    assert floor == 45, f"MUTED_FLOOR should be the Lc 45 secondary-text floor (got {floor})"
    body = int(re.search(r"APCA_FLOOR\s*=\s*([0-9]+)", js).group(1))
    assert floor < body, f"the muted floor ({floor}) must stay below the body floor ({body})"


def test_muted_base_is_the_documented_888_fallback(js):
    """The escalation STARTS from #888 — the documented `--fg-muted` fallback — so the token only
    changes where #888 actually fails (preserves the visual design elsewhere)."""
    assert re.search(r"MUTED_BASE_RGB\s*=\s*\[136,\s*136,\s*136\]", js), \
        "MUTED_BASE_RGB must be [136,136,136] (#888, the de-facto --fg-muted fallback)"


def test_muted_measured_against_the_light_glass_surface(js):
    """The muted ink's true surface = the 0.60 white glass fill composited over the sampled
    backdrop — the SAME compositeOver the bubble floor uses, so the measurement is faithful."""
    assert re.search(r"GLASS_LIGHT_RGB\s*=\s*\[255,\s*255,\s*255\]", js), \
        "GLASS_LIGHT_RGB must be the [255,255,255] light-glass tint"
    assert re.search(r"GLASS_FILL_ALPHA\s*=\s*0\.60?\b", js), \
        "GLASS_FILL_ALPHA must be the kube 0.60 fill opacity"
    body = js[js.index("function resolveMutedInk"):]
    body = body[: body.index("return")]
    assert "compositeOver(GLASS_LIGHT_RGB, GLASS_FILL_ALPHA, bgRgb)" in body, \
        "resolveMutedInk must composite the glass fill over the backdrop (the real muted surface)"
    assert "apcaContrast(ink, surface)" in body, \
        "resolveMutedInk must measure APCA(muted ink ↔ composited surface)"


def test_muted_escalates_toward_fg_not_a_fixed_darkening(js):
    """The sanctioned fix is 'promote --fg-muted toward --fg'. The escalation must move the ink
    toward the passed `fgRgb`, and only WHILE it is below the floor (so a clearing #888 is left
    alone — `floored` stays false)."""
    body = js[js.index("function resolveMutedInk"): js.index("function _readVarRgb")]
    assert re.search(r"fgRgb\[0\]\s*-\s*ink\[0\]", body), \
        "resolveMutedInk must interpolate the ink toward fgRgb (promote toward --fg)"
    assert re.search(r"lc\s*<\s*MUTED_FLOOR", body), \
        "the escalation loop must be gated on lc < MUTED_FLOOR"
    assert "floored = true" in body and "floored: floored" in body, \
        "resolveMutedInk must report `floored` (false ⇒ #888 already clears ⇒ design untouched)"


# ── applied ONCE at the token level; chrome keeps standing down ───────────────

def test_token_floor_applied_under_glass_theme(js):
    """_floorMutedToken sets `--fg-muted` on <html> — one token for the theme, ONLY when #888
    misses the floor (otherwise the override is removed so the base design stands)."""
    assert "function _floorMutedToken" in js, "a _floorMutedToken() applier must exist"
    body = js[js.index("function _floorMutedToken"): js.index("function _clearMutedToken")]
    assert 'setProperty("--fg-muted"' in body, "it must drive the --fg-muted token"
    assert "m.floored" in body and 'removeProperty("--fg-muted")' in body, \
        "it must ONLY override when floored, else remove the override (preserve the design)"
    assert 'setAttribute("data-muted-apca-lc"' in body, \
        "it must expose data-muted-apca-lc (the browser-smoke probe hook)"
    # it is invoked from the frosted branch of pass().
    assert "_floorMutedToken();" in js, "pass() must call _floorMutedToken() under the glass theme"


def test_token_cleared_on_standdown(js):
    """When adaptiveGlass stands down — no glass theme, or Increase Contrast — the JS override is
    dropped so the static CSS backstop / base value governs."""
    assert "function _clearMutedToken" in js, "a _clearMutedToken() must exist"
    # prefers-contrast standdown clears the token …
    assert re.search(r"prefersContrast\(\)\)\s*\{\s*_dropTagged\(null\);\s*_clearMutedToken\(\)", js), \
        "the prefers-contrast standdown must clear the muted token"
    # … and so does the no-glass-theme full standdown.
    tail = js[js.index("No glass theme"):]
    assert "_clearMutedToken();" in tail[:200], \
        "the no-glass-theme standdown must clear the muted token too"


def test_muted_helpers_exposed_on_the_api(js):
    """resolveMutedInk + MUTED_FLOOR are on window.OrwellAdaptiveGlass so the browser-smoke probe
    can measure the floor (mirrors resolveBubbleScrim/APCA_FLOOR)."""
    api = js[js.index("window.OrwellAdaptiveGlass = {"):]
    api = api[: api.index("}")]
    assert "resolveMutedInk: resolveMutedInk" in api, "resolveMutedInk must be exposed"
    assert "MUTED_FLOOR: MUTED_FLOOR" in api, "MUTED_FLOOR must be exposed"


# ── the static CSS backstop for the accessibility standdown paths ─────────────

def test_css_muted_backstop_for_standdown_media(css):
    """Under Increase Contrast / Reduce Transparency the adaptive JS stands down — a static floored
    `--fg-muted` keeps the guarantee, scoped to the glass theme so the normal path (JS-owned) is
    untouched."""
    # both a11y media set --fg-muted under body.theme-frosted.
    for media in ("prefers-contrast: more", "prefers-reduced-transparency: reduce"):
        pat = re.compile(
            r"@media\s*\(" + re.escape(media) + r"\)\s*\{\s*body\.theme-frosted\s*\{\s*--fg-muted:\s*#([0-9a-fA-F]{6})",
        )
        m = pat.search(css)
        assert m, f"a static --fg-muted backstop must exist under @media ({media}) body.theme-frosted"
        # and the backstop value must be visibly darker than the #888 base (a real floor, not a no-op).
        r = int(m.group(1)[0:2], 16)
        assert r < 136, f"the backstop --fg-muted (#{m.group(1)}) must be darker than #888 (a real floor)"


def test_backstop_is_scoped_to_glass_theme(css):
    """The backstop must NOT set --fg-muted globally (that would disturb the non-glass themes /
    the no-fallback inheriters) — only under body.theme-frosted."""
    # there is no bare `:root { --fg-muted: ... }` global override introduced by this change.
    assert not re.search(r":root\s*\{[^}]*--fg-muted\s*:", css), \
        "F-CONTRAST-1 must not define --fg-muted at :root (keep it scoped to the glass theme)"
