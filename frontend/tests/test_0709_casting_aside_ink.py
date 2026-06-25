"""Issue #709 (Liquid Glass) — the casting "cast photo is on file" producer aside is
light-on-light on the glass theme.

The LIVE-stream producer/casting aside is the inner `.ooc-producer-aside` div emitted by
`markdown.js` when the GM wraps a whole reply in `((…))` (the engine marker) — e.g. the
casting note "your cast photo is on file". It PINS its own text colour
`color-mix(in srgb, var(--fg) 78%, transparent)`, which on the glass theme is the LIGHT
cyan `--fg`.

The parent `.msg-ai` bubble flips polarity with the wallpaper (#744 adaptiveGlass): over a
BRIGHT wallpaper it goes DARK frost + DARK ink. But the aside's hard own-colour OVERRODE that
adaptive ink, so the aside stayed LIGHT cyan over the now-light bubble → light-on-light
(render-measured: parent flips to rgb(17,21,28); the aside stays srgb cyan; ~1:1 contrast,
invisible — the owner's casting report).

Fix (source-pinned here; the live look is verified by the render-parity loop under Playwright —
CI lacks a GPU compositor): under `body.theme-frosted` the aside text `inherit`s the bubble's
adaptive ink (so it flips WITH the bubble) and carries a LIGHT legibility halo (the dark-ink-on
-glass contract — NOT the dark `--ow-glass-text-shadow`, which smudges under dark ink). It pins
NO fixed hue and NO accent. The Normal tier (no `body.theme-frosted`) keeps its backstage look.
"""
import re
from pathlib import Path

FE = Path(__file__).resolve().parents[1]
CSS = (FE / "static" / "style.css").read_text(encoding="utf-8")


def _blocks_for(selector_literal: str):
    out = []
    for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", CSS):
        if selector_literal in m.group(1):
            out.append((m.group(1).strip(), m.group(2)))
    return out


def _frosted_block():
    """The frosted text-colour block that names the aside (the fix)."""
    blocks = [
        (s, b)
        for (s, b) in _blocks_for("body.theme-frosted .ooc-producer-aside")
        # the TEXT rule (not the ::before badge): a bare `color:` on the element selector
        if ".ooc-producer-aside::before" not in s and re.search(r"(?<!-)\bcolor\s*:", b)
    ]
    return blocks[-1] if blocks else (None, None)


def test_aside_follows_adaptive_ink_under_frosted():
    selectors, body = _frosted_block()
    assert body is not None, (
        "no body.theme-frosted .ooc-producer-aside text-colour rule — the aside still pins "
        "its own light-cyan var(--fg) colour over the adaptive glass bubble"
    )
    color = re.search(r"(?<!-)\bcolor\s*:\s*([^;]+);", body).group(1).strip()
    # It must FOLLOW the bubble's adaptive ink, not pin a fixed hue / accent.
    assert "inherit" in color, (
        f"the aside frosted colour is {color!r}; it must `inherit` the bubble's adaptive ink "
        "(so it flips polarity with the wallpaper like the #744 .msg-ai bubble)"
    )
    assert "var(--fg)" not in color, (
        "the aside must NOT route to var(--fg) (light on light glass — the bug)"
    )
    assert "var(--red)" not in color and "var(--accent" not in color, (
        "the aside text must carry NO accent hue (dark-ink-on-glass contract)"
    )


def test_aside_carries_light_halo_not_dark_smudge():
    _, body = _frosted_block()
    assert body is not None, "the #709 aside frosted block is missing"
    ts = re.search(r"text-shadow\s*:\s*([^;]+);", body)
    assert ts, "the #709 aside fix sets no text-shadow"
    val = ts.group(1).replace(" ", "")
    assert "255,255,255" in val, f"the aside halo should be LIGHT (white), got {ts.group(1)!r}"
    assert "var(--ow-glass-text-shadow)" not in val, (
        "must not use the dark --ow-glass-text-shadow (reads as a smudge under dark ink)"
    )


def test_aside_badge_tracks_currentcolor_under_frosted():
    """The `production` badge (::before) must track the ink too (currentColor), never pin the
    light var(--fg) — otherwise the badge label/border stays light-cyan over light glass."""
    blocks = [
        (s, b)
        for (s, b) in _blocks_for("body.theme-frosted .ooc-producer-aside::before")
    ]
    assert blocks, "no body.theme-frosted .ooc-producer-aside::before rule (the badge)"
    _, body = blocks[-1]
    color = re.search(r"(?<!background-)(?<!-)\bcolor\s*:\s*([^;]+);", body)
    assert color and ("inherit" in color.group(1) or "currentColor" in color.group(1)), (
        "the badge text must inherit/currentColor (track the adaptive ink), not pin var(--fg)"
    )
    assert "var(--fg)" not in body, (
        "the frosted badge must not key off var(--fg) (light on light glass)"
    )


def test_normal_tier_keeps_backstage_color():
    """The base (non-frosted) .ooc-producer-aside keeps its quiet var(--fg)-derived look —
    the fix is scoped to body.theme-frosted only."""
    base = [
        (s, b) for (s, b) in _blocks_for(".ooc-producer-aside")
        if "body.theme-frosted" not in s and ".ooc-producer-aside::before" not in s
        and re.search(r"(?<!-)\bcolor\s*:", b)
    ]
    assert base, "the base .ooc-producer-aside rule disappeared"
    assert any("var(--fg)" in b for _, b in base), (
        "the Normal-tier aside should keep its var(--fg)-derived backstage colour"
    )
