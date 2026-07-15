"""#1638 — the resize-handle kit primitive (.ow-resize-handle) — G7.

The thin, edge-hugging grab affordance that drives a container's width (or height) by drag AND
keyboard — today the sole consumer is the gadget-rail width grip (.gadget-rail-resize-handle in
orwellGadgetRail.js). It is a GRIP, not a value control, so `.ow-slider` (a track + thumb painting a
VALUE) is the wrong target; `.ow-resize-handle` gives the grip its own kit-branded look + affordance
contract. The primitive is presentation + affordance ONLY — the drag/keyboard/clamp/persist logic
stays in the consumer (the kit never owns width state).

Source-pinned (the FE has no DOM runtime in the pytest lane; visual correctness is the rendered demo
+ browser_smoke). This gate pins the CSS contract, the two baked-in design decisions (#8/#9 no accent
on the bar; the one sanctioned system-blue focus), and the G7 consumer adoption — WITHOUT regressing
the existing keyboard a11y (role=slider + aria-value* + Arrow-key nudges).
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*p):
    with open(os.path.join(FRONTEND, *p), encoding="utf-8") as f:
        return f.read()


CSS = _read("static", "style.css")
DEMO = _read("static", "element_kit_demo.html")
RAIL = _read("static", "js", "orwellGadgetRail.js")
DOC = _read("..", "docs", "design", "liquid-glass", "ELEMENT_KIT.md")


def _block(css, selector):
    """The declaration body of `selector {…}` (matched literally, then a single brace-balanced-free
    block — the kit rules contain no nested braces)."""
    m = re.search(re.escape(selector) + r"\s*\{([^}]*)\}", css)
    assert m, f"missing CSS rule: `{selector} {{ … }}`"
    return m.group(1)


def _resize_region():
    """The whole `.ow-resize-handle` KIT authoring region — from its section comment to the next
    kit block (COLOR WELL). Used for the whole-primitive scans (no-red, a11y trio)."""
    start = CSS.find("RESIZE HANDLE: .ow-resize-handle")
    assert start != -1, "the `.ow-resize-handle` kit block is not authored in the ELEMENT KIT region"
    end = CSS.find("COLOR WELL: .ow-color-well", start)
    assert end != -1, "could not bound the resize-handle region"
    return CSS[start:end]


REGION = _resize_region()


# ── 1. the primitive exists, with the preserved axial geometry + token-driven bar ────
def test_resize_handle_primitive_exists():
    strip = _block(CSS, ".ow-resize-handle")
    assert "position: absolute" in strip, "the hit strip must be absolutely positioned"
    assert "background: transparent" in strip, "the hit strip itself is transparent (only the bar paints)"
    assert "touch-action: none" in strip, "the grip must set touch-action:none for a clean drag"
    # the FULL axial geometry from the old `top:0; bottom:0` is preserved as `inset-block:0`.
    assert "inset-block: 0" in strip, "the strip must carry `inset-block:0` (full-height extent)"
    assert "var(--ow-resize-thickness" in strip, "the strip width must be token-driven"
    bar = _block(CSS, ".ow-resize-handle::before")
    assert 'content: ""' in bar and "inset-block: 0" in bar, "the ::before bar must be full-height"
    assert "var(--ow-resize-bar" in bar, "the visible bar width must be token-driven (--ow-resize-bar)"
    # the [data-edge] variants keep the -3px / 3px edge offsets so the strip stays anchored to the rail.
    edge_start = _block(CSS, '.ow-resize-handle[data-edge="start"]')
    assert "-3px" in edge_start, "data-edge=start must keep the -3px strip offset"
    edge_start_bar = _block(CSS, '.ow-resize-handle[data-edge="start"]::before')
    assert "3px" in edge_start_bar, "data-edge=start ::before must keep the 3px bar inset"
    edge_end = _block(CSS, '.ow-resize-handle[data-edge="end"]')
    assert "-3px" in edge_end, "data-edge=end must keep the -3px (mirrored) strip offset"


# ── 2. hover / active-drag rim is NEUTRAL glass, never an accent / red (#8/#9) ────────
def test_hover_and_drag_rim_is_neutral_not_accent():
    hover = _block(CSS, ".ow-resize-handle:hover::before,\n.ow-resize-handle.is-active::before")
    assert "var(--ow-glass-rim-strong" in hover, \
        "the hover / active-drag bar must use the neutral --ow-glass-rim-strong token"
    # the #8/#9 contract: NO accent hue / red anywhere in the resize-handle rules.
    assert "--accent" not in REGION, "the resize affordance must carry NO accent hue (#8/#9)"
    assert "var(--red" not in REGION, "the resize affordance must carry NO red (#8/#9)"
    assert not re.search(r"#f[0-9a-fA-F]{2,5}\b", REGION), \
        "the resize affordance must carry no bespoke red/warm hex (#8/#9)"
    # and the token itself is a NEUTRAL white rim (defined in the kit :root).
    m = re.search(r"--ow-glass-rim-strong:\s*(rgba\(255,\s*255,\s*255[^;]*)\)", CSS)
    assert m, "--ow-glass-rim-strong must be a neutral white rgba defined in the kit"


# ── 3. focus is the one sanctioned system-blue; the bar IS the focus signal ───────────
def test_focus_is_system_blue():
    focus = _block(CSS, ".ow-resize-handle:focus-visible::before")
    assert "var(--ow-focus-ring" in focus or "var(--ow-ios-blue" in focus, \
        "keyboard focus must paint the system-blue --ow-focus-ring / --ow-ios-blue"
    outline = _block(CSS, ".ow-resize-handle:focus-visible")
    assert "outline: none" in outline, "focus drops the outline — the bar is the focus signal"


# ── 4. an orientation variant exists so the primitive isn't width-only ────────────────
def test_orientation_variants():
    horiz = _block(CSS, '.ow-resize-handle[aria-orientation="horizontal"]')
    assert "height: var(--ow-resize-thickness" in horiz, "the horizontal variant swaps to a height grip"
    assert "ns-resize" in horiz, "the height grip uses the ns-resize cursor"


# ── 5. the a11y trio ─────────────────────────────────────────────────────────────────
def test_honors_a11y_trio():
    assert "@media (prefers-reduced-motion: reduce)" in REGION, "reduced-motion window missing"
    rm = re.search(r"@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.ow-resize-handle::before\s*\{([^}]*)\}", REGION)
    assert rm and "transition: none" in rm.group(1), "reduced-motion must drop the bar transition"
    assert "@media (prefers-contrast: more)" in REGION, "increased-contrast window missing"
    assert "--ow-resize-bar: 3px" in REGION, "increased-contrast must thicken the bar to 3px"
    assert "@media (prefers-reduced-transparency: reduce)" in REGION, \
        "reduced-transparency window missing (must solidify the hover/drag fill)"


# ── 6. the gadget rail adopts the primitive — WITHOUT losing the keyboard a11y ────────
def test_gadget_rail_adopts_the_primitive():
    # adoption: the created handle is dual-classed with the kit class.
    assert re.search(r'className\s*=\s*"ow-resize-handle gadget-rail-resize-handle"', RAIL), \
        "orwellGadgetRail.js must dual-class the handle `ow-resize-handle gadget-rail-resize-handle`"
    # the keyboard-a11y regression guard: role=slider + tabindex + the full aria-value* set survive.
    assert 'setAttribute("role", "slider")' in RAIL, "the handle must stay role=slider"
    assert 'setAttribute("tabindex", "0")' in RAIL, "the handle must stay focusable (tabindex 0)"
    for attr in ("aria-valuemin", "aria-valuenow", "aria-valuemax", "aria-valuetext"):
        assert attr in RAIL, f"the handle must still set {attr}"
    # the Arrow-key nudge branch survives.
    assert 'e.key === "ArrowLeft"' in RAIL and 'e.key === "ArrowRight"' in RAIL, \
        "the ArrowLeft/ArrowRight keyboard-resize branch must survive the migration"
    # the standalone appearance block moved to the kit — the consumer's `.gadget-rail-resize-handle`
    # rule must NO LONGER carry the `cursor: ew-resize` appearance (only edge/display overrides stay).
    consumer = re.search(r"\.gadget-rail-resize-handle\s*\{([^}]*)\}", CSS)
    assert consumer and "cursor: ew-resize" not in consumer.group(1), \
        "the standalone .gadget-rail-resize-handle appearance block (cursor: ew-resize) must move to the kit"
    # the .is-active bar-paint class is added on pointerdown and removed in endDrag (the release/cancel
    # path) — mirroring the grail-resizing add/remove.
    assert 'classList.add("is-active")' in RAIL, "must add .is-active on drag start (pointerdown)"
    assert 'classList.remove("is-active")' in RAIL, "must remove .is-active on release/cancel/abort"


# ── 7. desktop-only: no coarse-pointer tap-target obligation ──────────────────────────
def test_desktop_only_no_coarse_pointer_obligation():
    # the consumer still gates the handle behind isResizable()/_isNarrow() (never on touch).
    assert "isResizable()" in RAIL, "the consumer must keep gating the handle behind isResizable()"
    assert "_isNarrow()" in RAIL, "isResizable() must still consult _isNarrow() (desktop-only)"
    # and the kit reinforces it: hidden on a coarse pointer.
    assert re.search(r"@media \(pointer: coarse\)\s*\{[^}]*\.ow-resize-handle\s*\{[^}]*display: none", REGION), \
        "the kit must hide .ow-resize-handle on a coarse pointer (no sub-44 tap-target violation)"


# ── 8. the demo + docs reference the primitive ───────────────────────────────────────
def test_demo_and_docs_reference_the_primitive():
    assert "Resize handle — .ow-resize-handle" in DEMO, "the demo needs a labeled resize-handle section"
    assert "ow-resize-handle" in DEMO, "the demo must instantiate .ow-resize-handle"
    # rest + hover/active + focus stills.
    assert 'class="ow-resize-handle is-active"' in DEMO, "the demo must show the active-drag still"
    assert "ek-force-focus" in DEMO and DEMO.count("ow-resize-handle") >= 3, \
        "the demo must show rest / active / focus stills of the grip"
    # docs: documented AND explicitly says WHY it is a grip, not .ow-slider.
    assert "### Resize handle — `.ow-resize-handle`" in DOC, "ELEMENT_KIT.md must document the primitive"
    assert "not `.ow-slider`" in DOC, "the doc must explain why it is a grip, not .ow-slider"
