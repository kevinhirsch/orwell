"""Issue #950 — the chat title bar ("Orwell Chat" + rename) must be truly centered (H + V)
at all times, including when the sidebar is collapsed.

Cause (pre-fix): `.chat-top-bar` was flex-centered, but `body.sidebar-collapsed.hamburger-left/
right .chat-top-bar` added padding-left/right shims (to clear the hamburger), which shifted the
flex-centered content off true center when the sidebar was collapsed; an asymmetric top padding
also skewed vertical centering.

The Apple-pattern fix (style.css): the title cluster `.chat-meta-overlay` is ABSOLUTELY pinned to
the bar's full border box (`position: absolute; inset: 0`) and flex-centered (H + V). The edge
controls (hamburger / new-chat / incognito) float over the sides with their own absolute offsets
and NEVER displace the title; symmetric side gutters keep a long title truncating with ellipsis
while staying centered. No sidebar-collapsed padding shim survives.

Source-pinned regression guards.
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


CSS = _read("static", "style.css")
INDEX = _read("static", "index.html")


def _rule(selector):
    """Return the body of the FIRST top-level rule whose selector exactly matches `selector`."""
    # Match a rule whose selector list is exactly `selector` (allowing surrounding whitespace).
    pat = re.compile(r"(?:^|[\}\*/])\s*" + re.escape(selector) + r"\s*\{([^{}]*)\}", re.M)
    m = pat.search(CSS)
    assert m, f"could not find the `{selector}` CSS rule"
    return m.group(1)


def test_title_cluster_is_absolutely_pinned_to_the_full_bar():
    body = _rule(".chat-meta-overlay")
    assert "position: absolute" in body, (
        "#950: the title cluster must be absolutely positioned in the bar."
    )
    assert "inset: 0" in body, (
        "#950: the cluster must span the bar's FULL box (inset: 0) so it centers regardless "
        "of the floating edge controls."
    )
    # Flex-centered both axes.
    assert "justify-content: center" in body and "align-items: center" in body, (
        "#950: the cluster must be flex-centered H + V."
    )


def test_long_title_truncates_with_ellipsis_while_centered():
    body = _rule(".chat-meta-overlay #current-meta")
    assert "text-overflow: ellipsis" in body and "overflow: hidden" in body, (
        "#950: a long conversation title must truncate with an ellipsis."
    )
    assert "min-width: 0" in body, (
        "#950: min-width:0 lets the title shrink so the ellipsis triggers instead of pushing "
        "the cluster off-center."
    )


def test_top_bar_has_no_asymmetric_vertical_padding():
    body = _rule(".chat-top-bar")
    # The desktop bar centers via flex with symmetric (zero) padding — no asymmetric top shim that
    # would skew vertical centering. (The mobile @media block legitimately reserves corner gutters.)
    assert "align-items: center" in body and "justify-content: center" in body
    assert "padding: 0" in body, (
        "#950: the desktop bar must use symmetric padding (0) so its geometric center is the "
        "true middle — no vertical-center fudge."
    )


def test_no_sidebar_collapsed_padding_shim_on_the_topbar():
    # The stale shifters — body.sidebar-collapsed.hamburger-left/right .chat-top-bar adding
    # padding-left/right — must NOT exist; they pushed the flex-centered title off true center.
    offenders = re.findall(
        r"body\.sidebar-collapsed\.hamburger-(?:left|right)[^{]*\.chat-top-bar[^{]*\{[^}]*"
        r"padding-(?:left|right)\s*:",
        CSS,
    )
    assert not offenders, (
        "#950: a sidebar-collapsed hamburger padding shim on .chat-top-bar still exists — it "
        "shifts the centered title off-center when the sidebar is collapsed."
    )


def test_title_cluster_markup_present():
    # The centered cluster carries the title + count + cost + rename pencil.
    assert 'class="chat-meta-overlay"' in INDEX
    assert 'id="current-meta"' in INDEX
    assert 'id="topbar-rename-btn"' in INDEX
