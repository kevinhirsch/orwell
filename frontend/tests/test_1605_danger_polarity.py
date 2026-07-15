"""#1605 / KIT-F-06 — --color-danger is Apple's POLARITY-AWARE system red.

Owner ruling: repoint the app-wide danger token off the legacy flat-UI brick (#c0392b)
to Apple's system red. Apple ships TWO systemReds — #FF3B30 (light) / #FF453A (dark) —
so the token is polarity-aware: the dark :root carries #ff453a, :root.light carries
#ff3b30. The kit's own --ow-danger stays pinned #ff453a in both polarities by design
(its destructive fill is a translucent glass tint where the delta is imperceptible).

This gate pins BOTH the wiring (the two palette values) AND recomputes the WCAG math so
the danger consumers provably clear their floors on both polarities:
  - the ONE solid danger fill that carries white BODY text (--color-danger-strong,
    consumed by .confirm-btn-danger) must clear AA 4.5:1;
  - the plain danger hue (borders / focus rings / large-bold labels) must clear the 3:1
    UI / large-text floor on the theme backgrounds.
Mirrors the source-pinned + recomputed style of test_s6_4_on_accent_contrast.py.
"""
import os
import re

FE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

DANGER_DARK = "#ff453a"    # Apple iOS-dark systemRed
DANGER_LIGHT = "#ff3b30"   # Apple iOS-light systemRed
AA_NORMAL = 4.5
UI_LARGE = 3.0


def _read(rel):
    with open(os.path.join(FE, rel), encoding="utf-8") as fh:
        return fh.read()


CSS = _read("static/style.css")


# ── WCAG relative luminance + contrast (sRGB) — same math as test_s6_4 ───────────
def _hx(h):
    h = h.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def _lum(rgb):
    r, g, b = (c / 255 for c in rgb)
    f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def _ratio(a, b):
    l1, l2 = sorted((_lum(_hx(a)), _lum(_hx(b))), reverse=True)
    return (l1 + 0.05) / (l2 + 0.05)


def _mix_srgb(a, b, p):
    """color-mix(in srgb, a p%, b) — per-channel on the gamma-encoded values."""
    A, B = _hx(a), _hx(b)
    return "#%02x%02x%02x" % tuple(round(p * A[i] + (1 - p) * B[i]) for i in range(3))


# ── the wiring: the token is polarity-aware ──────────────────────────────────────
def _block(css, selector):
    m = re.search(re.escape(selector) + r"\s*\{(.*?)\}", css, re.S)
    assert m, f"{selector} block not found"
    return m.group(1)


def test_root_danger_is_dark_system_red():
    root = _block(CSS, ":root")
    m = re.search(r"--color-danger:\s*(#[0-9a-fA-F]{3,8})\s*;", root)
    assert m, ":root must define --color-danger"
    assert m.group(1).lower() == DANGER_DARK, (
        f"dark :root --color-danger must be Apple iOS-dark systemRed {DANGER_DARK}, got {m.group(1)}"
    )


def test_light_danger_is_light_system_red():
    light = _block(CSS, ":root.light")
    m = re.search(r"--color-danger:\s*(#[0-9a-fA-F]{3,8})\s*;", light)
    assert m, ":root.light must override --color-danger (polarity-aware system red)"
    assert m.group(1).lower() == DANGER_LIGHT, (
        f":root.light --color-danger must be Apple iOS-light systemRed {DANGER_LIGHT}, got {m.group(1)}"
    )


def test_legacy_brick_is_gone():
    """The legacy alizarin brick must not be the danger token anymore."""
    assert not re.search(r"--color-danger:\s*#c0392b", CSS), (
        "the legacy #c0392b danger brick must be fully repointed (#1605)"
    )


# ── the math: danger consumers clear their WCAG floors on BOTH polarities ─────────
def test_solid_danger_fill_white_text_clears_aa_both_polarities():
    # .confirm-btn-danger paints #fff on --color-danger-strong = color-mix(danger 76%, #000).
    for name, base in (("dark", DANGER_DARK), ("light", DANGER_LIGHT)):
        strong = _mix_srgb(base, "#000", 0.76)
        r = _ratio("#ffffff", strong)
        assert r >= AA_NORMAL, (
            f"{name} --color-danger-strong ({strong}) with white body text is {r:.2f}:1, "
            f"must clear AA {AA_NORMAL}:1"
        )
    # sanity: white on the RAW danger fill is the failing baseline the strong pair avoids.
    assert _ratio("#ffffff", DANGER_DARK) < AA_NORMAL


def test_danger_hue_clears_ui_large_floor_on_theme_backgrounds():
    # the plain danger hue is used for borders / focus rings / large-bold labels — the 3:1
    # UI / large-text floor, on the theme surfaces it sits on.
    cases = [
        ("dark on --bg #282c34", DANGER_DARK, "#282c34"),
        ("dark on --panel #111", DANGER_DARK, "#111111"),
        ("light on --bg #f5f5f5", DANGER_LIGHT, "#f5f5f5"),
        ("light on --panel #fff", DANGER_LIGHT, "#ffffff"),
    ]
    for name, hue, bg in cases:
        r = _ratio(hue, bg)
        assert r >= UI_LARGE, f"danger hue {name} is {r:.2f}:1, must clear the {UI_LARGE}:1 UI/large floor"
    # the light-polarity value is a strict improvement over reusing the dark value in the
    # light theme (the point of splitting the token).
    assert _ratio(DANGER_LIGHT, "#f5f5f5") > _ratio(DANGER_DARK, "#f5f5f5")
