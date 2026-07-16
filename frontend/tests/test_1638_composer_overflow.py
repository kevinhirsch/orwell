"""#1638 consumer #2 — the composer overflow "+" menu migrates onto OrwellMenuKit.

Companion to test_1638_menu_popover_kit.py (the KIT) and test_1638_menu_consumers_batch_a.py
(consumer #1, the per-message overflow menu). This pins consumer #2 — the composer's "+" overflow
menu (index.html #overflow-plus-btn) — so it cannot regress back to the bespoke #overflow-menu tray
(hand-rolled portal/positioning/fold-in-animation/document-click dismissal).

What changed, and what these tests pin:
  • The "+" trigger wires through OrwellMenuKit.attach (kit owns anchoring/dismissal/role=menu a11y).
  • The static #overflow-menu / .overflow-menu-item DOM tray is gone (markup + CSS + JS wiring).
  • The item set is BUILD-DEPENDENT — buildOverflowItems() (the () => items[] builder form) carries the
    game-build gating (Attach files / TTS Mode dropped) that used to .remove() DOM nodes.
  • updatePlusDot() + the G13 empty-chevron cascade recompute from the builder's item state.
  • The plan menu (initPlanMenu) — the ONLY other producer of `.overflow-menu` DOM — also moved onto
    the kit, so the `.overflow-menu` styles could be retired.

Source-pinned (no network/engine). Roles only. The LIVE kit-DOM + G13 empty-chevron behavior is the
required browser gate scripts/browser_smoke.py (the composer-overflow block).
"""
import os

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*p):
    with open(os.path.join(FRONTEND, *p), encoding="utf-8") as f:
        return f.read()


APP = _read("static", "app.js")
CSS = _read("static", "style.css")
INDEX = _read("static", "index.html")


# ── the "+" trigger opens the kit menu ─────────────────────────────────────────────────────
def test_overflow_plus_wires_through_the_kit_attach():
    assert "OrwellMenuKit.attach(plusBtn, buildOverflowItems" in APP, (
        "the composer overflow '+' must wire through OrwellMenuKit.attach with the () => items[] "
        "builder form (buildOverflowItems), re-evaluated on each open"
    )
    assert "ariaLabel: 'More tools'" in APP, "the migrated overflow menu must pass an accessible name"
    # the composer sits at the bottom of the viewport — the menu opens upward.
    wire = APP[APP.index("OrwellMenuKit.attach(plusBtn, buildOverflowItems"):]
    wire = wire[:400]
    assert "placement: 'top'" in wire, "the overflow menu opens upward (placement: 'top')"


def test_overflow_menu_dropped_its_bespoke_dom_and_wiring():
    # the static tray markup is gone (kit body-appends its own surface).
    assert 'id="overflow-menu"' not in INDEX, (
        "the static #overflow-menu tray div must be removed from index.html (the kit owns the surface)"
    )
    # the bespoke portal / positioning / fold-in / local dismissal helpers are gone.
    for dead in ("closeOverflowMenu", "function positionMenu", "overflowMirrors", "toolbar-overflow-mirror"):
        assert dead not in APP, f"the bespoke overflow-menu helper {dead!r} must be gone (kit owns it)"
    # and it is no longer a member of the closeAllPopups `.open`-toggle selector list (escMenuStack
    # owns dismissal now). Target the selector string so an explanatory comment can't trip the check.
    assert ".overflow-menu.open, .model-picker-menu.open" not in APP, (
        "the composer overflow menu must be OUT of the closeAllPopups .open sweep — the kit's "
        "escMenuStack seat dismisses it on any outside click"
    )


