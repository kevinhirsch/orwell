"""#1601 / OWN-2 — ONE light-glass family for the chat column.

Owner ruling: on frosted/glass the received (.msg-ai) bubble used to render as a DARK
veil while the composer + action row were LIGHT glass — two materials in one column.
The fix unifies the column onto ONE light-glass family: the .msg-ai bubble shares the
composer's fixed near-white light-glass material and reads with DARK chrome ink for
legibility (adaptiveGlass.js still escalates the scrim + sets the per-bubble ink over a
dark/busy wall; this gate pins the first-paint / non-JS default).

Source-pinned + recomputed WCAG (mirrors test_s6_4_on_accent_contrast.py). (OWN-3, the
cast-photo dialog polarity, "follows the same ruling" but is OUT OF SCOPE — a follow-up
noted in style.css.)
"""
import os
import re

FE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INK_DARK = "#16191f"       # the canonical chrome dark ink the light bubble reads with
LIGHT_GLASS = "#f5f6f8"    # rgba(245,246,248) — the near-white light-glass base
AA_NORMAL = 4.5


def _read(rel):
    with open(os.path.join(FE, rel), encoding="utf-8") as fh:
        return fh.read()


CSS = _read("static/style.css")


# ── WCAG math ────────────────────────────────────────────────────────────────────
def _hx(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def _lum(rgb):
    r, g, b = (c / 255 for c in rgb)
    f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def _ratio(a_rgb, b_rgb):
    l1, l2 = sorted((_lum(a_rgb), _lum(b_rgb)), reverse=True)
    return (l1 + 0.05) / (l2 + 0.05)


def _over(fg, bg, alpha):
    """fg composited over bg at alpha (sRGB approximation)."""
    F, B = _hx(fg), _hx(bg)
    return tuple(round(alpha * F[i] + (1 - alpha) * B[i]) for i in range(3))


# ── the wiring: .msg-ai is LIGHT glass + DARK ink, not a dark veil ────────────────
def test_msg_ai_frosted_is_light_glass_fill():
    m = re.search(r"body\.theme-frosted\s+\.msg-ai\s*\{(.*?)\}", CSS, re.S)
    assert m, "no body.theme-frosted .msg-ai rule"
    body = m.group(1)
    assert "rgba(245,246,248" in body, (
        "#1601 OWN-2: the received bubble must use the composer's near-white light-glass "
        "fill (rgba(245,246,248,…)), not the old dark scrim"
    )


def test_msg_ai_frosted_uses_dark_ink():
    # the default ink block flips the received bubble to the dark chrome ink.
    assert re.search(
        r"body\.theme-frosted\s+\.msg-ai\s*\{[^}]*color:\s*#16191f", CSS, re.S
    ), "#1601 OWN-2: the light-glass received bubble must read with dark ink #16191f"


def test_no_dark_scrim_veil_remains_on_received_bubble():
    """Guard the regression the ruling fixes: the received bubble must not re-acquire the
    old dark scrim fill (rgba(58,62,70,…) was the dark-veil family)."""
    m = re.search(r"body\.theme-frosted\s+\.msg-ai\s*\{(.*?)\}", CSS, re.S)
    assert m and "rgba(58,62,70" not in m.group(1), (
        "#1601 OWN-2 regression: the received bubble re-acquired a dark-veil scrim fill"
    )


# ── the math: dark ink on the light bubble clears AA ─────────────────────────────
def test_dark_ink_on_light_bubble_clears_aa():
    ink = _hx(INK_DARK)
    # escalated / over-a-light-wall state (the light glass at/near opaque): comfortably AAA.
    assert _ratio(ink, _hx(LIGHT_GLASS)) >= 7.0
    # the FLOOR default (--ai-scrim-alpha 0.46) over a mid-tone wall still clears AA — the
    # light scrim is a legibility backstop, not reliant on the JS escalation for AA here.
    mid = _over(LIGHT_GLASS, "#808080", 0.46)
    r = _ratio(ink, mid)
    assert r >= AA_NORMAL, (
        f"dark ink on the floored light bubble over a mid wall is {r:.2f}:1, must clear AA "
        f"{AA_NORMAL}:1 (adaptiveGlass escalates the scrim further over darker walls)"
    )
