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
    # the kit's bindMenuDismiss/escMenuStack own outside-click + Escape — the bespoke
    # dismissal handlers are gone (the ONE surviving document listener is the narrow
    # modal-close swallow, asserted separately below — it does NOT close the picker).
    assert "_onOutside" not in COLOR
    assert "_onEsc" not in COLOR
    assert ".key === 'Escape'" not in COLOR, "only Enter stays in the hex input; Escape is the kit's"
    # no bespoke position() placement fn, and it no longer mounts itself — the kit mounts it.
    assert "function position(" not in COLOR
    assert "document.body.appendChild" not in COLOR
    # the HSV drag's window-level pointer listeners are LEGITIMATELY kept (internal drag, not dismissal).
    assert "window.addEventListener('pointermove'" in COLOR
    assert "window.addEventListener('pointerup'" in COLOR


def test_color_picker_swallows_modal_close_x_only_while_open():
    """REGRESSION (Greptile P1): the color picker lives inside the Theme/Settings
    modals. A click on the modal close-X while the picker is open must close ONLY the
    picker (the kit's outside-click), not the modal underneath. The old bespoke
    _onOutside swallowed close-btn clicks; the kit's capture-phase dismissal does not
    stopPropagation, so one click would close BOTH. A narrow document-capture swallow
    restores the single-close behavior. Live proof: test_1638_color_picker_modal_close_browser.py."""
    # the swallow exists and targets an EXACT .close-btn (no aria-label substring,
    # which over-matched "Disclose" etc.).
    assert "_swallowModalCloseClick" in COLOR
    swallow = COLOR[COLOR.index("function _swallowModalCloseClick"):]
    swallow = swallow[:swallow.index("\n}") + 2]
    assert ".closest('.close-btn')" in swallow
    assert '[aria-label*="lose"' not in swallow, "the over-broad aria-label match must be dropped"
    # it is SCOPED to the picker's own enclosing modal — the clicked .close-btn must
    # be contained by the modal wrapping _input (an unrelated modal's close-btn is left alone).
    assert "_input.closest(" in swallow
    assert "modal.contains(closeBtn)" in swallow
    # it uses stopPropagation but NOT stopImmediatePropagation — the kit's sibling
    # capture listener must still run and close the picker.
    assert "e.stopPropagation()" in swallow
    assert "stopImmediatePropagation" not in swallow, \
        "must NOT stopImmediatePropagation — that would block the kit's own close listener too"
    # it is scoped to the open lifecycle: added in open(), removed in onClose + close().
    assert "document.addEventListener('click', _swallowModalCloseClick, true)" in COLOR
    assert "document.removeEventListener('click', _swallowModalCloseClick, true)" in COLOR


# ── 3. liquidGlass refraction set folds .cp-popover → .ow-popover ───────────────
def test_liquidglass_selectors_fold_cp_popover_to_ow_popover():
    sel_block = re.search(r"var SELECTORS = \[(.*?)\];", LIQUID, re.S).group(1)
    assert '".ow-popover"' in sel_block, \
        "the OrwellPopover kit surface must be a refraction target (the color popover rides it)"
    assert '".cp-popover"' not in sel_block, \
        "the folded .cp-popover frame must no longer be in the refraction SELECTORS set"
    # added exactly once.
    assert sel_block.count('".ow-popover"') == 1
