"""#1638 — the compact / icon kit button primitives (.ow-btn-icon / .ow-btn-compact).

New foundational kit primitives for the deliberately SUB-44px desktop chrome the 44px pill
can't serve (composer icon buttons, sidebar/section headers, model-picker, hamburger,
gadget-rail icon buttons over the dark wallpaper):

  • .ow-btn-icon    — a SQUARE, FLAT icon button: equal width/height (tunable
                      `--ow-btn-icon-size`, sub-44px default), a SUBTLE radius (NOT the full
                      pill, NOT a circular disc), no text padding, a centered glyph.
  • .ow-btn-compact — a FLAT, reduced-height TEXT button (still shows a label), shorter than
                      the 44px pill for dense chrome.
  • .ow-btn-icon.ow-btn-xs — an even smaller (~24px) icon size for the 24px chrome.

The non-negotiable contract this gate pins (source-pinned — the FE has no DOM runtime in the
pytest lane; visual correctness is the rendered demo + browser_smoke):
  1. both primitives are DEFINED in style.css, in BOTH theme tiers (frosted + flat);
  2. both are SUB-44px on a fine pointer (the compact/icon whole point) — the icon via an
     equal width/height sub-44 default, the compact via a sub-44 min-height;
  3. the icon is SQUARE with a subtle radius — NOT a circular disc (no `border-radius: 50%`)
     and NOT the full pill;
  4. both SNAP to the 44px touch floor on a coarse pointer (WCAG 2.5.5) — the
     `@media (any-pointer: coarse)` floor exists for both;
  5. ink is WALLPAPER-AWARE — the frosted tier inks the adaptive `var(--fg)` token (light over
     the dark wallpaper; the W3 `--fg` remap re-inks it dark inside a light-glass card), and
     that adaptive-over-wallpaper decision is REGISTERED in the #1644/W1 COOL_REGISTRY in the
     SAME change (so the closed-world text-ink gate stays green by DECISION, not by accident);
  6. the reference demo (element_kit_demo.html) instantiates both, with real glyphs + the
     xs size, so every tier renders them.
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*p):
    with open(os.path.join(FRONTEND, *p), encoding="utf-8") as f:
        return f.read()


CSS = _read("static", "style.css")
DEMO = _read("static", "element_kit_demo.html")
W1 = _read("tests", "test_1644_text_ink_polarity.py")


def _block(css, selector):
    """The declaration body of `selector {…}` (selector matched literally, then a single
    brace-balanced-free block — the kit rules contain no nested braces)."""
    m = re.search(re.escape(selector) + r"\s*\{([^}]*)\}", css)
    assert m, f"missing CSS rule: `{selector} {{ … }}`"
    return m.group(1)


def _media_blocks(css, header_re):
    """Every `@media (...) { … }` body whose header matches `header_re`, brace-BALANCED to the
    block's ACTUAL closing brace. Unlike `_block` (flat rules only), an @media block nests
    rules, so we count braces to the matching `}` instead of slicing a fixed width."""
    out = []
    for m in re.finditer(header_re, css):
        open_i = css.index("{", m.start())   # the @media block's opening brace
        depth, j = 0, open_i
        while j < len(css):
            if css[j] == "{":
                depth += 1
            elif css[j] == "}":
                depth -= 1
                if depth == 0:
                    break
            j += 1
        out.append(css[open_i + 1:j])
    return out


# ── 1. both primitives exist, in BOTH tiers ──────────────────────────────────────────
def test_both_primitives_defined_in_both_tiers():
    for sel in (
        "body.theme-frosted .ow-btn-icon",
        "body.theme-frosted .ow-btn-compact",
        "body:not(.theme-frosted) .ow-btn-icon",
        "body:not(.theme-frosted) .ow-btn-compact",
    ):
        assert sel in CSS, f"the {sel} primitive rule is missing"


# ── 2. sub-44px on a fine pointer (the compact/icon point) ───────────────────────────
def test_icon_is_square_and_sub_44_on_fine_pointer():
    body = _block(CSS, "body.theme-frosted .ow-btn-icon")
    # equal width/height, sized by the tunable token with a sub-44 default.
    assert "width: var(--ow-btn-icon-size" in body and "height: var(--ow-btn-icon-size" in body, body
    m = re.search(r"--ow-btn-icon-size,\s*(\d+)px", body)
    assert m, "the icon size needs a numeric px default (`var(--ow-btn-icon-size, NNpx)`)"
    assert int(m.group(1)) < 44, f"the fine-pointer icon default must be sub-44px, got {m.group(1)}px"
    assert "min-height: 0" in body, "the icon must drop the base 44px min-height floor on fine pointers"
    assert "padding: 0" in body, "an icon button carries no text padding"


def test_compact_is_reduced_height_sub_44():
    body = _block(CSS, "body.theme-frosted .ow-btn-compact")
    m = re.search(r"min-height:\s*(\d+)px", body)
    assert m and int(m.group(1)) < 44, f"compact must be sub-44px tall on a fine pointer, got {m and m.group(1)}"


# ── 3. the icon is SQUARE (subtle radius) — NOT a circular disc, NOT the full pill ───
def test_icon_is_square_not_a_disc_or_pill():
    for sel in ("body.theme-frosted .ow-btn-icon", "body:not(.theme-frosted) .ow-btn-icon"):
        body = _block(CSS, sel)
        assert "border-radius: 50%" not in body, f"{sel} must be a SQUARE, not a circular disc"
        assert "9999px" not in body and "999px" not in body and "--ow-btn-radius" not in body, \
            f"{sel} must carry a SUBTLE radius, not the full pill"
        assert re.search(r"border-radius:\s*\d+px", body), f"{sel} needs an explicit subtle px radius"


# ── 4. coarse-pointer 44px floor (WCAG 2.5.5) for BOTH ───────────────────────────────
def test_coarse_pointer_44_floor_exists_for_both():
    # the compact/icon floor lives in an `@media (any-pointer: coarse)` block (there are several
    # such blocks in the file — pick the one that floors BOTH primitives). Scope each candidate
    # to its ACTUAL closing brace (brace-balanced), not a fragile fixed-width slice.
    windows = _media_blocks(CSS, r"@media \(any-pointer: coarse\)\s*\{")
    floor = next((w for w in windows if ".ow-btn-icon" in w and ".ow-btn-compact" in w), None)
    assert floor, "no @media (any-pointer: coarse) block floors both compact/icon buttons"
    assert re.search(
        r"\.ow-btn-icon\s*\{[^}]*min-width:\s*44px\s*!important[^}]*min-height:\s*44px\s*!important", floor
    ), "the icon must snap to 44x44 (min-width+min-height 44px !important) on a coarse pointer"
    # the compact text button must ALSO snap to 44px WIDE (a short label can render <44px wide),
    # not just tall — WCAG 2.5.5 is 44x44 (#1653).
    assert re.search(
        r"\.ow-btn-compact\s*\{[^}]*min-width:\s*44px\s*!important[^}]*min-height:\s*44px\s*!important", floor
    ), "the compact text button must snap to 44x44 (min-width+min-height 44px !important) on a coarse pointer"


# ── 4b. flat no-lift hover: scoped + ordered so it WINS over the generic lift (#1653) ─
def test_flat_no_lift_hover_scoped_and_ordered_after_generic():
    # the flat compact/icon no-lift hover must be `body:not(.theme-frosted)`-scoped — EQUAL
    # (0,3,1) specificity to the generic `.ow-btn:hover` — so nothing but source order decides.
    icon_hover = CSS.find("body:not(.theme-frosted) .ow-btn-icon:hover")
    compact_hover = CSS.find("body:not(.theme-frosted) .ow-btn-compact:hover")
    assert icon_hover != -1, "the flat icon no-lift hover must be body:not(.theme-frosted)-scoped"
    assert compact_hover != -1, "the flat compact no-lift hover must be body:not(.theme-frosted)-scoped"
    # …and it must be DECLARED AFTER the generic `body:not(.theme-frosted) .ow-btn:hover`, so at
    # equal specificity source order makes it win (the #1653 flat-hover fix — else the generic
    # lift + `--own-flat-fill-hover` fill would override it).
    generic = CSS.find("body:not(.theme-frosted) .ow-btn:hover")
    assert generic != -1, "the generic flat `.ow-btn:hover` rule is missing"
    assert icon_hover > generic and compact_hover > generic, \
        "the flat no-lift hover must be ordered AFTER the generic `.ow-btn:hover` to win at equal specificity"
    # and the no-lift rule actually neutralizes the lift.
    body = _block(CSS, "body:not(.theme-frosted) .ow-btn-compact:hover")
    assert "transform: none" in body, "the flat no-lift hover must set `transform: none`"


# ── 5. wallpaper-aware ink + the W1 registry decision in the same change ──────────────
def test_frosted_ink_is_wallpaper_adaptive():
    for sel in ("body.theme-frosted .ow-btn-icon", "body.theme-frosted .ow-btn-compact"):
        body = _block(CSS, sel)
        assert "color: var(--fg)" in body, f"{sel} must ink the adaptive wallpaper-aware var(--fg)"
        # flat chrome, not a floating glass plate — so it drops onto the wallpaper AND a card.
        assert "background: transparent" in body, f"{sel} must be flat/transparent chrome"


def test_no_bespoke_hex_ink_introduced():
    # the primitives must ink via tokens only — never an un-allowlisted bespoke hex (W1 mandate).
    for sel in (
        "body.theme-frosted .ow-btn-icon", "body.theme-frosted .ow-btn-compact",
        "body:not(.theme-frosted) .ow-btn-icon", "body:not(.theme-frosted) .ow-btn-compact",
    ):
        body = _block(CSS, sel)
        assert "color: var(--fg)" in body, f"{sel} must ink the adaptive token var(--fg)"
        # no bespoke hex text color (a real `color:` decl, not `border-color`/`background-color`).
        assert not re.search(r"(?<![-\w])color:\s*#[0-9a-fA-F]", body), f"{sel} inks a bespoke hex"


def test_adaptive_ink_registered_in_w1_gate():
    # the sanctioned closed-world path: the frosted var(--fg) inks are registered as
    # "adaptive-wallpaper" in the #1644 W1 gate, in THIS change — else the gate would fail closed.
    for sel in ("body.theme-frosted .ow-btn-icon", "body.theme-frosted .ow-btn-compact"):
        assert f"'{sel}'" in W1, f"{sel} must be registered in the #1644 W1 COOL_REGISTRY"
    # and EACH registration is the adaptive-wallpaper classification (not some other bucket) —
    # BOTH primitives, not just the icon (#1653: the compact button must be covered too).
    for sel in ("body.theme-frosted .ow-btn-icon", "body.theme-frosted .ow-btn-compact"):
        reg = re.search(r"'" + re.escape(sel) + r"':\s*\(\s*\"([^\"]+)\"", W1)
        assert reg and reg.group(1) == "adaptive-wallpaper", \
            f"{sel} must register as adaptive-wallpaper"


# ── 6. the reference demo instantiates both ──────────────────────────────────────────
def test_demo_shows_compact_and_icon():
    # a clearly-labeled section + both primitives with real glyphs + the xs size.
    assert "Compact &amp; icon buttons" in DEMO, "the demo needs a labeled compact/icon section"
    assert "ow-btn ow-btn-icon" in DEMO, "the demo must instantiate .ow-btn-icon"
    assert "ow-btn ow-btn-compact" in DEMO, "the demo must instantiate .ow-btn-compact"
    assert "ow-btn-icon ow-btn-xs" in DEMO, "the demo must show the xs icon size"
    for glyph in ("✕", "⋯", "✎", "＋"):
        assert glyph in DEMO, f"the demo icon buttons should carry a real glyph ({glyph})"
    # disabled state present for both.
    assert re.search(r'ow-btn-icon"\s+disabled', DEMO), "the demo must show a disabled icon button"
    assert re.search(r'ow-btn-compact"\s+disabled', DEMO), "the demo must show a disabled compact button"
