"""#1638 — the color-well kit primitive (.ow-color-well).

A NEW foundational kit primitive framing a native color swatch — the Theme → Customize color
rows (20 `input[type="color"]`, all in index.html). It replaces the bespoke `.color-row` /
`.color-reset-btn` block. Source of the mandate: docs/design/1638-color-well-kit.md.

The non-negotiable contract this gate pins (source-pinned — the FE has no DOM runtime in the
pytest lane; visual correctness is the rendered demo + browser_smoke):
  1. `.ow-color-well` is DEFINED inside the ELEMENT KIT region (not stray app CSS);
  2. the swatch rule styles BOTH the native `input[type="color"]` AND colorPicker.js's swapped
     `input.cp-swatch-input`, and keeps the ::-webkit-/::-moz-color-swatch pseudo-rules;
  3. focus is the tokenized system-blue ring (`--ow-focus-ring`), NEVER the theme accent/red;
  4. label + reset ink carry NO accent hue (neutral `--ow-control-ink` only);
  5. the swatch hairline is the tokenized `--ow-control-rim`, not `var(--border)`;
  6. a coarse-pointer 44px hit floor on the WRAPPER's own box (single box model) — NO
     ::before/::after on the replaced color input — and the trailing reset carries the same
     floor, with the reset's [disabled] kept in lockstep with .changed in theme.js and a
     system-blue :focus-visible ring on the actionable reset;
  7. the 20 index.html wells are migrated (0 `.color-row`; the two inline-styled rows carry
     --start / --compact) and the bespoke `.color-row` / `.color-reset-btn` CSS is retired;
  8. the reference demo instantiates `.ow-color-well`;
  9. the swatch is NEVER a glass material (no backdrop-filter — it must show its own value).
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*p):
    with open(os.path.join(FRONTEND, *p), encoding="utf-8") as f:
        return f.read()


CSS = _read("static", "style.css")
KIT = CSS[CSS.index("── ELEMENT KIT ──"):CSS.index("── END ELEMENT KIT ──")]
# the color-well sub-block (authored last, just before the END marker).
COLORWELL = KIT[KIT.index(".ow-color-well {"):]
COLORWELL_NC = re.sub(r"/\*.*?\*/", "", COLORWELL, flags=re.S)   # comments blanked (avoid prose hits)
HTML = _read("static", "index.html")
DEMO = _read("static", "element_kit_demo.html")
THEME_JS = _read("static", "js", "theme.js")

# property-position color: (so `caret-color:` / `background-color:` / a selector `[style*=color:]`
# are not mis-read as a `color:` declaration).
_COLOR_DECL = re.compile(r"(?<![-\w])color\s*:\s*([^;{}]+)", re.I)


def _block(css, selector):
    """The declaration body of `selector {…}` (flat rule, no nested braces)."""
    m = re.search(re.escape(selector) + r"\s*\{([^}]*)\}", css)
    assert m, f"missing CSS rule: `{selector} {{ … }}`"
    return m.group(1)


def _balanced_media(css, header):
    """The brace-balanced body of the first `@media …` block whose text starts with `header`."""
    i = css.find(header)
    assert i != -1, f"missing `{header}` block"
    open_i = css.index("{", i)
    depth, j = 0, open_i
    while j < len(css):
        if css[j] == "{":
            depth += 1
        elif css[j] == "}":
            depth -= 1
            if depth == 0:
                return css[open_i + 1:j]
        j += 1
    raise AssertionError("unbalanced @media block")


# ── 1. defined inside the KIT region ─────────────────────────────────────────────────
def test_color_well_primitive_exists_in_kit_region():
    assert ".ow-color-well {" in KIT, "the .ow-color-well primitive must live in the ELEMENT KIT region"
    assert ".ow-color-well--start" in KIT and ".ow-color-well--compact" in KIT, \
        "the --start / --compact variants must be defined in the kit region"
    assert ".ow-color-well__reset" in KIT, "the reset sub-part must be defined in the kit region"


# ── 2. both the native input AND the colorPicker.js-swapped .cp-swatch-input ─────────
def test_color_well_styles_both_native_and_swapped_swatch():
    assert '.ow-color-well input[type="color"]' in COLORWELL, "the swatch rule must target the native input"
    assert ".ow-color-well input.cp-swatch-input" in COLORWELL, \
        "the swatch rule must ALSO target colorPicker.js's swapped .cp-swatch-input"
    # the native-picker pseudo-rules survive (the OS swatch chrome).
    assert "::-webkit-color-swatch-wrapper" in COLORWELL
    assert "::-webkit-color-swatch" in COLORWELL and "::-moz-color-swatch" in COLORWELL


# ── 3. tokenized system-blue focus ring — NOT the accent ─────────────────────────────
def test_color_well_focus_ring_is_system_blue_not_accent():
    body = _block(COLORWELL, ".ow-color-well input[type=\"color\"]:focus-visible,\n"
                             ".ow-color-well input.cp-swatch-input:focus-visible")
    assert "--ow-focus-ring" in body, "the focus ring must use the tokenized --ow-focus-ring"
    assert "--accent" not in body and "--red" not in body, \
        "the focus ring must NOT use the theme accent/red (the old `outline:1px solid var(--red)` is retired)"


# ── 4. label + reset ink carry NO accent hue ─────────────────────────────────────────
def test_color_well_label_and_reset_ink_carry_no_accent_hue():
    inks = [m.group(1).strip() for m in _COLOR_DECL.finditer(COLORWELL)]
    assert inks, "expected at least one color: declaration in the color-well block"
    for ink in inks:
        low = ink.lower()
        assert "--accent" not in low and "--ow-accent" not in low and "var(--red" not in low, \
            f"color-well ink must never be the accent/red hue, found `color: {ink}`"
        # every ink resolves to the neutral chrome ink or is transparent (the swatch text).
        assert low.startswith("var(--ow-control-ink") or low == "transparent", \
            f"color-well ink must be neutral --ow-control-ink / transparent, found `color: {ink}`"


# ── 5. the swatch hairline is the tokenized rim, not var(--border) ───────────────────
def test_color_well_hairline_is_tokenized():
    body = _block(COLORWELL, '.ow-color-well input[type="color"],\n.ow-color-well input.cp-swatch-input')
    assert "border: 1px solid var(--ow-control-rim)" in body, \
        "the swatch hairline must be the tokenized --ow-control-rim"
    assert "var(--border)" not in COLORWELL_NC, "the color-well must not use the raw var(--border) hairline"


# ── 6. coarse-pointer 44px floor on the WRAPPER (single box model), + reset a11y ─────
def test_color_well_has_44px_coarse_pointer_floor():
    coarse = _balanced_media(COLORWELL, "@media (any-pointer: coarse)")
    # the WRAPPER owns the hit area (single box model), floored to the tap-min token.
    m = re.search(r"\.ow-color-well\s*\{[^}]*min-height:\s*(?:var\(--ow-tap-min[^)]*\)|44px)", coarse)
    assert m, "the .ow-color-well wrapper must own the 44px coarse-pointer floor (min-height)"
    # the swatch's OWN hit box grows via padding (NOT a pseudo-element overlay).
    assert re.search(r'input\[type="color"\][^{]*,[^{]*input\.cp-swatch-input\s*\{[^}]*padding:', coarse), \
        "the swatch hit box must grow via padding on the coarse pointer"
    assert "::before" not in COLORWELL_NC and "::after" not in COLORWELL_NC, \
        "the coarse hit target must NOT be a ::before/::after overlay on the replaced color input"
    # the trailing reset carries the same 44px floor.
    reset = re.search(r"\.ow-color-well__reset\s*\{([^}]*)\}", coarse)
    assert reset, "the reset must have a coarse-pointer floor rule"
    assert re.search(r"min-width:\s*(?:var\(--ow-tap-min[^)]*\)|44px)", reset.group(1)) and \
        re.search(r"min-height:\s*(?:var\(--ow-tap-min[^)]*\)|44px)", reset.group(1)), \
        "the reset must snap to 44x44 on a coarse pointer"


def test_color_well_reset_disabled_synced_with_changed_and_has_focus_ring():
    # the actionable (.changed) reset shows a system-blue :focus-visible ring.
    ring = _block(COLORWELL, ".ow-color-well__reset.changed:focus-visible")
    assert "--ow-focus-ring" in ring, "the changed reset must show the system-blue focus ring"
    # theme.js keeps [disabled] in lockstep with .changed (an unchanged, invisible reset is inert
    # AND out of the tab order). Both the base and advanced reset syncs set btn.disabled.
    assert THEME_JS.count("btn.disabled = !changed") >= 2, \
        "theme.js must toggle the reset's [disabled] in lockstep with .changed (base + advanced)"
    # and it still toggles the .changed visibility class.
    assert "classList.toggle('changed', changed)" in THEME_JS


# ── 7. the 20 index.html wells are migrated ──────────────────────────────────────────
def test_index_color_wells_migrated():
    assert 'class="color-row"' not in HTML, "no bespoke .color-row must remain in index.html"
    assert 'class="color-reset-btn"' not in HTML, "no bespoke .color-reset-btn must remain in index.html"
    assert HTML.count('type="color"') == 20, "expected 20 color swatches"
    # 18 base wells + the two inline-styled special rows carrying the variants = 20.
    assert HTML.count('class="ow-color-well"') == 18, "expected 18 plain .ow-color-well rows"
    assert HTML.count("ow-color-well--start") == 1 and HTML.count("ow-color-well--compact") == 1, \
        "the harmony-accent (--start) and effect-color (--compact) rows must carry the variants"
    # the retired inline styles are gone from the migrated rows.
    assert "justify-content:flex-start;gap:8px;" not in HTML, "the --start row's inline style must be dropped"
    assert HTML.count('class="ow-color-well__reset"') == 19, "the 19 resets must be the __reset sub-part"


# ── 8. the bespoke CSS is retired ────────────────────────────────────────────────────
def test_bespoke_color_row_css_retired():
    assert ".color-row {" not in CSS, "the bespoke .color-row base rule must be retired"
    assert ".color-reset-btn" not in CSS, "the bespoke .color-reset-btn rules must be retired"
    # the hover-highlight re-points to the kit class.
    assert "#theme-tab-customize .ow-color-well:hover" in CSS, \
        "the theme-zone hover-highlight must re-point to .ow-color-well"


# ── 9. the reference demo instantiates the primitive ─────────────────────────────────
def test_demo_shows_color_well():
    assert "Color well" in DEMO, "the demo needs a labeled color-well section"
    assert "ow-color-well" in DEMO and "ow-color-well__reset" in DEMO, \
        "the demo must instantiate a labelled swatch + reset"
    assert 'type="color"' in DEMO, "the demo color well must carry a real color swatch"
    assert "ow-color-well--start" in DEMO and "ow-color-well--compact" in DEMO, \
        "the demo should show the --start and --compact variants"


# ── 10. the swatch is never a glass material ─────────────────────────────────────────
def test_flat_tier_swatch_is_not_glass():
    assert "backdrop-filter" not in COLORWELL, \
        "the swatch must show its picked value — never a backdrop-filter that would blur it"
