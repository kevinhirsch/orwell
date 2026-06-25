"""Liquid-glass craft touches — Genius #21 (pointer-reactive specular) + #26
(chromatic-fringe edge). SOURCE-PINS for the two restrained Apple-style material
touches added in the liquid-glass lane.

Both gate on body.glass-full (the Full-Glass / Chromium SVG-refraction tier — Frosted
and Normal are untouched) and honor the a11y queries. The contracts pinned here are
the ones easy to break by accident:

  #21 pointer-reactive specular:
    - exactly ONE focused surface carries the rim at a time (the JS tracks a single
      `specActive`, composer-focus wins over a focused window);
    - it is rAF-throttled, Full-Glass-only, and prefers-reduced-motion → a STATIC rim
      (no pointer tracking);
    - the highlight hue is OKLCH-normalized to NEUTRAL (~0 chroma) and stays under the
      #770 0.16 soft-hairline alpha ceiling.

  #26 chromatic-fringe edge:
    - limited to ≤2 KEY surfaces (the focused window + the composer);
    - high-chroma OKLCH stops (material quality, not a rainbow / not an accent stroke);
    - suppressed/neutralized under prefers-reduced-transparency.

The live visual behavior (the moving rim tracking the pointer; ONE at a time; the 1px
fringe) is proven by the Playwright frames captured in the PR. Source-pinned here
(the FE has no DOM runtime in pytest). Roles only, no names, no engine/network.

Intentionally DEFERRED: Genius #30 (the WebGPU/WebGL flowing-glass spike) — research
only / post-launch; SVG refraction is sufficient. Not built (see the CSS region note).
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


JS = _read("static", "js", "liquidGlass.js")
CSS = _read("static", "style.css")


# ════════════════════════════════════════════════════════════════════════════
# #21 — POINTER-REACTIVE SPECULAR (single focused surface)
# ════════════════════════════════════════════════════════════════════════════

def test_pointer_specular_tracks_a_single_active_surface():
    # The JS owns exactly ONE surface (`specActive`): setSpecActive clears the previous
    # before promoting the next, so there is provably never more than one live rim.
    assert "specActive" in JS
    assert "function setSpecActive(" in JS
    block = JS[JS.index("function setSpecActive("):JS.index("function refreshSpecTarget(")]
    # promoting a new surface clears the prior one (one-at-a-time guarantee)
    assert "if (specActive) clearSpec(specActive)" in block


def test_pointer_specular_picks_focused_surface_composer_wins():
    # focusedSurface(): composer focus (.chat-input-bar:focus-within) wins over a
    # focused window (.ow-window.ow-focused); STRICTLY one returned.
    block = JS[JS.index("function focusedSurface("):JS.index("function clearSpec(")]
    assert ".chat-input-bar" in block and ':focus-within' in block.replace('"', "'") or \
        '":focus-within"' in block
    assert ".ow-window.ow-focused" in block
    # composer is checked first (returns before the window), so it wins.
    assert block.index("chat-input-bar") < block.index("ow-window.ow-focused")


def test_pointer_specular_sets_position_custom_properties():
    # liquidGlass.js writes --ow-spec-x / --ow-spec-y (0..1 pointer position) on the
    # active surface; the CSS consumes them as the radial-gradient center.
    assert "--ow-spec-x" in JS and "--ow-spec-y" in JS
    assert "--ow-spec-x" in CSS and "--ow-spec-y" in CSS


def test_pointer_specular_is_raf_throttled():
    # pointermove only stashes the latest coords (specPending); a single rAF flushes
    # them to the CSS vars — no per-event style-write storm.
    assert "specPending" in JS
    assert "function flushSpec(" in JS
    assert "function onSpecPointerMove(" in JS
    move = JS[JS.index("function onSpecPointerMove("):JS.index("function bindSpec(")]
    assert "requestAnimationFrame" in move
    assert "specPending = {" in move


def test_pointer_specular_reduced_motion_is_static_no_tracking():
    # prefers-reduced-motion → the JS marks the surface data-ow-spec="static" (no
    # pointer chase) and flushSpec / onSpecPointerMove early-return under reducedMotion.
    assert 'setAttribute("data-ow-spec", "static")' in JS
    flush = JS[JS.index("function flushSpec("):JS.index("function onSpecPointerMove(")]
    assert "if (reducedMotion()) return" in flush
    move = JS[JS.index("function onSpecPointerMove("):JS.index("function bindSpec(")]
    assert "reducedMotion()" in move
    # the CSS static variant exists (fixed top rim, no pointer var in its center)
    assert '[data-ow-spec="static"]::after' in CSS


def test_pointer_specular_is_full_glass_only():
    # specEligible() gates on isFrosted() (== body.glass-full) and NOT reduced-transparency.
    elig = JS[JS.index("function specEligible("):JS.index("function focusedSurface(")]
    assert "isFrosted()" in elig
    assert "reducedTransparency()" in elig
    # the CSS rule is scoped to body.glass-full
    assert "body.glass-full [data-ow-spec]::after" in CSS


def test_pointer_specular_hue_is_neutral_oklch_under_hairline_ceiling():
    # The moving highlight is OKLCH near-white with ~0 chroma (no accent on colorless
    # glass), and its alpha stops stay under the #770 0.16 soft-hairline ceiling.
    region = _craft_region()
    # neutral OKLCH near-white, negligible chroma (the 3rd OKLCH component is the chroma)
    assert "oklch(0.99 0.004 250" in region, "specular hue must be neutral near-white OKLCH"
    core = re.search(r"--ow-spec-alpha-core:\s*([0-9.]+)", region)
    soft = re.search(r"--ow-spec-alpha-soft:\s*([0-9.]+)", region)
    assert core and soft, "missing the specular alpha tokens"
    assert float(core.group(1)) <= 0.16, "specular core alpha exceeds the #770 hairline ceiling"
    assert float(soft.group(1)) <= 0.16, "specular soft alpha exceeds the #770 hairline ceiling"


def test_pointer_specular_pseudo_is_non_interactive():
    # the ::after must never eat clicks on the focused surface.
    after = CSS[CSS.index("body.glass-full [data-ow-spec]::after {"):]
    after = after[:after.index("}")]
    assert "pointer-events: none" in after


def test_pointer_specular_suppressed_under_reduced_transparency():
    # Apple drops glass under Reduce Transparency → no specular sheen.
    region = _craft_region()
    rt = region[region.index("#26") if "#26" in region else 0:]  # search whole region
    assert re.search(
        r"@media \(prefers-reduced-transparency: reduce\)\s*\{[^}]*"
        r"body\.glass-full \[data-ow-spec\]::after\s*\{\s*display:\s*none",
        _craft_region(), re.S,
    ), "specular must be dropped under reduced transparency"


# ════════════════════════════════════════════════════════════════════════════
# #26 — CHROMATIC-FRINGE EDGE (≤2 key surfaces)
# ════════════════════════════════════════════════════════════════════════════

def _craft_region():
    # the dedicated craft region appended to style.css.
    idx = CSS.index("LIQUID-GLASS CRAFT REGION")
    return CSS[idx:]


def test_chromatic_fringe_limited_to_two_key_surfaces():
    # The fringe is drawn via a ::before on EXACTLY the focused window + the composer —
    # nothing else. We pin the selector list and that it is exactly those two surfaces.
    region = _craft_region()
    m = re.search(
        r"((?:body\.glass-full [^,{]+::before,?\s*)+)\{[^}]*padding:\s*1px",
        region, re.S,
    )
    assert m, "missing the 1px chromatic-fringe ::before rule"
    selectors = [s.strip() for s in m.group(1).rstrip(", \n").split(",")]
    selectors = [s for s in selectors if s]
    assert len(selectors) == 2, f"chromatic fringe must be on exactly 2 surfaces, got {selectors}"
    joined = " ".join(selectors)
    assert ".ow-window.ow-focused::before" in joined, "fringe must include the focused window"
    assert ".chat-input-bar::before" in joined, "fringe must include the composer"


def test_chromatic_fringe_is_one_pixel():
    region = _craft_region()
    # the gradient-border trick: a 1px padding ::before with a mask carving the interior.
    assert "padding: 1px" in region
    # the gradient-border mask-composite (exclude / xor) carves the 1px perimeter.
    assert "mask-composite: exclude" in region


def test_chromatic_fringe_uses_high_chroma_oklch_stops_not_a_rainbow():
    region = _craft_region()
    cool = re.search(r"--ow-fringe-cool:\s*oklch\(([^)]*)\)", region)
    warm = re.search(r"--ow-fringe-warm:\s*oklch\(([^)]*)\)", region)
    mid = re.search(r"--ow-fringe-mid:\s*oklch\(([^)]*)\)", region)
    assert cool and warm and mid, "missing the OKLCH fringe stop tokens"
    # high CHROMA on the two dispersion stops (the 2nd OKLCH component), kept faint
    # via the alpha (low) so it's perceived weight, not decoration.
    cool_chroma = float(cool.group(1).split()[1])
    warm_chroma = float(warm.group(1).split()[1])
    assert cool_chroma >= 0.10, "cool fringe stop must be high-chroma"
    assert warm_chroma >= 0.10, "warm fringe stop must be high-chroma"
    # a near-neutral MIDPOINT keeps it from reading as a rainbow (low chroma in the middle).
    mid_chroma = float(mid.group(1).split()[1])
    assert mid_chroma < cool_chroma and mid_chroma < warm_chroma, \
        "the fringe midpoint must be lower-chroma than the stops (no rainbow)"
    # the alpha on the dispersion stops stays faint (material quality, not a stroke).
    for tok in (cool.group(1), warm.group(1)):
        alpha = float(tok.split("/")[1].strip()) if "/" in tok else 1.0
        assert alpha <= 0.4, "fringe stop alpha too strong — reads as a colored stroke"


def test_chromatic_fringe_is_full_glass_only():
    region = _craft_region()
    # both fringe selectors are scoped under body.glass-full.
    assert "body.glass-full .ow-window.ow-focused::before" in region
    assert "body.glass-full .chat-input-bar::before" in region


def test_chromatic_fringe_neutralized_under_reduced_transparency():
    region = _craft_region()
    # under reduced transparency the chromatic edge is replaced by a plain neutral hairline.
    m = re.search(
        r"@media \(prefers-reduced-transparency: reduce\)\s*\{[^}]*"
        r"\.ow-window\.ow-focused::before[^}]*\.chat-input-bar::before\s*\{([^}]*)\}",
        region, re.S,
    )
    assert m, "missing the reduced-transparency fringe neutralization"
    body = m.group(1)
    assert "var(--ow-glass-rim-border" in body, "fringe must fall back to the neutral rim token"
    assert "oklch" not in body, "neutralized fringe must NOT keep a chromatic OKLCH gradient"


def test_chromatic_fringe_carries_no_accent_hue_token():
    # #770 / ruling #729: glass-chrome STROKES carry no theme accent/red. The fringe is
    # its own colorless OKLCH dispersion, never the accent.
    region = _craft_region()
    fringe = region[region.index("#26 chromatic-fringe"):]
    assert "var(--red)" not in fringe and "var(--accent" not in fringe


# ════════════════════════════════════════════════════════════════════════════
# Cross-cutting: the region exists, is fail-soft, and #30 is deferred (not built)
# ════════════════════════════════════════════════════════════════════════════

def test_craft_region_exists_and_is_anchored():
    assert "LIQUID-GLASS CRAFT REGION" in CSS
    assert "Genius #21" in CSS and "#26" in CSS


def test_webgpu_spike_is_intentionally_deferred_not_built():
    # #30 (WebGPU/WebGL flowing-glass) is research-only / post-launch — must NOT be built.
    assert "#30" in CSS and "deferred" in _craft_region().lower()
    # no WebGPU/WebGL machinery snuck into the liquid-glass module.
    assert "getContext('webgpu'" not in JS and 'getContext("webgpu"' not in JS
    assert "WebGLRenderingContext" not in JS
    assert "navigator.gpu" not in JS


def test_pointer_specular_is_fail_soft():
    # every spec mutation is wrapped so a failure leaves the CSS/SVG glass intact.
    spec = JS[JS.index("POINTER-REACTIVE SPECULAR"):JS.index("// ── Boot")]
    assert spec.count("catch (_)") >= 4, "pointer-specular paths must be pervasively fail-soft"
