"""The settings repair (S1, S2, S3, S12, A3) — source gates + the A3 ratchet.

S1: the modal sizes with clamp() against its overlay container and the whole
settings tree sits on the rem type scale (the density lever works again).
S2: short-viewport tier. S3: ONE narrow-layout switch (@container) with a
visible overflow affordance on the tab rail. A3/S12: the layout kit exists and
inline style= in settings.js only ratchets DOWN.
"""
import re
from pathlib import Path

FE = Path(__file__).resolve().parents[1]
STYLE = (FE / "static" / "style.css").read_text()
SETTINGS_JS = (FE / "static" / "js" / "settings.js").read_text()
INDEX = (FE / "static" / "index.html").read_text()

# A3: the ratchet ceiling. 219 at audit time → 212 after the kit sweep. Lower it
# as further sweeps land; NEVER raise it.
INLINE_STYLE_CAP = 212


def test_s1_modal_clamps_against_the_overlay_container():
    assert "width: clamp(560px, 58cqw, 880px)" in STYLE, "the modal must grow AND shrink (S1)"
    assert "max-height: min(85dvh, 720px)" in STYLE, "the dvh cap (S2)"
    assert "container-name: settings-overlay" in STYLE, "cqw needs the overlay container (S13)"
    assert not re.search(r"\.settings-modal-content \{[^}]*min\(720px", STYLE), \
        "the settings modal's old min()-only width must be gone"


def test_s1_rail_is_fluid():
    assert "width: clamp(140px, 18cqw, 200px)" in STYLE, "the fixed 160px rail absorbs nothing (S1)"


def test_s2_short_viewport_tier():
    assert "@media (max-height: 700px)" in STYLE and ".settings-layout { min-height: 0; }" in STYLE


def _settings_region():
    """The settings block proper: from the overlay container rule to the next section."""
    start = STYLE.find("container-name: settings-overlay")
    end = STYLE.find("/* ── Entrance Animations ── */")
    assert 0 < start < end
    return STYLE[start:end]


def test_s3_single_layout_switch():
    # Exactly one narrow-settings mechanism: the container query. No viewport copy.
    assert "@container settings-modal (max-width: 620px)" in STYLE
    assert "@media (max-width: 600px)" not in _settings_region(), \
        "the duplicate viewport copy must stay dead (S3)"


def test_s3_tab_rail_overflow_affordance():
    assert "mask-image: linear-gradient(to right" in STYLE, \
        "the clipped tab rail needs a visible affordance (S3)"


def test_s12_no_inline_px_font_sizes_in_the_settings_tree():
    assert not re.search(r"font-size:\s*\d+px", SETTINGS_JS), \
        "settings.js inline type must use the --fs-* scale (S12/S10)"
    assert not re.search(r"font-size:\s*\d+px", INDEX), \
        "index.html inline type must use the --fs-* scale (S12/S10)"


def test_s1_settings_css_region_is_on_the_scale():
    """The settings stretches of style.css carry no px font-sizes (the density
    lever and fluid root only work through rem)."""
    px = re.findall(r"font-size:\s*\d+px", _settings_region())
    assert not px, f"px type in the settings region (S1 cause #2): {px[:5]}"


def test_a3_layout_kit_exists():
    for cls in (".settings-section", ".settings-section-title", ".settings-divider",
                ".settings-hint", ".settings-row--end", ".settings-gap-top"):
        assert cls in STYLE, f"the settings layout kit is missing {cls} (A3)"


def test_a3_inline_style_ratchet():
    count = SETTINGS_JS.count('style="')
    assert count <= INLINE_STYLE_CAP, (
        f"settings.js inline style= grew to {count} (cap {INLINE_STYLE_CAP}) — "
        "compose the layout kit instead (A3)"
    )
