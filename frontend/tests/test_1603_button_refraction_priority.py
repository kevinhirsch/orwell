"""#1603 (KIT-G-01/02) — glass BUTTONS outrank notice CARDS under the refraction cap.

SOURCE-PIN / regression guard for the owner-ratified option (b) fix.

`liquidGlass.js` caps how many surfaces get the live SVG refraction at once
(`MAX_LIVE_SURFACES` desktop / `MAX_LIVE_SURFACES_MOBILE` mobile) and fills that
budget from the TOP of the `SELECTORS` priority list. Before the fix the notice /
gadget CARDS (`.og-card` / `.on-card`) sat ABOVE the glass BUTTONS, so on an
ordinary screen the windows + cards exhausted the budget and buttons starved to
zero refracted (audit `docs/audits/2026-07-14-theme-visual-audit.md` §3, measured
by cap instrumentation: desktop 0/13 secondary, 0/2 icon, 0/2 group; phone zero
buttons) — and two sibling buttons in ONE row could render different materials
purely by where the cap boundary fell.

The fix (option b, "costs nothing") REORDERS the priority list so every glass
button selector ranks ABOVE the card selectors — the intended order is
windows/chrome -> buttons -> cards. The caps are UNCHANGED (raising them is the
separate perf ruling #1603 still tracks; its VALUES are deliberately NOT pinned
here so that future ruling can raise them without touching this ordering guard).

This test greps the `SELECTORS` ordering in the source so a future reorder cannot
silently re-starve the buttons.
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


JS = _read("static", "js", "liquidGlass.js")

# The high-emphasis glass button variants that get the SVG refraction, and the
# content-layer card affordances that must yield the cap to them.
# (#1653: .ow-btn-icon is intentionally ABSENT — it became a FLAT chrome button and is no
# longer a glass-refraction target, so it's excluded from the SELECTORS refraction list.)
BUTTON_SELECTORS = (
    ".ow-btn-prominent",
    ".ow-btn-secondary",
    ".ow-btn-group",
    ".ow-btn",
)
CARD_SELECTORS = (".og-card", ".on-card")

# A representative slice of the window/chrome/nav layer that must always outrank the buttons (the
# HIG functional layer wins the cap first). Not the full prefix — enough DISTINCT chrome surfaces
# (window, sidebar, composer, modal, top-bar) that a regression sliding any ONE of them below the
# buttons trips this guard, without pinning the exact chrome ordering among themselves.
CHROME_SELECTORS = (".ow-window", "#sidebar", ".chat-input-bar", ".modal-content", ".chat-top-bar")


def _selectors():
    """The ordered `SELECTORS` priority list, parsed from the source.

    Matches only selector-SHAPED quoted literals (start with `.` or `#`) so the
    `//` comment prose in the block can never be mis-parsed as a selector.
    """
    m = re.search(r"var SELECTORS = \[(.*?)\];", JS, re.S)
    assert m, "liquidGlass.js must declare `var SELECTORS = [ ... ];`"
    return re.findall(r'"([.#][^"]*)"', m.group(1))


def test_selectors_list_contains_the_buttons_and_the_cards():
    sels = _selectors()
    for s in BUTTON_SELECTORS + CARD_SELECTORS:
        assert s in sels, f"{s} missing from the SELECTORS priority list"


def test_every_button_outranks_the_notice_card():
    # THE #1603 CONTRACT: every glass button selector appears BEFORE `.on-card` in
    # the priority list, so buttons claim refraction slots before the lower-frequency
    # notice cards under the existing cap (no more zero-refracted buttons).
    sels = _selectors()
    on_card = sels.index(".on-card")
    for btn in BUTTON_SELECTORS:
        assert sels.index(btn) < on_card, (
            f"{btn} must rank ABOVE .on-card in SELECTORS "
            f"(buttons win the cap over notice cards)"
        )


def test_every_button_outranks_both_cards():
    # The reorder placed BOTH cards (gadget .og-card + notice .on-card) below the
    # buttons: the last button precedes the first card.
    sels = _selectors()
    first_card = min(sels.index(c) for c in CARD_SELECTORS)
    last_button = max(sels.index(b) for b in BUTTON_SELECTORS)
    assert last_button < first_card, (
        "all glass button selectors must precede the card selectors in the cap order"
    )


def test_cards_are_the_lowest_priority_tail():
    # Cards are the LOWEST-priority tail (dropped first when the cap bites): nothing
    # but card selectors may sit below the last button.
    sels = _selectors()
    last_button = max(sels.index(b) for b in BUTTON_SELECTORS)
    tail = sels[last_button + 1:]
    assert tail, "the card selectors must follow the buttons"
    assert set(tail) <= set(CARD_SELECTORS), (
        f"only card selectors may rank below the buttons; found: {tail}"
    )


def test_chrome_still_outranks_the_buttons():
    # The full intended order is windows/chrome -> buttons -> cards: the big chrome panels keep
    # top priority so a button-heavy view never starves the windows/sidebar/composer. Guard the
    # whole representative chrome slice (window, sidebar, composer, modal, top-bar) — not just
    # .ow-window — so a future move of ANY of them below the buttons trips this.
    sels = _selectors()
    first_button = min(sels.index(b) for b in BUTTON_SELECTORS)
    for chrome in CHROME_SELECTORS:
        assert chrome in sels, f"{chrome} (chrome) missing from the SELECTORS priority list"
        assert sels.index(chrome) < first_button, (
            f"{chrome} (chrome) must still outrank the buttons in the cap order"
        )


def test_reorder_only_the_caps_still_exist_and_are_unpinned():
    # Scope guard: #1603 half (b) is a REORDER, not a cap raise (the cap raise is the
    # separate perf ruling the issue still tracks). The cap constants must still
    # exist; their numeric VALUES are intentionally NOT asserted here so that future
    # ruling can raise them without breaking this ordering guard.
    # Match DECLARATIONS (`\bNAME\s*=`), not bare substrings, so the desktop cap can't be
    # spuriously satisfied by the `MAX_LIVE_SURFACES_MOBILE` prefix if it were removed.
    assert re.search(r"\bMAX_LIVE_SURFACES\s*=", JS), "desktop cap declaration missing"
    assert re.search(r"\bMAX_LIVE_SURFACES_MOBILE\s*=", JS), "mobile cap declaration missing"
