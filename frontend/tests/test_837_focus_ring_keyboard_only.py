"""#837 — the focus ring is for KEYBOARD intent only, never spawn/programmatic focus (SOURCE-PINS).

Bug: many surfaces (windows, sheets, modals, gadget cards) spawn already showing the
blue `--ow-ios-blue` / red focus ring because their root/titlebar is programmatically
`.focus()`-ed on MOUNT (focus management / focus-trap). The focusable root then matched
`:focus-visible` and painted a ring though the user never keyboard-navigated to it.

Fix (two halves, both pinned here):
  1. Spawn/programmatic focus lands on a RING-FREE container (a tabindex=-1 / dialog /
     window / sheet root) — `outline:none` on :focus AND :focus-visible for those roots,
     and the kits focus the ring-free ROOT on mount, never an interactive control.
  2. The keyboard `:focus-visible` ring on real interactive controls is PRESERVED (WCAG
     2.4.7) — a Tab user MUST still see the ring. We must NEVER suppress the ring on
     a/button/input/select/textarea/[role=button]/[tabindex=0].

Behavior (a freshly-spawned window shows NO ring; Tab to a control rings) is exercised in
frontend/scripts/browser_smoke.py; these are the structural wiring pins.
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


# ── Half 1: spawn/programmatic-focus roots are ring-free ──────────────────────────────

def test_global_css_kills_ring_on_programmatic_focus_roots():
    css = _read("static", "style.css")
    # The #837 suppression block must cover the trap/dialog/window/sheet ROOTS on BOTH
    # :focus and :focus-visible (the browser's :focus-visible heuristic carries "visible"
    # over from the click/keypress that opened the surface).
    for sel in (
        '[tabindex="-1"]:focus',
        '[tabindex="-1"]:focus-visible',
        '[role="dialog"]:focus',
        '[role="dialog"]:focus-visible',
        '.ow-window:focus',
        '.ow-window:focus-visible',
        '.ow-sheet:focus',
        '.ow-sheet:focus-visible',
    ):
        assert sel in css, f"missing #837 ring-suppression selector: {sel}"


def test_window_root_is_tabindex_minus_one_and_focused_on_spawn_not_titlebar():
    js = _read("static", "js", "orwellWindow.js")
    # The window root is the spawn/trap target (out of Tab order, ring-free).
    assert "el.setAttribute('tabindex', '-1')" in js
    # Mount-focus targets the ring-free root, NOT the (tabindex=0, ringed) titlebar.
    assert "this.el.focus({ preventScroll: true })" in js
    # _focusIntoModal no longer falls back to focusing the first interactive control
    # (which would ring); it focuses the ring-free root.
    assert "(this.el || this.titlebar).focus({ preventScroll: true })" in js
    # The old ring-painting mount-focus on the titlebar is gone.
    assert "this.titlebar.focus()" not in js


def test_window_titlebar_keeps_its_keyboard_focus_visible_ring():
    # The titlebar (tabindex=0) is a genuine keyboard destination (arrows to nudge) — its
    # :focus-visible ring MUST survive, and it must NOT be in the suppression list.
    js = _read("static", "js", "orwellWindow.js")
    assert ".ow-titlebar:focus-visible { outline: 2px solid var(--ow-ios-blue" in js
    css = _read("static", "style.css")
    assert ".ow-titlebar:focus" not in css  # never suppressed globally


def test_sheet_root_is_tabindex_minus_one_and_focused_on_spawn():
    js = _read("static", "js", "orwellSheet.js")
    assert 'el.setAttribute("tabindex", "-1")' in js
    # _focusInto lands on the ring-free root, not the first interactive control.
    assert "this.el.focus({ preventScroll: true })" in js
    assert '(f || this.el).focus()' not in js  # the old ring-painting fallback is gone


def test_onboarding_spawn_focus_stays_on_ring_free_card_not_the_cta():
    js = _read("static", "js", "orwellOnboarding.js")
    # Card root is tabindex=-1 (ring-free) and is the spawn-focus target — not go.focus().
    assert 'card.setAttribute("tabindex", "-1")' in js
    assert "card.focus({ preventScroll: true })" in js
    assert "go.focus()" not in js  # auto-focusing the Start CTA (which rings) is gone


def test_gadget_deeplink_focus_lands_on_ring_free_container():
    js = _read("static", "js", "orwellGadgetRail.js")
    # The click-driven deep-link focuses the gadget CONTAINER via a temporary tabindex=-1
    # (ring-free) instead of the .og-head (tabindex=0, ringed) it used to grab.
    assert 'el.setAttribute("tabindex", "-1")' in js
    assert "el.focus({ preventScroll: true })" in js
    # The old "focus the header/first focusable" deep-link grab is gone.
    assert "(f || el).focus({ preventScroll: true })" not in js


# ── Half 2: keyboard focus visibility is PRESERVED (WCAG 2.4.7) ────────────────────────

def test_global_keyboard_focus_visible_ring_is_preserved():
    css = _read("static", "style.css")
    # The global keyboard ring on real keyboard-focused controls must still exist.
    m = re.search(r":focus-visible\s*\{\s*outline:\s*2px solid var\(--red\)", css)
    assert m, "the global :focus-visible keyboard ring was removed (WCAG 2.4.7 regression)"


def test_ring_suppression_does_not_touch_interactive_controls():
    # Guard against over-reach: the #837 suppression must NOT blanket-disable the ring on
    # the interactive elements a keyboard user Tabs to. (We pin the absence of a blanket
    # `<tag>:focus-visible { outline: none }` for these tags in the global ring region.)
    css = _read("static", "style.css")
    forbidden = [
        "button:focus-visible { outline: none }",
        "a:focus-visible { outline: none }",
        "input:focus-visible { outline: none }",
        '[role="button"]:focus-visible { outline: none }',
        '[tabindex="0"]:focus-visible { outline: none }',
    ]
    for f in forbidden:
        assert f not in css, f"#837 over-reached and killed a keyboard ring: {f}"
