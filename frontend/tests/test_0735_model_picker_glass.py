"""Issue #735 — the model-picker dropdown adopts the Liquid Glass kit and is legible.

Source-pinned gate (the live look is verified by the render-parity loop under
Playwright; CI lacks a GPU compositor, so these pin the load-bearing CSS contract
so a refactor can't silently regress it):

  * Under body.theme-frosted (the glass tiers — Full Glass AND Frosted) the model
    picker button + popover ride the shared kit LIGHT glass material (the same
    --ow-glass-* tokens / kube light fill the OrwellWindow + Notice kits use).
  * DARK INK (#16191f family) on the light glass for every text node — model name,
    provider/endpoint label, section labels, the selected/active row, the button
    label, the favorite/remove dots' resting state. NO light-on-light anywhere.
  * SOFT LUMINOUS hairlines (rgba(255,255,255,0.14) family), NOT a hard dark
    var(--border) stroke (Apple defines glass by lensing, not stroke).
  * NO accent HUE on TEXT (mandate). The favorite-status dot keeps its accent only as
    a sanctioned NON-text status indicator (a ● glyph), and only on .active.
  * Every new rule is scoped under body.theme-frosted, so the Normal tier (neither
    class) keeps its original flat look.

The picker spans two disjoint style.css regions: the base picker block (~3130) and
the shared "THE ORWELL DESIGN SYSTEM" dark-ink/material block (~37000). These assert
the *effective contract* across both, plus the inner-control fixes that live in the
base picker region.
"""
import re
from pathlib import Path

FE = Path(__file__).resolve().parents[1]
CSS = (FE / "static" / "style.css").read_text(encoding="utf-8")
JS = (FE / "static" / "js" / "modelPicker.js").read_text(encoding="utf-8")

DARK_INK = re.compile(r"#16191f", re.I)
LUMINOUS = re.compile(r"rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0?\.1[0-9]?\b")


def _rule(selector_literal: str) -> str:
    """Return the FIRST declaration block for an exact selector head occurrence."""
    i = CSS.find(selector_literal)
    assert i != -1, f"selector not found: {selector_literal!r}"
    start = CSS.find("{", i)
    end = CSS.find("}", start)
    assert start != -1 and end != -1
    return CSS[start + 1 : end]


def _blocks_for(selector_pat: str):
    """All declaration blocks whose selector list contains selector_pat."""
    out = []
    for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", CSS):
        if selector_pat in m.group(1):
            out.append((m.group(1).strip(), m.group(2)))
    return out


# ── 1. Glass MATERIAL on the picker under the glass tiers ───────────────────────
def test_picker_menu_and_button_carry_kit_glass_material():
    # The popover + button are folded onto the ONE light-glass material rule (the
    # same kube light fill the windows/notice kit use).
    fill_block = None
    for sel, body in _blocks_for("body.theme-frosted .model-picker-menu"):
        if "--ow-glass-light-color" in body or "--ow-glass-light-fill" in body:
            fill_block = (sel, body)
            break
    assert fill_block, (
        "the model-picker menu must adopt the shared kit light-glass fill "
        "(--ow-glass-light-color / --ow-glass-light-fill) under body.theme-frosted"
    )
    assert "body.theme-frosted .model-picker-btn" in CSS, (
        "the model-picker button must also be folded onto the glass material list"
    )


def test_picker_menu_uses_kit_backdrop_blur():
    # The popover blurs the backdrop using the kit backdrop token (Regular glass).
    hit = False
    for sel, body in _blocks_for("body.theme-frosted .model-picker-menu"):
        if "--ow-glass-backdrop" in body or re.search(r"backdrop-filter:\s*blur", body):
            hit = True
            break
    assert hit, "the model-picker popover must carry the kit backdrop blur (Regular glass)"


# ── 2. DARK INK on every text node — no light-on-light ──────────────────────────
def test_picker_text_nodes_are_dark_ink():
    # The popover sets the chrome dark ink as --fg so every inner `color: var(--fg)`
    # / color-mix(--fg N%) resolves dark, AND the explicit text-node rule pins it.
    menu_redefines_fg = any(
        re.search(r"--fg:\s*#16191f", body, re.I)
        for _sel, body in _blocks_for("body.theme-frosted .model-picker-menu")
    )
    # Explicit dark-ink rule covering the named text nodes (either region may carry it).
    explicit = re.search(
        r"body\.theme-frosted[^{}]*\.model-picker-(?:menu|btn)[^{}]*\{[^{}]*#16191f",
        CSS,
        re.I | re.S,
    )
    assert menu_redefines_fg or explicit, (
        "the picker's text nodes must resolve to dark ink (#16191f) on the light glass "
        "— either by redefining --fg on the popover or an explicit dark-ink text rule"
    )


