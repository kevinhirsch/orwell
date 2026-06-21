"""0054 — the control-room gadget rail. Source-pins for the structure + wiring; the live
behaviour (mount, collapse, side-swap, mobile drawer) is exercised in the play-through harness.
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*rel):
    with open(os.path.join(FRONTEND, *rel), encoding="utf-8") as f:
        return f.read()


def _registry_ids():
    """The gadget ids declared in the single-source-of-truth REGISTRY (in order)."""
    js = _read("static", "js", "orwellGadgetRail.js")
    block = re.search(r"var REGISTRY = \[(.*?)\];", js, re.S)
    assert block, "REGISTRY array must exist in orwellGadgetRail.js"
    return re.findall(r'id:\s*"([^"]+)"', block.group(1))


def _css_order_ids():
    """The rail gadget ids that carry a canonical `order` rule in style.css (in source order)."""
    css = _read("static", "style.css")
    return re.findall(r"\.gadget-rail-body > #([\w-]+)\s*\{\s*order:", css)


def test_rail_markup_and_controls_present():
    html = _read("static", "index.html")
    assert 'id="gadget-rail"' in html
    assert 'id="gadget-rail-body"' in html
    assert 'id="gadget-rail-toggle"' in html      # collapse
    assert 'id="gadget-rail-swap"' in html        # side-swap
    assert 'id="gadget-rail-open"' in html        # mobile drawer opener
    assert 'id="gadget-rail-strip"' in html       # collapsed icon strip
    assert 'src="/static/js/orwellGadgetRail.js"' in html


def test_rail_is_game_build_gated_and_responsive():
    css = _read("static", "style.css")
    # hidden in the full inherited workspace
    assert "body:not([data-game-build]) #gadget-rail" in css
    # collapse + side-swap + mobile drawer
    assert '.gadget-rail[data-collapsed="true"]' in css
    assert 'body[data-gadget-side="left"] #gadget-rail' in css
    assert "@media (max-width: 768px)" in css and ".gadget-rail.grail-open" in css
    # canonical gadget stacking
    assert ".gadget-rail-body > #orwell-status { order: 1; }" in css


def test_side_swap_is_one_coordinated_path_not_two_desynced_systems():
    """The ⇄ dock button used to flip ONLY data-gadget-side: the nav sidebar slid over via
    flex `order` but its hamburger stayed stranded over the relocated dock (the "sideways
    caret under the hamburger" overlap). The fix makes the nav sidebar side the SINGLE source
    of truth — the dock is mirrored to the opposite edge in syncRailSide, and ⇄ routes through
    the sidebar swap. (Live behaviour is exercised in browser_smoke.py.)"""
    rail = _read("static", "js", "orwellGadgetRail.js")
    # ⇄ delegates to the ONE sidebar-swap path (no independent data-gadget-side flip as the
    # primary action — only a fail-soft fallback when the sidebar module is absent)
    assert "_orwellToggleSidebarSide" in rail
    sb = _read("static", "js", "sidebar-layout.js")
    # the sidebar exposes the single swap seam + mirrors the dock to the opposite edge
    assert "window._orwellToggleSidebarSide" in sb
    assert "data-gadget-side" in sb                  # the dock is DERIVED from the sidebar side
    assert "function toggleSidebarSide" in sb


def test_controller_persists_state_and_gates_on_content():
    js = _read("static", "js", "orwellGadgetRail.js")
    assert "data-game-build" in js                 # never in the full workspace
    assert "orwell-gadget-rail-collapsed" in js     # persisted collapse
    assert "orwell-gadget-side" in js               # persisted side
    # visibility is CONTENT-driven (a gadget with visible content reveals the rail) — no
    # status-fetch race; this is what the browser-smoke keep-set relies on.
    assert "MutationObserver" in js
    assert "_hasContent" in js
    assert "syncVisibility" in js
    assert "orwell:gamechanged" in js
    # Escape is NOT handled per-surface (flows through ui.js's arbiter — F3 ratchet)
    assert '"Escape"' not in js and "'Escape'" not in js


def test_hud_gadgets_prefer_the_rail():
    # each HUD gadget mounts into the rail when present, with the sidebar as fallback
    for f in ("orwellStatusPanel.js", "orwellPresence.js"):
        js = _read("static", "js", f)
        assert 'getElementById("gadget-rail-body")' in js, f
        assert 'getElementById("sidebar")' in js, f   # fallback preserved


# ── the GADGET REGISTRY — the single source of truth both views derive from ───

def test_registry_is_the_single_source_of_truth():
    js = _read("static", "js", "orwellGadgetRail.js")
    # one declarative registry; each entry has a stable id, an icon and a Title-Case title
    assert "var REGISTRY = [" in js
    ids = _registry_ids()
    assert ids, "the registry must declare gadgets"
    # every always-on HUD gadget + the docked Phase-2 windows are registered
    for required in ("orwell-status", "orwell-deals", "orwell-cast-pin",
                     "orwell-presence", "orwell-finale", "orwell-cast", "orwell-retro"):
        assert required in ids, f"{required} must be in the gadget registry"


def test_registry_and_css_order_stay_in_sync():
    # the CSS `order` fallback MIRRORS the registry exactly (same ids, same order) — this is
    # the structural guarantee: an icon can never mismatch its gadget because both views and
    # the stacking derive from the one registry.
    assert _registry_ids() == _css_order_ids()


def test_collapsed_strip_is_registry_derived_not_hardcoded():
    html = _read("static", "index.html")
    # the strip container exists but is EMPTY in markup (built dynamically from the registry)
    assert 'id="gadget-rail-strip"' in html
    strip = re.search(r'<div class="gadget-rail-strip"[^>]*>(.*?)</div>', html, re.S)
    assert strip is not None
    assert "<button" not in strip.group(1), "the strip must not hardcode icon buttons"
    # the old blanket-expand icons are gone (they didn't map to real gadgets)
    assert "data-grail-expand" not in html

    js = _read("static", "js", "orwellGadgetRail.js")
    # the strip is rebuilt from the registry, filtered to mounted-and-visible gadgets
    assert "syncStrip" in js
    assert "activeGadgetIds" in js
    # each strip icon carries its gadget id and acts on THAT gadget (focus, not blanket expand)
    assert "data-grail-gadget" in js
    assert "focusGadget" in js


def test_strip_follows_visual_order_and_reorder():
    js = _read("static", "js", "orwellGadgetRail.js")
    # the strip derives from the rail's CURRENT visual order, and reorder re-syncs the strip
    assert "currentOrderIds" in js
    # reorder() calls syncStrip so the collapsed order follows the rail order
    reorder = re.search(r"function reorder\(ids\)\s*\{(.*?)\n  \}", js, re.S)
    assert reorder and "syncStrip" in reorder.group(1)


def test_public_seam_exposes_registry_and_live_derivations():
    js = _read("static", "js", "orwellGadgetRail.js")
    # the headless gate can assert the strip maps 1:1 to the active gadgets
    assert "OrwellGadgetRail" in js
    for member in ("registry", "activeGadgets", "stripGadgets", "focusGadget"):
        assert member in js, member
