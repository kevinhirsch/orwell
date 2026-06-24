"""PR #709 — Settings window nested panels are transparent under frosted glass
(SOURCE-PINS).

The Settings window (#settings-modal) is a glass kit window. Its nested panel
cards (Chat Area, Sidebar, Account, …) reuse .admin-card, which under the frosted
theme picks up the #765 .ow-window glass treatment — an opaque gray slab inside
the already-glass window (glass-on-glass / panels-on-panels). The fix makes those
nested cards transparent so the Settings window reads as ONE coherent glass
surface, scoped to #settings-modal so the admin panel's .admin-card glass (#765)
is untouched.

These pins assert:
  - a #settings-modal-scoped frosted rule sets the nested cards' background to
    transparent (no opaque gray fill), and
  - the override is scoped to #settings-modal (the global / admin .admin-card
    glass is NOT made transparent), and
  - the unscoped .admin-card base still paints its solid --panel fill (the admin
    panel treatment is intact).
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _css():
    with open(os.path.join(FRONTEND, "static", "style.css"), encoding="utf-8") as f:
        return f.read()


def _rule_block(css, selector):
    """Return the declaration block for an exact selector head, or None."""
    m = re.search(re.escape(selector) + r"\s*\{([^}]*)\}", css)
    return m.group(1) if m else None


def test_settings_modal_nested_cards_transparent_under_frosted():
    """A frosted rule scoped to #settings-modal makes the nested .admin-card
    panels transparent (no opaque gray fill), dropping their own border/shadow."""
    css = _css()
    sel = "body.theme-frosted #settings-modal .admin-card"
    # The scoped selector must exist (head of a multi-selector group is fine).
    assert sel in css, "missing #settings-modal-scoped frosted .admin-card rule"
    # Find the grouped rule's block (the head selector ends the group; grab the
    # block that immediately follows the .vis-row member of the same group).
    block = _rule_block(css, sel + ",\nbody.theme-frosted #settings-modal .vis-card,\nbody.theme-frosted #settings-modal .vis-row")
    assert block is not None, "scoped transparency rule block not found"
    assert "background-color: transparent" in block
    assert "background-image: none" in block
    # No nested opaque pane chrome.
    assert "border: none" in block
    assert "box-shadow: none" in block


def test_override_is_scoped_to_settings_modal_only():
    """The transparency override must be #settings-modal-scoped — it must NOT
    target a bare `body.theme-frosted .admin-card { background: transparent }`
    (that would strip the admin panel's #765 glass too)."""
    css = _css()
    # There must be no UNSCOPED frosted .admin-card rule that sets the background
    # to fully transparent.
    bad = re.search(
        r"body\.theme-frosted \.admin-card\s*\{[^}]*background-color:\s*transparent",
        css,
    )
    assert bad is None, "the transparency override leaked to the global .admin-card"


def test_admin_card_base_still_opaque():
    """The unscoped .admin-card base keeps its solid --panel fill (admin panel
    treatment intact)."""
    css = _css()
    # Anchor on a rule start (newline) so we match the bare `.admin-card { … }`
    # base rule, not a `… .admin-card { … }` descendant rule.
    m = re.search(r"\n\.admin-card\s*\{([^}]*)\}", css)
    assert m is not None, "base .admin-card rule not found"
    assert "background: var(--panel)" in m.group(1)
