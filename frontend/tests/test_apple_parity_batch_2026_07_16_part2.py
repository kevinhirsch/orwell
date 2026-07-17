"""Apple Genius rendered-pixel-parity batch (2026-07-16), part 2 — owner-reported items 7-9.

Source-pin gates (the FE has no DOM runtime in this pytest lane) for three additional
owner-reported layout issues found alongside the first parity batch:

  7. Decision-card (.odec) close button: on a longer title (e.g. the comp-intent card,
     "Competition round — set your approach") the head row had no reserved gutter for the
     absolutely-positioned .odec-x, so the title could run under/collide with it. Reserved a
     gutter on .odec-head matching the ×'s footprint.
  8. Decision-card confirm placement: .odec-row (the note + Confirm footer) carried only a
     bare margin-top — no visual grouping distinct from the rest of the card's internal
     spacing — so Confirm read as a loose, floating element. Gave the row a bounded "footer"
     treatment (a thin top hairline + more breathing room), hint/note left, action right,
     baseline-aligned (Apple form convention), while leaving every disabled/enabled Confirm
     rule untouched.
  9. Settings section-title double underline: every .admin-card h2/h5 section header (Chat
     Area, Sidebar, …) carried its OWN border-bottom INSIDE a card that already has a full
     4-sided box border, sandwiching the title between two hairlines. Dropped the heading's
     own divider — the card's box border (or, under the frosted Settings window where that's
     stripped to transparent, spacing/typography alone) is now the ONE grouping cue.
"""
import re
from pathlib import Path

FRONTEND = Path(__file__).resolve().parents[1]
DECISION_JS = (FRONTEND / "static" / "js" / "orwellDecision.js").read_text(encoding="utf-8")
CSS = (FRONTEND / "static" / "style.css").read_text(encoding="utf-8")


# ── Item 7: decision-card close button gutter ───────────────────────────────────────────


def test_odec_head_reserves_a_gutter_for_the_close_button():
    m = re.search(r"\.odec \.odec-head\s*\{([^}]*)\}", DECISION_JS)
    assert m, "the .odec-head rule must exist"
    body = m.group(1)
    assert "padding-right" in body, (
        "the head row must reserve a right-side gutter so a long title never runs under "
        "the absolutely-positioned .odec-x close button"
    )


def test_odec_x_still_absolute_top_right_with_44px_target():
    # Must stay compatible with the existing J5-21 pins (test_j5_20_21_decision_polish.py).
    m = re.search(r"\.odec \.odec-x\s*\{([^}]*)\}", DECISION_JS)
    assert m, "the .odec-x rule must exist"
    body = m.group(1)
    assert "position: absolute" in body
    assert "right:" in body and "top:" in body
    assert "min-width: 44px" in body and "min-height: 44px" in body


# ── Item 8: decision-card confirm/footer row grouping ────────────────────────────────────


def test_odec_row_reads_as_a_bounded_footer():
    m = re.search(r"\.odec \.odec-row\s*\{([^}]*)\}", DECISION_JS, re.DOTALL)
    assert m, "the .odec-row rule must exist"
    body = m.group(1)
    assert "border-top" in body, (
        "the note+Confirm row must carry a top hairline so it reads as a distinct footer "
        "zone, not a loose/floating element beside the option pills"
    )
    assert "justify-content: space-between" in body, (
        "the footer must explicitly place the hint left / action right (Apple form convention)"
    )


def test_odec_confirm_styling_untouched_by_the_footer_change():
    # The task requires keeping the disabled-until-selection behavior and the EXISTING
    # enabled styling exactly — confirm this fix never touched .odec-confirm's own rule.
    m = re.search(r"\.odec \.odec-confirm\s*\{([^}]*)\}", DECISION_JS, re.DOTALL)
    assert m, "the .odec-confirm rule must exist"
    body = m.group(1)
    assert "background: var(--accent" in body
    assert "min-height: 44px" in body
    disabled = re.search(r"\.odec \.odec-confirm:disabled\s*\{([^}]*)\}", DECISION_JS)
    assert disabled and "opacity: .4" in disabled.group(1) and "not-allowed" in disabled.group(1)


def test_narrow_viewport_still_stacks_full_width_confirm():
    # "action full-width below on narrow" must still hold (unchanged behavior).
    m = re.search(r"@media \(max-width: 480px\)\s*\{([^@]*?)\n\s*\}\n", DECISION_JS, re.DOTALL)
    assert m, "the narrow decision-card media block must exist"
    body = m.group(1)
    assert ".odec-confirm { width: 100%;" in body


# ── Item 9: settings section-title double underline ──────────────────────────────────────


def test_admin_card_heading_has_no_own_underline():
    m = re.search(
        r"\.admin-card h2,\s*/\* HIG F-A11Y-3.*?\.admin-card h5 \{([^}]*)\}",
        CSS, re.DOTALL,
    )
    assert m, "the .admin-card h2 / h5 heading rule must exist"
    body = m.group(1)
    assert "border-bottom:" not in body, (
        "the section heading must not carry its own border-bottom declaration — the card's "
        "own box border (or, under the frosted Settings window, spacing alone) is the ONE "
        "divider; a second heading-level hairline reproduces the double-underline bug"
    )
    assert "padding-bottom:" not in body, (
        "padding-bottom on the heading was only needed to space the (now-removed) border-bottom"
    )


def test_admin_card_still_has_its_own_box_border_as_the_one_divider():
    # The FLAT/normal tier's grouping cue: the card's own 4-sided border must still exist
    # (untouched) — dropping the heading underline must not silently drop ALL structure.
    m = re.search(r"\.admin-card \{\s*background: var\(--panel\);([^}]*)\}", CSS)
    assert m, "the base .admin-card rule must exist"
    assert "border: 1px solid var(--border)" in m.group(1)
