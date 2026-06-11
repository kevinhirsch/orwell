"""Lane G4 — ONE window visual language: the shared --win-* tokens.

Two visual languages had grown: the OrwellWindow kit family (.ow-window,
css injected by static/js/orwellWindow.js ensureCss) and the legacy modal
family (.modal-content / .modal-header in static/style.css — settings,
theme, and the tool modals). G4 extracts the shared window frame
(bg / border / radius / shadow) and titlebar type (size / weight /
tracking) as CSS custom properties defined ONCE in style.css :root and
consumed by BOTH families — so every window shares one look, and a theme
override (the 0052 house presets move --panel/--border; the house frost
layer repaints the ground) hits both families at once.

Deliberately NOT shared: the titlebar COLOR. The modal family's
var(--red) header fails AA 4.5:1 on the panel in some palettes
(room-101 2.81:1, light 3.03:1 — computed at lane time), so the kit
titlebar keeps its AA-proven var(--fg); the contrast pins below extend
the 0052 palette gate (test_u4_transcript_surface.py) to the kit family's
actual fg/ground pair.
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

TOKENS = (
    "--win-bg",
    "--win-border",
    "--win-radius",
    "--win-shadow",
    "--win-titlebar-fs",
    "--win-titlebar-weight",
    "--win-titlebar-ls",
)


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


def _walk(subdir, ext):
    root = os.path.join(FRONTEND, "static", subdir) if subdir else os.path.join(FRONTEND, "static")
    out = []
    for dirpath, _dirs, files in os.walk(root):
        out.extend(os.path.join(dirpath, f) for f in files if f.endswith(ext))
    return sorted(out)


def _definitions(text, token):
    # A DEFINITION is `--win-x:` not preceded by `(` (consumption is always
    # `var(--win-x` / a fallback chain, where `(` immediately precedes).
    return re.findall(r"(?<!\()" + re.escape(token) + r"\s*:", text)


def _block(text, selector_re, marker=None):
    """The first `{...}` body whose selector line matches selector_re exactly.
    Tolerates `${...}` template interpolations inside the kit's injected css."""
    m = re.search(selector_re + r"\s*\{((?:[^{}]|\$\{[^}]*\})*)\}", text)
    assert m, f"core rule {selector_re!r} not found"
    body = m.group(1)
    if marker:
        assert marker in body, (
            f"extracted the wrong {selector_re!r} block (marker {marker!r} missing) — "
            "the base rule must stay the first match in the file"
        )
    return body


def _prop(block, name):
    """The value of `name:` in a rule body (None when the rule doesn't set it)."""
    m = re.search(r"(?:^|[;{\s])" + re.escape(name) + r"\s*:\s*([^;]+);", block)
    return m.group(1).strip() if m else None


# ── the token set exists ONCE (style.css :root) ───────────────────────────────

def test_g4_token_set_is_defined_once_in_style_css():
    style = _read("static", "style.css")
    for token in TOKENS:
        defs = _definitions(style, token)
        assert len(defs) == 1, f"{token} must be defined exactly once in style.css, found {len(defs)}"
    root = re.search(r":root \{(.*?)\n\}", style, re.S).group(1)
    for token in TOKENS:
        assert _definitions(root, token), f"{token} must live in the first :root block"


def test_g4_no_other_file_defines_the_tokens():
    style_path = os.path.join(FRONTEND, "static", "style.css")
    for path in _walk("css", ".css") + _walk("js", ".js"):
        if os.path.abspath(path) == os.path.abspath(style_path):
            continue
        text = open(path, encoding="utf-8").read()
        for token in TOKENS:
            assert not _definitions(text, token), (
                f"{os.path.relpath(path, FRONTEND)} redefines {token} — the set is "
                "defined ONCE in style.css :root (Lane G4)"
            )


def test_g4_tokens_bind_to_the_theme_layer():
    # The binding that makes a theme override (e.g. the 0052 house presets,
    # which move --panel/--border) re-skin BOTH families at once.
    style = _read("static", "style.css")
    assert "--win-bg: var(--panel);" in style
    assert "--win-border: var(--border);" in style


# ── the kit family consumes the tokens (.ow-window — orwellWindow.js) ────────

def test_g4_kit_frame_consumes_the_tokens():
    kit = _read("static", "js", "orwellWindow.js")
    win = _block(kit, r"\.ow-window", marker="position: fixed")
    assert _prop(win, "background").startswith("var(--win-bg"), "kit bg must ride --win-bg"
    assert _prop(win, "border").startswith("1px solid var(--win-border"), "kit border must ride --win-border"
    assert _prop(win, "border-radius").startswith("var(--win-radius"), "kit radius must ride --win-radius"
    assert _prop(win, "box-shadow").startswith("var(--win-shadow"), "kit shadow must ride --win-shadow"
    bar = _block(kit, r"\.ow-titlebar", marker="cursor: move")
    assert _prop(bar, "border-radius").startswith("var(--win-radius"), "titlebar corners follow the frame radius"


