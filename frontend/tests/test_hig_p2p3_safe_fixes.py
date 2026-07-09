"""HIG audit (2026-07-09) — the SAFE, non-colliding P2/P3 fixes.

Source-pinned convention gates (the FE has no DOM runtime in this pytest lane), folded
alongside the existing a11y/convention ratchets (test_0756_reduced_transparency_gate.py,
test_ow_design_system.py). Each gate freezes one shipped HIG fix so it cannot silently
regress.

Findings covered here:
  • F-MOTION-1 (P2) — non-kit decorative animations honor Reduce Motion (the note-card
    flash + the hwfit schedule-chip transition), not just the .ow-*/.og-* kits.
  • F-CONTRAST-2 (P3) — the hwfit schedule error is NOT signalled by red color alone; a
    leading warning glyph adds a non-color channel (WCAG 1.4.1).
  • F-TOUCH-2 (P3) — the gadget action button (.og-act) is a real <button> and NOT
    tap-exempt, so the coarse-pointer 44pt floor (responsive-tokens.css) catches it.

Findings intentionally NOT in this PR (collision / gated by a sibling agent) are listed in
the PR body, not silently dropped.
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*p):
    with open(os.path.join(FRONTEND, *p), encoding="utf-8") as f:
        return f.read()


CSS = _read("static", "style.css")
GADGET_JS = _read("static", "js", "orwellGadget.js")


def _reduced_motion_blocks():
    """Every `@media (prefers-reduced-motion: reduce) { ... }` body in style.css."""
    blocks = []
    for m in re.finditer(r"@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{", CSS):
        i = m.end()
        depth = 1
        while i < len(CSS) and depth:
            if CSS[i] == "{":
                depth += 1
            elif CSS[i] == "}":
                depth -= 1
            i += 1
        blocks.append(CSS[m.end():i])
    return blocks


# ── F-MOTION-1 ────────────────────────────────────────────────────────────────
def test_note_card_flash_has_reduced_motion_guard():
    """The decorative note-card flash animation must be neutralized under Reduce Motion."""
    blocks = _reduced_motion_blocks()
    assert any(
        ".note-card-flash" in b and "animation: none" in b for b in blocks
    ), "note-card flash lacks a prefers-reduced-motion guard (F-MOTION-1)"


def test_hwfit_schedule_chip_transition_has_reduced_motion_guard():
    """The hwfit schedule day-chip transition must be neutralized under Reduce Motion."""
    blocks = _reduced_motion_blocks()
    assert any(
        ".hwfit-sched-day-chip" in b and "transition: none" in b for b in blocks
    ), "hwfit schedule-chip transition lacks a prefers-reduced-motion guard (F-MOTION-1)"


# ── F-CONTRAST-2 ──────────────────────────────────────────────────────────────
def test_hwfit_sched_err_has_non_color_channel():
    """The schedule error must carry a non-color channel (a leading glyph), not rely on
    the red hue alone (WCAG 1.4.1 / HIG Color)."""
    m = re.search(r"\.hwfit-sched-err::before\s*\{([^}]*)\}", CSS)
    assert m, "no .hwfit-sched-err::before rule — error is color-only (F-CONTRAST-2)"
    body = m.group(1)
    assert "content:" in body, ".hwfit-sched-err::before must set a `content` glyph (F-CONTRAST-2)"
    # The glyph must be a real, non-empty mark (not content:"" which conveys nothing).
    cm = re.search(r"content:\s*\"([^\"]*)\"", body)
    assert cm and cm.group(1).strip(), ".hwfit-sched-err::before content must be a visible glyph"


# ── F-TOUCH-2 ─────────────────────────────────────────────────────────────────
def test_og_act_is_a_real_button_not_tap_exempt():
    """The gadget action button is created as a real <button> with class `og-act` and no
    `.tap-exempt`, so the responsive-tokens.css coarse-pointer 44pt floor
    (`button:not(.tap-exempt)`) reaches it on touch (F-TOUCH-2)."""
    assert 'createElement("button")' in GADGET_JS, "og-act must be a real <button> element"
    assert 'className = "og-act"' in GADGET_JS, "the action button must carry the .og-act class"
    assert "tap-exempt" not in GADGET_JS, (
        "og-act must NOT be tap-exempt — that would drop it below the 44pt coarse floor "
        "(F-TOUCH-2)"
    )


def test_coarse_pointer_floor_covers_plain_buttons():
    """Guard the mechanism F-TOUCH-2 relies on: the coarse-pointer floor targets
    `button:not(.tap-exempt)`."""
    tokens = _read("static", "css", "responsive-tokens.css")
    assert "button:not(.tap-exempt)" in tokens, (
        "the coarse-pointer tap floor selector changed — F-TOUCH-2 relies on "
        "`button:not(.tap-exempt)` catching .og-act"
    )
