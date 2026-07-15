"""#1638 — the keycap kit primitive (.ow-kbd / .ow-kbd-group).

A NEW foundational kit primitive for the Settings → Shortcuts key-chips: a passive
`<kbd class="ow-kbd">` glyph rendering one key of a shortcut combo. It replaces the bespoke
`.shortcut-key kbd` block, whose headline contract violation (#726/#773) was painting the
keycap's GLYPH in the theme accent (`color: var(--accent, var(--red))`) plus an accent fill
and border. The migration's core win is a NEUTRAL, legible, glass-consistent keycap whose
emphasis comes from the raised-chip SHAPE (a physical key), not a hue on the glyph.

Source-pinned checks (the FE has no DOM runtime in the pytest lane; visual correctness is the
rendered demo + browser_smoke). Mirrors test_1638_compact_icon_kit.py / test_0771_compact_pin_kit.py.
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*p):
    with open(os.path.join(FRONTEND, *p), encoding="utf-8") as f:
        return f.read()


CSS = _read("static", "style.css")
KIT = CSS[CSS.index("── ELEMENT KIT ──"):CSS.index("── END ELEMENT KIT ──")]
SETTINGS = _read("static", "js", "settings.js")
DEMO = _read("static", "element_kit_demo.html")


def _block(css, selector):
    """The declaration body of `selector {…}` — matched literally then a single brace-free block
    (the flat kit rules contain no nested braces)."""
    m = re.search(re.escape(selector) + r"\s*\{([^}]*)\}", css)
    assert m, f"missing CSS rule: `{selector} {{ … }}`"
    return m.group(1)


# ── 1 ───────────────────────────────────────────────────────────────────────────
def test_keycap_primitive_exists_in_kit_region():
    assert ".ow-kbd" in KIT, ".ow-kbd primitive must be authored inside the ELEMENT KIT region"


# ── 2 — the headline contract fix: NEUTRAL ink, NEVER the accent ──────────────────
def test_keycap_ink_is_neutral_not_accent():
    body = _block(KIT, ".ow-kbd")
    color = re.search(r"(?<![\w-])color\s*:\s*([^;]+);", body)
    assert color, ".ow-kbd must set a color"
    val = color.group(1)
    assert "--ow-control-ink" in val or "#16191f" in val, \
        f".ow-kbd color must be the neutral --ow-control-ink (or the #16191f literal), got: {val}"
    assert "--accent" not in body and "var(--red" not in body and "--ow-accent" not in body, \
        ".ow-kbd must NOT reference any accent token anywhere in its block (the #726/#773 fix)"


# ── 3 — fill + border are neutral tokens ──────────────────────────────────────────
def test_keycap_fill_and_border_are_neutral_tokens():
    body = _block(KIT, ".ow-kbd")
    assert "--ow-control-fill" in body, ".ow-kbd background must use --ow-control-fill"
    assert "--ow-control-rim" in body, ".ow-kbd border must use --ow-control-rim"
    assert "var(--accent" not in body and "var(--red" not in body, \
        ".ow-kbd fill/border must not use an accent token"


# ── 4 — emphasis by SHAPE (raised chip), not hue ──────────────────────────────────
def test_keycap_has_chip_depth():
    body = _block(KIT, ".ow-kbd")
    shadow = re.search(r"box-shadow\s*:\s*([^;]+);", body)
    assert shadow, ".ow-kbd must have a box-shadow for the raised-key look"
    val = shadow.group(1)
    assert "inset" in val, ".ow-kbd box-shadow must include an inset top rim (the key face)"


# ── 5 — Full Glass takes the shared sample ────────────────────────────────────────
def test_keycap_full_glass_takes_the_shared_sample():
    body = _block(KIT, "body.glass-full .ow-kbd")
    assert "--ow-btn-glass" in body, \
        "body.glass-full .ow-kbd must compose the shared --ow-btn-glass backdrop sample"
    assert "backdrop-filter" in body


def _media_body(css, header_re):
    """Every `@media (...) { … }` body whose header matches `header_re`, brace-BALANCED to the
    block's ACTUAL closing brace (nested rules count braces to the matching `}`)."""
    out = []
    for m in re.finditer(header_re, css):
        open_i = css.index("{", m.start())
        depth, i = 0, open_i
        while i < len(css):
            if css[i] == "{":
                depth += 1
            elif css[i] == "}":
                depth -= 1
                if depth == 0:
                    out.append(css[open_i + 1:i])
                    break
            i += 1
    return out