def test_g4_kit_titlebar_type_consumes_the_tokens():
    kit = _read("static", "js", "orwellWindow.js")
    title = _block(kit, r"\.ow-title", marker="ellipsis")
    assert _prop(title, "font-size").startswith("var(--win-titlebar-fs")
    assert _prop(title, "font-weight").startswith("var(--win-titlebar-weight")
    assert _prop(title, "letter-spacing").startswith("var(--win-titlebar-ls")
    # Titlebar COLOR is deliberately NOT shared: the kit keeps the AA-proven
    # var(--fg) (inherited from .ow-window) — never the modal family's
    # var(--red), which fails AA on the room-101/light palettes.
    assert _prop(title, "color") is None and "--red" not in title
    win = _block(kit, r"\.ow-window", marker="position: fixed")
    assert _prop(win, "color").startswith("var(--fg")


# ── the modal family consumes the same tokens (style.css core rules) ─────────

def test_g4_modal_frame_consumes_the_tokens():
    style = _read("static", "style.css")
    content = _block(style, r"\n\s*\.modal-content", marker="modal-enter")
    assert _prop(content, "background") == "var(--win-bg)"
    assert _prop(content, "border") == "1px solid var(--win-border)"
    assert _prop(content, "border-radius") == "var(--win-radius)"
    assert _prop(content, "box-shadow") == "var(--win-shadow)"


def test_g4_modal_titlebar_type_consumes_the_tokens():
    style = _read("static", "style.css")
    h4 = _block(style, r"\n\s*\.modal-header h4", marker="margin-right:auto")
    assert _prop(h4, "font-size") == "var(--win-titlebar-fs)"
    assert _prop(h4, "font-weight") == "var(--win-titlebar-weight)"
    assert _prop(h4, "letter-spacing") == "var(--win-titlebar-ls)"


def test_g4_no_leftover_hardcoded_frame_values_in_the_core_rules():
    # The tokenized properties may not carry literals in either family's core
    # rules (the kit's var() FALLBACKS — for style.css not having loaded —
    # are part of the token consumption, not leftovers).
    style = _read("static", "style.css")
    content = _block(style, r"\n\s*\.modal-content", marker="modal-enter")
    for prop in ("background", "border", "border-radius", "box-shadow"):
        assert "--win-" in _prop(content, prop), f".modal-content {prop} regressed off the tokens"
        assert "rgba(" not in _prop(content, prop) and "#" not in _prop(content, prop)
    h4 = _block(style, r"\n\s*\.modal-header h4", marker="margin-right:auto")
    for prop, token in (("font-size", "fs"), ("font-weight", "weight"), ("letter-spacing", "ls")):
        assert _prop(h4, prop) == f"var(--win-titlebar-{token})", \
            f".modal-header h4 {prop} regressed off the tokens to a literal"
    kit = _read("static", "js", "orwellWindow.js")
    win = _block(kit, r"\.ow-window", marker="position: fixed")
    for prop in ("background", "border", "border-radius", "box-shadow"):
        value = _prop(win, prop)
        assert value.split("var(")[0].strip(" :") in ("", "1px solid"), \
            f".ow-window {prop} carries a literal before the token: {value!r}"


# ── the per-theme layer hits both families at once ────────────────────────────

def test_g4_house_frost_covers_both_families():
    css = _read("static", "css", "orwellHouseThemes.css")
    assert "@supports" in css and "Shared house polish" in css
    frost = css[css.index("@supports"):css.index("Shared house polish")]
    assert "body.house-theme .modal-content" in frost, "frost must cover the modal family"
    assert "body.house-theme .ow-window" in frost, "frost must cover the kit family by name"
    assert "var(--win-bg" in frost, "the frost fallback composites from the shared ground token"


# ── AA contrast, extended to the kit family (the 0052 gate's math) ────────────

HOUSE = ["the-feed", "telescreen", "room-101", "memory-wall", "sequester"]


def _house_palettes():
    theme_js = _read("static", "js", "theme.js")
    body = re.search(r"export const THEMES = \{(.*?)\n\};", theme_js, re.S).group(1)
    out = {}
    for name in HOUSE:
        m = re.search(
            rf"'{name}':\s*\{{\s*bg:'#([0-9a-f]{{6}})',\s*fg:'#([0-9a-f]{{6}})',\s*panel:'#([0-9a-f]{{6}})'",
            body)
        assert m, f"{name} palette missing/odd shape"
        out[name] = {"bg": m.group(1), "fg": m.group(2), "panel": m.group(3)}
    return out


def _lum(hexstr):
    r, g, b = (int(hexstr[i:i + 2], 16) / 255 for i in (0, 2, 4))
    f = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def _ratio(a, b):
    l1, l2 = sorted((_lum(a), _lum(b)), reverse=True)
    return (l1 + 0.05) / (l2 + 0.05)


def test_g4_kit_family_ground_meets_aa_on_the_house_palettes():
    """The kit window paints var(--fg) on --win-bg → var(--panel); under the
    house frost the ground composites between the panel and the bg, so AA at
    BOTH ends bounds the composite. This extends the 0052 palette gate
    (test_u4_transcript_surface.py) to the kit family's actual pair."""
    for name, p in _house_palettes().items():
        for ground in ("panel", "bg"):
            r = _ratio(p["fg"], p[ground])
            assert r >= 4.5, f"{name}: kit fg on {ground} is {r:.2f}:1 (< AA 4.5)"


# ── the kit window that post-dates the A3 lint stays on the rem scale ─────────

def test_g4_cast_window_type_stays_on_the_rem_scale():
    cast = _read("static", "js", "orwellCast.js")
    assert not re.search(r"font-size:\s*[\d.]+px", cast), \
        "the cast window's content type must sit on the rem scale (A3 lint class)"
