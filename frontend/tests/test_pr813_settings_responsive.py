"""PR #813 — fe-responsive close-out: two source-pinned regressions in the
Settings OrwellWindow kit migration.

1. The "Peek" toggle (#settings-opacity-wrap) is re-homed into the kit titlebar
   where it ALSO carries `.ow-titlebar-accessory`. That accessory rule
   (`body.theme-frosted .ow-titlebar-accessory { min-height:24px }`) has higher
   specificity than the plain coarse-pointer touch-floor rule, so the button
   measured 59x24 at phone-390 — under the WCAG 2.5.5 44px floor. The fix
   re-asserts the 44px floor at titlebar-accessory specificity + !important,
   ONLY inside the coarse/≤480 media query (desktop stays the compact 22px box).

2. At the tablet tier (~820px viewport) the kit window's `max-width: 64vw`
   put the settings content in the 480–500px DEAD ZONE — exactly the G6 rail
   stack/left boundary, where getBoundingClientRect and @container resolution
   can land on opposite sides of the 480 token depending on the runner. The fix
   caps the SETTINGS kit window at this tier so the content is reliably ≤480,
   letting the EXISTING `@container settings-modal (max-width:480px)` rule do the
   stacking (container-driven, not a viewport stack). The runtime half is
   asserted by scripts/responsive_matrix.py (tablet-820 settings-rail).
"""
import re
from pathlib import Path

FE = Path(__file__).resolve().parents[1]
STYLE = (FE / "static" / "style.css").read_text()


def test_peek_touch_floor_beats_the_titlebar_accessory_sizing():
    """The coarse/≤480 rule must re-assert 44px at .ow-titlebar-accessory
    specificity with !important so it beats `body.theme-frosted
    .ow-titlebar-accessory { min-height:24px }`."""
    # The media query that carries the touch floor.
    start = STYLE.find("@media (max-width: 480px), (pointer: coarse)")
    assert start != -1, "the Peek coarse-pointer touch-floor media query must exist"
    end = STYLE.find("/* The title h4", start)  # next comment-anchored rule after the block
    assert end != -1 and end > start
    block = STYLE[start:end]
    # A rule scoped to the titlebar-accessory case, with the 44px floor + !important.
    sel = ".theme-opacity-wrap.theme-opacity-toggle.ow-titlebar-accessory"
    assert sel in block, (
        "the touch-floor rule must target the kit titlebar accessory case explicitly "
        "(it carries .ow-titlebar-accessory once re-homed into the titlebar)")
    # the accessory-scoped rule must win with !important on both dimensions.
    acc = block[block.find(sel):]
    acc = acc[:acc.find("}") + 1]
    assert "min-height: 44px !important" in acc, "44px min-height must beat the 24px accessory cap"
    assert "min-width: 44px !important" in acc, "44px min-width keeps both dimensions on the floor"


def test_peek_floor_is_coarse_only_desktop_stays_compact():
    """The grow must live ONLY inside the coarse/≤480 media query — the desktop
    base rule keeps the compact 22px Peek look."""
    # Base rule: 22px height, no 44px floor.
    base = re.search(r"\.theme-opacity-wrap\s*\{([^}]*)\}", STYLE)
    assert base and "height: 22px" in base.group(1), "desktop base Peek stays 22px"
    assert "44px" not in base.group(1), "the desktop base must NOT carry a 44px floor"


def test_tablet_tier_caps_the_settings_window_so_the_rail_stacks():
    """769–920px viewport caps #settings-modal.ow-window narrow enough that its
    content is ≤480, so the existing 480 container tier stacks the rail. This is
    the deterministic fix for the tablet-820 stack/left knife-edge."""
    header = "@media (min-width: 769px) and (max-width: 920px)"
    start = STYLE.find(header)
    assert start != -1, "the tablet-tier settings window cap must exist"
    block = STYLE[start:STYLE.find("}", STYLE.find("}", start) + 1) + 1]
    assert "#settings-modal.ow-window" in block, "the cap must target the settings kit window"
    assert "max-width: 500px !important" in block, (
        "cap the window at 500px (content ≤ ~475px ⇒ under the 480 token) with "
        "!important to beat the kit's max-width:64vw base")


def test_tablet_cap_does_not_stack_via_viewport_media():
    """The cap must NOT itself flip the layout — stacking stays the container
    query's job (the ONE mechanism, S3). The viewport media block only sets a
    window width cap, never flex-direction."""
    header = "@media (min-width: 769px) and (max-width: 920px)"
    start = STYLE.find(header)
    block = STYLE[start:STYLE.find("}", STYLE.find("}", start) + 1) + 1]
    assert "flex-direction" not in block, (
        "the tablet cap must not stack directly — the @container 480 tier owns stacking")
