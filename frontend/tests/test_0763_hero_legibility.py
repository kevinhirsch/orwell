"""Issue #763 — the welcome HERO is unreadable over a LIGHT wallpaper.

ROOT CAUSE (owner-reported; audit-flagged): the welcome hero — the big "Orwell"
wordmark (`.welcome-name`), the subtitle (`.welcome-sub`) and the inline "type /setup"
link (`.setup-trigger-link`) — sits DIRECTLY over the wallpaper (`#__wp`), NOT over the
light-glass chrome. Under the glass theme the old rule repainted `.welcome-name` to the
LIGHT `var(--fg)` (and `.welcome-eye` joined the accent→`var(--fg)` neutralize block) —
so over a LIGHT wallpaper the hero is light-on-light (~1.13:1 — invisible). The /setup
link was separately flagged at 2.55:1.

Unlike the chrome (a FIXED light glass that legitimately wants dark ink), the hero has
NO glass plate, so a single fixed ink cannot be legible over EVERY wallpaper (light /
dark / busy). The fix is APPROACH 1 — ADAPTIVE INK: the hero is added to adaptiveGlass's
adaptive set so it flips ink polarity with the wallpaper (the SAME `#__wp` sampler + APCA
floor machinery, #744) exactly like the `.msg-ai` bubbles. Apple flips monochrome labels
over content ("becoming darker when the underlying content is light, and lighter when
it's dark" — HIG Color). NO accent hue on the text (mandate) — neutral ink only.

Source-pinned here; the live legibility over light/dark/busy wallpapers (APCA Lc ≥ 60
for every hero element) is verified by the render-verify loop under Playwright (CI lacks
a GPU compositor) — see the agent763 scratchpad screenshots + measured contrast.
"""
import re
from pathlib import Path

FE = Path(__file__).resolve().parents[1]
CSS = (FE / "static" / "style.css").read_text(encoding="utf-8")
ADAPTIVE_JS = (FE / "static" / "js" / "adaptiveGlass.js").read_text(encoding="utf-8")


def _blocks_for(selector_literal: str):
    """All declaration blocks whose selector LIST contains selector_literal exactly."""
    out = []
    for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", CSS):
        if selector_literal in m.group(1):
            out.append((m.group(1).strip(), m.group(2)))
    return out


# ── 1. The hero name no longer HARD-REPAINTS to the single light var(--fg) ──────────
def test_welcome_name_not_hard_repainted_to_light_fg_under_frosted():
    """The bug: `body.theme-frosted #welcome-screen .welcome-name { ...: var(--fg) }`.
    Over a light wallpaper var(--fg) is light → light-on-light. The frosted hero-name
    rule must NOT set the text color/fill to var(--fg) (it's now adaptive / a neutral
    dark default that adaptiveGlass flips per wallpaper)."""
    found = False
    for selectors, body in _blocks_for("#welcome-screen .welcome-name"):
        if "body.theme-frosted" not in selectors:
            continue
        found = True
        # neither `color:` nor `-webkit-text-fill-color:` may resolve to var(--fg)
        for m in re.finditer(r"(?:-webkit-text-fill-)?color\s*:\s*([^;]+);", body):
            val = m.group(1)
            assert "var(--fg)" not in val, (
                f".welcome-name frosted ink is {val!r} — must NOT be the light var(--fg) "
                "(light-on-light over a light wallpaper — the bug). It is adaptive now."
            )
    assert found, "no frosted #welcome-screen .welcome-name rule found"


# ── 2. The hero carries NO accent hue on its text (mandate) ─────────────────────────
def test_hero_text_carries_no_accent_hue_under_frosted():
    for target in ("#welcome-screen .welcome-name", "#welcome-screen .welcome-sub"):
        for selectors, body in _blocks_for(target):
            if "body.theme-frosted" not in selectors:
                continue
            for m in re.finditer(r"(?:-webkit-text-fill-)?color\s*:\s*([^;]+);", body):
                val = m.group(1)
                assert "var(--red)" not in val and "var(--accent)" not in val, (
                    f"{target} frosted ink {val!r} must carry NO accent hue (neutral ink only)"
                )
        # the accent GRADIENT clip must be killed on the name (background:none)
    name_blocks = [b for s, b in _blocks_for("#welcome-screen .welcome-name")
                   if "body.theme-frosted" in s]
    assert any("background" in b and "none" in b for b in name_blocks), (
        "the frosted .welcome-name must kill its accent gradient (background:none)"
    )


