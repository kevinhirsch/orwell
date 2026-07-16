"""#1638 batch A — the first menu/popover CONSUMER migrations onto OrwellMenuKit.

Companion to test_1638_menu_popover_kit.py (which pins the KIT itself). This pins the first
consumers that have actually moved onto the kit, so the migration cannot silently regress back to
bespoke dropdown DOM + hand-rolled anchoring/dismissal.

Banked in batch A:
  • the per-message overflow "···" menu (both twins in chatRenderer.js — the received/GM footer
    and the sent/player footer) → OrwellMenuKit.open;
  • the dead chat-header export popover — its trigger + menu markup were removed in #795, so its
    bespoke open/close + document-click + Escape dismissal was permanently dead; removed here (the
    kit owns menu dismissal).

Deferred to follow-up lanes (NOT asserted migrated here): model-sort, session-sort,
composer-overflow, session-actions. session-sort and composer-overflow are pinned by
scripts/browser_smoke.py's LIVE drivers (#session-sort-dropdown / #auto-sort-sessions-more and
#overflow-plus-btn / .overflow-menu + the G13 empty-chevron cascade), so they require rewriting a
required browser gate + refactoring initToolbarOverflow and belong in their own lanes.
"""
import os

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*p):
    with open(os.path.join(FRONTEND, *p), encoding="utf-8") as f:
        return f.read()


CHATRENDERER = _read("static", "js", "chatRenderer.js")
APP = _read("static", "app.js")


# ── the per-message overflow menu now composes the kit ────────────────────────────────────
def test_msg_overflow_menu_opens_through_the_kit():
    # both ··· overflow builders (received/GM footer + sent/player footer) open an anchored
    # OrwellMenuKit menu instead of hand-building a floating div.
    assert CHATRENDERER.count("window.OrwellMenuKit.open({") >= 2, (
        "both per-message overflow twins must open through OrwellMenuKit.open"
    )
    assert "ariaLabel: 'Message actions'" in CHATRENDERER, (
        "the migrated overflow menu must pass an accessible name"
    )
    # prefer-up placement (the old flip-up default) is expressed through the kit option, not
    # hand-computed getBoundingClientRect math.
    assert "placement: 'top'" in CHATRENDERER


def test_msg_overflow_menu_dropped_its_bespoke_dom_and_positioning():
    # the retired bespoke markup + fixed-coord positioning + local dismissal are gone.
    assert "'msg-overflow-menu'" not in CHATRENDERER, (
        "the bespoke .msg-overflow-menu container must no longer be built (the kit owns the surface)"
    )
    assert "'msg-overflow-item'" not in CHATRENDERER, (
        "the bespoke .msg-overflow-item rows must no longer be built (kit item model owns rows)"
    )
    assert "menu.style.top = (btnRect.top - menu.offsetHeight" not in CHATRENDERER, (
        "the hand-rolled flip-up positioning must be gone (the kit's flip/shift engine owns it)"
    )


# ── the dead export popover's bespoke dismissal is removed ─────────────────────────────────
def test_export_popover_bespoke_dismissal_is_removed():
    # the export popover's own document-click + Escape dismissal (dead since #795 removed the
    # trigger/menu markup) is gone — the kit / escMenuStack owns menu dismissal now.
    assert "document.addEventListener('click', () => exportMenu.classList.remove('open'))" not in APP, (
        "the export popover's bespoke outside-click dismissal must be removed"
    )
    assert "if (exportDlBtn && exportMenu) {" not in APP, (
        "the export popover's dead open/close toggle block must be removed"
    )
