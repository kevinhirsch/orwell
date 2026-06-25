"""#8/#9 — window / dock / gadget glass coherence + the red-border kill + legible
"The House" controls + SVG (not emoji) dock icons.

The owner flagged: a stray RED BORDER on a window/modal under glass; the Control-Center
DOCK reading foggier/darker/odd vs the windows + cards; "The House" (gadget rail /
control room) header controls rendering BLACK-on-black / illegible; and the condensed
dock strip using literal EMOJI (📋, 🧭, …) that break the app's SVG line-icon language.

Glass chrome is COLORLESS while a glass tier is active (the material takes color only
from the backdrop). Sanctioned accents stay (iOS-blue toggles/focus rings, green sliders,
the single primary CTA, the macOS traffic-light close/min/dock cluster) — those are NOT
"the red border".

Source-pinned (the FE has no DOM runtime in pytest; browser-smoke + the render probe cover
the live DOM). Roles only, no names, no engine/network.
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


CSS = _read("static", "style.css")
INDEX = _read("static", "index.html")
RAIL_JS = _read("static", "js", "orwellGadgetRail.js")


def _strip_comments(css: str) -> str:
    return re.sub(r"/\*.*?\*/", "", css, flags=re.S)


def _block(css: str, anchor: str) -> str:
    """The selector list + declaration block whose selector list contains `anchor`
    (CSS comments stripped, so a comment that names --red can't false-trip the no-red checks)."""
    i = css.index(anchor)
    start = css.rfind("}", 0, i) + 1
    end = css.index("}", css.index("{", i))
    return _strip_comments(css[start:end + 1])


# ── (1) the red border / ring is gone from window/dock/gadget chrome under glass ──
def test_window_dock_gadget_focus_rings_are_system_blue_not_red():
    # The #770/#8 neutralize block routes the focus-visible outline on every window/dock/gadget
    # control to the ONE sanctioned system-blue, never the theme accent/red.
    block = _block(CSS, "outline-color: var(--ow-ios-blue")
    for needed in (
        ".ow-window *:focus-visible",
        ".og-card button:focus-visible",
        "#minimized-dock .minimized-dock-chip:focus-visible",
    ):
        assert needed in block, f"{needed} must route to the system-blue focus ring"
    assert "var(--ow-ios-blue" in block
    assert "var(--red" not in block and "e06c75" not in block


def test_no_accent_red_on_dock_chip_hover_or_focus_chrome():
    # The dock chip hover/focus used to tint its background + border with the theme accent/red;
    # it now lightens to a neutral white fill + neutral rim. Pin the frosted dock-chip
    # hover/focus rule specifically.
    chip_hover = _block(CSS, "body.theme-frosted #minimized-dock .minimized-dock-chip:hover")
    assert "var(--red" not in chip_hover and "var(--accent" not in chip_hover
    assert "e06c75" not in chip_hover
    assert "rgba(255,255,255" in chip_hover


def test_glass_button_bloom_ring_is_neutral_not_red():
    # The control hover/focus glass-bloom ring is a neutral white hairline, not the accent/red.
    bloom = _block(CSS, "the control \"comes to life\"")
    assert "var(--red" not in bloom and "var(--accent" not in bloom


def test_gadget_rail_resize_handle_hover_is_neutral_not_red():
    # The GADGET-sidebar (rail) resize affordance glowed RED on hover/drag (var(--accent)/--red).
    # Colorless glass chrome: hover/drag → neutral luminous white; keyboard focus → system-blue.
    hover = _block(CSS, ".gadget-rail.grail-resizing .gadget-rail-resize-handle::before")
    assert "var(--red" not in hover and "var(--accent" not in hover and "e06c75" not in hover
    assert "rgba(255,255,255" in hover
    focus = _block(CSS, ".gadget-rail-resize-handle:focus-visible::before")
    assert "var(--ow-ios-blue" in focus
    assert "var(--red" not in focus and "var(--accent" not in focus


# ── (2) the dock is ONE glass family with the windows + cards ──────────────────
def test_dock_consumes_the_shared_light_glass_material():
    # The dock (#minimized-dock.ow-has-rows) is a MEMBER of the one light-glass material block
    # (the same block the windows + .og-card + .modal-content consume), so it shares the veil,
    # backdrop, rim + float — not a bespoke dark blur over an --fg-tinted border.
    light_block = _block(CSS, "GLASS BACKGROUND OPACITY")
    assert "#minimized-dock.ow-has-rows" in light_block
    assert ".ow-window" in light_block and ".og-card" in light_block
    # the bespoke dark dock material is gone (no blur(36px), no rgba(0,0,0,0.4) dock fill, no
    # --fg-tinted dock border).
    dock_layout = _block(CSS, "generous, Control-Center radius")
    assert "blur(36px)" not in dock_layout
    assert "color-mix(in srgb, var(--fg) 22%" not in dock_layout  # the old cyan border
    assert "var(--ow-glass-rim-border)" in dock_layout            # neutral rim instead


def test_dock_chip_chrome_is_colorless_neutral_white():
    # The dock TILE rides the parent glass with the neutral WHITE rim/fill every glass control
    # carries — not the --fg (cyan) tint.
    chip = _block(CSS, "the dock TILE rides the parent dock glass")
    assert "rgba(255,255,255" in chip
    assert "var(--ow-glass-rim-border)" in chip


# ── (3) "The House" (gadget rail) header is legible under glass ────────────────
def test_rail_head_takes_light_ink_not_black_under_glass():
    # The rail header sits over the DARK app (the rail is a transparent container), so it takes
    # the light --fg ink, NOT the dark-glass #16191f ink (which rendered it black-on-black).
    head = _block(CSS, "(gadget rail / control-room) HEADER legibility")
    assert "var(--fg" in head
    assert "#16191f" not in head
    # and the rail head is NO LONGER in the dark-ink fold block.
    dark_ink = _block(CSS, "color: #16191f")
    assert ".gadget-rail-head" not in dark_ink


def test_rail_head_controls_are_svg_line_icons_not_text_glyphs():
    # The ⠿ / ⇄ / × text glyphs are replaced by currentColor SVG line icons (legible + coherent).
    for ctrl in ("gadget-rail-rearrange", "gadget-rail-swap", "gadget-rail-close"):
        # the button carries an <svg ... stroke="currentColor"> child
        m = re.search(r'id="' + ctrl + r'"[^>]*>(.*?)</button>', INDEX, re.S)
        assert m, f"{ctrl} button not found"
        inner = m.group(1)
        assert "<svg" in inner and 'stroke="currentColor"' in inner, f"{ctrl} must be an SVG line icon"
        # no leftover emoji / box-drawing glyphs as the control content
        assert "⠿" not in inner and "⇄" not in inner


# ── (4) the condensed dock strip uses SVG line icons, not emoji ────────────────
def test_strip_renders_svg_line_icons_not_emoji():
    # The strip render path emits the SVG icon (innerHTML) for each registry id.
    assert "SVG_ICON[id]" in RAIL_JS
    assert "b.innerHTML = SVG_ICON[id]" in RAIL_JS
    # every registry gadget id has an SVG icon entry.
    ids = re.findall(r'id:\s*"([^"]+)"', RAIL_JS)
    ids = [i for i in ids if i.startswith("orwell-")]
    assert ids, "expected registry ids"
    icon_start = RAIL_JS.index("var SVG_ICON")
    icon_block = RAIL_JS[icon_start:RAIL_JS.index("};", icon_start) + 2]
    for gid in ids:
        assert '"' + gid + '":' in icon_block, f"{gid} needs an SVG_ICON entry"
    # the SVG icons are currentColor stroke icons (the kit language) — built by the _svg() helper.
    helper = RAIL_JS[RAIL_JS.index("function _svg"):icon_start]
    assert 'stroke="currentColor"' in helper


def test_no_clipboard_or_compass_emoji_rendered_as_strip_glyph():
    # The specific owner-flagged emoji (📋 clipboard, 🧭 compass) are not the rendered strip glyph:
    # the strip now emits SVG; the registry emoji survive only as a fallback string, never the
    # primary render path.
    sync = RAIL_JS[RAIL_JS.index("function syncStrip"):RAIL_JS.index("function syncStrip") + 900]
    assert "b.textContent = g.icon" not in sync.split("else")[0]  # SVG path comes first
    assert "if (SVG_ICON[id])" in sync
