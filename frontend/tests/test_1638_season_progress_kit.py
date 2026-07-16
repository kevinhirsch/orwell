"""#1638 (G8) — the season-progress kit primitives (.ow-progress / .on-chip).

Two DISPLAY-ONLY overlays injected by orwellSeasonProgress.js — a bottom-edge progress bar and a
top-right "Season N" chip — migrate off their bespoke fills/faces onto kit tokens:

  • .ow-progress / .ow-progress-fill — a reusable progressbar primitive (token track + fill; the
                     fill keeps the accent chain, since a progress FILL is a legitimate accent use
                     unlike chrome TEXT). `.ow-progress--edge` is the fixed bottom-edge variant.
  • .on-chip / .on-chip--season — a static, NON-INTERACTIVE notice-family pill. The drift-fix drops
                     the old `--mono` monospace face for `--ow-ui-font`, the accent-tinted ink for
                     legible `--fg`, and the accent border for `--ow-glass-rim-border`.

Both stay strictly display-only (pointer-events:none, no tab stop); the ARIA `role="progressbar"` +
value stays on the consumer element, and the chip's aria-label stays VALUE-bearing ("Season N",
JS-synced to the visible text — never the static "Season number"). Source-pinned (the FE has no DOM
runtime in the pytest lane), mirroring test_1638_compact_icon_kit.py.
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*p):
    with open(os.path.join(FRONTEND, *p), encoding="utf-8") as f:
        return f.read()


CSS = _read("static", "style.css")
DEMO = _read("static", "element_kit_demo.html")
JS = _read("static", "js", "orwellSeasonProgress.js")


def _block(css, selector):
    """The declaration body of `selector {…}` (selector matched literally, then a single
    brace-balanced-free block — the kit rules contain no nested braces)."""
    m = re.search(re.escape(selector) + r"\s*\{([^}]*)\}", css)
    assert m, f"missing CSS rule: `{selector} {{ … }}`"
    return m.group(1)


def _media_blocks(css, header_re):
    """Every `@media (...) { … }` body whose header matches `header_re`, brace-BALANCED to the
    block's actual closing brace."""
    out = []
    for m in re.finditer(header_re, css):
        open_i = css.index("{", m.start())
        depth, j = 0, open_i
        while j < len(css):
            if css[j] == "{":
                depth += 1
            elif css[j] == "}":
                depth -= 1
                if depth == 0:
                    break
            j += 1
        out.append(css[open_i + 1:j])
    return out


# ── 1. the progress primitive exists, token-driven ───────────────────────────────────
def test_progress_primitive_exists():
    track = _block(CSS, ".ow-progress")
    assert "--ow-progress-track" in track, ".ow-progress track must be token-driven (--ow-progress-track)"
    assert "overflow: hidden" in track, ".ow-progress must clip its fill (overflow:hidden)"
    fill = _block(CSS, ".ow-progress-fill")
    assert "--ow-progress-fill-color" in fill, ".ow-progress-fill must be token-driven (--ow-progress-fill-color)"
    # the accent chain is RETAINED with the #6d4aff final fallback (a progress fill is a legit accent use).
    assert "#6d4aff" in fill, "the fill token chain must keep the #6d4aff final fallback (never render unpainted)"
    assert re.search(r"\.ow-progress--edge\s*\{", CSS), "the .ow-progress--edge fixed-bottom variant is missing"


# ── 2. display-only: no hover/focus/cursor; the edge variant is non-interactive ───────
def test_progress_is_display_only():
    body = _block(CSS, ".ow-progress")
    assert ":hover" not in body and ":focus" not in body, ".ow-progress must not carry hover/focus (display-only)"
    assert "cursor: pointer" not in body, ".ow-progress is not a control — no cursor:pointer"
    # no standalone `.ow-progress:hover`/`:focus` rules anywhere.
    assert ".ow-progress:hover" not in CSS and ".ow-progress:focus" not in CSS, \
        ".ow-progress must never gain a hover/focus rule (it is a display overlay)"
    edge = _block(CSS, ".ow-progress--edge")
    assert "pointer-events: none" in edge, "the --edge variant must be non-interactive (pointer-events:none)"


# ── 3. reduced-motion freezes the fill ───────────────────────────────────────────────
def test_progress_reduced_motion():
    windows = _media_blocks(CSS, r"@media \(prefers-reduced-motion: reduce\)\s*\{")
    frozen = next((w for w in windows if ".ow-progress-fill" in w and "transition: none" in w), None)
    assert frozen, "@media (prefers-reduced-motion: reduce) must freeze the .ow-progress-fill transition"


