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

Cache-clean follow-up pins (2026-07-11, the #780-4/#780-5/#780-6 sweep):
  • #4 (behavioural) An explicit SAVED glassTier must win over the dedicated `glass`
    named-theme default — proven by EVALUATING resolveGlassTier/defaultGlassTierFor
    (extracted from theme.js) in node, not just source-pinning them; and the first-paint
    head-script in index.html resolves the saved tier BEFORE the per-theme glass default,
    so a saved 'frosted'/'normal' never flashes glass-full on cold load.
  • #5 The element-kit demo's wallpaper covers the FULL scroll height (no dark `--bg`
    slab past the fold) — the demo overrides the app shell to a scrollable block with a
    fixed full-bleed wallpaper.
  • #6 The received-bubble (`.msg-ai`) backing over a busy MULTICOLOR wallpaper is a
    NEUTRAL frost, not a per-bubble patchy plate — the saturate amplifier was dropped from
    180% so a hostile wall no longer blooms through at a different hue per bubble.
"""
import os
import re
import shutil
import subprocess
import tempfile

import pytest

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


# ── #4 (behavioural) — saved frosted OVERRIDES the glass named theme ─────────────
def _extract_fn(js, name):
    """Pull a top-level `function <name>(...) { ... }` declaration (up to the first
    line-start closing brace) out of theme.js so it can be evaluated standalone."""
    m = re.search(r"function %s\([^)]*\)\s*\{.*?\n\}" % re.escape(name), js, re.S)
    assert m, f"could not extract function {name} from theme.js"
    return m.group(0)


def test_saved_glass_tier_behaviorally_overrides_glass_named_theme():
    """The audit's #4 (an explicit saved tier must win over the per-theme default), re-pinned
    through the frosted-COLLAPSE (owner ruling). 'frosted' is no longer a resolved tier — a
    saved 'frosted' (explicit string OR the legacy `frosted:true` bool) FOLDS to Glass
    ('full'); Flat ('normal') still wins over the glass default; and every theme's per-theme
    default is now Glass ('full'). Proven BEHAVIOURALLY by running the real
    resolveGlassTier/defaultGlassTierFor (lifted from theme.js) in node."""
    node = shutil.which("node")
    if not node:
        pytest.skip("node not available to evaluate the theme resolution logic")
    js = _read("static", "js", "theme.js")
    harness = (
        # a minimal THEMES the two functions read (glass ships glassTier:'full'; a house
        # theme + a plain theme cover the non-glass branches) — roles only, no real palettes.
        "const THEMES = { glass:{glassTier:'full',glass:true}, 'the-feed':{house:true}, dark:{} };\n"
        + _extract_fn(js, "defaultGlassTierFor") + "\n"
        + _extract_fn(js, "resolveGlassTier") + "\n"
        + r"""
