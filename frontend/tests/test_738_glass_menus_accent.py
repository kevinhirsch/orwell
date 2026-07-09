"""#738 Liquid-Glass polish — two source-pinned CSS gates (the pytest lane has no DOM
runtime; live computed appearance is verified by the render-verify loop under Playwright —
these are the same source-pinned convention checks the other glass-chrome tests use).

ITEM 5 — Unify dropdown/popover menus onto light glass.
  The chat-header export popover (.export-dropdown-menu — Rename/Copy/PDF) and the
  per-message overflow menu (.msg-overflow-menu) still painted the dark, opaque
  `background: var(--panel)` fill, so they read as a DARK box in the light glass theme
  (body.theme-frosted). FIX: fold BOTH onto the ONE shared light-glass material like every
  other chrome popover (.dropdown / .overflow-menu / .cp-popover). DoD: no opaque-dark menu
  survives in the light theme.

ITEM 23 — Sent-bubble timestamp free of accent ink.
  The sent-bubble role line (the "You · time" cluster) carries a leading `.role::before`
  status dot. Its base fill is color-mix(var(--fg) 40%, transparent); on the glass theme
  --fg is the LIGHT-CYAN ink, so the dot rendered as a faint COLORED speck on the blue sent
  bubble beside the timestamp. FIX: under body.theme-frosted neutralize it to a translucent
  WHITE dot (the sanctioned white-on-blue treatment). DoD: the sent-bubble timestamp cluster
  carries no accent ink.
"""
import re
from pathlib import Path

FE = Path(__file__).resolve().parents[1]
CSS = (FE / "static" / "style.css").read_text(encoding="utf-8")

# The shared LIGHT-glass material token every folded chrome popover consumes.
LIGHT_GLASS_TOKEN = "--ow-glass-light-color"
# Accent tokens / house accent hue that must never ink the sent-bubble timestamp cluster.
ACCENT_TOKENS = ("var(--accent", "var(--red", "#c6613f", "#e06c75")


def _css_blocks(text: str, selector_literal: str):
    """All declaration blocks (selectors, body) whose selector LIST contains the literal."""
    out = []
    for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", text):
        if selector_literal in m.group(1):
            out.append((m.group(1).strip(), m.group(2)))
    return out


# ── ITEM 5 — the dark-opaque export/overflow popovers are folded onto light glass ──────
def test_export_popover_folded_onto_light_glass():
    """.export-dropdown-menu (the Rename/Copy/PDF popover) rides the shared light-glass
    material under body.theme-frosted — no dark opaque `var(--panel)` box in the light theme."""
    blocks = _css_blocks(CSS, ".export-dropdown-menu")
    frosted_material = [
        (sel, body) for sel, body in blocks
        if "theme-frosted" in sel and LIGHT_GLASS_TOKEN in body
    ]
    assert frosted_material, (
        "the export popover (Rename/Copy/PDF) is not folded onto the light-glass material "
        "under body.theme-frosted — a dark opaque menu would survive in the light theme (#738 item 5)"
    )


def test_msg_overflow_menu_folded_onto_light_glass():
    """The per-message overflow menu is the same dark-var(--panel) defect class; fold it too."""
    blocks = _css_blocks(CSS, ".msg-overflow-menu")
    frosted_material = [
        (sel, body) for sel, body in blocks
        if "theme-frosted" in sel and LIGHT_GLASS_TOKEN in body
    ]
    assert frosted_material, (
        ".msg-overflow-menu is not folded onto the light-glass material under "
        "body.theme-frosted (#738 item 5)"
    )


def test_no_dark_opaque_menu_survives_in_light_theme():
    """DoD belt: every menu we folded also has a light-theme rule (material + dark-ink) so no
    combination leaves it as the dark opaque base fill in the light theme."""
    for sel_literal in (".export-dropdown-menu", ".msg-overflow-menu"):
        frosted = [b for b in _css_blocks(CSS, sel_literal) if "theme-frosted" in b[0]]
        assert frosted, f"{sel_literal} has no body.theme-frosted (light-theme) rule at all"
        assert any(LIGHT_GLASS_TOKEN in body for _sel, body in frosted), (
            f"{sel_literal} has frosted rules but none apply the shared light-glass fill "
            f"({LIGHT_GLASS_TOKEN}) — it could still read dark in the light theme"
        )


def test_folded_menus_stay_out_of_the_refraction_corner_clip():
    """The two folded menus share the light-glass MATERIAL but are deliberately NOT in the
    JS SVG-refraction set (liquidGlass.js — only .dropdown/.overflow-menu/.cp-popover/
    .model-picker-menu refract), so they have no corner halo to clip and must stay OUT of the
    `overflow: hidden` corner-clip rule. That rule is a source-pinned 'exactly four refracted
    popovers' intent (test_liquid_glass.py::test_edge_bleed_clamp_menus_clip_backdrop_to_rounded_rect);
    adding them would both break that gate and needlessly clip a non-refracted menu."""
    clip = [
        (sel, body) for sel, body in _css_blocks(CSS, ".model-picker-menu")
        if "theme-frosted" in sel and "overflow: hidden" in body
    ]
    assert clip, "no body.theme-frosted overflow:hidden corner-clip rule for the leaf popovers"
    for menu in (".export-dropdown-menu", ".msg-overflow-menu"):
        for sel, _body in clip:
            assert menu not in sel, (
                f"{menu} must NOT be added to the SVG-refraction corner-clip — it isn't refracted, "
                f"and that rule is pinned to exactly the four refracted popovers (#738 item 5)"
            )


# ── ITEM 23 — the sent-bubble timestamp cluster carries no accent ink ──────────────────
def test_sent_bubble_role_dot_neutralized_under_frosted():
    """body.theme-frosted .msg-user .role::before is pinned to a neutral (white) fill so the
    leading status dot in the sent-bubble role line carries no colored/accent cast."""
    blocks = _css_blocks(CSS, ".msg-user .role::before")
    frosted = [(sel, body) for sel, body in blocks if "theme-frosted" in sel]
    assert frosted, (
        "no body.theme-frosted .msg-user .role::before rule — the sent-bubble dot keeps its "
        "color-mix(var(--fg) …) cyan cast on the glass theme (#738 item 23)"
    )
    for _sel, body in frosted:
        assert "background" in body, "the frosted sent-bubble dot rule sets no background"
        for tok in ACCENT_TOKENS:
            assert tok not in body, f"the frosted sent-bubble dot must carry no accent ink ({tok})"
        assert ("255,255,255" in body or "#fff" in body.lower()), (
            "the frosted sent-bubble dot should be a NEUTRAL white (matching the white-on-blue "
            "timestamp), not a hued fill"
        )


def test_sent_bubble_timestamp_cluster_has_no_accent_token():
    """Every rule that inks the sent-bubble timestamp cluster (.msg-user role-timestamp /
    timestamp / msg-time / role::before) is accent-free — accent must never be on text."""
    seen = False
    for literal in (
        ".msg-user .role-timestamp",
        ".msg-user .timestamp",
        ".msg-user .msg-time",
        ".msg-user .role::before",
    ):
        for sel, body in _css_blocks(CSS, literal):
            seen = True
            for tok in ACCENT_TOKENS:
                assert tok not in body, (
                    f"rule '{sel}' inks the sent-bubble timestamp cluster with accent ({tok}) "
                    f"— forbidden by the no-accent-on-text mandate (#738 item 23)"
                )
    assert seen, "no sent-bubble timestamp/dot rules found — selectors drifted"
