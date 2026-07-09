"""#640 — THE GADGET RATCHET: rail-gadget chrome fragmentation cannot grow back.

The sibling of test_f3_window_ratchet.py (windows), for the control-room rail. Every NATIVE
rail gadget (a `<section>` card that mounts into #gadget-rail-body) must compose the OrwellGadget
kit (`window.OrwellGadgetKit` + the `.og-*` family) for its card chrome — header (icon +
Title-Case title + optional actions), body, empty-state, the rail mount + content-driven
visibility, and (#638) per-gadget synced collapse. It must NOT hand-roll a card again:

  • no bespoke card shell (the margin/padding/70%-panel-mix/border/10px-radius/Fira-mono block
    each gadget used to inline) — that's the kit's `.og-card`;
  • no hand-wired rail mount (getElementById("gadget-rail-body") + the fallback chain) — the
    kit owns the mount once.

A failure here is the audit's gadget asymmetry (#637/#638) regrowing per-gadget. Compose
`window.OrwellGadgetKit.create(...)` instead (see orwellGadget.js).

NB on scope: the rail also hosts the FINALE / CAST / RETRO panels, but those are OrwellWindow
KIT windows docked into the rail (dockable:true) — they already compose a kit (the window kit)
and bring `.ow-*` chrome. They are window-tier, not native gadgets, so they're out of this
gate (the window ratchet covers them).
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JS_DIR = os.path.join(FRONTEND, "static", "js")


def _read(*rel):
    with open(os.path.join(FRONTEND, *rel), encoding="utf-8") as f:
        return f.read()


# ── the NATIVE rail gadgets (the migrated set) ────────────────────────────────
# These are the `<section>` card gadgets with a registry row in orwellGadgetRail.js. They all
# compose the OrwellGadget kit now. New native gadgets MUST join this set (declare a registry
# row + compose the kit); nothing may regrow bespoke chrome.
NATIVE_GADGETS = (
    "orwellStatusPanel.js",
    "orwellDeals.js",
    "orwellCastPin.js",
    "orwellNightStatus.js",
    "orwellPresence.js",
    "orwellCastingFile.js",  # M4-5: the pre-game casting-file progress card
)

# The kit module itself + the window-tier panels that dock into the rail via the WINDOW kit
# (they compose OrwellWindow, not OrwellGadget — covered by the window ratchet).
KIT = "orwellGadget.js"
WINDOW_TIER_DOCKED = ("orwellFinale.js", "orwellCast.js", "orwellRetrospective.js")

# The bespoke-card-shell fingerprint: the inline block every hand-rolled gadget used — the
# 70%-panel background mix paired with the 10px radius, inside a per-gadget <style>/#id rule.
# The kit's `.og-card` is the ONE place this may live now.
_CARD_BG_MIX = "color-mix(in srgb, var(--panel"


def test_native_gadgets_compose_the_kit():
    for f in NATIVE_GADGETS:
        js = _read("static", "js", f)
        assert "OrwellGadgetKit.create(" in js, (
            f"{f} must compose the OrwellGadget kit (window.OrwellGadgetKit.create) — "
            "new rail gadgets inherit the card chrome, never hand-roll it (#640)."
        )


def test_native_gadgets_do_not_hand_roll_the_card_shell():
    # The bespoke card background (the 70%-panel mix) may only live in the kit's `.og-card`.
    # A migrated gadget keeps ONLY its own inner rules (rows / portraits / labels), never the shell.
    for f in NATIVE_GADGETS:
        js = _read("static", "js", f)
        assert _CARD_BG_MIX not in js, (
            f"{f} re-grew a bespoke card shell ({_CARD_BG_MIX}…) — the card background/border/"
            "radius is the kit's `.og-card`; keep only gadget-specific inner CSS."
        )


def test_native_gadgets_do_not_hand_wire_the_rail_mount():
    # The rail mount + its sidebar/body fallback is the kit's job (one place). A migrated gadget
    # asks the kit to mount (ensure()/mount()) and never re-implements getElementById("gadget-rail-body").
    for f in NATIVE_GADGETS:
        js = _read("static", "js", f)
        assert 'getElementById("gadget-rail-body")' not in js, (
            f"{f} re-grew a hand-wired rail mount — the kit owns the mount + the "
            "sidebar/body fallback (orwellGadget.js)."
        )


def test_kit_owns_the_rail_mount_and_fallback_chain():
    kit = _read("static", "js", KIT)
    assert 'getElementById("gadget-rail-body")' in kit  # rail first
    assert 'getElementById("sidebar")' in kit           # sidebar fallback
    assert "document.body" in kit                        # degraded/headless DOM fallback


def test_kit_provides_the_og_family_chrome():
    kit = _read("static", "js", KIT)
    # the .og-* family the gadgets compose (mirrors .ow-* for windows)
    for cls in (".og-card", ".og-head", ".og-title", ".og-body", ".og-actions", ".og-empty"):
        assert cls in kit, cls
    # the public seam (mirrors window.OrwellWindowKit)
    assert "window.OrwellGadgetKit" in kit
    assert "create:" in kit


def test_og_family_is_declared_in_style_css_for_themes():
    # the .og-* family is also a source-of-truth declaration in style.css (so the house themes /
    # frost layer paint it), exactly as the .ow-* / .gadget-rail-* families are.
    css = _read("static", "style.css")
    for cls in (".og-card", ".og-card .og-head", ".og-card .og-title", ".og-card .og-body"):
        assert cls in css, cls
    # game-build-gated like the rail (the .og-card lives inside the rail, which is gated)
    assert "body:not([data-game-build]) #gadget-rail" in css


def test_per_gadget_collapse_syncs_through_the_layout_store():
    # #638: collapse uses the SAME 0064 capture event (no parallel sync), under a synthetic
    # "gadget:<id>" window id, and applies a synced collapse from the seed OR a peer window.
    kit = _read("static", "js", KIT)
    assert "gadget:" in kit                              # the synthetic id namespace
    assert "orwell:window-layout" in kit                # the shared capture event
    assert "orwell:layout-seed" in kit and "orwell:layout-changed" in kit
    assert "collapsed" in kit
    # localStorage stays the offline/seed fallback (per-user key)
    assert "orwell-gadget-collapsed:" in kit


def test_kit_never_dispatches_gamechanged():
    # g15 invariant: the single `orwell:gamechanged` dispatcher stays in platform.js. The kit
    # only flips display (content-driven) — the rail's MutationObserver reacts; no ad-hoc dispatch.
    kit = _read("static", "js", KIT)
    assert "new CustomEvent('orwell:gamechanged'" not in kit
    assert 'new CustomEvent("orwell:gamechanged"' not in kit


def test_kit_motion_is_reduced_motion_guarded():
    # the only kit motion (the collapse chevron transition) is stripped under prefers-reduced-motion.
    kit = _read("static", "js", KIT)
    assert "prefers-reduced-motion" in kit


def test_kit_is_loaded_before_the_gadgets():
    # the kit (classic script) must execute before the gadget modules that consume window.OrwellGadgetKit.
    html = _read("static", "index.html")
    assert "orwellGadget.js" in html
    i_kit = html.find("orwellGadget.js")
    for f in NATIVE_GADGETS:
        assert i_kit < html.find(f), f"{f} loads before the kit it composes"
