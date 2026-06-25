"""#756 (Liquid Glass cleanup) — the reduced-transparency opaque-fallback GATE.

Apple's HIG mandates testing custom Liquid Glass against the three a11y settings.
The `prefers-reduced-transparency: reduce` fallback (style.css ~37737) forces every
`body.theme-frosted` glass surface SOLID/opaque so text-over-content stays legible for
users who asked for reduced transparency.

The recurring regression this gate freezes: every NEW glass surface (House pill, sheets,
dock, gadget cards, the kit windows, chrome popovers, …) must ALSO be added to the
reduced-transparency opaque-fallback set, or it silently keeps its translucency for those
users (illegible text). The a11y `@media` block and the canonical glass-material list have
no compiler tying them together — they drift by hand.

So this gate DERIVES the glass-surface set from the SAME source list the material itself
uses — the single `body.theme-frosted … { background-color: var(--ow-glass-light-color) }`
rule (the one place every glassed surface is enumerated to receive the ONE light glass) —
and asserts each surface has a `prefers-reduced-transparency: reduce` opaque fallback. A
future surface added to the material list WITHOUT a fallback fails here loudly.

Source-pinned (the FE has no DOM runtime in the pytest lane), folded alongside the F-3 /
test_ow_design_system.py ratchet style.
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*p):
    with open(os.path.join(FRONTEND, *p), encoding="utf-8") as f:
        return f.read()


CSS = _read("static", "style.css")


def _selectors_before(decl_marker):
    """Return the `.foo`/`#bar` selectors of the single rule whose body contains
    `decl_marker`, by walking back from the declaration to the rule's opening brace
    (bounded by the previous `}`)."""
    idx = CSS.index(decl_marker)
    brace = CSS.rfind("{", 0, idx)
    prev_close = CSS.rfind("}", 0, brace)
    sel_text = CSS[prev_close + 1:brace]
    return re.findall(r"body\.theme-frosted\s+([.#][\w-]+)", sel_text)


# ── the CANONICAL glass-surface source list ──────────────────────────────────
# The ONE rule that paints every glassed surface with the shared light-glass fill.
# This is the same enumeration the a11y/material code references, so deriving from it
# keeps the gate in sync: add a surface to the material → it must appear here → it must
# have a reduced-transparency fallback (asserted below).
GLASS_MATERIAL_DECL = "background-color: var(--ow-glass-light-color) !important;"

# The opaque fallback block: forces SOLID (panel fill, no backdrop-filter/translucency).
RT_FALLBACK_DECL = "background-color: var(--panel, var(--bg)) !important;"


def test_canonical_glass_material_list_is_nonempty():
    """Guard the gate itself: if the material rule is refactored/renamed, fail loudly
    rather than silently passing on an empty derived set."""
    sels = _selectors_before(GLASS_MATERIAL_DECL)
    assert len(sels) >= 8, (
        "could not derive the canonical glass-surface list from the "
        f"`{GLASS_MATERIAL_DECL}` rule (got {sels}); the material rule moved/renamed — "
        "re-point this gate at the new canonical enumeration."
    )


def test_reduced_transparency_block_exists_and_forces_opaque():
    assert "@media (prefers-reduced-transparency: reduce)" in CSS
    assert RT_FALLBACK_DECL in CSS, (
        "the reduced-transparency block must force a SOLID panel fill "
        f"(`{RT_FALLBACK_DECL}`) so glass goes opaque for the a11y setting."
    )
    # and it drops the translucency machinery (blur + bg image) on the fallback.
    rt = CSS[CSS.index("@media (prefers-reduced-transparency: reduce)"):]
    rt_first = rt[: rt.index(RT_FALLBACK_DECL) + 400]
    assert "backdrop-filter: none" in rt_first
    assert "background-image: none" in rt_first


def test_every_glass_surface_has_reduced_transparency_opaque_fallback():
    """THE GATE: every surface in the canonical glass-material list must appear in the
    `prefers-reduced-transparency: reduce` opaque-fallback selector set. A new glass
    surface added to the material without a fallback regresses legibility for users who
    requested reduced transparency — and fails HERE."""
    glass = _selectors_before(GLASS_MATERIAL_DECL)

    # The opaque-fallback selector set: the selectors of the RT rule that forces the
    # solid panel fill (the one carrying RT_FALLBACK_DECL).
    fallback = set(_selectors_before(RT_FALLBACK_DECL))

    missing = [s for s in glass if s not in fallback]
    assert not missing, (
        "glass surface(s) missing a `prefers-reduced-transparency: reduce` opaque "
        f"fallback: {missing}. Add each to the RT block (style.css ~37737) so it goes "
        "SOLID (var(--panel)) — translucent text-over-content is illegible for users "
        "who asked for reduced transparency."
    )