# ── 4. the chip treatment exists, drift-fixed onto kit tokens ─────────────────────────
def test_chip_treatment_exists():
    body = _block(CSS, ".on-chip")
    assert "--ow-ui-font" in body, ".on-chip must use --ow-ui-font (NOT --mono/monospace)"
    assert "monospace" not in body and "--mono" not in body, ".on-chip must drop the bespoke --mono/monospace face"
    assert "--ow-radius-pill" in body, ".on-chip must use the --ow-radius-pill token"
    assert re.search(r"\.on-chip--season\s*\{", CSS), "the .on-chip--season placement variant is missing"


# ── 5. no accent ink on the chip (the specific drift this lane fixes) ─────────────────
def test_no_accent_ink_on_chip():
    body = _block(CSS, ".on-chip")
    assert "color: var(--fg)" in body, ".on-chip must ink legible --fg (no accent on chrome text)"
    m = re.search(r"(?<![-\w])color:\s*([^;]+);", body)
    assert m, ".on-chip must declare a color"
    ink = m.group(1)
    assert "--accent" not in ink and "--ow-accent" not in ink, \
        f".on-chip text ink must never be accent-tinted (the #726/#773 no-accent-on-chrome rule): {ink!r}"


# ── 6. the season BAR adopts the primitive ───────────────────────────────────────────
def test_season_bar_adopts_primitive():
    assert 'bar.className = "ow-progress ow-progress--edge"' in JS, \
        "the season bar must carry `ow-progress ow-progress--edge`"
    assert 'fill.className = "ow-progress-fill osp-fill"' in JS, \
        "the fill must be dual-classed `ow-progress-fill osp-fill` (paint()'s .osp-fill selector survives)"
    # the local bar shell CSS is reduced to placement/z only — the bespoke accent track fill is gone.
    assert "color-mix(in srgb, var(--accent, var(--accent-primary, #6d4aff)) 16%" not in JS, \
        "the bespoke `color-mix(--accent 16%)` bar track fill must be gone (now .ow-progress token track)"
    assert "#${BAR_ID} { display: none; }" in JS, "the bar shell must reduce to the initial-hidden state only"


# ── 7. the season CHIP adopts the treatment ──────────────────────────────────────────
def test_season_chip_adopts_treatment():
    assert 'chip.className = "on-chip on-chip--season"' in JS, \
        "the season chip must carry `on-chip on-chip--season`"
    # the bespoke monospace face + accent ink/border are gone from the JS.
    assert "font-family: var(--mono, monospace)" not in JS, "the bespoke chip `--mono` face must be gone"
    assert "color: color-mix(in srgb, var(--accent" not in JS, "the bespoke accent-tinted chip ink must be gone"
    assert "border: 1px solid color-mix(in srgb, var(--accent" not in JS, "the bespoke accent chip border must be gone"


# ── 8. ARIA is preserved — the bar progressbar + the chip VALUE-bearing name ──────────
def test_aria_preserved():
    for attr in ('"role", "progressbar"', '"aria-valuemin", "0"', '"aria-valuemax", "100"',
                 '"aria-valuenow"', '"aria-describedby"'):
        assert attr in JS, f"the bar must preserve its ARIA progressbar wiring ({attr})"
    # the chip's accessible name carries the season VALUE, synced to the visible text …
    assert 'chip.setAttribute("aria-label", "Season " + season)' in JS, \
        "the chip aria-label must be VALUE-bearing (`Season N`, synced to the visible text)"
    # … and the chip must never be GIVEN a static, value-less accessible name (which would override
    #    the visible text and hide the number from AT).
    assert 'setAttribute("aria-label", "Season number")' not in JS, \
        "the chip must not set a static `Season number` accessible name (it hides the number from AT)"


# ── 9. both overlays keep pointer-events:none (never intercept clicks beneath) ────────
def test_pointer_events_none_preserved():
    assert "pointer-events: none" in _block(CSS, ".ow-progress--edge"), \
        "the season bar (.ow-progress--edge) must keep pointer-events:none"
    assert "pointer-events: none" in _block(CSS, ".on-chip--season"), \
        "the season chip (.on-chip--season) must keep pointer-events:none"


# ── 10. the reference demo instantiates both primitives ──────────────────────────────
def test_demo_references_the_primitive():
    assert "Progress &amp; chip" in DEMO, "the demo needs a labeled progress/chip section"
    assert 'class="ow-progress"' in DEMO, "the demo must instantiate .ow-progress"
    assert 'class="ow-progress-fill"' in DEMO, "the demo must instantiate .ow-progress-fill"
    assert 'class="on-chip"' in DEMO, "the demo must instantiate .on-chip"
    # a real percentage fill so every tier renders it.
    assert "width:60%" in DEMO, "the demo progressbar should show a real fill (e.g. 60%)"
