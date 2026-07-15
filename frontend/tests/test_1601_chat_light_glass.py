"""#1601 / OWN-2 — ONE light-glass family for the chat column.

Owner ruling: on frosted/glass the received (.msg-ai) bubble used to render as a DARK
veil while the composer + action row were LIGHT glass — two materials in one column.
The fix unifies the column onto ONE light-glass family: the .msg-ai bubble shares the
composer's fixed near-white light-glass material and reads with DARK chrome ink for
legibility (adaptiveGlass.js still escalates the scrim + sets the per-bubble ink over a
dark/busy wall; this gate pins the first-paint / non-JS default).

Source-pinned + recomputed WCAG (mirrors test_s6_4_on_accent_contrast.py). The gate parses
the EFFECTIVE cascaded declarations (comment-free, last-rule-wins) for the exact
`body.theme-frosted .msg-ai` selector and derives the contrast inputs from those parsed
values — so it fails loudly if the fill rgb, the scrim alpha, or the ink drift, instead of
passing on a stale hardcoded constant, a comment, or a `border-color:` false match. (OWN-3,
the cast-photo dialog polarity, "follows the same ruling" but is OUT OF SCOPE — a follow-up
noted in style.css.)
"""
import os
import re

FE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AA_NORMAL = 4.5
MSG_AI_SEL = "body.theme-frosted .msg-ai"


def _read(rel):
    with open(os.path.join(FE, rel), encoding="utf-8") as fh:
        return fh.read()


def _strip_css_comments(css):
    return re.sub(r"/\*.*?\*/", "", css, flags=re.S)


CSS = _read("static/style.css")
CSS_NC = _strip_css_comments(CSS)


# ── declaration parsing (comment-free, exact-selector, cascade last-wins) ─────────
def _rule_blocks(css):
    """Yield (selector_list, declaration_body) for every plain rule. `[^{}]+` can't cross
    a brace, so a rule nested inside an @media is captured as its own inner block."""
    for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", css):
        yield m.group(1).strip(), m.group(2)


def _effective_decls(css, selector):
    """All declarations across every rule whose selector EXACTLY equals `selector`
    (so grouped `.msg-ai, .msg-user {…}` and descendant `.msg-ai .body {…}` rules are
    excluded), later rules overriding earlier — the cascade for one element at equal
    specificity. `!important` is normalized off. Returns {prop: value}."""
    out = {}
    for sel, body in _rule_blocks(css):
        if sel != selector:
            continue
        for decl in body.split(";"):
            prop, sep, val = decl.partition(":")
            if not sep:
                continue
            out[prop.strip()] = val.replace("!important", "").strip()
    return out


AI = _effective_decls(CSS_NC, MSG_AI_SEL)


def _rgb_of(bg):
    m = re.search(r"rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)", bg)
    assert m, f"no rgb(a) fill parsed from {bg!r}"
    return tuple(int(m.group(i)) for i in (1, 2, 3))


def _alpha_of(bg, decls):
    """The 4th rgba() channel, resolving a `var(--x, default)` against the same rule's
    custom-property declarations (so a drift in --ai-scrim-alpha is caught, not assumed)."""
    # greedy `.+` to the LAST paren so a nested `var(--x, default)` alpha isn't clipped.
    m = re.search(r"rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*(.+)\)", bg)
    assert m, f"no rgba alpha channel in {bg!r}"
    a = m.group(1).strip()
    vm = re.match(r"var\(\s*(--[\w-]+)\s*,\s*([\d.]+)\s*\)", a)
    if vm:
        return float(decls.get(vm.group(1), vm.group(2)))
    return float(a)


# ── WCAG math ────────────────────────────────────────────────────────────────────
def _hx(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def _lum(rgb):
    r, g, b = (c / 255 for c in rgb)

    def f(c):
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def _ratio(a_rgb, b_rgb):
    l1, l2 = sorted((_lum(a_rgb), _lum(b_rgb)), reverse=True)
    return (l1 + 0.05) / (l2 + 0.05)


def _over(fg_rgb, bg_rgb, alpha):
    """fg composited over bg at alpha (sRGB approximation)."""
    return tuple(round(alpha * fg_rgb[i] + (1 - alpha) * bg_rgb[i]) for i in range(3))


# ── the wiring: .msg-ai is LIGHT glass + DARK ink, not a dark veil ────────────────
def test_msg_ai_frosted_is_light_glass_fill():
    bg = AI.get("background-color")
    assert bg, f"no effective background-color on `{MSG_AI_SEL}`"
    assert _rgb_of(bg) == (245, 246, 248), (
        "#1601 OWN-2: the received bubble must use the composer's near-white light-glass "
        f"fill (rgb 245,246,248), not the old dark scrim; got {bg!r}"
    )


def test_msg_ai_frosted_uses_dark_ink():
    # parsed from the EXACT `color:` declaration (not a border-color: substring match).
    assert AI.get("color", "").lower() == "#16191f", (
        "#1601 OWN-2: the light-glass received bubble must read with the dark chrome ink "
        f"#16191f; got color={AI.get('color')!r}"
    )


def test_no_dark_scrim_veil_remains_on_received_bubble():
    """Guard the regression the ruling fixes: the effective fill must not be the old dark
    scrim family (rgba(58,62,70,…) was the dark veil)."""
    assert _rgb_of(AI.get("background-color", "rgba(0,0,0,0)")) != (58, 62, 70), (
        "#1601 OWN-2 regression: the received bubble re-acquired a dark-veil scrim fill"
    )


# ── the math: dark ink on the light bubble clears AA (inputs parsed from CSS) ─────
def test_dark_ink_on_light_bubble_clears_aa():
    ink = _hx(AI["color"])
    light_glass = _rgb_of(AI["background-color"])
    alpha = _alpha_of(AI["background-color"], AI)
    # escalated / over-a-light-wall state (the light glass at/near opaque): comfortably AAA.
    assert _ratio(ink, light_glass) >= 7.0
    # the FLOOR default (parsed --ai-scrim-alpha) over a mid-tone wall still clears AA — the
    # light scrim is a legibility backstop, not reliant on the JS escalation for AA here.
    mid = _over(light_glass, (128, 128, 128), alpha)
    r = _ratio(ink, mid)
    assert r >= AA_NORMAL, (
        f"dark ink on the floored light bubble (alpha {alpha}) over a mid wall is {r:.2f}:1, "
        f"must clear AA {AA_NORMAL}:1 (adaptiveGlass escalates the scrim further over darker walls)"
    )
