"""Issue #726 (kit button accent fill / low contrast) + #759 audit tail (status-HUD
accent-on-text). The "NO accent hue on TEXT while glass is on" mandate, two surfaces.

Apple's rule on the Regular LIGHT glass material is DARK monochrome ink (HIG Color:
"becoming darker when the underlying content is light, and lighter when it's dark" —
docs/design/liquid-glass/ADAPTIVE_LEGIBILITY_REFERENCE.md §1). The rest of the glass
chrome already uses the neutral dark ink #16191f.

A. STATUS HUD (frontend/static/js/orwellStatusPanel.js — injected CSS):
   `.os-noms` (nominees) painted var(--red) and `.os-done .os-winner` painted
   var(--accent). On the LIGHT glass those wash to an illegible light grey (~2.2:1,
   render-measured). Under body.theme-frosted they must resolve to the neutral dark ink
   #16191f. The NON-text accents (the flash highlight .os-changed background, the
   .os-badge background) are sanctioned and untouched. Normal (non-glass) tier keeps
   its accent.

B. KIT BUTTON BASE (.ow-btn in frontend/static/style.css):
   The audit flagged `.ow-window .ow-btn` rendering a light/accent label on light glass
   (~1.49:1, illegible). The base + secondary + prominent label keyed off the inherited
   --fg, which on the light glass is the theme's LIGHT foreground wherever --fg isn't
   dark-redefined (a naked .ow-window with no .ow-body) — light-on-light (~1.04:1,
   render-measured). EVERY kit button must carry the neutral dark chrome ink; the
   default/secondary control carries NO accent fill, NO accent label; the prominent CTA
   keeps its bright neutral-glass fill with a legible dark label (no amber+light combo).

Source-pinned, CSS/JS-as-text like the other FE chrome tests (the pytest lane has no DOM
runtime). The live computed contrast (status noms/winner + all kit buttons → 14.94:1 on
the light glass, from 2.17:1 / 1.04:1) is verified by the render-verify loop under
Playwright — see the agent726 scratchpad screenshots + measured contrast.
"""
import re
from pathlib import Path

FE = Path(__file__).resolve().parents[1]
CSS = (FE / "static" / "style.css").read_text(encoding="utf-8")
PANEL_JS = (FE / "static" / "js" / "orwellStatusPanel.js").read_text(encoding="utf-8")

CHROME_INK = "#16191f"  # the shared neutral dark ink for the light glass chrome


def _css_blocks(text: str, selector_literal: str):
    """All declaration blocks (selectors, body) whose selector LIST contains the literal."""
    out = []
    for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", text):
        if selector_literal in m.group(1):
            out.append((m.group(1).strip(), m.group(2)))
    return out


# ── A. STATUS HUD — nominees + winner text is neutral on glass ─────────────────────

def test_status_noms_neutral_under_frosted():
    """.os-noms (nominees) must resolve to the neutral dark ink under body.theme-frosted,
    not var(--red)/var(--accent)."""
    blocks = _css_blocks(PANEL_JS, "#orwell-status .os-noms")
    frosted = [(s, b) for s, b in blocks if "body.theme-frosted" in s]
    assert frosted, "no body.theme-frosted #orwell-status .os-noms rule (the #759 nominee fix)"
    for _, body in frosted:
        cm = re.search(r"(?<!-)\bcolor\s*:\s*([^;]+);?", body)
        assert cm, ".os-noms frosted rule sets no color"
        val = cm.group(1).strip().rstrip(";")
        assert "var(--red)" not in val and "var(--accent)" not in val, (
            f".os-noms frosted ink {val!r} must carry NO accent hue (neutral dark ink)"
        )
        assert CHROME_INK in val, (
            f".os-noms frosted ink must be the neutral chrome ink {CHROME_INK}, got {val!r}"
        )


def test_status_winner_neutral_under_frosted():
    """.os-done .os-winner (season winner name) must resolve to the neutral dark ink
    under body.theme-frosted, not var(--accent)/var(--red)."""
    blocks = _css_blocks(PANEL_JS, ".os-done .os-winner")
    frosted = [(s, b) for s, b in blocks if "body.theme-frosted" in s]
    assert frosted, "no body.theme-frosted .os-done .os-winner rule (the #759 winner fix)"
    for _, body in frosted:
        cm = re.search(r"(?<!-)\bcolor\s*:\s*([^;]+);?", body)
        assert cm, ".os-winner frosted rule sets no color"
        val = cm.group(1).strip().rstrip(";")
        assert "var(--accent)" not in val and "var(--red)" not in val, (
            f".os-winner frosted ink {val!r} must carry NO accent hue (neutral dark ink)"
        )
        assert CHROME_INK in val, (
            f".os-winner frosted ink must be the neutral chrome ink {CHROME_INK}, got {val!r}"
        )