# ── 6 — a11y trio subset ──────────────────────────────────────────────────────────
def test_keycap_honors_a11y_trio_subset():
    # reduced-transparency solid fallback on .ow-kbd (find the media block that scopes .ow-kbd)
    rt = [b for b in _media_body(KIT, r"prefers-reduced-transparency\s*:\s*reduce") if ".ow-kbd" in b]
    assert rt, ".ow-kbd must have a prefers-reduced-transparency solid fallback"
    body = rt[0]
    assert "backdrop-filter: none" in body, \
        "the reduced-transparency fallback must disable backdrop-filter"
    # and it must also neutralize the higher-specificity Full-Glass rule
    assert "body.glass-full .ow-kbd" in body, \
        "the reduced-transparency block MUST match the body.glass-full .ow-kbd specificity, or the " \
        "Full-Glass rule keeps its backdrop-filter and the user preference is ignored"
    # prefers-contrast border bump
    pc = [b for b in _media_body(KIT, r"prefers-contrast\s*:\s*more") if ".ow-kbd" in b]
    assert pc, ".ow-kbd must have a prefers-contrast: more border bump"


# ── 7 — the producer emits the kit class ──────────────────────────────────────────
def test_settings_emits_kit_keycap():
    assert '<kbd class="ow-kbd">' in SETTINGS, \
        "settings.js _formatKeyCaps must emit <kbd class=\"ow-kbd\">"
    # no bare <kbd> (no class) survives
    assert not re.search(r"<kbd>(?!\s*class)", SETTINGS), \
        "no bare <kbd> (without the .ow-kbd class) may remain in settings.js"
    assert "<kbd>${label}</kbd>" not in SETTINGS


# ── 8 — BOTH legacy accent selectors retired ─────────────────────────────────────
def test_bespoke_shortcut_key_kbd_css_retired():
    # No `.shortcut-key kbd` selector (base or .listening) may carry accent styling.
    for m in re.finditer(r"\.shortcut-key(?:\.listening)?\s+kbd\s*\{([^}]*)\}", CSS):
        body = m.group(1)
        assert "var(--accent" not in body and "var(--red" not in body, \
            "a .shortcut-key kbd selector still carries an accent token: %r" % body
    # the accent-hued keycap block (identified by its accent color declaration) must be gone
    assert not re.search(r"\.shortcut-key\s+kbd\s*\{[^}]*color:\s*var\(--accent", CSS), \
        "the legacy accent-hued .shortcut-key kbd block must be deleted"
    assert not re.search(r"\.shortcut-key\.listening\s+kbd\s*\{", CSS), \
        "the .shortcut-key.listening kbd accent-border rule must be deleted (folded into .ow-kbd)"


# ── 9 — the chip is a passive glyph (no tap floor of its own) ─────────────────────
def test_keycap_is_not_interactive_floor():
    body = _block(KIT, ".ow-kbd")
    assert "min-height: 44px" not in body and "--ow-tap-min" not in body, \
        ".ow-kbd is a passive glyph: the 44px tap floor belongs to the wrapping .shortcut-key button"


# ── 10 — the demo instantiates the primitive ─────────────────────────────────────
def test_demo_shows_keycap():
    assert 'class="ow-kbd"' in DEMO, "element_kit_demo.html must render an .ow-kbd example"
    assert "ow-kbd-group" in DEMO, "the demo should show the .ow-kbd-group combo cluster"
