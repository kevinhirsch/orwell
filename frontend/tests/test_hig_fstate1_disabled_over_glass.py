"""HIG audit (2026-07-09) — F-STATE-1 (P3): disabled controls over glass.

Opacity alone is an ambiguous "disabled" cue over a translucent glass/photo backdrop (a faint
control can read as merely dim). The frosted disabled rule already paints an opaque fill + label +
`cursor: not-allowed`; F-STATE-1 extends that so a control disabled via `aria-disabled="true"`
(the ARIA equivalent AT announces, not just the native `:disabled` attribute) gets the SAME
non-interactive affordance — and adds an app-wide `not-allowed` cursor for any `aria-disabled`
control so the pointer matches the announced state.
"""
import re
from pathlib import Path

FRONTEND = Path(__file__).resolve().parents[1]
CSS = (FRONTEND / "static" / "style.css").read_text(encoding="utf-8")


def _frosted_disabled_rule():
    """The `body.theme-frosted … button:disabled { … }` opaque-disabled rule (selector list + body)."""
    m = re.search(
        r"((?:body\.theme-frosted[^{]*?:disabled[^{]*,\s*|body\.theme-frosted[^{]*?\[aria-disabled[^{]*,?\s*)+)\{([^}]*)\}",
        CSS,
    )
    return m


def test_frosted_disabled_rule_present_and_opaque():
    m = _frosted_disabled_rule()
    assert m, "the frosted opaque-disabled rule is missing"
    body = m.group(2)
    # the opaque treatment (non-regression) + the not-allowed cursor.
    assert "opacity: 1 !important" in body, "disabled must NOT rely on opacity over glass"
    assert "cursor: not-allowed" in body, "the frosted disabled rule must set cursor: not-allowed"


def test_frosted_disabled_covers_aria_disabled():
    """The opaque treatment must apply to aria-disabled controls, not only native :disabled."""
    m = _frosted_disabled_rule()
    assert m, "the frosted opaque-disabled rule is missing"
    selectors = m.group(1)
    # every :disabled sibling in the selector list has an aria-disabled counterpart.
    assert 'body.theme-frosted .send-btn[aria-disabled="true"]' in selectors, (
        "the frosted disabled rule must also match .send-btn[aria-disabled=\"true\"] (F-STATE-1)"
    )
    assert 'body.theme-frosted .ow-window .ow-body button[aria-disabled="true"]' in selectors, (
        "the frosted disabled rule must also match ow-body button[aria-disabled=\"true\"] (F-STATE-1)"
    )


def test_global_aria_disabled_cursor():
    """Any aria-disabled control app-wide gets the not-allowed cursor so the affordance matches the
    AT-announced state (additive — cursor only)."""
    assert re.search(
        r'\[aria-disabled="true"\]\s*\{\s*cursor:\s*not-allowed', CSS
    ), 'a global [aria-disabled="true"] { cursor: not-allowed } rule must exist (F-STATE-1)'


def test_email_send_btn_disabled_keeps_cursor():
    """Non-regression: the email composer's send button keeps its not-allowed cursor."""
    assert re.search(
        r"\.email-send-btn:disabled\s*\{[^}]*cursor:\s*not-allowed", CSS
    ), "the .email-send-btn:disabled not-allowed cursor regressed"