# ── 3. The /setup link is neutral & adaptive (was flagged at 2.55:1) ───────────────
def test_setup_link_is_neutral_and_inherits_adaptive_ink():
    """The inline /setup span sets its OWN accent color (style=color:var(--accent)…).
    Under frosted it must be overridden to a NEUTRAL ink that tracks the subtitle's
    adaptive ink (color: inherit) — not a fixed value that fails over a dark wallpaper,
    and never an accent hue."""
    blocks = [(s, b) for s, b in _blocks_for(".setup-trigger-link")
              if "body.theme-frosted" in s and "#welcome-screen" in s]
    assert blocks, "no frosted #welcome-screen .setup-trigger-link rule (the 2.55:1 link)"
    _, body = blocks[0]
    cm = re.search(r"(?<!-)\bcolor\s*:\s*([^;]+);", body)
    assert cm, "the frosted /setup link sets no color"
    val = cm.group(1)
    assert "var(--accent)" not in val and "var(--red)" not in val, (
        f"the /setup link must carry no accent hue under frosted, got {val!r}"
    )
    assert "inherit" in val, (
        f"the /setup link should inherit the subtitle's adaptive ink, got {val!r} "
        "(a fixed dark fails over a dark/busy wallpaper)"
    )


# ── 4. The eye glyph is no longer routed to the light var(--fg) neutralize block ────
def test_welcome_eye_removed_from_var_fg_neutralize_block():
    for selectors, body in _blocks_for("body.theme-frosted a"):
        if re.search(r"\bcolor\s*:\s*var\(--fg\)", body):
            assert "body.theme-frosted .welcome-eye" not in selectors, (
                ".welcome-eye is still in the var(--fg) neutralize block (light-on-light "
                "over a light wallpaper) — it must inherit the adaptive wordmark ink"
            )


def test_welcome_eye_inherits_wordmark_ink():
    """The eye is an inline SVG inside .welcome-name — it must track the wordmark's
    adaptive ink (currentColor), not a fixed light var(--fg) or an accent hue."""
    blocks = [(s, b) for s, b in _blocks_for(".welcome-eye") if "body.theme-frosted" in s]
    assert blocks, "no frosted .welcome-eye rule found"
    _, body = blocks[0]
    cm = re.search(r"\bcolor\s*:\s*([^;]+);", body)
    assert cm, ".welcome-eye frosted rule sets no color"
    val = cm.group(1)
    assert "currentColor" in val or "inherit" in val, (
        f".welcome-eye must inherit the wordmark ink (currentColor/inherit), got {val!r}"
    )
    assert "var(--fg)" not in val and "var(--red)" not in val and "var(--brand-color)" not in val, (
        f".welcome-eye must carry no fixed light/accent ink, got {val!r}"
    )


# ── 5. The hero is wired into adaptiveGlass's ADAPTIVE set ──────────────────────────
def test_hero_is_in_adaptive_glass_set():
    """adaptiveGlass must declare a HERO_ADAPTIVE selector covering the wordmark + subtitle
    and run it under the frosted standdown alongside the bubbles."""
    m = re.search(r"HERO_ADAPTIVE\s*=\s*([\"'])(.*?)\1", ADAPTIVE_JS)
    assert m, "adaptiveGlass.js declares no HERO_ADAPTIVE selector"
    sel = m.group(2)
    assert ".welcome-name" in sel, "HERO_ADAPTIVE must include the wordmark (.welcome-name)"
    assert ".welcome-sub" in sel, "HERO_ADAPTIVE must include the subtitle (.welcome-sub)"


def test_hero_runs_in_frosted_adaptive_pass():
    """Under the frosted/glass-full standdown, the adaptive pass must iterate the hero
    (it's appended to the kept/iterated adaptive selector, not dropped with the chrome)."""
    assert "BUBBLE_ADAPTIVE + \", \" + HERO_ADAPTIVE" in ADAPTIVE_JS or \
           "HERO_ADAPTIVE" in ADAPTIVE_JS and re.search(
               r"_dropTagged\(\s*[A-Z_]*ADAPTIVE[A-Z_]*\s*\)", ADAPTIVE_JS), (
        "the frosted pass must KEEP + iterate HERO_ADAPTIVE (not drop it with the chrome)"
    )


def test_hero_resolver_uses_apca_floor():
    """The hero ink resolver must verify the chosen ink clears the APCA floor against the
    wallpaper (the #744 machinery reused) — not just a blind polarity flip."""
    m = re.search(r"function resolveHeroInk\b.*?\n  \}", ADAPTIVE_JS, re.S)
    assert m, "adaptiveGlass.js has no resolveHeroInk()"
    fn = m.group(0)
    assert "apcaContrast" in fn, "resolveHeroInk must measure APCA contrast"
    assert "APCA_FLOOR" in fn, "resolveHeroInk must escalate against APCA_FLOOR"


def test_hero_ink_is_neutral_not_accent():
    """The hero ink constants must be neutral (dark #16191f / light #eef1f4), no accent."""
    assert "HERO_INK_DARK" in ADAPTIVE_JS and "HERO_INK_LIGHT" in ADAPTIVE_JS, (
        "adaptiveGlass.js must declare neutral HERO_INK_DARK / HERO_INK_LIGHT"
    )
    # no accent token painted as hero ink
    m = re.search(r"function resolveHeroInk\b.*?\n  \}", ADAPTIVE_JS, re.S)
    assert m and "--red" not in m.group(0) and "--accent" not in m.group(0), (
        "the hero ink must carry no accent hue"
    )
