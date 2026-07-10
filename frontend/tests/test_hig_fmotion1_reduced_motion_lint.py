"""HIG audit (2026-07-09) — F-MOTION-1 (P2): the DURABLE Reduce-Motion gate.

#1271 added per-surface Reduce-Motion guards for two decorative surfaces (the note-card flash +
the hwfit schedule chip). That is the fragile pattern the audit flags: each new decorative surface
must remember to opt in, and new ones slip through. The durable fix (this gate + the global net in
style.css) is a substring net — `@media (prefers-reduced-motion: reduce) { [class*="-flash"], … }`
— that neutralizes the whole decorative-motion FAMILY by class-name convention, so a new
`*-flash` / `*-pulse` / … surface is covered by construction.

This is a SOURCE-LINT gate (matches the repo's convention-check style — see
test_hig_p2p3_safe_fixes.py, test_ow_design_system.py). It fails if the net is removed/shrunk, and —
the real ratchet — if a decorative `@keyframes` family appears that the net does NOT cover, forcing
an explicit decision instead of a silent Reduce-Motion miss.
"""
import re
from pathlib import Path

FRONTEND = Path(__file__).resolve().parents[1]
CSS = (FRONTEND / "static" / "style.css").read_text(encoding="utf-8")

# The decorative-motion vocabulary. These are attention/ambience effects a Reduce-Motion user
# wants gone; FUNCTIONAL motion (spin loaders, slide/fade/pop state transitions) is deliberately
# NOT in this set — the net must never touch functional state.
DECORATIVE_FAMILIES = {
    "flash", "pulse", "glow", "shimmer", "blink", "shake", "wiggle", "bounce", "throb", "flare",
}


def _reduced_motion_blocks():
    """Every `@media (prefers-reduced-motion: reduce) { ... }` body in style.css."""
    blocks = []
    for m in re.finditer(r"@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{", CSS):
        i = m.end()
        depth = 1
        while i < len(CSS) and depth:
            if CSS[i] == "{":
                depth += 1
            elif CSS[i] == "}":
                depth -= 1
            i += 1
        blocks.append(CSS[m.end():i])
    return blocks


def _global_net_block():
    """The reduced-motion block that carries the `[class*="-…"]` substring net."""
    for b in _reduced_motion_blocks():
        if '[class*="-flash"]' in b:
            return b
    return None


# ── the net exists and is comprehensive ───────────────────────────────────────

def test_global_decorative_net_exists():
    net = _global_net_block()
    assert net is not None, (
        "the durable F-MOTION-1 net is missing — a `@media (prefers-reduced-motion: reduce)` block "
        'with `[class*="-flash"], …` substring selectors must exist in style.css'
    )
    assert "animation: none" in net, "the net must neutralize `animation`"
    assert "transition: none" in net, "the net must neutralize `transition` too"


def test_net_covers_the_decorative_vocabulary():
    """The net must carry a `[class*="-X"]` selector for EVERY decorative family in the vocabulary,
    so it can't be quietly shrunk."""
    net = _global_net_block() or ""
    missing = [f for f in DECORATIVE_FAMILIES if f'[class*="-{f}"]' not in net]
    assert not missing, (
        f"the F-MOTION-1 net dropped decorative families {sorted(missing)} — every family in the "
        "vocabulary must have a `[class*=\"-<family>\"]` selector"
    )


# ── the real ratchet: a new decorative @keyframes family must be covered ──────

def _decorative_keyframe_families():
    """Families that appear in a decorative `@keyframes <name>` — the surfaces most likely to ship
    an unguarded animation. A NEW family here that the net doesn't cover is the ratchet trip."""
    used = set()
    for m in re.finditer(r"@keyframes\s+([A-Za-z0-9_-]+)", CSS):
        name = m.group(1).lower()
        for fam in DECORATIVE_FAMILIES:
            if fam in name:
                used.add(fam)
    return used


def test_every_decorative_keyframe_family_is_netted():
    """RATCHET: if a decorative `@keyframes ...-sparkle` (etc.) is added, its family must be in the
    net — otherwise the animation silently ignores Reduce Motion. (Add the family to the net AND to
    DECORATIVE_FAMILIES here, a deliberate two-line decision.)"""
    net = _global_net_block() or ""
    used = _decorative_keyframe_families()
    uncovered = sorted(f for f in used if f'[class*="-{f}"]' not in net)
    assert not uncovered, (
        f"decorative @keyframes families {uncovered} are NOT covered by the Reduce-Motion net — "
        "a new decorative animation would ignore the OS setting. Add each to the style.css net."
    )
    # sanity: the scan found the known families (guards against a broken regex passing vacuously).
    assert {"flash", "pulse", "glow"} <= used, (
        f"the decorative-keyframe scan looks broken (found {sorted(used)}) — expected at least "
        "flash/pulse/glow to be present in style.css"
    )


# ── regression: the #1271 per-surface guards stay (they cover non-family names) ─

def test_1271_specific_guards_retained():
    """`.hwfit-sched-day-chip` carries no decorative family word, so the substring net can't reach
    it — its specific #1271 guard must remain. The note-card flash guard stays too."""
    blocks = _reduced_motion_blocks()
    assert any(".hwfit-sched-day-chip" in b and "transition: none" in b for b in blocks), (
        "the hwfit schedule-chip transition guard (#1271) was dropped — the net can't reach it "
        "(no family word in the class name)"
    )
    assert any(".note-card-flash" in b and "animation: none" in b for b in blocks), (
        "the note-card flash guard (#1271) was dropped"
    )
