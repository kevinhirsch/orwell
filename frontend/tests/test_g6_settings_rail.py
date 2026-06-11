"""Lane G6 — the settings window keeps its LEFT tab rail.

Explicit user preference: "I liked the settings window with the left hand panel
on it instead of the top panel." The top-bar stacking is a LAST resort for
genuinely narrow contexts, not the response to a moderately narrow modal.

Source pins for the two-tier container mechanism in style.css:
  ≤620 token — COMPRESS tier: the rail stays left, clamps tighter, labels
               ellipsize instead of overflowing.
  ≤480 token — STACK tier: only here does the rail move to the top.
The runtime half lives in scripts/responsive_matrix.py (settings is audited
open at desktop-1366 and phone-390).
"""
import re
from pathlib import Path

FE = Path(__file__).resolve().parents[1]
STYLE = (FE / "static" / "style.css").read_text()


def _container_block(threshold):
    """The full body of `@container settings-modal (max-width: <threshold>px)`."""
    header = f"@container settings-modal (max-width: {threshold}px)"
    start = STYLE.find(header)
    assert start != -1, f"missing the settings container tier at the {threshold} token"
    i = STYLE.find("{", start)
    depth, j = 1, i + 1
    while depth and j < len(STYLE):
        depth += {"{": 1, "}": -1}.get(STYLE[j], 0)
        j += 1
    return STYLE[i + 1:j - 1]


def test_stacking_lives_at_the_480_token_only():
    """The rail moves to the top ONLY below 480 — never at 620."""
    stack = _container_block(480)
    assert "flex-direction: column" in stack, \
        "the 480 tier must stack the settings layout (rail on top)"
    assert "flex-direction: row" in stack, \
        "the stacked rail runs horizontally"
    compress = _container_block(620)
    assert "flex-direction: column" not in compress, \
        "620 must NOT stack — the left rail survives moderately narrow modals (G6)"
    assert "flex-direction: row" not in compress, \
        "620 must NOT turn the rail horizontal (G6)"


def test_620_tier_compresses_the_left_rail():
    compress = _container_block(620)
    m = re.search(r"\.settings-sidebar\s*\{[^}]*width:\s*clamp\((\d+)px", compress)
    assert m, "the 620 tier must tighten the rail with a width clamp"
    assert int(m.group(1)) < 140, \
        "the compressed rail floor must undercut the base 140px floor"
    # Labels give way before the rail does.
    assert "text-overflow: ellipsis" in compress, "labels must ellipsize, not overflow"
    assert "min-width: 0" in compress, "the label span needs min-width:0 to shrink"


def test_stack_tier_follows_the_compress_tier_in_source():
    """Same specificity — the stacked geometry only wins below 480 because it
    comes later in the cascade. Reordering silently breaks the stack."""
    assert STYLE.find("@container settings-modal (max-width: 620px)") \
        < STYLE.find("@container settings-modal (max-width: 480px)")


def test_base_rail_is_left_and_fluid():
    """Above 620 the rail is untouched: the S1 fluid clamp, vertical, left."""
    assert "width: clamp(140px, 18cqw, 200px)" in STYLE
    # The base rule (anchored by its S1 clamp — earlier .settings-sidebar
    # mentions are the docked min-height resets).
    m = re.search(r"\.settings-sidebar\s*\{([^}]*width:\s*clamp\(140px[^}]*)\}", STYLE)
    assert m and "flex-direction: column" in m.group(1), \
        "the base rail is a left-hand column"


def test_no_viewport_media_copy_of_the_settings_switch():
    """The container tiers are the ONE mechanism (S3) — no @media twin may
    reintroduce a viewport-width stacking path."""
    start = STYLE.find("container-name: settings-overlay")
    end = STYLE.find("/* ── Entrance Animations ── */")
    region = STYLE[start:end]
    assert "@media (max-width: 600px)" not in region
    assert "@media (max-width: 620px)" not in region
