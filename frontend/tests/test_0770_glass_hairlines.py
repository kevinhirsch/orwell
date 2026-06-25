"""#770 — kill the persistent white hairlines + the stray red stroke on glass chrome.

Issue #770: #760 only scoped the COMPOSER, but the SHARED chrome-glass rule still drew a
hard white ruled line on every other glass surface — below window titlebars, under "Orwell"
in the sidebar, around decision cards/gadgets — plus a stray red/accent stroke (the gadget
header focus outline + the decision "Continue" border + rag/search red border-lefts).

Root cause (render-diff confirmed, see the agent report): the winning shared chrome rim rule
set `border-color: rgba(255,255,255,0.55)` + `box-shadow: inset 0 1px 0 rgba(255,255,255,0.65)`,
which resolves to a HARD WHITE RULED LINE on a light wallpaper. Apple's lit glass edge is a SOFT
luminous highlight, NEVER a visible ruled line (docs/design/liquid-glass/LIQUID_GLASS_REFERENCE.md
§6 "a thin highlight that responds to geometry" + README "soft luminous edges").

The fix is at the SOURCE: one canonical subtle-white edge token (--ow-glass-rim ≈ 0.12) shared
by every glass chrome surface, and a no-accent-on-STROKES contract (system-blue focus ring /
neutral hairline borders) sibling to the existing no-accent-on-TEXT contract.

Source-pinned (the FE has no DOM runtime in pytest; the browser-smoke + responsive-matrix gates
cover the live DOM). Roles only, no names, no engine/network.
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


CSS = _read("static", "style.css")


def _white_rim_alphas(block: str):
    """Every white inset-rim alpha (rgba(255,255,255,A)) in a CSS block."""
    return [float(a) for a in re.findall(r"rgba\(255,\s*255,\s*255,\s*([0-9.]+)\)", block)]


# ── The canonical subtle rim token ────────────────────────────────────────────

def test_canonical_rim_token_is_a_subtle_fixed_white():
    # --ow-glass-rim / --ow-glass-rim-border are the ONE soft luminous edge, fixed white,
    # well below a hard-line alpha and NOT --fg-dependent.
    rim = re.search(r"--ow-glass-rim:\s*rgba\(255,\s*255,\s*255,\s*([0-9.]+)\)", CSS)
    border = re.search(r"--ow-glass-rim-border:\s*rgba\(255,\s*255,\s*255,\s*([0-9.]+)\)", CSS)
    assert rim and border, "missing the #770 canonical --ow-glass-rim / --ow-glass-rim-border tokens"
    assert float(rim.group(1)) <= 0.16, "rim token too bright — reads as a hard line"
    assert float(border.group(1)) <= 0.16, "border token too bright — reads as a hard line"
    # NOT --fg-dependent (that was the original-issue failure mode on light surfaces).
    assert "var(--fg)" not in rim.group(0) and "var(--fg)" not in border.group(0)


# ── The shared chrome rim no longer draws a hard white line ────────────────────

def _shared_chrome_rim_block():
    # The winning rule lives in the prefers-reduced-transparency:no-preference media block,
    # anchored by the #770 fix comment.
    idx = CSS.index("#770: the light-glass rim")
    # the rule is the {...} immediately containing that comment
    start = CSS.rfind("{", 0, idx)
    end = CSS.index("}", idx)
    return CSS[start:end + 1]


def test_shared_chrome_rim_is_softened_not_a_hard_white_rule():
    block = _shared_chrome_rim_block()
    # the over-bright literals MUST be gone from the winning rule
    assert "rgba(255,255,255,0.65)" not in block, "0.65 hard top rim still present on the shared rule"
    assert "rgba(255,255,255,0.55)" not in block, "0.55 hard border still present on the shared rule"
    assert "rgba(255, 255, 255, 0.65)" not in block
    assert "rgba(255, 255, 255, 0.55)" not in block
    # it now uses the canonical subtle edge token
    assert "var(--ow-glass-rim)" in block and "var(--ow-glass-rim-border)" in block
    # any literal white alpha left in the block stays subtle
    for a in _white_rim_alphas(block):
        assert a <= 0.16, f"shared chrome rim still has a hard-line alpha ({a})"


def _strip_css_comments(css: str) -> str:
    return re.sub(r"/\*.*?\*/", "", css, flags=re.S)


def test_no_remaining_0_65_or_0_55_glass_chrome_rim_anywhere():
    # belt-and-braces: the over-bright literals are retired specifically as EDGE STROKES —
    # i.e. as an `inset` box-shadow rim OR a `border*-color` (the two hard-line vectors).
    # Text-shadows / background fills at the same alpha are not edges and are left alone.
    # Comments (which merely describe the OLD behavior) are stripped first.
    css = _strip_css_comments(CSS)
    edge_patterns = [
        r"inset[^;,]*rgba\(255,\s*255,\s*255,\s*0\.(65|55)\)",         # inset rim
        r"border(?:-(?:top|bottom|left|right))?-color:[^;]*"
        r"rgba\(255,\s*255,\s*255,\s*0\.(65|55)\)",                    # hard border stroke
    ]
    for pat in edge_patterns:
        for m in re.finditer(pat, css, re.S):
            ctx = css[max(0, m.start() - 400):m.start()]
            assert ".send-btn" in ctx, (
                "a hard 0.65/0.55 white EDGE stroke survives outside the sanctioned send-btn "
                f"hover (near: ...{css[max(0,m.start()-20):m.start()+60]!r})"
            )


def test_minimized_dock_and_thinking_pill_use_the_soft_rim():
    # the iOS-dock + the thinking pill both moved off the bright (--fg 0.55 / white 0.65) rim.
    dock = re.search(r"#minimized-dock\.ow-has-rows\s*\{[^}]*var\(--ow-glass-rim\)[^}]*\}", CSS, re.S)
    assert dock, "minimized-dock rim not on the canonical soft token"
    # the FROSTED thinking GLASS PILL specifically — the rule that carries the box-shadow rim
    # (a bare `.thinking-section { display:none }` game-build rule + the prefers-contrast a11y
    # rule, which legitimately uses a --fg contrasting border, also match a looser pattern).
    think = None
    for m in re.finditer(r"body\.theme-frosted\s+\.thinking-section\s*\{([^}]*)\}", CSS, re.S):
        if "box-shadow" in m.group(1):
            think = m.group(0)
            break
    assert think, "could not find the frosted thinking-pill glass rule (with box-shadow)"
    assert "var(--ow-glass-rim" in think, "thinking pill rim not softened to the canonical token"
    assert "rgba(255,255,255,0.65)" not in think


# ── The chatbar middle: no internal divider between the two rows ───────────────

def test_chatbar_rows_carry_no_internal_divider():
    # the textarea row (.chat-input-top) and toolbar row (.chat-input-bottom) must define
    # NO border / box-shadow — nothing may draw a hard line across the MIDDLE of the bar.
    for sel in (".chat-input-top", ".chat-input-bottom"):
        m = re.search(re.escape(sel) + r"\s*\{[^}]*\}", CSS, re.S)
        assert m, f"missing {sel} rule"
        body = m.group(0)
        assert "border:" not in body and "border-bottom" not in body and "border-top" not in body, \
            f"{sel} draws a border — a hard line could cut the chatbar middle"
        assert "box-shadow" not in body, f"{sel} draws a box-shadow divider in the chatbar middle"


def test_composer_inline_icon_buttons_ride_the_bar_no_own_rim():
    # render-diff showed the composer icon buttons (class "input-icon-btn tool-indicator")
    # were matched by the shared chrome rule's `.tool-indicator`, so each carried the panel
    # rim/border — lined up, those top rims read as a faint line across the MIDDLE of the bar.
    # They must ride the bar glass (no own edge) under the glass theme.
    seg = CSS[CSS.index("#770 composer-MIDDLE line"):]
    m = re.search(
        r"body\.theme-frosted\s+\.chat-input-bar\s+\.input-icon-btn[^{]*\{([^}]*)\}",
        seg, re.S,
    )
    assert m, "missing the #770 composer inline-icon-button rim strip"
    body = m.group(1)
    assert "box-shadow: none" in body, "composer icon buttons still carry a box-shadow rim"
    assert "border-color: transparent" in body, "composer icon buttons still carry a border stroke"


# ── No accent HUE on glass-chrome STROKES (#770 + ruling #729) ─────────────────

def _no_accent_strokes_block():
    idx = CSS.index("#770: NO accent HUE on glass-chrome STROKES")
    end = CSS.index("#759:", idx)
    return CSS[idx:end]


def test_glass_focus_rings_are_system_blue_not_accent_red():
    block = _no_accent_strokes_block()
    # the gadget header focus outline (and on-card focus) go to the ONE system-blue ring.
    assert "og-head:focus-visible" in block
    assert "var(--ow-ios-blue" in block
    # the focus rule sets outline-color to system-blue, never the theme accent/red.
    focus = re.search(r":focus-visible[^{]*\{[^}]*\}", block, re.S)
    assert focus and "var(--ow-ios-blue" in focus.group(0)
    assert "var(--red)" not in focus.group(0) and "var(--accent" not in focus.group(0)


def test_glass_chrome_borders_neutralize_red_accent_strokes():
    block = _no_accent_strokes_block()
    # the decision "Continue" border + rag/search red border-lefts become a neutral hairline.
    assert ".on-card.on-continue" in block
    assert ".rag-source-item" in block and ".search-status" in block
    border_rule = re.search(r"\.on-card\.on-continue[^{]*\{[^}]*\}", block, re.S)
    assert border_rule, "missing the on-continue / rag / search border neutralization"
    assert "var(--ow-glass-rim-border)" in border_rule.group(0)
    # no accent hue introduced by the neutralization itself
    assert "var(--red)" not in border_rule.group(0) and "var(--accent" not in border_rule.group(0)
