"""#780 — Liquid-Glass cache-clean audit follow-up. Source-pinned checks for the
fixed findings:

  • #2 Colored emoji in game-window titlebars → monochrome icon language. The kit
    renders the `title` string VERBATIM into the titlebar (it does NOT render the
    `icon` slot there — that drives the dock chip), so a leading emoji in `title`
    lands as a full-color glyph that clashes with the mono SVG icon family. The fix
    drops the emoji from every game-window title; the mono SVG `icon` slot stays.
  • #3 Finale window opened flush top-left, clipped (red traffic-light cut off). Its
    content CSS defaults to `display:none`, so the slot restack at open() skipped it
    (an invisible entry is not stacked) and it sat at the CSS-default 0,0. The fix
    re-runs the slot stack the moment the panel becomes visible.
  • #4 Glass tier override gap. Re-selecting a BUILT-IN theme passed ct=null to
    resolveGlassTier, so it always resolved the per-theme DEFAULT — clobbering a
    tier the player had explicitly saved for that same theme. The fix consults the
    saved record when re-selecting the same theme.
  • #1 (optional polish) Login presets not distinct / true to label. The mesh-gradient
    preset palettes are made distinct + name-true (sunset=warm, aurora=green/teal/violet,
    gold=warm gold, etc.).
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


# A conservative range that covers the colored-emoji glyphs the audit flagged
# (🎬 🏆 ✨ 🚪 📼 …) — any Extended Pictographic / emoji-block codepoint.
_EMOJI = re.compile(
    "[\U0001F000-\U0001FAFF\U00002600-\U000027BF\U00002B00-\U00002BFF\U0001F1E6-\U0001F1FF️]"
)


def _titlebar_titles(js):
    """Every `title: "..."` literal passed to OrwellWindowKit.create — the string the
    kit renders verbatim into the titlebar."""
    return re.findall(r'title:\s*"([^"]*)"', js) + re.findall(r"title:\s*'([^']*)'", js)


# ── #2 — no colored emoji in any GAME-window titlebar ──────────────────────────
def test_no_emoji_in_game_window_titlebars():
    for fname in (
        "orwellCast.js",
        "orwellFinale.js",
        "orwellNewSeason.js",
        "orwellRetrospective.js",
    ):
        js = _read("static", "js", fname)
        for title in _titlebar_titles(js):
            bad = _EMOJI.findall(title)
            assert not bad, f"{fname}: titlebar title {title!r} still carries emoji {bad}"


def test_game_windows_still_pass_a_monochrome_svg_icon():
    """Dropping the emoji must not drop the (mono, currentColor) icon — it still drives
    the dock chip. Each game window passes an inline SVG `icon`."""
    for fname in ("orwellCast.js", "orwellFinale.js", "orwellRetrospective.js"):
        js = _read("static", "js", fname)
        assert "icon:" in js and "<svg" in js, f"{fname}: lost its mono SVG icon"
        assert "currentColor" in js, f"{fname}: icon must stroke/fill currentColor (monochrome)"


def test_new_season_icon_is_mono_svg_not_emoji():
    """orwellNewSeason previously passed an EMOJI as its `icon` (🎬 / 🚪) — now a mono SVG."""
    js = _read("static", "js", "orwellNewSeason.js")
    assert "ICON_NEW" in js and "ICON_EVICTED" in js
    # The icon opt must reference the mono SVG constants, never a raw emoji.
    icon_line = next(l for l in js.splitlines() if "icon: evicted ?" in l)
    assert "ICON_EVICTED" in icon_line and "ICON_NEW" in icon_line
    assert not _EMOJI.findall(icon_line), "new-season icon slot still carries emoji"
    # And the constants are inline SVGs in currentColor.
    for const in ("ICON_NEW", "ICON_EVICTED"):
        decl = next(l for l in js.splitlines() if l.strip().startswith(f"const {const}"))
        assert "<svg" in decl and "currentColor" in decl


# ── #3 — finale re-anchors the instant it becomes visible ──────────────────────
def test_finale_restacks_when_it_becomes_visible():
    """The finale's content CSS defaults display:none, so the open()-time slot restack
    skips it. The fix re-runs the slot stack once it is shown, so it lands on its
    top-left slot base instead of the clipped CSS-default 0,0."""
    js = _read("static", "js", "orwellFinale.js")
    # The default-hidden state is the precondition for the bug.
    assert "display: none;" in js
    # The fix: restack after the visibility flip, via the public slot API.
    assert js.count("window.OrwellSlots.restackAll") >= 2, (
        "expected a restack in BOTH render() and the _orwellFinaleEnsure show seam"
    )
    # It must guard on actually-visible (never restack while still hidden / no-op).
    assert "_wasHidden" in js


# ── #4 — saved glass tier overrides the per-theme default on re-select ─────────
def test_glass_tier_override_consults_saved_record_for_builtin_theme():
    """The swatch-click handler must NOT clobber a saved explicit tier when re-selecting
    a built-in theme: it consults the saved record (same theme name) before falling to
    the per-theme default."""
    js = _read("static", "js", "theme.js")
    # The fixed call passes the saved record (not a bare null) for built-ins.
    assert "_tierRec" in js
    assert "resolveGlassTier(_tierRec, name)" in js
    # The old, clobbering call is gone.
    assert "resolveGlassTier(ct, name)" not in js
    # It only preserves when the saved record is for the SAME theme being selected.
    assert "_savedRec.name === name" in js


def test_resolve_glass_tier_still_honors_explicit_saved_tier():
    """Defensive: the resolution order is unchanged — an explicit saved glassTier wins
    over the per-theme default (the whole point of the override)."""
    js = _read("static", "js", "theme.js")
    # resolveGlassTier reads rec.glassTier FIRST.
    fn = js[js.index("function resolveGlassTier"):]
    fn = fn[: fn.index("\n}")]
    assert "rec.glassTier === 'full'" in fn
    assert "rec.glassTier === 'frosted'" in fn
    assert "rec.glassTier === 'normal'" in fn
    # ... and only then defaults.
    assert fn.index("rec.glassTier") < fn.index("defaultGlassTierFor")


# ── #1 (optional polish) — login presets distinct + name-true ──────────────────
def _preset_vars(css, name):
    block = re.search(
        r'\[data-lbg-preset="%s"\]\s*\{(.*?)\}' % re.escape(name), css, re.S
    )
    assert block, f"preset {name} not found"
    return dict(re.findall(r"--(lbg-[\w-]+):\s*(#[0-9a-fA-F]{3,8})", block.group(1)))


def test_login_presets_are_distinct_and_name_true():
    css = _read("static", "css", "meshGradient.css")
    presets = {n: _preset_vars(css, n) for n in ("sunset", "aurora", "ocean", "gold", "lavender")}
    # All five lead-color sets are distinct (no two presets share their c1..c4 tuple).
    tuples = {n: tuple(p[k] for k in ("lbg-c1", "lbg-c2", "lbg-c3", "lbg-c4")) for n, p in presets.items()}
    assert len(set(tuples.values())) == 5, "two presets share a palette"
    # sunset must NOT lead with the same purple aurora used to (the reported collision):
    # its first stop is warm (red channel dominant), not a violet.
    s1 = presets["sunset"]["lbg-c1"]
    sr, sg, sb = int(s1[1:3], 16), int(s1[3:5], 16), int(s1[5:7], 16)
    assert sr > sb, f"sunset c1 {s1} should be warm (R>B), not a purple lead"
    # gold must read warm gold, not green/teal: its first stop is warm (R>=G>B), not teal.
    g1 = presets["gold"]["lbg-c1"]
    gr, gg, gb = int(g1[1:3], 16), int(g1[3:5], 16), int(g1[5:7], 16)
    assert gr >= gg and gg > gb, f"gold c1 {g1} should be warm gold, not teal/green"
