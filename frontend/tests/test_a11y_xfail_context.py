"""The a11y matrix XFAIL registry's CONTEXT constraint (#1375-i).

XFAIL needles are substring-matched against the finding line, so a selector-only needle
would exempt that element in EVERY sweep context. `XFAIL_CONTEXT` narrows an entry to one
context (the settings-scrim reading for #1375-i): a hit from any other context must classify
as a real FAIL — the un-scrimmed user-bar chip measures ~13:1, and a regression there gates.

Drives `classify_and_report()` directly with synthetic findings (no browser, no engine —
`a11y_matrix`'s module body is import-safe by design; the sweep lives under main()).
Roles only; Vault-free (chrome only).
"""
import importlib
import os
import sys

import pytest

SCRIPTS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts")

# The finding line #1375-i's needle matches (the volatile numbers after the needle are
# irrelevant to matching — only the stable prefix is compared).
_USER_BAR_LINE = ("contrast:sidebar:span#user-bar-name.user-bar-name — WCAG 3.40:1 < 4.5 "
                  "(APCA Lc 27 dark-on-light, 9.8px, fg=rgb(22, 25, 31) bg=rgb(108, 109, 110)) 'User'")


@pytest.fixture()
def a11y():
    sys.path.insert(0, SCRIPTS)
    try:
        mod = importlib.import_module("a11y_matrix")
    finally:
        sys.path.remove(SCRIPTS)
    saved = dict(mod.found), set(mod.xfail_hits)
    mod.found.clear()
    mod.xfail_hits.clear()
    yield mod
    mod.found.clear()
    mod.found.update(saved[0])
    mod.xfail_hits.clear()
    mod.xfail_hits.update(saved[1])


def test_registry_carries_the_context_constraint(a11y):
    """#1375-i must stay context-scoped — dropping the constraint reopens the blanket exemption."""
    assert a11y.XFAIL_CONTEXT.get("#1375-i") == "+settings"
    assert "#1375-i" in a11y.XFAIL


def test_scrimmed_context_is_absorbed_as_xfail(a11y, capsys):
    """The settings-scrim reading (the only context CI fires) classifies as the known XFAIL."""
    a11y.record(_USER_BAR_LINE, "desktop-1366+settings")
    assert a11y.classify_and_report() == 0
    assert "XFAIL[#1375-i]" in capsys.readouterr().out


def test_unscrimmed_context_is_a_real_fail(a11y, capsys):
    """The same element failing OUTSIDE the scrim (a real chip/ink regression) must gate."""
    a11y.record(_USER_BAR_LINE, "desktop-1366")
    assert a11y.classify_and_report() == 1
    assert "FAIL" in capsys.readouterr().out


def test_mixed_contexts_do_not_hide_the_unscrimmed_hit(a11y, capsys):
    """A finding seen BOTH under the scrim and un-scrimmed carries a real regression — gate it."""
    a11y.record(_USER_BAR_LINE, "desktop-1366+settings")
    a11y.record(_USER_BAR_LINE, "tablet-820")
    assert a11y.classify_and_report() == 1
    assert "FAIL" in capsys.readouterr().out
