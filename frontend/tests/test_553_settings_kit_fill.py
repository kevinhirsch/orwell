"""#553 — Settings → OrwellWindow-kit layout fill (SOURCE-PINS).

The Settings window is hosted INSIDE the OrwellWindow kit (#settings-modal is the
.ow-window; the kit titlebar + .ow-body own the frame + scrolling). Before this
fix the .settings-modal-content rendered as a "box-in-a-box": a fixed-width,
top-margined card floating inside the larger kit body with a dead top band (the
legacy Issue-#208 `margin-top: 7vh` centering hack) and a dead right margin (the
`clamp(560px, …)` floor resolving narrower than the body).

These pins assert the kit-hosted desktop fill rule exists and that the two legacy
leaks are gone, so the box-in-a-box can't regress. The live visual proof (content
fills the kit body, zero top/right dead-margin, every tab renders) is the #553
Playwright capture in the PR; mobile (≤768px) keeps its full-height bottom-sheet
rules unchanged (this fix is desktop-only).
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


def _css():
    return _read("static", "style.css")


def test_legacy_issue208_margin_hack_is_gone():
    """The 7vh / 3vh top-margin centering hack must not leak inside the kit body."""
    css = _css()
    assert "margin-top: 7vh" not in css
    assert "margin-top: 3vh" not in css


def test_kit_hosted_content_fills_the_ow_body_on_desktop():
    """A desktop rule scopes the kit-hosted content to fill the .ow-body:
    margin:0, full width (no clamp floor), no own height cap, no double-frame."""
    css = _css()
    # The kit-scoped fill selector exists.
    sel = "#settings-modal.ow-window > .ow-body > .settings-modal-content"
    assert sel in css
    # Pull the rule block for that selector and assert the fill declarations.
    m = re.search(re.escape(sel) + r"\s*\{([^}]*)\}", css)
    assert m, "kit-hosted fill rule block not found"
    block = m.group(1)
    assert "margin: 0" in block          # no top dead-band
    assert "width: 100%" in block        # no clamp() floor → no right dead-margin
    assert "max-width: none" in block
    assert "max-height: none" in block   # the .ow-body owns the viewport cap
    # No double-framing — the .ow-window IS the frame.
    assert "border: none" in block
    assert "border-radius: 0" in block
    assert "box-shadow: none" in block


def test_kit_fill_rule_is_desktop_scoped():
    """The fill rule must sit inside a (min-width: 769px) block so mobile's
    full-height bottom-sheet (≤768px) is byte-unchanged."""
    css = _css()
    idx = css.index("#settings-modal.ow-window > .ow-body > .settings-modal-content")
    # Walk back to the nearest @media and assert it is the desktop one.
    media = css.rfind("@media", 0, idx)
    assert media != -1
    head = css[media:idx]
    assert "min-width: 769px" in head
    # Defensive: the nearest enclosing @media is NOT a max-width (mobile) block.
    assert "max-width: 768px" not in head
