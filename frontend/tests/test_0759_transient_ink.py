"""Issue #759 — two TRANSIENT chat-chrome surfaces are light-on-light on the glass.

Confirmed light-on-light BLOCKERS (surface audit, measured ~1.13:1 — invisible):

  1. The "Thinking" accordion header label — `.thinking-header-left` — paints its own
     text (base `color: var(--red)`); the frosted accent-neutralize block routed it to
     `var(--fg)`, which on the LIGHT glass is LIGHT ink.
  2. The ACTIVE tool-indicator chip — `.tool-indicator.active` — base `color: var(--red)`
     (line ~2893); the frosted block forced it to `var(--fg)` (light on light glass).

Both surfaces sit OUTSIDE the dark-ink chrome scope (the thinking SECTION is deliberately
out of scope; the base `.tool-indicator` is in the dark-ink list but `.tool-indicator.active`
re-paints its text at higher specificity). Apple's light toolbar/sidebar over light glass
renders DARK monochrome ink ("text … becoming darker when the underlying content is light" —
HIG Color; `lg_hig_legibility_primary_label` shows the dark glyph on the light glass tile).

Fix (source-pinned here; the live look is verified by the render-parity loop under
Playwright — CI lacks a GPU compositor): under `body.theme-frosted` BOTH surfaces resolve
their TEXT to the neutral dark ink `#16191f` (the same ink the rest of the functional
chrome uses), and NEITHER uses the light `var(--fg)` / accent `var(--red)` for text.
Non-text accents (spinner/dot, the chip background tint) are untouched. The Normal tier
(no `body.theme-frosted`) keeps its original look.
"""
import re
from pathlib import Path

FE = Path(__file__).resolve().parents[1]
CSS = (FE / "static" / "style.css").read_text(encoding="utf-8")

DARK_INK = "#16191f"


def _blocks_for(selector_literal: str):
    """All declaration blocks whose selector LIST contains selector_literal exactly."""
    out = []
    for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", CSS):
        selectors = m.group(1)
        if selector_literal in selectors:
            out.append((selectors.strip(), m.group(2)))
    return out


def _frosted_color_for(target_selector: str) -> str:
    """The TEXT color the target resolves to under body.theme-frosted — the LAST
    frosted block that lists the target selector AND sets a `color:` declaration.
    (Later same-or-higher-specificity rule wins; our fix is the last text-color rule
    that names these targets.)"""
    winner = None
    for selectors, body in _blocks_for(target_selector):
        if "body.theme-frosted" not in selectors:
            continue
        m = re.search(r"(?<!background-)(?<!-)\bcolor\s*:\s*([^;]+);", body)
        if m:
            winner = m.group(1).strip()
    return winner


# ── 1. The "Thinking" accordion header label resolves to DARK ink on the glass ──────
def test_thinking_header_left_is_dark_ink_under_frosted():
    color = _frosted_color_for("body.theme-frosted .thinking-header-left")
    assert color is not None, ".thinking-header-left has no frosted text-color rule"
    assert DARK_INK in color.lower(), (
        f".thinking-header-left frosted text color is {color!r}, expected {DARK_INK} "
        "(dark monochrome ink on light glass — HIG Color / lg_hig_legibility_primary_label)"
    )
    assert "var(--fg)" not in color, (
        ".thinking-header-left must NOT route to var(--fg) (light on light glass — the bug)"
    )
    assert "var(--red)" not in color, ".thinking-header-left text must carry NO accent hue"


# ── 2. The ACTIVE tool-indicator chip resolves to DARK ink on the glass ─────────────
def test_tool_indicator_active_is_dark_ink_under_frosted():
    color = _frosted_color_for("body.theme-frosted .tool-indicator.active")
    assert color is not None, ".tool-indicator.active has no frosted text-color rule"
    assert DARK_INK in color.lower(), (
        f".tool-indicator.active frosted text color is {color!r}, expected {DARK_INK}"
    )
    assert "var(--fg)" not in color, (
        ".tool-indicator.active must NOT route to var(--fg) (light on light glass — the bug)"
    )
    assert "var(--red)" not in color, (
        ".tool-indicator.active text must NOT keep var(--red) (no accent hue on text)"
    )


# ── 3. Neither target is still in the accent→var(--fg) neutralize list ──────────────
def test_targets_removed_from_var_fg_neutralize_block():
    """The accent-neutralize block (`… { color: var(--fg) !important }`) must no longer
    list these two surfaces — that block is the root cause (var(--fg) is light here)."""
    for selectors, body in _blocks_for("body.theme-frosted a"):
        if re.search(r"\bcolor\s*:\s*var\(--fg\)", body):
            assert "body.theme-frosted .thinking-header-left" not in selectors, (
                ".thinking-header-left is still in the var(--fg) neutralize block"
            )
            assert "body.theme-frosted .tool-indicator.active" not in selectors, (
                ".tool-indicator.active is still in the var(--fg) neutralize block"
            )


# ── 4. Both carry a LIGHT halo, not the dark --ow-glass-text-shadow smudge ──────────
def test_dark_ink_carries_light_halo_not_dark_smudge():
    """Under dark ink the dark --ow-glass-text-shadow reads as a dirty smudge (#725);
    the fix uses a light (white) halo. Pin the fix block carries a light text-shadow."""
    blocks = [
        (s, b) for (s, b) in _blocks_for("body.theme-frosted .thinking-header-left")
        if "body.theme-frosted .tool-indicator.active" in s and DARK_INK in b.lower()
    ]
    assert blocks, "the shared #759 dark-ink fix block was not found"
    _, body = blocks[0]
    ts = re.search(r"text-shadow\s*:\s*([^;]+);", body)
    assert ts, "the #759 fix block sets no text-shadow"
    val = ts.group(1)
    assert "255,255,255" in val.replace(" ", "") or "255, 255, 255" in val, (
        f"text-shadow should be a LIGHT halo (white), got {val!r}"
    )
    assert "var(--ow-glass-text-shadow)" not in val, (
        "must not use the dark --ow-glass-text-shadow (reads as a smudge under dark ink)"
    )


# ── 5. The fix is scoped to body.theme-frosted — Normal tier keeps its look ─────────
def test_fix_scoped_to_frosted_only():
    blocks = [
        s for (s, b) in _blocks_for(".thinking-header-left")
        if DARK_INK in b.lower() and ".tool-indicator.active" in s
    ]
    assert blocks, "no shared dark-ink fix block for the two transients"
    for s in blocks:
        assert "body.theme-frosted" in s, (
            "the dark-ink fix must be scoped under body.theme-frosted (glass tiers only)"
        )
