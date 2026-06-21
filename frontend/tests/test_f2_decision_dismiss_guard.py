"""F2 — the decision card must not re-nag a card the player dismissed (source-pinned).

Bug (still live on main before this): rearmFromStatus unconditionally reset _userDismissed
whenever a pending was present, so any orwell:gamechanged firing while the SAME pending was
still active (e.g. the player dismissed the card to decide in conversation, then a chat turn
fired a game-mutating tool) re-shoved the dismissed card back. The fix records the dismissed
pending's signature and short-circuits re-arm for that exact pending; a genuinely DIFFERENT
pending still re-arms. See docs/audits/2026-06-21-session-observations.md (O-7).
"""
import os
import re

FE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read():
    with open(os.path.join(FE, "static", "js", "orwellDecision.js"), encoding="utf-8") as fh:
        return fh.read()


def test_dismissed_signature_is_tracked():
    js = _read()
    assert "_dismissedSig" in js, "the dismissed pending's signature must be tracked."
    assert re.search(r"const _sig = \(p\)", js), "a stable pending-signature helper (_sig) must exist."


def test_rearm_short_circuits_the_same_dismissed_pending():
    js = _read()
    assert re.search(r"if \(_userDismissed && _sig\(pending\) === _dismissedSig\) return;", js), (
        "rearmFromStatus must NOT re-arm the exact pending the player dismissed (it must compare "
        "the live pending's signature to the dismissed one and bail)."
    )
    # the guard must sit BEFORE the _userDismissed reset, or the reset defeats it.
    guard = js.index("=== _dismissedSig) return;")
    reset = js.index("_userDismissed = false;   // a fresh")
    assert guard < reset, "the dismissed-signature guard must run before the _userDismissed reset."


def test_dismiss_sites_record_the_signature():
    js = _read()
    # The × button and the Escape handler (the dismiss-to-talk paths) must record the signature.
    assert "_userDismissed = true; _dismissedSig = _sig(pending); removeCard();" in js, (
        "the × dismiss must record the dismissed signature."
    )
    # at least 3 sites set _dismissedSig (×, Escape, and the handled/submit + cancel paths).
    assert js.count("_dismissedSig = _sig(pending)") >= 3, (
        "every _userDismissed=true site should record the signature so no path re-nags."
    )
