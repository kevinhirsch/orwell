"""#1638 — the portrait-tile kit primitive (.ow-portrait / .ow-portrait-tile).

A new foundational kit primitive: the square, clipped, radiused FRAME around a houseguest's face
(a generated portrait or the designed monogram fallback) plus the selection / loading / broken /
muted chrome the frame owns. It unifies three drifted bespoke frames behind ONE primitive —

  • G6 cast portrait cards      (.oc-portrait / .oc-hg,  orwellCast.js)
  • G4 casting-headshot tiles   (.hs-cand / .hs-libitem / .hs-preview, orwellHeadshot.js)
  • G5 premiere status tiles    (.os-tile, orwellStatusPanel.js)

Owner ruling (§6.1): the migration is FRAME-ONLY — G6 keeps its hand-rolled two-layer reveal seam
(oc-img-pending / ocFadeIn) and does NOT adopt OrwellMonogram.face(); only the outer frame + state
classes move to the kit.

Source-pinned convention checks (the FE pytest lane has no DOM runtime; visual correctness rides
element_kit_demo.html + browser_smoke). The KIT region is the single source of truth for the
primitive; the consumers must adopt it.
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*p):
    with open(os.path.join(FRONTEND, *p), encoding="utf-8") as f:
        return f.read()


CSS = _read("static", "style.css")
DEMO = _read("static", "element_kit_demo.html")
CAST = _read("static", "js", "orwellCast.js")
HEADSHOT = _read("static", "js", "orwellHeadshot.js")
PANEL = _read("static", "js", "orwellStatusPanel.js")
DOC = _read(os.path.join("..", "docs", "design", "liquid-glass", "ELEMENT_KIT.md"))

# Bind the ELEMENT KIT region only — the primitive lives here, one source of truth.
KIT = CSS[CSS.index("── ELEMENT KIT ──"):CSS.index("── END ELEMENT KIT ──")]
# The portrait block for the tighter "no dup / no accent" scans (start at its opening /* so the
# comment-stripper sees a balanced comment).
PORTRAIT = KIT[KIT.index("/* ── PORTRAIT TILE"):KIT.index("/* ── COLOR WELL")]
# comment-stripped view — the /* … */ prose mentions tokens/selectors it must not be scanned for.
PORTRAIT_NC = re.sub(r"/\*.*?\*/", "", PORTRAIT, flags=re.S)


def _rule(css, selector):
    """The declaration body of a FLAT `selector { … }` rule (no nested braces)."""
    m = re.search(re.escape(selector) + r"\s*\{([^{}]*)\}", css)
    assert m, f"missing CSS rule: `{selector} {{ … }}`"
    return m.group(1)


def test_portrait_primitive_exists():
    assert re.search(r"\.ow-portrait\s*\{", KIT), ".ow-portrait frame must be authored in the KIT"
    assert re.search(r"\.ow-portrait-tile\s*\{", KIT), ".ow-portrait-tile must be authored in the KIT"
    base = _rule(KIT, ".ow-portrait")
    assert "aspect-ratio" in base, "the frame owns the aspect ratio"
    assert "overflow: hidden" in base, "the frame clips its face"
    # radius is TOKEN-driven, never a hard-coded radius on the base primitive
    assert "border-radius: var(--ow-portrait-radius" in base, "radius must come from --ow-portrait-radius"


def test_portrait_full_state_set():
    for needle in (
        ".ow-portrait.is-selected",
        ".ow-portrait.is-loading",
        ".ow-portrait.is-broken",
        ".ow-portrait--muted",
        ".ow-portrait--muted-grey",
        ".ow-portrait-tile:hover",
        ".ow-portrait-tile:focus-visible",
    ):
        assert needle in PORTRAIT, f"the portrait primitive must author {needle}"
    # the not-yet-met state loses NEITHER the dim NOR the desaturate — both in one class.
    mg = _rule(PORTRAIT, ".ow-portrait--muted-grey")
    assert "opacity" in mg and re.search(r"filter:\s*grayscale", mg), \
        ".ow-portrait--muted-grey must carry BOTH an opacity dim and a grayscale filter"


def test_focus_ring_is_system_blue_not_brand():
    tile_focus = _rule(PORTRAIT, ".ow-portrait-tile:focus-visible")
    assert "--ow-focus-ring" in tile_focus or "--ow-ios-blue" in tile_focus, \
        "the tile focus ring must be the kit system blue"
    # NO brand/accent hue anywhere on a portrait focus/selection rule (the G4 drift-fix pin).
    assert "--brand-color" not in PORTRAIT_NC, "no --brand-color drift in the portrait primitive"
    assert "--accent" not in PORTRAIT_NC, "no --accent hue in the portrait primitive"


def test_selected_is_ring_not_accent_fill():
    # the .is-selected rule (combined selector) — grab the block that starts at `.ow-portrait.is-selected`
    m = re.search(r"\.ow-portrait\.is-selected[^{]*\{([^{}]*)\}", PORTRAIT)
    assert m, "the .is-selected rule must exist"
    body = m.group(1)
    assert ("outline" in body or "box-shadow" in body) and "--ow-ios-blue" in body, \
        "selection is a system-blue ring (outline/box-shadow), not an accent fill"
    assert "background" not in body, "selection must never be an accent background fill"


def test_no_size_hardcode_on_primitive():
    base = _rule(KIT, ".ow-portrait")
    assert "width:" not in base and "height:" not in base, \
        "no fixed width/height on the primitive — aspect + caller track drive size"
    # OWN-4 pin: the interactive tile re-arms the aspect ratio against the app-wide button reset.
    m = re.search(r"\.ow-portrait-tile\s*\{([^{}]*)\}", PORTRAIT_NC)
    assert m and "height: auto" in m.group(1), "the OWN-4 pin: .ow-portrait-tile must set height:auto"


def test_two_tier_authored():
    assert "body.theme-frosted .ow-portrait" in PORTRAIT, "a frosted-tier author must exist"
    frosted = _rule(PORTRAIT, "body.theme-frosted .ow-portrait")
    assert "--ow-control-fill" in frosted and "--ow-glass-rim" in frosted, \
        "frosted composes --ow-control-fill + the luminous --ow-glass-rim edge"
    base = _rule(KIT, ".ow-portrait")
    assert "--panel" in base and "--border" in base, "the flat tier composes --panel/--border"
    # glass-on-glass ban: the frame never stacks a second backdrop-filter (declaration, not prose).
    assert "backdrop-filter:" not in PORTRAIT_NC, "no second backdrop-filter on the portrait frame"


def test_honors_a11y_trio():
    assert re.search(r"prefers-reduced-motion: reduce[^}]*\}[^@]*\.ow-portrait", PORTRAIT, re.S) \
        or ("prefers-reduced-motion" in PORTRAIT and ".ow-portrait" in PORTRAIT), \
        "reduced-motion must quiet the portrait animations"
    assert "prefers-reduced-motion: reduce" in PORTRAIT
    assert "prefers-contrast: more" in PORTRAIT, "a contrast branch for the primitive"
    assert "prefers-reduced-transparency: reduce" in PORTRAIT, "a reduced-transparency branch"


def test_eviction_not_duplicated():
    # eviction monochrome is owned by .ow-mono-face.ow-mono-evicted — the frame must not re-declare it
    # (scan the comment-stripped CSS: the design prose legitimately names the owning selector).
    assert "ow-mono-evicted" not in PORTRAIT_NC, \
        "the portrait frame must not re-declare eviction monochrome (owned by .ow-mono-evicted)"


def test_cast_g6_frame_only_adoption():
    # the frame swap landed on the cast card…
    assert "oc-hg ow-portrait-tile" in CAST, ".oc-hg must carry the kit interactive tile"
    assert "oc-portrait ow-portrait" in CAST, ".oc-portrait must carry the kit frame"
    # …and the hand-rolled two-layer reveal seam is KEPT (frame-only ruling — do NOT assert deleted).
    assert "oc-img-pending" in CAST and "oc-justin" in CAST, \
        "G6 keeps its bespoke two-layer reveal (frame-only ruling §6.1)"


def test_headshot_g4_adoption_and_kit_state_wiring():
    assert "hs-cand" in HEADSHOT and "ow-portrait-tile" in HEADSHOT, ".hs-cand adopts the kit tile"
    assert "ow-portrait" in HEADSHOT, ".hs-libitem / .hs-preview adopt the kit frame"
    # the load/error handlers must toggle the kit is-loading / is-broken (not only the legacy hs-*).
    assert re.search(r'remove\("hs-loading",\s*"is-loading"\)', HEADSHOT), \
        "the load handler must clear the kit .is-loading class"
    assert re.search(r'add\("hs-broken",\s*"is-broken"\)', HEADSHOT), \
        "the error handler must set the kit .is-broken class"
    # the G4 focus-color drift is fixed to the system blue.
    assert "hs-cand:focus-visible" in HEADSHOT and "--ow-ios-blue" in HEADSHOT
    m = re.search(r"\.hs-cand:focus-visible[^{]*\{([^{}]*)\}", HEADSHOT)
    assert m and "--brand-color" not in m.group(1), "the .hs-cand focus drift must be repointed off --brand-color"


def test_status_g5_adoption():
    assert "os-tile ow-portrait ow-portrait-tile" in PANEL, ".os-tile adopts the kit frame + tile"
    # the local .os-tile .ow-mono-face radius override is gone (the face inherits via the kit frame).
    assert ".os-tile .ow-mono-face { border-radius" not in PANEL, \
        "the local face-radius override must be removed (inherited from .ow-portrait now)"
    # the muted-grey modifier is adopted alongside the (pinned) unlit gate.
    assert "ow-portrait--muted-grey" in PANEL, ".os-tile-unmet migrates to the shared muted-grey modifier"


def test_coarse_pointer_tap_floor():
    m = re.search(r"@media \(pointer: coarse\)\s*\{(.*?)\n\}", PORTRAIT, re.S)
    assert m, "a coarse-pointer block must exist for the primitive"
    body = m.group(1)
    assert ".ow-portrait-tile::after" in body, "the 44px hit expander must be hosted on .ow-portrait-tile"
    assert "--ow-tap-min" in body or "44px" in body, "the hit target must be the 44px WCAG floor"


def test_demo_and_docs_reference_the_primitive():
    assert "Portrait tile" in DEMO and "ow-portrait-tile" in DEMO, \
        "element_kit_demo.html must instantiate the portrait tile"
    for state in ("is-selected", "is-loading", "is-broken", "ow-portrait--muted", "ow-portrait--muted-grey"):
        assert state in DEMO, f"the demo must show the {state} state"
    assert ".ow-portrait" in DOC and "--ow-portrait-radius" in DOC, \
        "ELEMENT_KIT.md must document the primitive + its radius token"
