"""HIG audit (2026-07-09) — the kit-window touch + a11y fixes.

Source-pinned convention gates (the FE has no DOM runtime in this pytest lane), the
sibling of test_hig_p2p3_safe_fixes.py — those two findings were deliberately split out
here because both live in `frontend/static/js/orwellWindow.js` and were owned by a
different agent (see that file's module docstring: "Findings intentionally NOT in this
PR … gated by a sibling agent"). Each gate freezes one shipped HIG fix so it cannot
silently regress. Roles only; no names; Vault-free (window chrome only).

Findings covered here:
  • F-TOUCH-1 (P2) — the kit titlebar controls (.ow-controls button / .ow-dismiss) were
    32px on coarse pointers in the NON-frosted theme (they carry .tap-exempt to escape the
    global 44px floor, and only the FROSTED theme added the invisible 44px ::after hit
    region). The kit CSS now extends that same ::after hit region to the non-frosted chrome
    under `@media (pointer: coarse)`, so the VISIBLE control stays a proportionate 32px but
    the HIT area meets the 44pt floor in both themes (HIG Layout: "at least 44x44 pt").
  • F-A11Y-4 (P3) — the titlebar's keyboard-move ("arrows to nudge") affordance was carried
    ONLY by `title=`, which never surfaces on touch and is unreliable for AT. It now also
    sets `aria-keyshortcuts`, so the move keys reach the accessibility tree (HIG
    Accessibility: don't rely on hover-only cues). The window-control buttons keep their
    accessible names via `aria-label`.
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*p):
    with open(os.path.join(FRONTEND, *p), encoding="utf-8") as f:
        return f.read()


WINDOW_JS = _read("static", "js", "orwellWindow.js")


def _balanced_block(text, opener_regex):
    """Return the brace-balanced body that follows the first match of `opener_regex`
    (mirrors test_hig_p2p3_safe_fixes.py's _reduced_motion_blocks brace walk)."""
    m = re.search(opener_regex, text)
    assert m, f"no block matching {opener_regex!r}"
    i = m.end()
    depth = 1
    while i < len(text) and depth:
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
        i += 1
    return text[m.end():i]


# ── F-TOUCH-1 ─────────────────────────────────────────────────────────────────
def _coarse_pointer_block():
    """The `@media (pointer: coarse)` body in the kit's own injected CSS (ensureCss),
    scoped so a stray `::after` elsewhere in the file can't satisfy the assertions."""
    return _balanced_block(WINDOW_JS, r"@media\s*\(pointer:\s*coarse\)\s*\{")


def test_titlebar_controls_have_44pt_hit_area_on_coarse_pointer():
    """Within the coarse-pointer block, the tap-exempt titlebar controls get an invisible
    >=44px ::after hit region — closing the non-frosted-theme gap (F-TOUCH-1)."""
    block = _coarse_pointer_block()
    # Slice guard: this must be the real coarse block that also sets the 32px visible size.
    assert ".ow-controls button" in block and "min-height: 32px" in block, (
        "coarse-pointer block slice guard — expected the 32px control sizing (F-TOUCH-1)"
    )
    # The ::after hit region must target the control buttons (and the dismiss control).
    after = re.search(
        r"\.ow-controls button::after[^{]*\{([^}]*)\}", block
    )
    assert after, (
        ".ow-controls button::after hit region missing under coarse pointer — the "
        "non-frosted titlebar controls stay 32px (F-TOUCH-1)"
    )
    body = after.group(1)
    assert "width: 44px" in body and "height: 44px" in body, (
        "the ::after hit region must be >=44x44px to meet the touch floor (F-TOUCH-1)"
    )
    assert 'position: absolute' in body, (
        "the ::after hit region must be absolutely positioned over the control (F-TOUCH-1)"
    )


def test_titlebar_controls_are_positioned_for_the_hit_region():
    """The ::after can only anchor over the control if the button is a positioning context;
    the coarse block must set `position: relative` on the controls (F-TOUCH-1)."""
    block = _coarse_pointer_block()
    m = re.search(r"\.ow-controls button, \.ow-dismiss \{([^}]*)\}", block)
    assert m and "position: relative" in m.group(1), (
        "the coarse titlebar controls must be position:relative so the 44px ::after "
        "anchors over them (F-TOUCH-1)"
    )


def test_visible_control_size_unchanged():
    """F-TOUCH-1 expands the HIT area only — the VISIBLE control must stay 32px (no giant
    buttons dominating the ~44px titlebar; the #893 intent)."""
    block = _coarse_pointer_block()
    m = re.search(r"\.ow-controls button, \.ow-dismiss \{([^}]*)\}", block)
    assert m, "coarse titlebar control sizing rule missing"
    assert "min-width: 32px" in m.group(1) and "min-height: 32px" in m.group(1), (
        "the visible control must remain 32px — the fix grows the hit area, not the glyph"
    )


# ── F-A11Y-4 ──────────────────────────────────────────────────────────────────
def test_titlebar_advertises_move_keys_via_aria_keyshortcuts():
    """The keyboard-move affordance must reach AT via aria-keyshortcuts, not only `title=`
    (which is hover-only and never surfaces on touch) — F-A11Y-4."""
    assert "aria-keyshortcuts" in WINDOW_JS, (
        "the titlebar keyboard-move affordance must set aria-keyshortcuts (F-A11Y-4)"
    )
    m = re.search(r"setAttribute\(\s*'aria-keyshortcuts'\s*,\s*([A-Za-z_]+)\s*\)", WINDOW_JS)
    assert m, "aria-keyshortcuts must be set with the arrow-nudge keys (F-A11Y-4)"
    # The advertised keys must include the four arrow keys the titlebar keydown handler acts on.
    for key in ("ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"):
        assert key in WINDOW_JS, f"aria-keyshortcuts must advertise {key} (F-A11Y-4)"


def test_move_keys_gated_on_keyboard_move_availability():
    """aria-keyshortcuts must only be set when the window is actually keyboard-movable
    (draggable + floating), matching the _onTitlebarKey handler — no over-promising a
    shortcut on a docked/non-draggable window (F-A11Y-4)."""
    # The set-call sits inside a `this.o.draggable && !docked && !sheet` guard —
    # #893 extended the gate: a sheet-presented window has no XY move either, so
    # advertising arrow-move keys on it would over-promise exactly the same way.
    m = re.search(
        r"if\s*\(\s*this\.o\.draggable\s*&&\s*!docked\s*&&\s*!sheet\s*\)\s*\{[^}]*aria-keyshortcuts",
        WINDOW_JS,
        re.DOTALL,
    )
    assert m, (
        "aria-keyshortcuts must be gated on `this.o.draggable && !docked && !sheet` "
        "(F-A11Y-4; #893 — a sheet has no keyboard move to advertise)"
    )


def test_window_controls_keep_accessible_names():
    """The icon-only window controls must keep an accessible name (aria-label), so a
    `title`-only affordance is never the sole label (F-A11Y-4)."""
    # Dock toggle, minimize, and close each carry aria-label (both dynamic states covered).
    assert "'Dock to the control room'" in WINDOW_JS and "'Float this window'" in WINDOW_JS, (
        "the dock toggle must carry an aria-label in both states"
    )
    assert re.search(r"aria-label'\s*,\s*canMin \? 'Minimize'", WINDOW_JS), (
        "the minimize control must carry an aria-label"
    )
    assert re.search(r"setAttribute\('aria-label',\s*'Close'\)", WINDOW_JS), (
        "the close control must carry an aria-label"
    )


# ── CodeRabbit follow-ups (2026-07-10) ────────────────────────────────────────
def test_arrow_nudge_gated_on_draggable():
    """The Arrow-key titlebar nudge is a MOVE affordance and must be gated on
    `this.o.draggable` — a draggable:false dialog must not be nudgeable even though the
    aria-keyshortcuts + tooltip only advertise the keys for draggable windows. The guard
    sits in _onTitlebarKey, after the direction lookup and BEFORE the position mutation."""
    handler = _balanced_block(WINDOW_JS, r"_onTitlebarKey\s*\([^)]*\)\s*\{")
    m = re.search(r"const d = dirs\[e\.key\];\s*if \(!d\) return;(.*)", handler, re.DOTALL)
    assert m, "the arrow-direction lookup must precede the draggable gate (_onTitlebarKey)"
    tail = m.group(1)
    # An early `if (!this.o.draggable) return;` must appear before the first el.style mutation.
    guard = tail.find("if (!this.o.draggable) return")
    move = tail.find("this.el.style")
    assert guard != -1, (
        "_onTitlebarKey must ignore the Arrow keys when this.o.draggable is false "
        "(CodeRabbit MAJOR: a non-draggable dialog could be nudged)"
    )
    assert move == -1 or guard < move, (
        "the draggable gate must short-circuit BEFORE any position mutation"
    )


def test_coarse_pointer_controls_gap_prevents_hit_region_overlap():
    """Each 32px control's centered 44px ::after overhangs its box by 6px per edge, so the
    coarse-pointer .ow-controls gap must be >=12px (2*6) or adjacent 44px hit regions overlap
    and a boundary tap resolves to the later DOM control — close beating minimize (CodeRabbit
    MAJOR)."""
    block = _coarse_pointer_block()
    m = re.search(r"\.ow-controls \{([^}]*)\}", block)
    assert m, ".ow-controls gap rule missing under coarse pointer (hit-region overlap fix)"
    gap = re.search(r"gap:\s*(\d+)px", m.group(1))
    assert gap and int(gap.group(1)) >= 12, (
        "the coarse-pointer .ow-controls gap must be >=12px so the 44px ::after hit "
        "regions of adjacent controls don't intersect (CodeRabbit MAJOR)"
    )