const cases = [
  // COLLAPSE: a saved 'frosted' folds to Glass ('full') — frosted is never a resolved tier.
  ["saved frosted folds to Glass", resolveGlassTier({name:'glass',glassTier:'frosted'},'glass'), 'full'],
  // Flat ('normal') STILL beats the glass named-theme 'full' default (explicit tier wins).
  ["saved normal overrides the glass named theme",  resolveGlassTier({name:'glass',glassTier:'normal'},'glass'),  'normal'],
  // legacy back-compat bool: frosted:true folds to Glass; frosted:false stays Flat.
  ["legacy frosted:true folds to Glass",  resolveGlassTier({name:'glass',frosted:true},'glass'),  'full'],
  ["legacy frosted:false stays Flat", resolveGlassTier({name:'glass',frosted:false},'glass'), 'normal'],
  // and ONLY an unset tier falls through to the per-theme default (glass -> full).
  ["unset tier keeps the glass default full", resolveGlassTier({name:'glass'},'glass'), 'full'],
  ["null record keeps the glass default full", resolveGlassTier(null,'glass'), 'full'],
  // a non-glass theme: a saved tier still wins; its default is now Glass ('full'), too.
  ["saved full on a house theme wins", resolveGlassTier({name:'the-feed',glassTier:'full'},'the-feed'), 'full'],
  ["house-theme default is Glass",   resolveGlassTier(null,'the-feed'), 'full'],
  ["saved normal on a house theme wins", resolveGlassTier({name:'the-feed',glassTier:'normal'},'the-feed'), 'normal'],
];
let bad = 0;
for (const [d, got, exp] of cases) {
  if (got !== exp) { bad++; console.log('FAIL ' + d + ': got=' + got + ' exp=' + exp); }
}
if (bad) process.exit(1); else console.log('ALL_PASS');
"""
    )
    with tempfile.NamedTemporaryFile("w", suffix=".mjs", delete=False) as f:
        f.write(harness)
        path = f.name
    try:
        r = subprocess.run([node, path], capture_output=True, text=True, timeout=30)
    finally:
        os.unlink(path)
    assert r.returncode == 0, (
        "glass-tier resolution regressed:\n" + r.stdout + r.stderr
    )
    assert "ALL_PASS" in r.stdout


def test_first_paint_head_script_resolves_saved_tier_before_glass_default():
    """The cold-load head script in index.html paints the glass tier from the FIRST frame; it
    must resolve a SAVED glassTier (and the legacy `frosted` bool) BEFORE it falls to the
    per-theme default — otherwise a saved 'normal' (Flat) would flash glass on load. Post
    frosted-collapse the legacy bool's true branch folds to Glass ('full') and the per-theme
    default is Glass ('full') too (the #777 ceiling below drops it per device)."""
    html = _read("static", "index.html")
    saved = html.index("t.glassTier === 'full' || t.glassTier === 'frosted'")
    legacy = html.index("t.frosted ? 'full' : 'normal'")
    # the per-theme default branch: every theme resolves to Glass ('full') at first paint.
    default = html.index("_tier = 'full';", legacy)
    assert saved < legacy < default, (
        "the first-paint tier resolution must read the saved glassTier, then the legacy bool, "
        "and only THEN the per-theme glass default"
    )


# ── #5 — the element-kit demo wallpaper covers the full scroll height (no dark slab) ──
def test_element_kit_demo_wallpaper_covers_full_scroll_height():
    """The demo overrides the fixed-height app shell to a normal scrollable block whose
    wallpaper covers the WHOLE scroll height, so no dark `--bg` slab shows past the fold.

    The wallpaper rides a dedicated FIXED, pointer-events:none #__wp layer — NOT
    `background-attachment: fixed` on the tall scrolling body. In real Chrome a fixed
    background on a scroll container is promoted to a compositing layer that eats the
    wheel + clicks in the bottom region (the switchers went dead) — headless software-GL
    never promotes it, so the automated gates couldn't see it. See #1624. The `#__wp`
    element is the compositor-friendly way to pin a full-bleed backdrop."""
    html = _read("static", "element_kit_demo.html")
    # the app shell (height:100dvh; display:flex; overflow) is overridden to a scrollable block
    assert "height: auto !important" in html
    assert "display: block !important" in html
    # the wallpaper is a FIXED full-bleed #__wp layer, pointer-transparent so it never
    # intercepts the wheel or a click (covers the viewport at every scroll position).
    assert re.search(r"#__wp\s*\{[^}]*position:\s*fixed[^}]*inset:\s*0", html, re.S), (
        "the demo must carry a fixed full-bleed #__wp wallpaper layer"
    )
    assert re.search(r"#__wp\s*\{[^}]*pointer-events:\s*none", html, re.S), (
        "the #__wp wallpaper layer must be pointer-events:none so it never eats input"
    )
    # and the ANTI-PATTERN must NOT come back: no fixed-attachment background anywhere
    # (the real-Chrome input-eating compositing bug this page hit). Whitespace- and
    # case-tolerant so `attachment:fixed` / uppercase can't slip a regression past the gate.
    assert re.search(r"background-attachment\s*:\s*fixed\b", html, re.I) is None, (
        "no fixed-attachment background on the scrolling body (breaks wheel + fixed-control "
        "clicks in real Chrome — #1624)"
    )


# ── #6 — the received-bubble backing is a neutral frost over a busy multicolor wall ──
def _msg_ai_frost_block(css):
    m = re.search(r"body\.theme-frosted\s+\.msg-ai\s*\{(.*?)\}", css, re.S)
    assert m, "could not find the theme-frosted .msg-ai glass block"
    return m.group(1)


def test_msg_ai_backing_saturate_is_de_amplified_for_uniformity():
    """#780-6: the 180% saturate amplified a hostile MULTICOLOR wallpaper into a per-bubble
    patchy plate. It is dropped to a gentle pick-up (<=130%) so the backing reads as a
    consistent neutral frost — while STILL a real translucent frost (blur + a saturate, never
    a lens, and the floored scrim var is untouched)."""
    block = _msg_ai_frost_block(_read("static", "style.css"))
    m = re.search(r"backdrop-filter:\s*blur\([0-9.]+px\)\s*saturate\(([0-9]+)%\)", block)
    assert m, ".msg-ai must keep a blur+saturate frost backdrop-filter"
    sat = int(m.group(1))
    assert sat <= 130, f".msg-ai saturate {sat}% must be de-amplified (<=130%) so a busy wall reads uniform"
    assert sat >= 100, f".msg-ai saturate {sat}% must keep a gentle glass pick-up (>=100%)"
    # still a frost, not a lens; the scrim FLOOR var is preserved (the legibility contract).
    assert "url(#" not in block, ".msg-ai backing must stay a frost (no SVG refraction lens)"
    assert "--ai-scrim-alpha" in block, "the floored scrim var must stay the legibility floor"
