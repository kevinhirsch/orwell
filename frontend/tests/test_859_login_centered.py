"""Issue #859 — the create-account (login / OOBE account-creation) window is not centered.

The login page (static/login.html) is the account-creation surface (login / signup / first-run
admin setup all render the same .card). It used to be top-anchored (`align-items: flex-start` +
`padding-top: 15vh`), so the card floated near the top rather than centered like the OrwellWindow
kit's `modal:true` dialogs.

The fix: center the card on screen (H + V) by default; the mobile soft-keyboard handler flips to a
top anchor ONLY while the keyboard is open (a `.kbd-open` class), so the focused field stays visible.

Source-pinned convention checks (the login page is a standalone HTML/CSS surface).
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


LOGIN = _read("static", "login.html")


def _body_rule():
    """The top-level `body { ... }` rule (not body.<class>) in login.html's <style>."""
    m = re.search(r"\bbody\s*\{(.*?)\}", LOGIN, re.S)
    assert m, "login.html must declare a body rule"
    return m.group(1)


def test_login_card_is_vertically_centered_by_default():
    body = _body_rule()
    assert "align-items: center" in body, (
        "#859: the login/create-account card must be vertically CENTERED "
        "(align-items: center), not top-anchored."
    )
    assert "align-items: flex-start" not in body, (
        "#859: the default body must NOT top-anchor the card."
    )
    # The old 15vh top shim must be gone from the default resting state.
    assert "padding-top: 15vh" not in body, (
        "#859: the 15vh top padding (top-anchor) must be removed from the default body."
    )


def test_login_card_is_horizontally_centered():
    body = _body_rule()
    assert "justify-content: center" in body, (
        "#859: the card must stay horizontally centered."
    )


def test_keyboard_open_state_top_anchors_via_class_not_inline():
    # While the mobile keyboard is open the card top-anchors via a .kbd-open class (CSS owns the
    # anchor) so the focused field isn't pushed off-screen — without disturbing the centered default.
    assert re.search(r"body\.kbd-open\s*\{[^}]*align-items:\s*flex-start", LOGIN, re.S), (
        "#859: body.kbd-open must top-anchor the card while the keyboard is open."
    )
    # The visualViewport handler toggles the class instead of mutating inline paddingTop.
    assert "classList.add('kbd-open')" in LOGIN and "classList.remove('kbd-open')" in LOGIN, (
        "#859: the keyboard handler must toggle the .kbd-open class, not set inline padding."
    )