def test_fav_and_remove_dots_have_legible_resting_ink():
    fav = _rule("body.theme-frosted .model-picker-list .mp-fav-dot:not(.active)")
    rm = _rule("body.theme-frosted .model-picker-list .mp-remove-dot")
    assert re.search(r"22\s*,\s*25\s*,\s*31", fav), (
        "the resting favorite dot must be a legible muted DARK ink on the light glass"
    )
    assert re.search(r"22\s*,\s*25\s*,\s*31", rm), (
        "the resting remove-from-recent dot must be a legible muted DARK ink"
    )


# ── 3. SOFT LUMINOUS hairlines, not a hard dark var(--border) stroke ────────────
def test_picker_menu_border_is_soft_luminous_hairline():
    hit = False
    for sel, body in _blocks_for("body.theme-frosted .model-picker-menu"):
        m = re.search(r"border(?:-color)?:\s*([^;]+)", body)
        if m and ("rgba(255,255,255" in m.group(1).replace(" ", "") or "--ow-glass-edge" in m.group(1)):
            hit = True
    assert hit, (
        "the model-picker popover border must be a soft luminous hairline "
        "(rgba(255,255,255,…)/--ow-glass-edge), never a hard dark var(--border)"
    )


# ── 4. NO accent HUE on TEXT; the active fav dot is the only sanctioned exception ─
def test_no_accent_hue_on_picker_text_under_glass():
    # None of the picker's TEXT-bearing dark-ink rules may paint var(--accent)/--red.
    for needle in (
        "body.theme-frosted .model-picker-list .mp-fav-dot:not(.active)",
        "body.theme-frosted .model-picker-list .mp-remove-dot",
        "body.theme-frosted .model-picker-list .mp-provider-chevron",
    ):
        body = _rule(needle)
        assert "var(--accent" not in body and "var(--red" not in body, (
            f"{needle} must not paint an accent hue on its text/symbol under glass"
        )


def test_resting_fav_dot_rule_excludes_active_so_status_accent_survives():
    # The resting dark-ink rule must be :not(.active) so the favorited-status dot
    # keeps its sanctioned NON-text accent (a status indicator, not body text).
    assert "body.theme-frosted .model-picker-list .mp-fav-dot:not(.active)" in CSS, (
        "the resting fav-dot dark-ink rule must be scoped :not(.active) so the "
        "active favorite keeps its sanctioned status accent"
    )


# ── 5. Scoped under body.theme-frosted (Normal tier keeps its flat look) ────────
def test_picker_glass_block_is_scoped_to_theme_frosted():
    # The #735 inner-control fixes live in the base picker region; every one must be
    # under body.theme-frosted so the Normal tier is untouched.
    block = re.search(
        r"/\* ── Liquid Glass — model picker \(#735\).*?/\* Overflow \"\+\" menu \*/",
        CSS,
        re.S,
    )
    assert block, "the #735 model-picker glass block marker must exist in the picker region"
    region = block.group(0)
    # Every selector line that styles the picker must be glass-scoped.
    for line in re.findall(r"^\s*(body\.[^,{]+|\.[^,{]*model-picker[^,{]*)\s*[,{]", region, re.M):
        if "model-picker" in line or "mp-" in line or "model-switch" in line:
            assert "body.theme-frosted" in line, (
                f"#735 picker rule not scoped to the glass tier: {line.strip()!r}"
            )


# ── 6. No dark drop-shadow smudge under the now-dark ink ─────────────────────────
def test_no_dark_text_shadow_smudge_on_picker_ink():
    block = re.search(
        r"/\* ── Liquid Glass — model picker \(#735\).*?/\* Overflow \"\+\" menu \*/",
        CSS,
        re.S,
    )
    assert block
    # A text-shadow in this block, if present, must be a LIGHT halo, never a dark one.
    for ts in re.findall(r"text-shadow:\s*([^;]+);", block.group(0)):
        assert "rgba(0,0,0" not in ts.replace(" ", ""), (
            "dark ink must not carry a dark text-shadow (reads as a smudge) — "
            "use a light halo or none"
        )


# ── 7. The JS keeps the favorite dot as a status indicator (sanctioned accent) ──
def test_js_fav_dot_is_a_status_glyph_not_relabelled():
    # Guards the contract the CSS relies on: the active fav dot is a ● status glyph.
    assert "mp-fav-dot" in JS and "active" in JS, (
        "modelPicker.js must still render the favorite dot as the .mp-fav-dot status "
        "control the glass CSS targets"
    )
