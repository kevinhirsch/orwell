"""Light-theme chrome polarity + top-bar coherence (owner live-playtest fixes).

Companion to test_light_theme_user_bar.py. On the DEFAULT glass theme (a DARK palette whose
CHROME is the ONE LIGHT glass, over the teal mesh backdrop) several chrome surfaces stayed
stuck at a foreign DARK polarity instead of joining the light-glass family — dark elements on
the light/teal background (the owner report). These SOURCE pins (fast fe-unit lane, no browser)
hold each fix so it can't silently regress. The same 0114 convention as the user-bar test:
chrome derives from the theme's own tokens / the shared light-glass material, never a
polarity-fixed hardcode. Chrome only; Vault-free; roles-only.
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
with open(os.path.join(FRONTEND, "static", "style.css"), encoding="utf-8") as _f:
    CSS = _f.read()


def _blocks_with(selector_literal):
    """(selector-list, body) for every declaration block whose selector list contains the literal."""
    out = []
    for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", CSS):
        if selector_literal in m.group(1):
            out.append((m.group(1).strip(), m.group(2)))
    return out


# ── the jump-to-bottom FAB rides the ONE light glass (was a dark var(--panel) circle) ─────────

def test_fab_joins_the_frosted_light_glass_material():
    """#orwell-scroll-bottom must sit in the frosted light-glass background group — the same
    var(--ow-glass-light-color) material as .chat-top-bar — so it is LIGHT on the glass theme,
    not the injected dark var(--panel) circle floating on the light-glass chrome."""
    hits = [
        (sel, body) for (sel, body) in _blocks_with("#orwell-scroll-bottom")
        if "var(--ow-glass-light-color)" in body and "theme-frosted" in sel
    ]
    assert hits, (
        "the FAB (#orwell-scroll-bottom) must be folded into the frosted light-glass background "
        "group (background-color: var(--ow-glass-light-color)) like .chat-top-bar")


def test_fab_takes_the_frosted_dark_ink():
    """Riding the LIGHT glass, the FAB chevron must take the same DARK ink (#16191f) as the rest
    of the light-glass chrome — its injected light var(--fg) would be near-white-on-light-glass."""
    hits = [
        (sel, body) for (sel, body) in _blocks_with("#orwell-scroll-bottom")
        if "#16191f" in body and "theme-frosted" in sel
    ]
    assert hits, "the FAB must take the frosted dark ink (#16191f) so its chevron reads on light glass"


# ── the top bar: bottom-only rounding + opacity parity with the sidebar ───────────────────────

def test_top_bar_rounds_only_the_bottom_corners():
    """The top bar sits FLUSH against #chat-container (overflow:hidden), so rounding its TOP
    corners clipped them (owner: "cut off / not rounded correctly at the top corners"). It must
    round the BOTTOM corners only (top-left/right = 0)."""
    radius = None
    for (sel, body) in _blocks_with(".chat-top-bar"):
        if "theme-frosted" not in sel:
            continue
        m = re.search(r"border-radius:\s*([^;!]+)", body)
        if m:
            radius = m.group(1).strip()
            break
    assert radius is not None, "no frosted .chat-top-bar border-radius rule found"
    parts = radius.split()
    assert parts[0] == "0" and parts[1] == "0", (
        f"the top bar must square its TOP corners (0 0 …); got border-radius: {radius!r}")


def test_top_bar_holds_opacity_parity_when_scrolled():
    """The recede-on-scroll fade (opacity .55) left the top bar more see-through than the sidebar
    in live play (owner: it must match the sidebar + gadgets). The .chat-scrolled top-bar rule
    must keep full opacity."""
    scrolled = [
        body for (sel, body) in _blocks_with(".chat-scrolled .chat-top-bar")
        if "prefers-reduced-motion" not in sel  # (the reduce block already forces opacity:1)
    ]
    assert scrolled, "no .chat-scrolled .chat-top-bar rule found"
    for body in scrolled:
        m = re.search(r"opacity:\s*([\d.]+)", body)
        if m:
            assert float(m.group(1)) >= 1.0, (
                f"the scrolled top bar must hold full opacity to match the sidebar; got {m.group(1)}")


# ── the beat chip label follows theme polarity over the mesh backdrop ─────────────────────────

def test_beat_chip_label_follows_theme_polarity_on_frosted():
    """Under the frosted material the plain beat label (.agent-thread-tool) must derive from the
    theme's own polarity ink var(--fg) — light on the glass/dark-backdrop themes, dark on the
    light palettes — so it doesn't read as a dim/dark element amid the light chat content. The
    OUTCOME slate keeps its accent (excluded)."""
    hits = [
        (sel, body) for (sel, body) in _blocks_with(".agent-thread-tool")
        if "theme-frosted" in sel and "var(--fg" in body
    ]
    assert hits, (
        "the frosted beat label must derive its color from var(--fg) (theme polarity), not the "
        "low-contrast accent")
    # the accent-bearing outcome slate must stay untouched by this override
    assert any(":not(.ow-slate-outcome)" in sel for (sel, _b) in hits), (
        "the frosted beat-label override must EXCLUDE .ow-slate-outcome (outcomes keep their accent)")


# ── the user-bar account icons follow the same polarity as the username ───────────────────────

def test_user_bar_icons_follow_theme_polarity():
    """The account icons (.user-bar-btn) must take the theme's var(--fg) ink like the username
    beside them — they previously kept the sidebar dark ink and rendered dark-on-dark on the
    dark footer band (owner: "dark-on-dark icons")."""
    hits = [
        (sel, body) for (sel, body) in _blocks_with(".user-bar-btn")
        if "theme-frosted" in sel and "var(--fg" in body
    ]
    assert hits, (
        "the frosted user-bar icon buttons must take var(--fg) ink so they read on the dark dock "
        "band (light ink), matching the username")