def test_status_nontext_accents_preserved():
    """The NON-text accents are sanctioned and must NOT be neutralized: the .os-changed
    flash uses var(--accent) in a BACKGROUND, and the .os-badge uses it in a BACKGROUND.
    Only TEXT goes neutral — these stay."""
    assert re.search(r"\.os-badge[^{}]*\{[^{}]*background\s*:[^;]*var\(--accent", PANEL_JS), (
        "the .os-badge accent BACKGROUND (a non-text accent) must be preserved"
    )
    assert "os-row-flash" in PANEL_JS and "var(--accent" in PANEL_JS, (
        "the .os-changed flash highlight (a non-text accent background) must be preserved"
    )


# ── B. KIT BUTTON BASE — legible neutral ink, no accent fill/label ──────────────────

def _ow_btn_block(selector_literal: str):
    blocks = [(s, b) for s, b in _css_blocks(CSS, selector_literal)
              if "body.theme-frosted" in s]
    assert blocks, f"no body.theme-frosted {selector_literal} rule found"
    # the kit-owned base block is the one inside the .ow-btn source-of-truth section
    return blocks[0][1]


def test_ow_btn_base_carries_neutral_dark_ink():
    """.ow-btn must set an EXPLICIT neutral dark ink (not inherit the light --fg, which is
    light-on-light in a naked .ow-window scope), and no accent hue."""
    body = _ow_btn_block("body.theme-frosted .ow-btn ")
    cm = re.search(r"(?<!-)\bcolor\s*:\s*([^;]+);", body)
    assert cm, ".ow-btn base sets no explicit color (it would inherit the light --fg)"
    val = cm.group(1).strip()
    assert CHROME_INK in val, (
        f".ow-btn base ink must be the neutral chrome ink {CHROME_INK}, got {val!r}"
    )
    assert "var(--fg)" not in val, (
        ".ow-btn base must NOT key its label off the inherited --fg "
        "(light-on-light on the glass in a naked window scope)"
    )
    assert "var(--accent)" not in val and "var(--red)" not in val, (
        ".ow-btn base label must carry no accent hue"
    )


def test_ow_btn_secondary_no_accent_fill_no_light_fg_fill():
    """.ow-btn-secondary (the default/secondary control) must carry NO accent fill and
    must NOT key its fill off the light --fg (which inverts to a near-white plate on the
    light glass). A faint dark wash keyed off the chrome ink is correct."""
    body = _ow_btn_block("body.theme-frosted .ow-btn-secondary")
    assert "var(--accent)" not in body and "var(--red)" not in body, (
        ".ow-btn-secondary must carry no accent fill / accent border"
    )
    bg = re.search(r"background(?:-color)?\s*:\s*([^;]+);", body)
    assert bg, ".ow-btn-secondary sets no background"
    assert "var(--fg" not in bg.group(1), (
        ".ow-btn-secondary fill must not key off the light --fg "
        "(it inverts to a near-white plate on the glass) — key it off the chrome ink"
    )


def test_ow_btn_prominent_label_legible_on_fill():
    """The ONE prominent CTA may keep its bright fill, but its LABEL must be the legible
    neutral dark ink on that fill — NOT the light --fg (the #726 illegible-label combo),
    and not an accent hue on the text."""
    body = _ow_btn_block("body.theme-frosted .ow-btn-prominent")
    cm = re.search(r"(?<!-)\bcolor\s*:\s*([^;]+);", body)
    assert cm, ".ow-btn-prominent sets no label color"
    val = cm.group(1).strip()
    assert CHROME_INK in val, (
        f".ow-btn-prominent label must be the legible dark ink {CHROME_INK} on its bright "
        f"fill (the #726 bug was a light/accent label ~1.49:1), got {val!r}"
    )
    assert "var(--fg)" not in val, (
        ".ow-btn-prominent label must not be the light --fg (illegible on the bright fill)"
    )
    assert "var(--accent)" not in val and "var(--red)" not in val, (
        ".ow-btn-prominent label must carry no accent hue"
    )
