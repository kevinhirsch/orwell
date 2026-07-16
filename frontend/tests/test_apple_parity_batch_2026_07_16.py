"""Apple Genius rendered-pixel-parity batch (2026-07-16) — source-pin gates.

Five CSS/JS fixes from a rendered-pixel-parity pass over the frosted/glass theme (contrast
measured on real renders). These are source-pinned convention checks (the FE has no DOM
runtime in this pytest lane) — they freeze the mechanism so it can't silently regress:

  G-2  Theme window segmented-control SELECTED pill: a higher-specificity generic
       vibrant-fill rule (`.ow-window .ow-body button:not(.ow-btn)`) was painting the
       `.theme-seg` selected pill's BACKGROUND with a translucent dark-tinted plate
       (composited light-grey on the light glass) while the pill's own `color:#fff` still
       won — white-on-light-grey at 1.55:1. Fixed by excluding `.theme-seg-btn` from that
       generic override so `.theme-seg`'s own base/selected rules govern.
  G-1  (unfixed half) `.msg-user` (sent bubble) bolded emphasis followed the base
       `.msg strong`/`.msg b` COOL syntax-highlight ink (teal `--hl-builtin`) instead of the
       fixed white sent-bubble ink — mirrors the #1644 `.msg-ai` fix.
  G-7  Settings-nav INACTIVE tab ink fell back to the dark-theme `--color-muted` (#9aa0a8,
       tuned for a dark backdrop) on the light frosted nav surface — 2.50:1. Scoped fix
       (NOT a global `--color-muted`/`--fg-muted` change).

Rendered visual proof lives in the Apple Genius session evidence (scratchpad screenshots);
these gates only pin the CSS mechanism.
"""
import re
from pathlib import Path

FRONTEND = Path(__file__).resolve().parents[1]
CSS = (FRONTEND / "static" / "style.css").read_text(encoding="utf-8")


def _relative_luminance(hex_color: str) -> float:
    hex_color = hex_color.lstrip("#")
    r, g, b = (int(hex_color[i : i + 2], 16) / 255 for i in (0, 2, 4))

    def lin(c: float) -> float:
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = lin(r), lin(g), lin(b)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _contrast(hex_a: str, hex_b: str) -> float:
    la, lb = _relative_luminance(hex_a), _relative_luminance(hex_b)
    la, lb = max(la, lb), min(la, lb)
    return (la + 0.05) / (lb + 0.05)


# ── G-2: the Theme window segmented-control selected pill ──────────────────────────────


def test_theme_seg_selected_pill_uses_system_blue_and_white_label():
    """The base (theme-independent) `.theme-seg` selected-pill rule must still pin the
    sanctioned system-blue fill + white label — this is the source of truth both tiers
    should resolve to once the generic override no longer clobbers it."""
    m = re.search(
        r'\.theme-seg > button\[aria-pressed="true"\][^{]*\{([^}]*)\}',
        CSS,
        re.DOTALL,
    )
    assert m, "the `.theme-seg` selected-pill rule must exist"
    body = m.group(1)
    assert "var(--ow-ios-blue" in body, "the selected pill must fill with the sanctioned system blue"
    assert "#fff" in body, "the selected pill's label must be white"


def test_generic_vibrant_fill_rule_excludes_theme_seg_buttons():
    """The generic `.ow-window .ow-body button:not(.ow-btn)` vibrant-fill override
    (KIT-F-01) has HIGHER specificity than `.theme-seg`'s own selected-pill rule and was
    winning the `background-color` war — painting the selected pill's fill light-grey
    while its `color:#fff` (set by a *different*, unaffected property) stayed white. Every
    occurrence of the base selector must now also exclude `.theme-seg-btn`, exactly like it
    already excludes `.ow-btn` (KIT-F-01 precedent), so `.theme-seg`'s own rules govern."""
    occurrences = re.findall(
        r"body\.theme-frosted \.ow-window \.ow-body button:not\(\.ow-btn\)(:not\(\.theme-seg-btn\))?",
        CSS,
    )
    assert occurrences, "the generic vibrant-fill selector must still exist"
    missing = [i for i, guard in enumerate(occurrences) if not guard]
    assert not missing, (
        f"{len(missing)}/{len(occurrences)} occurrence(s) of the generic "
        "`.ow-window .ow-body button:not(.ow-btn)` rule are missing the `:not(.theme-seg-btn)` "
        "guard — the Theme window's segmented pill will lose its blue fill again"
    )


# ── G-1 (unfixed half): `.msg-user` bolded emphasis ─────────────────────────────────────


def test_msg_user_emphasis_follows_the_sent_bubble_ink():
    """Mirrors the #1644 `.msg-ai` fix: every emphasis combinator inside a SENT bubble must
    drop the cool syntax-highlight ink and pin the fixed white sent-bubble ink instead."""
    selectors = [
        "strong", "b", "em", "i",
        "strong em", "em strong", "b i", "i b", "b em", "em b", "strong i", "i strong",
    ]
    for sel in selectors:
        pattern = r"body\.theme-frosted \.msg-user %s\s*[,{]" % re.escape(sel)
        assert re.search(pattern, CSS), f"missing `.msg-user {sel}` ink-follow rule"

    # the whole block must set color:#fff !important (the fixed sent-bubble pairing),
    # not `inherit` alone and never a leftover --hl-* token.
    m = re.search(
        r"body\.theme-frosted \.msg-user strong,.*?i strong\s*\{([^}]*)\}",
        CSS,
        re.DOTALL,
    )
    assert m, "the `.msg-user` emphasis block must exist as one rule family"
    body = m.group(1)
    assert "color: #fff !important" in body, "sent-bubble emphasis must pin white ink"
    assert "--hl-" not in body, "sent-bubble emphasis must not carry a syntax-highlight token"


# ── G-7: settings-nav inactive tab ink ───────────────────────────────────────────────────


def test_settings_nav_inactive_ink_is_scoped_not_global():
    """The fix must be scoped to `.settings-nav-item`, never a blanket `--color-muted` /
    `--fg-muted` token redefinition (which would ripple into unrelated muted text like chat
    timestamps and gadget captions)."""
    assert re.search(
        r"body\.theme-frosted \.settings-nav-item:not\(\.active\)\s*\{\s*color:\s*#([0-9a-fA-F]{6});?\s*\}",
        CSS,
    ), "a scoped `.settings-nav-item:not(.active)` ink rule must exist"


def test_settings_nav_inactive_ink_clears_aa_on_the_light_nav():
    m = re.search(
        r"body\.theme-frosted \.settings-nav-item:not\(\.active\)\s*\{\s*color:\s*#([0-9a-fA-F]{6});?\s*\}",
        CSS,
    )
    assert m, "the scoped ink rule must exist"
    ink = "#" + m.group(1)
    # the measured light-nav surface from the audit.
    contrast = _contrast(ink, "#f9f9fa")
    assert contrast >= 4.5, (
        f"{ink} on #f9f9fa measures {contrast:.2f}:1 — must clear the 4.5:1 AA floor"
    )
