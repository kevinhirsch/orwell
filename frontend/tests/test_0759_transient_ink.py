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
CHAT_JS = (FE / "static" / "js" / "chat.js").read_text(encoding="utf-8")
MARKDOWN_JS = (FE / "static" / "js" / "markdown.js").read_text(encoding="utf-8")

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


# ══════════════════════════════════════════════════════════════════════════════════
# #761 — the RIGHT side of the thinking-header (the expand caret + the elapsed timer)
# must ALSO be neutral dark ink under the glass theme, so the whole header row reads as
# one monochrome line (it was still accent red: .thinking-toggle paints var(--red)).
# ══════════════════════════════════════════════════════════════════════════════════
def test_thinking_caret_and_timer_neutral_under_frosted():
    for target in (
        "body.theme-frosted .thinking-toggle",
        "body.theme-frosted .live-think-toggle",
        "body.theme-frosted .thinking-timer",
        "body.theme-frosted .live-think-timer",
    ):
        color = _frosted_color_for(target)
        assert color is not None, f"{target} has no frosted text-color rule"
        assert DARK_INK in color.lower(), (
            f"{target} frosted color is {color!r}, expected {DARK_INK} (one monochrome row)"
        )
        assert "var(--red)" not in color, f"{target} must NOT keep var(--red) (stray accent)"
        assert "var(--fg)" not in color, f"{target} must NOT route to light var(--fg)"


def test_caret_glyph_unchanged_color_only():
    """#761 is COLOR-ONLY — the caret GLYPH (▼ \\25BC via .thinking-toggle::after) and the
    toggle function are untouched. Pin the glyph rule still exists."""
    after = None
    for m in re.finditer(r"\.thinking-toggle::after\s*\{([^{}]*)\}", CSS):
        after = m.group(1)
    assert after is not None, ".thinking-toggle::after rule (the caret glyph) was removed"
    assert "25BC" in after.upper() or "▼" in after, (
        "the caret glyph must remain ▼ (\\25BC) — #761 is color-only, no glyph change"
    )


# ══════════════════════════════════════════════════════════════════════════════════
# #762 — exactly ONE expand caret in the live thinking header. The duplicate was the
# final-render path re-emitting a SECOND accordion (via processWithThinking) into the
# .live-reply-content when the reply buffer still carried a leftover inline <think>.
# The fix strips the leftover think block before that render.
# ══════════════════════════════════════════════════════════════════════════════════
def test_live_header_markup_has_single_toggle():
    """The chat.js live-think header template (~1663) must declare exactly ONE
    .thinking-toggle span (no second caret baked into the markup)."""
    # the live header block: from .live-think-spinner-slot to the live toggle
    m = re.search(r'live-think-spinner-slot.*?live-think-toggle', CHAT_JS, re.S)
    assert m, "could not locate the live-think header template in chat.js"
    block = m.group(0)
    assert block.count("thinking-toggle") == 1, (
        "the live header markup must contain exactly one .thinking-toggle caret"
    )


def test_final_render_strips_leftover_think_before_live_reply():
    """#762 fix: before rendering the reply into the existing .live-reply-content, chat.js
    must strip any leftover inline <think> so processWithThinking does not emit a SECOND
    accordion (a duplicate caret) next to the live one."""
    # the guarded render branch (live thinking bar already showing)
    i = CHAT_JS.find("Render reply into the live-reply container")
    assert i != -1, "the live-reply final-render branch was not found in chat.js"
    branch = CHAT_JS[i:i + 1200]
    assert "extractThinkingBlocks" in branch, (
        "the live-reply final render must strip leftover <think> via extractThinkingBlocks "
        "(else a second accordion/caret is emitted — #762)"
    )
    assert re.search(r"<think", branch, re.I), (
        "the fix should guard on a leftover <think> in the reply buffer"
    )


def test_markdown_timer_has_pinnable_class():
    """The finished-section timer (markdown.js timeHtml) carries the .thinking-timer class
    so the neutral-color rule can target it (it previously had no class)."""
    assert 'class="thinking-timer"' in MARKDOWN_JS, (
        "markdown.js timeHtml must carry class=\"thinking-timer\" for the neutral color pin"
    )


