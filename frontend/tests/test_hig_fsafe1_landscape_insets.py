"""HIG audit (2026-07-09) — F-SAFE-1 (P2): landscape left/right safe-area insets.

`--safe-left` / `--safe-right` were defined (responsive-tokens.css) but essentially unused, so on a
notched phone held in LANDSCAPE the sidebar / composer edge can slide under the sensor housing.
This gate pins that the outermost fixed chrome now consumes the horizontal insets — using
`max(<base>, var(--safe-*))` so portrait / non-notched screens (inset = 0) see NO visual change.
"""
import re
from pathlib import Path

FRONTEND = Path(__file__).resolve().parents[1]
CSS = (FRONTEND / "static" / "style.css").read_text(encoding="utf-8")
TOKENS = (FRONTEND / "static" / "css" / "responsive-tokens.css").read_text(encoding="utf-8")


def test_tokens_still_defined():
    """The mechanism relies on the tokens existing (env(safe-area-inset-left/right))."""
    assert re.search(r"--safe-left:\s*env\(safe-area-inset-left", TOKENS)
    assert re.search(r"--safe-right:\s*env\(safe-area-inset-right", TOKENS)


def test_composer_consumes_horizontal_insets():
    """The composer spans the viewport — its horizontal padding must floor at the base and expand
    into the safe inset. (There are several `.chat-input-bar` rules; the base one carries the
    shorthand `padding` we augment.)"""
    # the shorthand padding on the base composer rule expands its L/R into the safe inset via
    # max(base, inset) — so there is NO change when the inset is 0.
    assert "padding: 10px max(12px, var(--safe-right)) 10px max(12px, var(--safe-left))" in CSS, (
        "the composer base padding must expand L/R into max(12px, var(--safe-*)) (F-SAFE-1)"
    )
    # scope guard: it lives on a .chat-input-bar rule (not some unrelated selector).
    m = re.search(
        r"\.chat-input-bar\s*\{[^}]*padding:\s*10px\s+max\(12px,\s*var\(--safe-right\)\)", CSS
    )
    assert m, "the composer safe-inset padding must be on a .chat-input-bar rule"


def test_sidebar_consumes_horizontal_insets():
    """The sidebar is the leftmost fixed chrome — floor its horizontal padding at the safe inset."""
    # a top-level `#sidebar { ... }` rule (not a descendant) that adds the horizontal inset floors.
    assert re.search(
        r"#sidebar\s*\{[^}]*padding-left:\s*max\(0px,\s*var\(--safe-left\)\)", CSS
    ), "the sidebar must floor padding-left at max(0px, var(--safe-left)) (F-SAFE-1)"
    assert re.search(
        r"#sidebar\s*\{[^}]*padding-right:\s*max\(0px,\s*var\(--safe-right\)\)", CSS
    ), "the sidebar must floor padding-right at max(0px, var(--safe-right)) (F-SAFE-1)"


def test_standalone_body_consumes_horizontal_insets():
    """The installed-app (standalone) body honors the landscape insets alongside the existing
    top/bottom handling."""
    # inside the display-mode: standalone block, body gets padding-left/right from the safe tokens.
    m = re.search(r"@media\s*\(display-mode:\s*standalone\)\s*\{(.*?)\n\}", TOKENS, re.S)
    assert m, "no standalone media block in responsive-tokens.css"
    block = m.group(1)
    assert "padding-left: var(--safe-left)" in block and "padding-right: var(--safe-right)" in block, (
        "the standalone body must consume --safe-left/--safe-right (F-SAFE-1)"
    )
    # the existing top inset must remain (non-regression).
    assert "padding-top: var(--safe-top)" in block, "the standalone top inset regressed"
