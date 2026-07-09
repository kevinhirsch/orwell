"""#738 Liquid-Glass polish — three localized items, source-pinned (the pytest lane has no
DOM runtime; live computed appearance is verified by the render-verify loop under Playwright,
the same convention the other glass-chrome tests use).

ITEM 8 — gadget-card ROW legibility (contrast floor).
  The gadget-rail cards (.og-card) carry dense HUD status rows in DARK ink on the light
  glass. adaptiveGlass STANDS DOWN on chrome under the glass theme, so — unlike the .msg-ai
  bubble (which escalates its scrim per-bubble in JS) — the cards get no runtime backstop.
  FIX: a CSS-STATIC contrast floor mirroring the .msg-ai worst-case-scrim idea in the opposite
  polarity — floor the light-glass fill opaque-enough (a --og-scrim-alpha var) that the dense
  rows clear APCA over any wallpaper, with the a11y reduced-transparency opaque re-asserted.

ITEM 13 — >=44px touch targets.
  The collapsible gadget-card HEADER is the collapse affordance (role=button) but carried no
  min-height, so its ~20px row fell under the WCAG 2.5.5 44px floor. FIX: add it to the
  coarse-pointer 44px floor beside the other gadget-rail chrome.

ITEM 22 — Diary Room rose chrome -> a hint (OWNER RULED "tone down to a hint").
  The confessional pill (orwellDiaryRoom.js #orwell-dr-pill) used to carry a full ROSE chrome
  tint (a color-mix(var(--accent) 18%) fill + a solid rose border). OWNER RULING: neutralise
  the BULK to the colourless light-glass material like every other #738 surface, but KEEP a
  WHISPER of rose as the confessional's diegetic identity — a thin, bounded rose EDGE only.
"""
import re
from pathlib import Path

FE = Path(__file__).resolve().parents[1]
CSS = (FE / "static" / "style.css").read_text(encoding="utf-8")
DR_JS = (FE / "static" / "js" / "orwellDiaryRoom.js").read_text(encoding="utf-8")

LIGHT_GLASS_TOKEN = "--ow-glass-light-color"
ROSE = "#e06c75"  # the confessional's bounded diegetic rose


def _css_blocks(text: str, selector_literal: str):
    """All declaration blocks (selectors, body) whose selector LIST contains the literal."""
    out = []
    for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", text):
        if selector_literal in m.group(1):
            out.append((m.group(1).strip(), m.group(2)))
    return out


# ── ITEM 8 — gadget-card contrast floor ────────────────────────────────────────
def test_gadget_card_has_static_contrast_floor():
    """body.theme-frosted .og-card floors its light-glass fill opaque-enough (a
    --og-scrim-alpha var driving an rgba white fill) so the dense DARK rows clear a
    contrast floor — the .msg-ai worst-case-scrim discipline, CSS-static because
    adaptiveGlass stands down on chrome under the glass theme."""
    floor = [
        (sel, body) for sel, body in _css_blocks(CSS, ".og-card")
        if "theme-frosted" in sel and "--og-scrim-alpha" in body
    ]
    assert floor, (
        "no body.theme-frosted .og-card contrast-floor rule with --og-scrim-alpha — the "
        "gadget rows have no legibility backstop over a busy wallpaper (#738 item 8)"
    )
    sel, body = floor[0]
    m = re.search(r"--og-scrim-alpha:\s*([0-9.]+)", body)
    assert m, "the gadget contrast floor sets no --og-scrim-alpha value"
    alpha = float(m.group(1))
    assert alpha >= 0.70, (
        f"--og-scrim-alpha={alpha} is too thin to be a worst-case contrast floor for dense "
        f"dark rows over a busy mid-tone wallpaper (#738 item 8)"
    )
    assert "rgba(255, 255, 255, var(--og-scrim-alpha))" in body, (
        "the floor must drive the fill from the --og-scrim-alpha var (a white scrim), "
        "mirroring .msg-ai's --ai-scrim-alpha pattern"
    )


def test_gadget_card_floor_respects_reduced_transparency():
    """The floor is later in the cascade than the shared a11y block, so it MUST re-assert the
    opaque panel fallback under prefers-reduced-transparency (else the translucent floor wins
    back for that a11y setting)."""
    # find a reduced-transparency block that forces .og-card opaque AFTER the floor rule.
    floor_idx = CSS.index("--og-scrim-alpha")
    tail = CSS[floor_idx:]
    rt = re.search(
        r"@media \(prefers-reduced-transparency: reduce\)\s*\{[^{}]*"
        r"body\.theme-frosted \.og-card\s*\{([^{}]*)\}",
        tail,
    )
    assert rt, (
        "no reduced-transparency opaque re-assert for .og-card AFTER the contrast floor — a "
        "reduced-transparency user would get the translucent floor back (#738 item 8)"
    )
    assert "var(--panel" in rt.group(1) and "background-image: none" in rt.group(1), (
        "the reduced-transparency re-assert must force a SOLID opaque panel fill"
    )


