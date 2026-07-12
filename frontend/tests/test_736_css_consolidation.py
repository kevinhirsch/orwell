"""#736 — CSS cleanup/consolidation pins.

The dedicated post-glass/kit cleanup pass on `static/style.css` removed the accumulated
DEAD CSS for the inherited-workspace verticals the game build drops (`GAME_DROP_SET`:
calendar / cookbook / gallery + gallery-editor / notes / documents+doclib / email / hwfit /
research / compare (panes/diff) / skills / memory / tasks — their JS modules are physically
deleted; see `frontend/src/settings.py` + issue #663). Only rules whose EVERY selector token
was proven referenced NOWHERE outside style.css (JS / HTML / server-rendered Python / tests)
were removed, so the removal is pixel-neutral for the live game build (proven by a full-DOM
computed-style byte-identity check swapping the original vs reduced sheet on the same DOM).

These pins are source-only (the pytest lane has no DOM). They (1) prove representative
dropped-vertical dead selectors stay gone, (2) prove the live keep-set surfaces are intact
(no over-removal), (3) hold the sheet's structural integrity, and (4) ratchet the size so the
inherited-workspace cruft cannot silently creep back.
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*p):
    with open(os.path.join(FRONTEND, *p), encoding="utf-8") as f:
        return f.read()


CSS = _read("static", "style.css")


# Representative dead selectors from the dropped inherited-workspace verticals. Each was
# verified referenced NOWHERE outside style.css and removed; the surface's JS is deleted and
# the vertical is forced off under ORWELL_GAME_BUILD, so these can never legitimately return.
REMOVED_DEAD_SELECTORS = [
    ".cal-hero-clock",          # calendar view
    ".cookbook-card-title",     # cookbook
    ".ge-adj-popup",            # gallery image-editor
    ".note-card-ai-chip",       # notes
    ".gallery-grid-item",       # gallery
    ".hwfit-ring",              # health/fitness
    ".pane-vote-btn",           # compare model-pane (NOT game voting — see the rule comment)
    ".diff-toolbar-btn-accept", # compare/document diff viewer
    ".research-report-links",   # deep research
]

# Live keep-set surfaces that MUST survive — a guard against over-removal. These are the
# window kit, chat transcript, cast pin, decision card, gadget/settings cards, and the
# theme segmented control (all game-build surfaces).
LIVE_KEEPSET_SELECTORS = [
    ".ow-window",       # the window kit
    ".msg-ai",          # received chat bubble (the transcript IS the game)
    "#chat-container",  # the chat surface
    ".oc-pin",          # cast pin control
    ".og-card",         # gadget card kit
    ".odec-confirm",    # decision card confirm
    ".theme-seg",       # theme segmented control
    ".cmp-eval-btn",    # a compare class STILL referenced by slashCommands.js — correctly KEPT
]


def test_dropped_surface_dead_selectors_removed():
    """The proven-dead dropped-vertical rules are gone from style.css."""
    still_present = [s for s in REMOVED_DEAD_SELECTORS if s in CSS]
    assert not still_present, (
        f"dead inherited-workspace selectors reappeared in style.css: {still_present}"
    )


def test_live_keepset_surfaces_intact():
    """The cleanup did not touch any live game-build surface (over-removal guard)."""
    missing = [s for s in LIVE_KEEPSET_SELECTORS if s not in CSS]
    assert not missing, f"live keep-set selectors went missing from style.css: {missing}"


def test_braces_balanced():
    """Structural integrity: the surgical rule removal left the sheet well-formed."""
    assert CSS.count("{") == CSS.count("}"), (
        f"unbalanced braces after consolidation: {CSS.count('{')} open vs {CSS.count('}')} close"
    )


def test_no_empty_at_rule_blocks():
    """The cleanup left no empty @media/@supports/@container wrappers behind."""
    empties = re.findall(r"@(?:media|supports|container)\b[^{]*\{\s*\}", CSS)
    assert not empties, f"empty at-rule blocks remain ({len(empties)}): {empties[:3]}"


def test_sheet_materially_smaller_ratchet():
    """Anti-regrowth ratchet — the dropped-vertical dead CSS (~18k lines) must not creep
    back. The sheet is ~24.1k lines post-cleanup; the 27k ceiling gives headroom for real
    growth while flagging a return of the inherited-workspace cruft. Lower this as the sheet
    shrinks further; raise it deliberately (in the same PR) for genuine new surface CSS."""
    n_lines = CSS.count("\n") + 1
    assert n_lines <= 27000, (
        f"style.css grew to {n_lines} lines (> 27000 ratchet) — inherited-workspace dead CSS "
        f"may be creeping back; investigate before raising the ceiling."
    )
