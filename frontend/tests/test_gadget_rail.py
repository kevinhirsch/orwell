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
    # #640: the rail mount (with the sidebar → body fallback) is now the OrwellGadget kit's job —
    # the gadgets compose the kit and no longer hand-wire the mount. The fallback chain lives once,
    # in orwellGadget.js; assert the kit owns it, and that the HUD gadgets compose the kit.
    kit = _read("static", "js", "orwellGadget.js")
    assert 'getElementById("gadget-rail-body")' in kit
    assert 'getElementById("sidebar")' in kit          # fallback preserved (kit-owned)
    for f in ("orwellStatusPanel.js", "orwellPresence.js"):
        js = _read("static", "js", f)
        assert "OrwellGadgetKit.create(" in js, f


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


def test_j5_control_room_chrome_meets_touch_tap_target_floor():
    """J5-01 (Control-Room audit): the gadget-rail chrome controls render BELOW the 44px
    coarse-pointer tap-target floor — rail header buttons 30×32, collapsed-strip icons 38×38.
    A touch-only (`pointer: coarse`) rule bumps them to 44px; desktop stays compact.
    (#893 interim — mobile titlebar-control proportion fix: the kit titlebar controls
    .ow-controls button / .ow-dismiss were REMOVED from this floor — a 44px box dominates the
    kit's ~44px titlebar. They are `.tap-exempt` and take an Apple-proportionate ~32px coarse
    size from the kit's own CSS instead; this floor stays for the gadget-rail chrome only.)"""
    css = _read("static", "style.css")
    assert "J5-01" in css                       # the Control-Room tap-target fix marker
    block = css[css.find("J5-01"):css.find("J5-01") + 1300]
    assert "@media (hover: none) and (pointer: coarse)" in block
    for sel in (".gadget-rail-head button", "#gadget-rail-strip"):
        assert sel in block, sel
    # the kit titlebar controls no longer ride this 44px floor (proportion fix)
    assert ".ow-controls button {" not in block and ".ow-dismiss," not in block
    assert "min-width: 44px" in block and "min-height: 44px" in block


# ── #798 — drag-to-reorder actually reorders (and persists) ───────────────────

def test_drag_drop_hit_test_sees_through_the_lifted_gadget():
    """#798 regression: dragging a gadget did NOT reorder. The grabbed gadget is translated
    UNDER the finger (transform + z-index:5), so the drop-target probe's `elementFromPoint`
    returned the DRAGGED gadget itself — `over === _drag.el` every time, so the drop never
    fired moveRelative → reorder. The fix makes the lifted gadget transparent to hit-testing
    (`pointer-events:none`) during the probe AND skips it in the nearest-by-center fallback,
    so the probe resolves to the gadget BENEATH it. (Live drag+reorder+persist is exercised
    in browser_smoke.py.)"""
    js = _read("static", "js", "orwellGadgetRail.js")
    probe = re.search(r"function _gadgetFromPoint\(x, y\)\s*\{(.*?)\n  \}", js, re.S)
    assert probe, "_gadgetFromPoint must exist"
    body = probe.group(1)
    # the lifted gadget is taken out of hit-testing around the elementFromPoint call …
    assert 'pointerEvents = "none"' in body, "must drop the lifted gadget out of hit-testing"
    assert "elementFromPoint" in body
    # … and restored afterwards (no permanently-dead pointer events on the card)
    assert "removeProperty" in body or "pointerEvents = prevPE" in body
    # the nearest-by-center fallback must SKIP the dragged gadget (else it resolves to itself)
    assert "_drag.el" in js and "c === lifted" in body
    # the drop path still ends at the real reorder seam
    end = re.search(r"function _endPointer\(e\)\s*\{(.*?)\n  \}", js, re.S)
    assert end and "moveRelative" in end.group(1)


def test_reorder_persists_to_localstorage_and_syncs():
    """The reorder seam saves the new order (per-user localStorage key + the 0064 layout-sync
    fan-out) so it survives a reload and crosses devices/windows."""
    js = _read("static", "js", "orwellGadgetRail.js")
    save = re.search(r"function saveOrder\(ids\)\s*\{(.*?)\n  \}", js, re.S)
    assert save, "saveOrder must exist"
    body = save.group(1)
    assert "lsSet(_orderKey()" in body                 # per-user localStorage fallback
    assert "orwell:window-layout" in body              # the synced source of truth (#637)
    # the order key is per-user (so two users on one device don't collide)
    assert 'return "orwell-gadget-order:"' in js


# ── #797 — gadget content insets ride the --ow-space-* scale (clean, even) ────

def _og_card_block(css: str) -> str:
    i = css.find(".og-card {")
    assert i != -1, ".og-card must be declared in style.css"
    # span to the end of the .og-card family (the @media reduced-motion chev rule closes it)
    end = css.find(".og-card .og-chev { transition: none; }", i)
    assert end != -1, ".og-card family must close with the reduced-motion chev rule"
    return css[i:end + 80]


def test_gadget_insets_use_the_spacing_tokens_not_adhoc_rems():
    """#797: the gadget content insets were ad-hoc rems (.4rem/.55rem/.35rem/.45rem/.1rem) that
    rendered slightly uneven across kinds. They now ride the --ow-space-* scale: --ow-space-3
    (12px) horizontal padding, --ow-space-2 (8px) vertical padding + margin + inner gaps,
    --ow-space-1 (4px) for the tightest gaps — clean, consistent across every gadget kind."""
    css = _read("static", "style.css")
    block = _og_card_block(css)
    # card padding + margin on the token scale
    assert "padding: var(--ow-space-2, 8px) var(--ow-space-3, 12px)" in block
    assert "margin: var(--ow-space-2, 8px) var(--ow-space-2, 8px) 0" in block
    # the header rhythm matches the card (gap == bottom margin == --ow-space-2)
    assert "gap: var(--ow-space-2, 8px); margin: 0 0 var(--ow-space-2, 8px)" in block
    # tightest gaps (actions, chevron) on --ow-space-1
    assert "gap: var(--ow-space-1, 4px)" in block          # .og-actions
    assert "margin-left: var(--ow-space-1, 4px)" in block  # .og-chev
    # the old ad-hoc inset rems are GONE from the card block
    for bad in (".4rem", ".55rem", ".35rem", ".45rem", ".1rem"):
        assert bad not in block, f"ad-hoc inset {bad} must not remain in the .og-card chrome"


def test_gadget_kit_js_and_css_insets_stay_in_lockstep():
    """The runtime ensureCss() in orwellGadget.js (which paints the kit BEFORE style.css loads)
    must carry the SAME token-based insets as the style.css source-of-truth copy — otherwise the
    card flashes a different spacing on first paint."""
    js = _read("static", "js", "orwellGadget.js")
    assert "margin: var(--ow-space-2, 8px) var(--ow-space-2, 8px) 0" in js
    assert "padding: var(--ow-space-2, 8px) var(--ow-space-3, 12px)" in js
    assert "gap: var(--ow-space-2, 8px); margin: 0 0 var(--ow-space-2, 8px)" in js
    assert "gap: var(--ow-space-1, 4px)" in js
    assert "margin-left: var(--ow-space-1, 4px)" in js