# ── ITEM 13 — >=44px touch targets ─────────────────────────────────────────────
def test_collapsible_gadget_head_meets_touch_floor():
    """The collapsible gadget-card header (role=button) is floored to 44px on coarse
    pointers alongside the rest of the gadget-rail chrome (WCAG 2.5.5)."""
    coarse = [
        (sel, body) for sel, body in _css_blocks(CSS, ".og-card.og-collapsible .og-head")
        if "min-height: 44px" in body
    ]
    assert coarse, (
        ".og-card.og-collapsible .og-head is not in a 44px min-height floor — the collapse "
        "affordance falls under the touch target floor (#738 item 13)"
    )
    sel, body = coarse[0]
    assert "min-width: 44px" in body, "the gadget-head touch floor sets no min-width"
    # it rides the SAME coarse-pointer floor as .og-act (not a separate desktop-affecting rule)
    assert ".og-act" in sel and "pointer: coarse" not in sel, (
        "the gadget-head floor should share the existing coarse-pointer block with .og-act"
    )


def test_gadget_act_still_floored():
    """Belt: the gadget action button keeps its 44px coarse floor (not displaced)."""
    assert any(
        "min-height: 44px" in body
        for sel, body in _css_blocks(CSS, ".og-card .og-act")
    ), ".og-card .og-act lost its 44px coarse-pointer floor (#738 item 13)"


def test_responsive_matrix_has_no_stale_tap_target_xfail():
    """The tap-target gate's XFAIL registry carries no un-fixed tap-target finding we claim to
    have resolved. (It is empty on main; this pins that we didn't leave a stale entry.)"""
    matrix = (FE / "scripts" / "responsive_matrix.py").read_text(encoding="utf-8")
    xfail_block = re.search(r"XFAIL\s*=\s*\{(.*?)\}", matrix, re.S)
    assert xfail_block, "could not locate the responsive_matrix XFAIL registry"
    body = xfail_block.group(1)
    # no active finding-ID entry keyed to a 'touch'/'tap' offender we just fixed.
    entries = [ln for ln in body.splitlines() if re.search(r'^\s*"[^"]+"\s*:', ln)]
    for ln in entries:
        assert "touch" not in ln.lower() and "tap" not in ln.lower(), (
            f"a tap-target XFAIL remains that should be fixed + removed: {ln.strip()}"
        )


# ── ITEM 22 — Diary Room rose -> hint ──────────────────────────────────────────
def test_dr_pill_inline_style_carries_no_rose_fill():
    """The pill's inline cssText (orwellDiaryRoom.js) no longer hard-codes the rose fill /
    border — the bulk is neutralised in CSS so the glass theme can carry the light-glass
    material."""
    start = DR_JS.index("pill.style.cssText")
    end = DR_JS.index("pill.innerHTML", start)
    css_text = DR_JS[start:end]
    assert "var(--accent" not in css_text, (
        "the DR pill inline style still paints the rose --accent fill/border — the bulk "
        "chrome must be neutralised, not a full rose tint (#738 item 22)"
    )
    assert "background:" not in css_text and "border:" not in css_text, (
        "the DR pill inline style still sets a bulk background/border — move it to CSS so the "
        "glass theme can swap the bulk to the colourless light-glass material (#738 item 22)"
    )


def test_dr_pill_bulk_is_colourless_light_glass_under_frosted():
    """OWNER RULING part 1 — neutralise the BULK: under the glass theme the pill rides the ONE
    shared colourless light-glass material like every other #738 surface."""
    frosted = [
        (sel, body) for sel, body in _css_blocks(CSS, "#orwell-dr-pill")
        if "theme-frosted" in sel
    ]
    assert frosted, "no body.theme-frosted #orwell-dr-pill rule — the bulk isn't neutralised"
    assert any(LIGHT_GLASS_TOKEN in body for _sel, body in frosted), (
        f"the DR pill bulk does not use the shared light-glass material ({LIGHT_GLASS_TOKEN}) "
        f"under the glass theme — it must match every other colourless surface (#738 item 22)"
    )


def test_dr_pill_keeps_a_bounded_rose_hint():
    """OWNER RULING part 2 — NOT full-neutralise: a WHISPER of rose is KEPT as the
    confessional's diegetic identity, as a thin bounded EDGE (border), never a rose fill."""
    blocks = _css_blocks(CSS, "#orwell-dr-pill")
    assert blocks, "no #orwell-dr-pill CSS rules at all"
    rose_edges = []
    for _sel, body in blocks:
        for decl in body.split(";"):
            if ROSE in decl and ("border" in decl):
                rose_edges.append(decl.strip())
    assert rose_edges, (
        f"the DR pill keeps NO rose hint — the owner ruled to KEEP a whisper of rose as a thin "
        f"edge ({ROSE} on a border), not full-neutralise (#738 item 22)"
    )
    # BOUNDED: the rose must be an EDGE/border, never a full-surface background fill.
    for _sel, body in blocks:
        for decl in body.split(";"):
            d = decl.strip()
            if not d:
                continue
            if ROSE in d and d.startswith("background"):
                raise AssertionError(
                    f"the rose must be a bounded EDGE only, not a background fill: '{d}' "
                    f"(#738 item 22)"
                )
