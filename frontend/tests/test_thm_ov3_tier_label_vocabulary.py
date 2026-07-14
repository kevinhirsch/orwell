"""THM-OV-3 (2026-07-14 theme-visual audit) — ONE glass-tier vocabulary: Glass / Frosted / Flat.

The theme window carried TWO vocabularies for the SAME three tiers: the Customize ladder
(#theme-glass-tier, Font & Layout) said **Full / Frosted / Off** while the Browse quick
control (#theme-glass-tier-quick, #1316) said **Glass / Frosted / Flat**. Owner ruling:
Glass / Frosted / Flat wins everywhere.

Scope pin (the wire contract): the `data-tier` attribute VALUES — full | frosted | normal —
are consumed by theme.js (applyGlassTier / _syncGlassTierControl / the persisted glassTier
string) and MUST NOT change. Labels and title tooltips only.
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

#: the one sanctioned label per wire value (owner vocabulary).
LABELS = {"full": "Glass", "frosted": "Frosted", "normal": "Flat"}


def _read(*p):
    with open(os.path.join(FRONTEND, *p), encoding="utf-8") as f:
        return f.read()


def _seg_buttons(html, seg_id):
    """The (data-tier, visible label) pairs of one segmented tier control."""
    m = re.search(r'<div id="%s"[^>]*>(.*?)</div>' % re.escape(seg_id), html, re.S)
    assert m, f"#{seg_id} control not found in index.html"
    return re.findall(r'<button[^>]*data-tier="(\w+)"[^>]*>(.*?)</button>', m.group(1), re.S)


def test_customize_ladder_speaks_glass_frosted_flat():
    html = _read("static", "index.html")
    btns = _seg_buttons(html, "theme-glass-tier")
    assert btns, "the Customize ladder has no tier buttons"
    for tier, label in btns:
        assert label.strip() == LABELS[tier], (
            f"THM-OV-3: the Customize ladder labels data-tier={tier!r} as {label.strip()!r} "
            f"— the one vocabulary is {LABELS[tier]!r} (Glass/Frosted/Flat everywhere)"
        )


def test_quick_control_speaks_glass_frosted_flat():
    html = _read("static", "index.html")
    btns = _seg_buttons(html, "theme-glass-tier-quick")
    assert btns, "the Browse quick control has no tier buttons"
    for tier, label in btns:
        assert label.strip() == LABELS[tier], (
            f"THM-OV-3: the quick control labels data-tier={tier!r} as {label.strip()!r} "
            f"— the one vocabulary is {LABELS[tier]!r}"
        )


def test_tier_wire_values_are_untouched():
    # the data-tier VALUES are the wire contract (theme.js persists/reads them) — both
    # controls must still carry exactly {full, frosted, normal}.
    html = _read("static", "index.html")
    for seg_id in ("theme-glass-tier", "theme-glass-tier-quick"):
        tiers = {t for t, _ in _seg_buttons(html, seg_id)}
        assert tiers == {"full", "frosted", "normal"}, (
            f"#{seg_id} wire values changed: {sorted(tiers)} — data-tier values are contract"
        )


def test_no_tier_button_anywhere_says_full_or_off():
    # the retired vocabulary must not creep back onto ANY tier segment in the shell.
    html = _read("static", "index.html")
    for tier, label in re.findall(r'<button[^>]*data-tier="(\w+)"[^>]*>(.*?)</button>',
                                  html, re.S):
        assert label.strip() not in ("Full", "Off"), (
            f"THM-OV-3: a tier button labels data-tier={tier!r} with the retired "
            f"vocabulary {label.strip()!r} — use {LABELS[tier]!r}"
        )
