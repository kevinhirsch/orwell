"""#1638 — the emoji + color pickers migrated onto the shared OrwellPopover kit.

Consumers #11 (emoji picker) and #12 (color picker) used to re-invent anchoring,
dismissal, Escape and positioning. They now open through
`OrwellPopoverKit.open({ ... })` — the kit owns the flip/shift positioning engine
and dismissal (bindMenuDismiss + the escMenuStack Escape seat), so each picker's
bespoke document-level outside-click / Escape / manual-position / ghost-click code
is DELETED and the color popover's `.cp-popover` frame folds onto the kit's
`.ow-popover` surface (which is now the refraction target in liquidGlass).

Source-pinned — the pytest lane has no DOM runtime; the live mount/dismiss is
exercised by the browser suite + browser_smoke.py.
"""
import re
from pathlib import Path

FE = Path(__file__).resolve().parents[1]
EMOJI = (FE / "static" / "js" / "emojiPicker.js").read_text(encoding="utf-8")
COLOR = (FE / "static" / "js" / "colorPicker.js").read_text(encoding="utf-8")
LIQUID = (FE / "static" / "js" / "liquidGlass.js").read_text(encoding="utf-8")


# ── 1. both pickers open through the kit with a REQUIRED ariaLabel ──────────────
def test_emoji_picker_opens_via_popover_kit_with_arialabel():
    assert "OrwellPopoverKit" in EMOJI, "the emoji picker must open through the shared kit"
    # role='dialog' (the kit default) THROWS without an ariaLabel — pin it present.
    assert "ariaLabel: 'Emoji picker'" in EMOJI
    # a focus-trap consumer that focuses the search input on open, under a marker class
    # (the emoji picker is deliberately NOT a refraction target — see liquidGlass test).
    assert "focusTrap: true" in EMOJI
    assert "className: 'ow-popover-emoji'" in EMOJI
    assert "onOpen" in EMOJI and ".emoji-picker-search" in EMOJI, \
        "the search input must be focused on open via the kit's onOpen"


def test_color_picker_opens_via_popover_kit_with_arialabel():
    assert "OrwellPopoverKit" in COLOR, "the color picker must open through the shared kit"
    assert "ariaLabel: 'Color picker'" in COLOR
    assert "focusTrap: true" in COLOR


# ── 2. the ad-hoc dismissal / positioning is DELETED (the kit owns it) ──────────
def test_emoji_picker_has_no_adhoc_dismissal_or_positioning():
    # no document-level outside-click / Escape listeners (kit: bindMenuDismiss/escMenuStack)…
    assert "document.addEventListener" not in EMOJI
    assert "_closeOnOutsideClick" not in EMOJI
    assert "_closeOnEscape" not in EMOJI
    # …no manual fixed-position placement (kit: the flip/shift engine)…
    assert "style.position" not in EMOJI
    assert "style.zIndex" not in EMOJI
    # …and no ghost-click guard (kit deferred-attach covers the opening click).
    assert "_pickerOpenedAt" not in EMOJI


def test_color_picker_has_no_adhoc_dismissal_or_positioning():
    # the kit's bindMenuDismiss/escMenuStack own outside-click + Escape — no document listeners
    # and no bespoke Escape/outside handlers survive.
    assert "document.addEventListener" not in COLOR
    assert "_onOutside" not in COLOR
    assert "_onEsc" not in COLOR
    assert ".key === 'Escape'" not in COLOR, "only Enter stays in the hex input; Escape is the kit's"
    # no bespoke position() placement fn, and it no longer mounts itself — the kit mounts it.
    assert "function position(" not in COLOR
    assert "document.body.appendChild" not in COLOR
    # the HSV drag's window-level pointer listeners are LEGITIMATELY kept (internal drag, not dismissal).
    assert "window.addEventListener('pointermove'" in COLOR
    assert "window.addEventListener('pointerup'" in COLOR


# ── 3. liquidGlass refraction set folds .cp-popover → .ow-popover ───────────────
def test_liquidglass_selectors_fold_cp_popover_to_ow_popover():
    sel_block = re.search(r"var SELECTORS = \[(.*?)\];", LIQUID, re.S).group(1)
    assert '".ow-popover"' in sel_block, \
        "the OrwellPopover kit surface must be a refraction target (the color popover rides it)"
    assert '".cp-popover"' not in sel_block, \
        "the folded .cp-popover frame must no longer be in the refraction SELECTORS set"
    # added exactly once.
    assert sel_block.count('".ow-popover"') == 1
