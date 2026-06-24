"""The Orwell design-system ratchet (F-3 style) — one shared token set the kits +
the .ow-*/.og-*/.on-* families compose, enforced so surfaces can't drift back to
bespoke chrome values.

Source-pinned (the FE has no DOM runtime in the pytest lane). Pins:
  • the single design-token block exists (spacing/radius/type/accent/glass material
    + the kit-owned .ow-btn button system);
  • the glass material is NEUTRAL (no hue) with restrained saturation;
  • the shared button base + its prominent/secondary/icon variants exist;
  • the spacing scale is referenced (not re-invented) by the kit surfaces.

This is the typography/buttons/spacing/material consolidation (HIG Materials /
Buttons / Layout #695 / Typography #696) tied back to the kits + DWE windowing lane.
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*p):
    with open(os.path.join(FRONTEND, *p), encoding="utf-8") as f:
        return f.read()


CSS = _read("static", "style.css")


def test_design_system_token_block_exists():
    assert "THE ORWELL DESIGN SYSTEM" in CSS


def test_spacing_scale_tokens():
    for t in ("--ow-space-1", "--ow-space-2", "--ow-space-3", "--ow-space-4", "--ow-tap-min"):
        assert t in CSS, t
    # the scale references the app's existing --space-* (one rhythm, not re-invented).
    assert "var(--space-2" in CSS


def test_radius_scale_concentric_aware():
    for t in ("--ow-radius", "--ow-radius-inner", "--ow-radius-pill"):
        assert t in CSS, t


def test_type_ramp_sf_default():
    # SF system stack + the weight ramp (no thin on glass).
    assert "--ow-ui-font" in CSS and "-apple-system" in CSS
    for t in ("--ow-fw-regular", "--ow-fw-medium", "--ow-fw-semibold"):
        assert t in CSS, t


def test_kit_owned_button_base_and_variants():
    # ONE source of truth for buttons: .ow-btn base + prominent/secondary/icon variants.
    for sel in (".ow-btn", ".ow-btn-prominent", ".ow-btn-secondary", ".ow-btn-icon"):
        assert sel in CSS, sel


def test_glass_material_is_neutral_no_hue():
    # the material tokens are neutral veils (white/near-black rgba), never a hued
    # theme color, and saturation stays restrained (colorless frost).
    assert "--ow-glass-veil-light" in CSS and "--ow-glass-veil-dark" in CSS
    sats = [int(s) for s in re.findall(r"--ow-glass-backdrop[^:]*:\s*[^;]*saturate\((\d+)%\)", CSS)]
    assert sats and all(s <= 125 for s in sats), f"glass saturation too high: {sats}"


def test_no_accent_hue_on_glass_buttons():
    # the kit button base must not bake an accent hue into the glass (owner: glass is
    # colorless; prominent = luminosity + weight, not color).
    base = re.search(r"\.ow-btn-prominent\s*\{(.*?)\}", CSS, re.S)
    assert base and "--accent" not in base.group(1) and "--ow-accent" not in base.group(1)


def test_accent_token_exists_for_deliberate_nonglass_use():
    # the accent token still exists (for deliberate non-glass semantics), it's just not
    # applied to the glass material/buttons.
    assert "--ow-accent" in CSS
