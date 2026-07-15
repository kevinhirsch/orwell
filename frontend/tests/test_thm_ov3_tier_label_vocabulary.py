"""THM-OV-3 (2026-07-14 theme-visual audit) + the frosted-tier COLLAPSE (owner ruling).

Originally THM-OV-3 unified TWO vocabularies for the SAME three tiers onto Glass / Frosted /
Flat everywhere. The owner then COLLAPSED the redundant middle tier: 'frosted' was glass
material minus the SVG refraction, and the refraction ALREADY auto-downgrades full→frosted on
constrained devices (theme.js glassTierCeiling), so frosted-as-a-manual-choice was invisible/
redundant. The user-facing control now offers ONE glass choice — Glass (full) or Flat (normal).
'frosted' survives ONLY as the automatic downgrade target (never a button, never in the
resolution layer's output; a legacy saved 'frosted' folds to Glass).

Scope pin (the wire contract): the `data-tier` attribute VALUES — full | normal — are
consumed by theme.js (applyGlassTier / _syncGlassTierControl / the persisted glassTier string)
and MUST NOT change. Labels and title tooltips only.
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

#: the one sanctioned label per user-facing wire value (owner vocabulary). 'frosted' is
#: intentionally absent — it is no longer a user-selectable segment.
LABELS = {"full": "Glass", "normal": "Flat"}


def _read(*p):
    with open(os.path.join(FRONTEND, *p), encoding="utf-8") as f:
        return f.read()


def _seg_buttons(html, seg_id):
    """The (data-tier, visible label) pairs of one segmented tier control."""
    m = re.search(r'<div id="%s"[^>]*>(.*?)</div>' % re.escape(seg_id), html, re.S)
    assert m, f"#{seg_id} control not found in index.html"
    return re.findall(r'<button[^>]*data-tier="(\w+)"[^>]*>(.*?)</button>', m.group(1), re.S)


def test_customize_ladder_speaks_glass_flat():
    html = _read("static", "index.html")
    btns = _seg_buttons(html, "theme-glass-tier")
    assert btns, "the Customize ladder has no tier buttons"
    for tier, label in btns:
        assert label.strip() == LABELS[tier], (
            f"the Customize ladder labels data-tier={tier!r} as {label.strip()!r} "
            f"— the one vocabulary is {LABELS[tier]!r} (Glass/Flat everywhere)"
        )


def test_quick_control_speaks_glass_flat():
    html = _read("static", "index.html")
    btns = _seg_buttons(html, "theme-glass-tier-quick")
    assert btns, "the Browse quick control has no tier buttons"
    for tier, label in btns:
        assert label.strip() == LABELS[tier], (
            f"the quick control labels data-tier={tier!r} as {label.strip()!r} "
            f"— the one vocabulary is {LABELS[tier]!r}"
        )


def test_tier_wire_values_are_the_collapsed_two():
    # The collapse: both controls now carry exactly {full, normal}. 'frosted' is no longer
    # a selectable segment (it survives only as the auto-downgrade target inside theme.js).
    html = _read("static", "index.html")
    for seg_id in ("theme-glass-tier", "theme-glass-tier-quick"):
        tiers = {t for t, _ in _seg_buttons(html, seg_id)}
        assert tiers == {"full", "normal"}, (
            f"#{seg_id} wire values are {sorted(tiers)} — the collapsed control must carry "
            "exactly {full, normal} (Glass / Flat); frosted is no longer a button"
        )


def test_no_frosted_or_retired_vocabulary_on_any_tier_button():
    # The collapsed-away 'frosted' segment AND the older retired vocabulary must not creep
    # back onto ANY tier segment in the shell.
    html = _read("static", "index.html")
    for tier, label in re.findall(r'<button[^>]*data-tier="(\w+)"[^>]*>(.*?)</button>',
                                  html, re.S):
        assert tier != "frosted", (
            "a data-tier=\"frosted\" button reappeared — frosted is collapsed into Glass and "
            "must not be offered as a manual choice"
        )
        assert label.strip() not in ("Full", "Off", "Frosted"), (
            f"a tier button labels data-tier={tier!r} with a retired/removed vocabulary "
            f"{label.strip()!r} — use {LABELS[tier]!r} (Glass / Flat only)"
        )
