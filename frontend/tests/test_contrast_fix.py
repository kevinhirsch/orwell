"""#1876 — unit test for chyron kicker contrast fix.

Asserts the rendered CSS (via the JS source string) no longer sets hard-coded
opacity on the kicker and instead uses color-mix() for accessible contrast.

Browser-free: reads the JS source and asserts on the string, so this stays
in the fast, parallel fe-unit lane.
"""
from __future__ import annotations

import os
import re
from pathlib import Path

FRONTEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORWELL_DECISION_JS = Path(FRONTEND_DIR) / "static" / "js" / "orwellDecision.js"


def _kicker_css_block() -> str:
    """Extract the .ow-chyron-kicker CSS block from the JS source."""
    src = ORWELL_DECISION_JS.read_text(encoding="utf-8")
    # Find the kicker CSS block inside a template literal / string
    m = re.search(
        r"\.ow-chyron\s+\.ow-chyron-kicker\s*\{[^}]+}",
        src,
        re.DOTALL,
    )
    assert m is not None, ".ow-chyron .ow-chyron-kicker CSS block not found in orwellDecision.js"
    return m.group(0)


def test_kicker_opacity_removed():
    """The kicker must NOT set opacity to .65 or any hard-coded opacity."""
    css = _kicker_css_block()
    # No opacity property at all (the fix removes it entirely)
    assert "opacity" not in css, (
        f"kicker CSS still sets opacity: {css}"
    )


def test_kicker_uses_color_mix():
    """The kicker must use color-mix(in srgb, var(--fg, currentColor) 73%, transparent)."""
    css = _kicker_css_block()
    assert "color-mix(in srgb, var(--fg, currentColor) 73%, transparent)" in css, (
        f"kicker CSS missing expected color-mix expression; got: {css}"
    )


def test_kicker_css_has_correct_structure():
    """Structural check: the kicker block has the expected properties."""
    css = _kicker_css_block()
    # Should have display, font-size, letter-spacing, text-transform
    assert "display: block" in css
    assert "font-size: .7rem" in css
    assert "letter-spacing: .06em" in css
    assert "text-transform: uppercase" in css
    # Should have margin-bottom
    assert "margin-bottom: .15rem" in css or "margin-bottom: .15rem" in css
