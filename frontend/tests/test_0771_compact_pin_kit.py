"""#769 + #771 — the Cast "Compact pin" control is a first-class kit control.

Owner brief (full, proper reskin so #769 first-pass AND #771 follow-up both close):

  Replace the 📌 color emoji with a monochrome inline SVG (currentColor) consistent
  with the kit's icon language; style `.oc-pin` as a coherent, Apple-restrained kit
  button — small glass/kit-consistent control, dark legible ink on glass, soft hairline,
  NO accent on the label text, proper hover/active/toggled states, sensible shape, and a
  44px touch target on a coarse pointer. Keep it FUNCTIONAL (it toggles cast-pin compact
  mode). While here, bring the broader cast-pin gadget (orwellCastPin.js) into kit
  coherence (no color emoji in its placeholder).

These are SOURCE-PINNED convention checks (the look is render-verified in the PR via
browser screenshots over light + dark glass). They guard against the control regressing
back to a color emoji / unstyled-on-glass button.
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAST_JS = os.path.join(FRONTEND, "static", "js", "orwellCast.js")
CASTPIN_JS = os.path.join(FRONTEND, "static", "js", "orwellCastPin.js")
STYLE = os.path.join(FRONTEND, "static", "style.css")


def _read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def _oc_pin_button():
    """The Compact-pin <button> tag (id=oc-pin), inner markup included."""
    js = _read(CAST_JS)
    m = re.search(r'<button[^>]*id="oc-pin"[^>]*>.*?</button>', js, re.S)
    assert m, "the Compact-pin button (#oc-pin) must exist in orwellCast.js"
    return m.group(0)


def _oc_pin_css():
    """The first `#orwell-cast .oc-pin { ... }` base rule body (from the inline <style>)."""
    js = _read(CAST_JS)
    m = re.search(r"#orwell-cast \.oc-pin \{([^}]*)\}", js)
    assert m, "orwellCast.js must carry a `#orwell-cast .oc-pin` style rule"
    return m.group(1)


# ── 1. monochrome icon, no color emoji ──────────────────────────────────────

def test_compact_pin_has_no_color_emoji():
    btn = _oc_pin_button()
    assert "📌" not in btn, "the 📌 color emoji must be gone (off-brand vs the kit's monochrome icons)"
    # belt: no pushpin/people emoji anywhere on the control
    for emoji in ("📌", "📍", "👤", "👥"):
        assert emoji not in btn, f"no color emoji ({emoji}) on the Compact-pin control"


def test_compact_pin_uses_monochrome_inline_svg():
    btn = _oc_pin_button()
    assert "<svg" in btn and 'class="oc-pin-ic"' in btn, (
        "the glyph must be an inline SVG with class oc-pin-ic (kit icon language)"
    )
    assert 'stroke="currentColor"' in btn, (
        "the icon must stroke currentColor so it is monochrome and inherits the legible ink"
    )
    assert "fill" in btn and re.search(r'fill="none"', btn), (
        "the icon is a stroked (not filled) glyph — matches the kit's line-icon language"
    )


# ── 2. first-class kit button (rides .ow-btn) ───────────────────────────────

def test_compact_pin_is_a_kit_button():
    btn = _oc_pin_button()
    classes = re.search(r'class="([^"]*)"', btn).group(1).split()
    assert "ow-btn" in classes, (
        ".oc-pin must carry .ow-btn so it inherits the kit's shared glass material "
        "(specular rim, soft float shadow, dark legible ink) on the glass tier."
    )
    assert "ow-btn-secondary" in classes, (
        "use the secondary variant — a small restrained control, not a tinted primary CTA"
    )
    assert "oc-pin" in classes, "keep .oc-pin for the pin-specific overrides"


# ── 3. legible-on-glass ink + soft hairline, no accent on the label ─────────

def test_compact_pin_has_dark_legible_ink_on_glass():
    css = _oc_pin_css()
    # the kit's dark chrome ink (#16191f) — legible dark monochrome ink on the light glass.
    assert "#16191f" in css, (
        "the label ink must be the kit's dark chrome ink (#16191f), legible on the light "
        "glass material — never a light-on-light or accent-hued label"
    )


def test_compact_pin_label_carries_no_accent_hue():
    """The default/idle label must not be painted an accent colour (#726 kit rule:
    emphasis is luminosity + weight, never hue on the text)."""
    css = _oc_pin_css()
    color = re.search(r"(?:^|;)\s*color\s*:\s*([^;]+)", css)
    assert color, ".oc-pin must set an explicit text color"
    val = color.group(1).strip().lower()
    # accent tokens / the project red — never on the idle label.
    for accent in ("--accent", "var(--accent", "#e06c75", "var(--ow-ios-blue"):
        assert accent not in val, f"the idle label color must not be an accent ({accent}); got {val}"


def test_compact_pin_has_a_soft_hairline_not_a_hard_dark_border():
    css = _oc_pin_css()
    border = re.search(r"(?:^|;)\s*border\s*:\s*([^;]+)", css)
    assert border, ".oc-pin must declare a border"
    val = border.group(1).strip().lower()
    # a soft translucent hairline (color-mix to transparent), not the old hard var(--border).
    assert "color-mix" in val and "transparent" in val, (
        "the border must be a soft translucent hairline (color-mix … transparent), not the "
        f"old hard dark var(--border) stroke; got {val}"
    )
    assert "var(--border" not in val, "the hard dark var(--border) hairline is the #725 look we removed"


# ── 4. hover / active / toggled states ──────────────────────────────────────

def test_compact_pin_has_hover_active_focus_and_toggled_states():
    js = _read(CAST_JS)
    assert "#orwell-cast .oc-pin:hover" in js, "needs a hover state"
    assert "#orwell-cast .oc-pin:active" in js, "needs an active/pressed state"
    assert "#orwell-cast .oc-pin:focus-visible" in js, "needs a visible keyboard-focus ring"
    assert '#orwell-cast .oc-pin[aria-pressed="true"]' in js, (
        "needs a TOGGLED state keyed off aria-pressed (the two-state pin control)"
    )


def test_compact_pin_declares_aria_pressed_and_is_wired_live():
    btn = _oc_pin_button()
    assert "aria-pressed=" in btn, (
        "the toggle must declare aria-pressed (two-state control — AT + the toggled visual)"
    )
    js = _read(CAST_JS)
    # the pinned state is sourced from the gadget, not assumed, and updated on click.
    assert "OrwellCastPin.isPinned()" in js, "aria-pressed must reflect the live pinned state"
    assert 'setAttribute("aria-pressed"' in js, "the click handler must update aria-pressed"


# ── 5. still functional: it toggles the cast-pin compact mode ───────────────

def test_compact_pin_still_toggles_the_rail_gadget():
    js = _read(CAST_JS)
    assert "OrwellCastPin.setPinned(true)" in js, (
        "clicking Compact pin must still pin the roster into the control-room rail"
    )


# ── 6. the 44px coarse-pointer tap floor (single source of truth) ───────────

def test_compact_pin_has_a_44px_coarse_pointer_floor():
    css = _read(STYLE)
    # the RESP-1/2 touch block lifts .oc-pin to the 44px floor on a coarse pointer. Find the
    # `.oc-pin` rule, then confirm it lives in a coarse-pointer @media and carries 44px.
    pin = css.index("#orwell-cast .oc-pin {")
    head = css[:pin]
    media = head.rindex("@media")
    block = css[media:pin + 200]
    assert "pointer: coarse" in block, ".oc-pin's 44px rule must be inside a coarse-pointer @media"
    assert "44px" in block, (
        ".oc-pin must hit the 44px tap target (WCAG 2.5.5) on a coarse pointer (owned in style.css)"
    )


# ── 7. cast-pin gadget coherence (no color emoji placeholder) ───────────────

def test_castpin_gadget_placeholder_is_monochrome_svg():
    js = _read(CASTPIN_JS)
    assert "👤" not in js, (
        "the cast-pin gadget portrait placeholder must be a monochrome SVG silhouette "
        "(kit icon language), not the 👤 color emoji"
    )
    # a stroked silhouette glyph drawn in currentColor.
    assert "OCP_SILHOUETTE" in js, "a shared monochrome silhouette glyph constant"
    assert 'stroke="currentColor"' in js, "the silhouette strokes currentColor (monochrome)"