# ── the builder carries the build-dependent item set + the G13 gating ──────────────────────
def test_build_overflow_items_is_the_builder_and_gates_by_build():
    assert "function buildOverflowItems()" in APP
    builder = APP[APP.index("function buildOverflowItems()"):]
    builder = builder[: builder.index("\n  function updatePlusDot")]
    # game-build gating lives HERE now (moved out of applyGameBuildMenuGating's DOM .remove()).
    assert "data-game-build" in builder and "gameBuild" in builder, (
        "buildOverflowItems must gate by the game build (attach/tts drops moved into the builder)"
    )
    assert "'Attach files'" in builder, "the tray Attach entry is a builder item (full build only)"
    assert 'script[src*="tts-ai.js"]' in builder, (
        "the TTS Mode item ships only when the tts-ai.js voice module is present (the game build "
        "strips it), so the game build stays empty"
    )
    # responsive toolbar mirrors fold in from the builder reading .toolbar-collapsed (no injected DOM).
    assert "toolbar-collapsed" in builder, (
        "a collapsed composer button folds into the overflow menu as a builder item (reads "
        ".toolbar-collapsed), not injected mirror DOM"
    )


def test_update_plus_dot_recomputes_from_item_state():
    up = APP[APP.index("function updatePlusDot()"):]
    up = up[: up.index("\n  function refreshOverflowChevron")]
    # the active dot is recomputed from the builder's item `checked` state — NOT a DOM class scan.
    assert "buildOverflowItems().some(it => it && it.checked)" in up, (
        "updatePlusDot must recompute .has-active from the builder's item state (checked), not a "
        "stale .overflow-menu-item.active DOM scan"
    )
    assert ".overflow-menu-item.active" not in up, (
        "updatePlusDot must not scan the retired .overflow-menu-item DOM"
    )


def test_g13_empty_chevron_cascade_is_builder_driven_and_reversible():
    assert "function refreshOverflowChevron()" in APP
    refresh = APP[APP.index("function refreshOverflowChevron()"):]
    refresh = refresh[: refresh.index("\n  window._updateOverflowPlusDot")]
    # REVERSIBLE, not hide-only: hide the '+' when the builder yields zero items AND restore it when
    # the build is non-empty (a later settings-pass TTS enable / full-build responsive collapse must
    # un-hide it, or the menu is permanently unreachable — the Greptile/CodeRabbit bug).
    assert "buildOverflowItems().length" in refresh and "count === 0 ? 'none' : ''" in refresh, (
        "refreshOverflowChevron must hide the '+' on an empty build and RESTORE it on a non-empty one"
    )


# ── the `.overflow-menu` styling is retired ────────────────────────────────────────────────
def test_overflow_menu_css_retired():
    # the bespoke container + item + domino-stagger rule blocks are gone.
    for rule in (".overflow-menu {", ".overflow-menu-item {", ".overflow-menu.hidden",
                 ".overflow-menu.closing", ".overflow-active-dot {",
                 "@keyframes overflow-menu-pop", "@keyframes overflow-item-in",
                 "@keyframes overflow-item-out"):
        assert rule not in CSS, f"the retired composer overflow rule {rule!r} must be gone from style.css"
    # the trigger + its active dot (recomputed by updatePlusDot) and the wrapper layout stay.
    assert ".overflow-wrapper {" in CSS, "the composer overflow WRAPPER layout is kept"
    assert ".overflow-plus-btn.has-active .plus-active-dot" in CSS, (
        "the trigger's active-dot rule is kept (updatePlusDot toggles .has-active)"
    )


# ── the plan menu (the only other .overflow-menu producer) also moved onto the kit ─────────
def test_plan_menu_migrated_to_the_kit():
    plan = APP[APP.index("function initPlanMenu()"):]
    plan = plan[: plan.index("})();")]
    assert "OrwellMenuKit.open(" in plan, (
        "the plan menu must open through OrwellMenuKit.open (it borrowed .overflow-menu classes; "
        "retiring those styles requires it to move onto the kit too)"
    )
    assert "overflow-menu plan-menu" not in plan, (
        "the plan menu must no longer build bespoke .overflow-menu / .overflow-menu-item DOM"
    )
    # It must TOGGLE, not stack: track the live instance + close it on re-open (the kit treats the
    # anchor as "inside", so a re-click won't dismiss it — without this a 2nd .ow-popover stacks).
    assert "_planMenu" in plan and "_planMenu.close(" in plan, (
        "the plan menu must track its live instance and close it on re-click (toggle), never mint a "
        "duplicate popover on the anchor's re-click"
    )