# ══════════════════════════════════════════════════════════════════════════════════
# #759 sweep — the DOC-FENCE indicator family is the SAME defect class.
#
# The active document indicator in the chat toolbar (.doc-indicator-active /
# #doc-indicator-btn.active) and its overflow-menu twin (#overflow-doc-btn.has-docs /
# .active) paint their OWN text at var(--accent, var(--red)) (base ~line 3014/3023) for
# the "docs attached / panel open" state. On the glass theme --accent is unset and --red
# resolves to the house accent HUE (#c6613f on the default glass theme) — an ACCENT-ON-GLASS
# glyph on the LIGHT glass chrome (measured ~4.05:1 vs. a white-composited surface, vs.
# ~17.6:1 after the fix). #overflow-doc-btn sits inside .overflow-menu, whose dark-ink
# redefine only touches --fg (NOT --accent/--red), so it is NOT covered by that scope.
# Fix: flip the TEXT to the SAME neutral dark ink (#16191f) + a LIGHT halo, scoped to
# body.theme-frosted (Normal tier untouched). NON-text state cues (opacity, the chip
# background tint) persist — only the accent HUE on the glyph goes neutral.
# ══════════════════════════════════════════════════════════════════════════════════
_DOC_TARGETS = (
    "body.theme-frosted .doc-indicator-active",
    "body.theme-frosted #doc-indicator-btn.active",
    "body.theme-frosted #overflow-doc-btn.has-docs",
    "body.theme-frosted #overflow-doc-btn.active",
)


def test_doc_indicator_family_is_dark_ink_under_frosted():
    for target in _DOC_TARGETS:
        color = _frosted_color_for(target)
        assert color is not None, f"{target} has no frosted text-color rule (#759 sweep)"
        assert DARK_INK in color.lower(), (
            f"{target} frosted color is {color!r}, expected {DARK_INK} "
            "(neutral dark ink on light glass — no accent hue)"
        )
        assert "var(--accent)" not in color, (
            f"{target} text must NOT keep var(--accent) (accent hue on glass — the bug)"
        )
        assert "var(--red)" not in color, (
            f"{target} text must NOT keep var(--red) (accent hue on glass — the bug)"
        )
        assert "var(--fg)" not in color, (
            f"{target} must NOT route to light var(--fg) (light on light glass)"
        )


def test_doc_indicator_family_carries_light_halo():
    """The dark-ink doc-indicator fix uses a LIGHT (white) halo, never the dark
    --ow-glass-text-shadow (a dark shadow under dark ink = a smudge, #725)."""
    blocks = [
        (s, b) for (s, b) in _blocks_for("body.theme-frosted .doc-indicator-active")
        if "body.theme-frosted #overflow-doc-btn.active" in s and DARK_INK in b.lower()
    ]
    assert blocks, "the shared #759-sweep doc-indicator dark-ink fix block was not found"
    _, body = blocks[0]
    ts = re.search(r"text-shadow\s*:\s*([^;]+);", body)
    assert ts, "the doc-indicator fix block sets no text-shadow"
    val = ts.group(1)
    assert "255,255,255" in val.replace(" ", "") or "255, 255, 255" in val, (
        f"text-shadow should be a LIGHT halo (white), got {val!r}"
    )
    assert "var(--ow-glass-text-shadow)" not in val, (
        "must not use the dark --ow-glass-text-shadow (smudge under dark ink)"
    )


def test_doc_indicator_fix_scoped_to_frosted_only():
    """The doc-indicator dark-ink fix must be scoped under body.theme-frosted so the
    Normal tier keeps its accent-state glyph."""
    blocks = [
        s for (s, b) in _blocks_for(".doc-indicator-active")
        if DARK_INK in b.lower() and "#overflow-doc-btn.active" in s
    ]
    assert blocks, "no shared dark-ink fix block for the doc-indicator family"
    for s in blocks:
        assert "body.theme-frosted" in s, (
            "the doc-indicator dark-ink fix must be scoped under body.theme-frosted"
        )
