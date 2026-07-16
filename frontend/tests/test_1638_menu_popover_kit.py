"""#1638 / KM-W10 — the menu / popover kit primitive (OrwellPopoverKit + OrwellMenuKit).

New foundational kit primitive: ONE anchored-surface engine + ONE action-menu contract that the
~14 bespoke dropdown / menu / popover surfaces will migrate onto (in a LATER lane — this slice is
additive + parallel-safe, it does NOT touch the consumers). The direct sibling of the window kit
(orwellWindow.js) and the sheet kit (orwellSheet.js).

Source-pinned convention checks (the pytest lane has no DOM runtime): the two layered seams on
`window`, the API method matrix, the role/aria + roving-keyboard contract, disabled-inert on every
path, the single dismissOnScroll policy, the ANCHORED-on-every-viewport owner ruling (NO sheet
handoff), the `.ow-menu` / `.ow-popover` CSS family (tokens only, no bespoke hex), the frosted
glass fold, g15 silence, and the reference-demo instantiation. Live behaviour (open / arrow-key /
Escape / focus-return / flip) is exercised in scripts/browser_smoke.py.

Provenance: docs/design/1638-menu-popover-kit.md (the build-ready spec + the 2026-07-15 owner
ruling: menus stay ANCHORED on mobile; the Ctrl+K palette is EXCLUDED). Mirrors
test_f_window_kit.py / test_1638_compact_icon_kit.py / test_0753_sheet_kit.py conventions.
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*p):
    with open(os.path.join(FRONTEND, *p), encoding="utf-8") as f:
        return f.read()


JS = _read("static", "js", "orwellMenu.js")
CSS = _read("static", "style.css")
HTML = _read("static", "index.html")
DEMO = _read("static", "element_kit_demo.html")
ELEMENTS = _read("static", "js", "orwellElements.js")

# The linked-stylesheet copy of the family — sliced to its own region so the pins verify the kit
# block, not stray app rules that happen to mention a class name.
_START = "── MENU / POPOVER KIT ──"
_END = "── ELEMENT KIT: NORMAL (FLAT) TIER ──"
assert _START in CSS, "the MENU / POPOVER KIT region marker is missing from style.css"
MENU_CSS = CSS[CSS.index(_START):CSS.index(_END)]


def _block(css, selector):
    """The declaration body of `selector {…}` (literal match, single brace-free block)."""
    m = re.search(re.escape(selector) + r"\s*\{([^}]*)\}", css)
    assert m, f"missing CSS rule: `{selector} {{ … }}`"
    return m.group(1)


# ═══════════════════════════════════════════════════════════════════════════════════════
# 1. the kit exists, exposes the TWO layered seams, and is loaded
# ═══════════════════════════════════════════════════════════════════════════════════════
def test_kit_exposes_both_seams_on_window():
    assert "window.OrwellPopoverKit" in JS, "the base anchored-surface seam is missing"
    assert "window.OrwellMenuKit" in JS, "the action-menu seam is missing"


def test_popover_kit_api_matrix():
    # OrwellPopoverKit: .open / .closeAll / .openCount (the spec's method matrix).
    seam = JS[JS.index("window.OrwellPopoverKit"):JS.index("window.OrwellMenuKit")]
    for method in ("open:", "closeAll:", "openCount:"):
        assert method in seam, f"OrwellPopoverKit is missing {method}"


def test_menu_kit_api_matrix():
    # OrwellMenuKit: .open / .attach / .closeAll / .openCount (the spec's method matrix).
    seam = JS[JS.index("window.OrwellMenuKit"):]
    for method in ("open:", "attach:", "closeAll:", "openCount:"):
        assert method in seam, f"OrwellMenuKit is missing {method}"


def test_kit_is_loaded_as_a_module_before_consumers():
    assert "orwellMenu.js" in HTML, "the menu/popover kit must be loaded in index.html"
    assert re.search(r'<script[^>]*type="module"[^>]*orwellMenu\.js', HTML), \
        "orwellMenu.js must load as a module script (it imports escMenuStack + platform)"


# ═══════════════════════════════════════════════════════════════════════════════════════
# 2. the kit OWNS the contracts (à la test_sourcepin_kit_owns_the_contracts)
# ═══════════════════════════════════════════════════════════════════════════════════════
def test_kit_owns_the_positioning_engine():
    # ONE flip/shift engine, viewport-clamped, position:fixed.
    assert "getBoundingClientRect" in JS, "the anchoring engine must measure the anchor"
    assert "reposition" in JS, "the kit exposes a reposition() engine"
    assert "placement" in JS and "FLIP" in JS, "the main-axis flip branch is missing"
    # the cross-axis shift/clamp every consumer hand-codes, centralized.
    assert "Math.min" in JS and "Math.max" in JS, "the viewport shift/clamp is missing"


def test_kit_dismisses_through_esc_menu_stack_not_a_raw_doc_click():
    # dismissal rides the SHARED escMenuStack seat (outside-click + the ui.js Escape arbiter);
    # NO consumer/kit hand-rolls a document click listener for dismissal again.
    assert "bindMenuDismiss" in JS, "the kit must dismiss through escMenuStack.bindMenuDismiss"
    assert "from './escMenuStack.js'" in JS, "bindMenuDismiss must be imported from escMenuStack"
    assert "document.addEventListener('click'" not in JS, \
        "dismissal must go through escMenuStack, not a raw document click listener"


def test_kit_teardown_is_abortcontroller():
    assert "AbortController" in JS, "the kit tears down through one AbortController"


def test_kit_returns_focus_to_the_opener():
    assert "returnFocus" in JS and "_returnFocus" in JS, "focus-return to the opener is missing"
    assert "_owReturnFocus" in JS, "the kit reuses the shared window/sheet focus-return helper"


# ═══════════════════════════════════════════════════════════════════════════════════════
# 3. role / aria wiring — the uniform contract replacing the near-total absence today
# ═══════════════════════════════════════════════════════════════════════════════════════
def test_menu_role_and_aria_wiring():
    # surface + items + trigger.
    assert "'menu'" in JS, "the surface must carry role=menu"
    assert "'menuitem'" in JS, "rows must carry role=menuitem"
    assert "'menuitemcheckbox'" in JS, "checkbox rows must carry role=menuitemcheckbox"
    assert "aria-orientation" in JS, "the menu declares aria-orientation=vertical"
    assert "'separator'" in JS, "separators carry role=separator"
    # the trigger gets aria-haspopup + aria-expanded, toggled automatically.
    assert "aria-haspopup" in JS and "aria-expanded" in JS, \
        "the trigger must get aria-haspopup + a toggled aria-expanded"
    assert "aria-checked" in JS, "checkbox rows expose aria-checked"


def test_dialog_role_popover_requires_an_accessible_name():
    # RESOLVED design point: a dialog-role surface REQUIRES an ariaLabel.
    assert re.search(r"role\s*===\s*'dialog'\s*&&\s*!.*ariaLabel", JS), \
        "a role='dialog' popover must require an ariaLabel (accessible name)"


# ═══════════════════════════════════════════════════════════════════════════════════════
# 4. roving-tabindex keyboard nav — the REAL thing, not a highlight class
# ═══════════════════════════════════════════════════════════════════════════════════════
def test_roving_keyboard_contract():
    for key in ("ArrowDown", "ArrowUp", "Home", "End", "Enter", "ArrowRight", "ArrowLeft"):
        assert key in JS, f"the roving nav is missing the {key} handler"
    # roving = move tabindex 0/-1 + focus, not a .kb-active highlight.
    assert "tabindex" in JS and "_move" in JS and "_moveTo" in JS, "the roving-tabindex driver is missing"
    # typeahead with an idle-reset buffer.
    assert "_typeBuf" in JS and "_typeahead" in JS, "the typeahead buffer is missing"


# ═══════════════════════════════════════════════════════════════════════════════════════
# 5. disabled items are INERT on every path (pointer / keyboard / typeahead / submenu)
# ═══════════════════════════════════════════════════════════════════════════════════════
def test_disabled_items_are_inert_on_every_path():
    assert "aria-disabled" in JS, "disabled rows carry aria-disabled"
    # CSS blocks the pointer entirely.
    disabled = _block(MENU_CSS, '.ow-menu-item[aria-disabled="true"]')
    assert "pointer-events: none" in disabled, "a disabled row must block pointer events"
    # the roving driver + activation + typeahead all gate on rec.enabled, so a disabled row can
    # never receive focus or fire onSelect.
    assert "rec.enabled === false" in JS, "click/hover must skip a disabled row"
    assert "this._items[i].enabled" in JS, "the roving move must skip disabled rows"
    assert re.search(r"if\s*\(rec\.enabled", JS), "typeahead must skip disabled rows"


# ═══════════════════════════════════════════════════════════════════════════════════════
# 6. the single dismissOnScroll policy — reposition-in-view; close when the anchor leaves it
# ═══════════════════════════════════════════════════════════════════════════════════════
def test_dismiss_on_scroll_policy_is_single_and_testable():
    assert "dismissOnScroll" in JS, "the dismissOnScroll option is missing"
    assert "_anchorOffscreen" in JS, "the 'anchor left the viewport' predicate is missing"
    # the policy: on scroll/resize, reposition; but if the anchor scrolled out of view, CLOSE.
    reflow = JS[JS.index("_reflow() {"):JS.index("_reflow() {") + 700]
    assert "_anchorOffscreen" in reflow and "_teardown" in reflow, \
        "dismissOnScroll must CLOSE when the anchor leaves the viewport"
    assert "reposition()" in reflow, "otherwise it must reposition-in-view"
    # rAF-debounced, never a scroll-thrash.
    assert "requestAnimationFrame" in JS, "the reflow must be rAF-debounced"


# ═══════════════════════════════════════════════════════════════════════════════════════
# 7. OWNER RULING — menus stay ANCHORED on mobile (NO OrwellSheet handoff)
# ═══════════════════════════════════════════════════════════════════════════════════════
def test_menus_stay_anchored_on_mobile_no_sheet_handoff():
    assert "OWNER RULING" in JS, "the owner ruling (anchored on mobile) must be documented"
    # the sheetOnNarrow flag exists as a documented DEFERRED no-op…
    assert "sheetOnNarrow" in JS, "the sheetOnNarrow flag must exist (deferred no-op)"
    # …but the kit NEVER delegates to OrwellSheet — it anchors on every viewport.
    assert "OrwellSheetKit.create" not in JS, \
        "the menu kit must NOT hand off to OrwellSheet — it anchors on EVERY viewport (owner ruling)"


# ═══════════════════════════════════════════════════════════════════════════════════════
# 8. the CSS family — tokens only, coarse floor, z-band, neutral focus ring, glass fold
# ═══════════════════════════════════════════════════════════════════════════════════════
def test_css_family_present():
    for sel in (".ow-popover", ".ow-menu", ".ow-menu-item", ".ow-menu-item-danger",
                ".ow-menu-icon", ".ow-menu-label", ".ow-menu-shortcut", ".ow-menu-check",
                ".ow-menu-sep", ".ow-menu-section", ".ow-menu-submenu-caret", ".ow-menu-item-sub"):
        assert sel in MENU_CSS, f"the {sel} rule is missing from the menu CSS family"
    # the injected fallback carries the same family (kept in lock-step).
    assert "ow-menu-css" in JS, "the injected <style> id is missing"
    for sel in (".ow-popover", ".ow-menu", ".ow-menu-item", ".ow-menu-sep"):
        assert sel in JS, f"the injected fallback is missing {sel}"


def test_css_reuses_the_shared_window_tokens():
    surface = _block(MENU_CSS, ".ow-popover")
    assert "var(--win-bg" in surface, "the surface must ride the shared --win-bg"
    assert "var(--win-shadow" in surface, "the surface must ride the shared --win-shadow"
    assert "var(--ow-ui-font" in surface, "the surface must use the shared --ow-ui-font"


def test_z_band_is_above_the_modal_tier():
    m = re.search(r"--ow-z-menu:\s*(\d+)", CSS)
    assert m, "the --ow-z-menu token is missing from :root"
    assert int(m.group(1)) >= 1002, f"the menu band must sit above the modal tier (>=1002), got {m.group(1)}"
    assert "z-index: var(--ow-z-menu" in MENU_CSS, "the surface must draw from the --ow-z-menu band"


def test_coarse_pointer_44px_row_floor():
    m = re.search(r"@media \(pointer: coarse\)\s*\{([^@]*?)\}\s*\}", MENU_CSS, re.S)
    assert m, "the coarse-pointer floor is missing"
    assert re.search(r"\.ow-menu-item\s*\{[^}]*min-height:\s*44px", m.group(1)), \
        "a menu row must snap to a 44px floor on a coarse pointer (WCAG 2.5.5)"


def test_focus_ring_is_neutral_ios_blue_never_accent():
    # the #729 neutrality rule: the focus/active ring is the iOS-blue, never the theme red/accent.
    m = re.search(r"\.ow-menu-item[^\n]*:focus-visible\s*\{([^}]*)\}", MENU_CSS)
    assert m, "the menu-item focus-visible rule is missing"
    ring = m.group(1)
    assert "--ow-ios-blue" in ring, "the focus ring must be the neutral --ow-ios-blue"
    assert "var(--red" not in ring and "var(--accent" not in ring, \
        "the focus ring must NOT carry the theme red/accent hue (#729)"


def test_no_bespoke_hex_ink_in_the_menu_family():
    # every `color:` decl in the menu family inks via a token (--fg / --red) or the sanctioned
    # neutral chrome ink #16191f — never a stray bespoke hex.
    for m in re.finditer(r"(?<![-\w])color:\s*([^;]+);", MENU_CSS):
        val = m.group(1).strip()
        if val in ("inherit",):
            continue
        if val.startswith("var("):
            continue
        assert val in ("#16191f",), f"bespoke hex ink in the menu family: {val!r}"


def test_glass_fold_and_a11y_tiers():
    # frosted rides the shared light-glass material (the #738 item-5 fold, centralized).
    assert re.search(r"body\.theme-frosted \.ow-popover\s*\{[^}]*--ow-glass-light-color", MENU_CSS), \
        "the frosted .ow-popover must ride --ow-glass-light-color"
    # a11y: reduced-transparency opaque override.
    assert "prefers-reduced-transparency: reduce" in MENU_CSS, "the opaque a11y override is missing"
    assert "prefers-contrast: more" in MENU_CSS, "the hard-rim a11y override is missing"
    # reduced-motion strips the open keyframe (in both the injected fallback + the linked copy).
    assert "prefers-reduced-motion: reduce" in JS
    assert "prefers-reduced-motion: reduce" in MENU_CSS


# ═══════════════════════════════════════════════════════════════════════════════════════
# 9. g15 silence — a menu never mutates game state, so it never dispatches orwell:gamechanged
# ═══════════════════════════════════════════════════════════════════════════════════════
def test_kit_is_g15_silent():
    assert "orwell:gamechanged" not in JS, "the kit must never dispatch orwell:gamechanged"
    assert "new CustomEvent(" not in JS, "the kit mounts chrome only — no CustomEvent dispatch"


# ═══════════════════════════════════════════════════════════════════════════════════════
# 10. the reference demo instantiates a real menu + a real popover
# ═══════════════════════════════════════════════════════════════════════════════════════
def test_demo_shows_menu_and_popover():
    assert "Menus &amp; popovers (#1638)" in DEMO, "the demo needs a labeled menu/popover section"
    assert "ek-menu-trigger" in DEMO and "ek-popover-trigger" in DEMO, \
        "the demo must carry real menu + popover triggers"
    assert "orwellMenu.js" in DEMO, "the demo must load the menu/popover kit"
    # the driver wires them live via BOTH seams, exercising the item model (danger / disabled /
    # separator / submenu / description / checkbox / section header).
    assert "OrwellMenuKit.attach" in ELEMENTS, "the demo driver must wire an OrwellMenu"
    assert "OrwellPopoverKit.open" in ELEMENTS, "the demo driver must wire an OrwellPopover"
    for feature in ("danger:", "disabled:", "separator:", "submenu:", "description:", "checked:", "section:"):
        assert feature in ELEMENTS, f"the demo menu must exercise the {feature} item feature"


# ═══════════════════════════════════════════════════════════════════════════════════════
# 11. review-flagged correctness contracts (#1656): reopen listeners rebind, submenu-ancestry
#     dismissal, maxHeight honored, attach idempotency + onClose compose.
# ═══════════════════════════════════════════════════════════════════════════════════════
def _method_body(js, header):
    """The body of a `header … {` method up to (but excluding) the matching close brace."""
    start = js.index(header)
    depth = 0
    i = js.index("{", start)
    j = i
    while j < len(js):
        if js[j] == "{":
            depth += 1
        elif js[j] == "}":
            depth -= 1
            if depth == 0:
                return js[i:j + 1]
        j += 1
    raise AssertionError(f"could not bracket-match method: {header!r}")


def test_menu_open_is_idempotent_and_resets_the_abortcontroller():
    # A reopen after a close (which aborts this.ac) MUST bind row + keyboard listeners on a FRESH
    # controller, and a second open() while already open must early-return (no orphaned popover).
    # Scope to the OrwellMenu class (both classes have an `open(opener)`; this is the menu's).
    menu_class = JS[JS.index("export class OrwellMenu {"):]
    body = _method_body(menu_class, "open(opener) {")
    # idempotent early-return before any (re)build.
    assert re.search(r"if\s*\(this\.isOpen\(\)\)\s*return this;", body), \
        "OrwellMenu.open must early-return when already open (idempotent reopen)"
    # fresh AbortController when the prior one was aborted, BEFORE listener wiring (_buildList).
    assert re.search(r"if\s*\(this\.ac\.signal\.aborted\)\s*this\.ac\s*=\s*new AbortController\(\)", body), \
        "OrwellMenu.open must recreate this.ac when aborted so reopened listeners actually bind"
    reset_at = body.index("new AbortController()")
    build_at = body.index("_buildList()")
    assert reset_at < build_at, \
        "the AbortController reset must precede _buildList() (row listeners bind on this.ac.signal)"


def test_popover_dismissal_is_submenu_ancestry_aware():
    # descendant submenu surfaces (body-level siblings) count as INSIDE the parent boundary via the
    # _owParentPopover chain, so clicking into a submenu never dismisses the ancestor first.
    assert "_owParentPopover" in JS, "a submenu surface must record its parent surface (_owParentPopover)"
    assert re.search(r"if\s*\(this\.o\.submenuOf\)\s*el\._owParentPopover\s*=\s*this\.o\.submenuOf",
                     JS), "the submenu surface must link to its parent surface in _build"
    assert "isWithinPopoverTree" in JS, "the ancestry-aware 'is inside' predicate is missing"
    # the outside-click predicate must consult the ancestry walk, not a bare el.contains.
    assert re.search(r"return\s*!isWithinPopoverTree\(ev\.target\)", JS), \
        "the dismissal predicate must treat the popover tree (self + descendant submenus) as inside"


def test_reposition_honors_the_maxheight_option():
    body = _method_body(JS, "reposition() {")
    assert re.search(r"if\s*\(this\.o\.maxHeight\)\s*avail\s*=\s*Math\.min\(avail,\s*this\.o\.maxHeight\)",
                     body), "reposition() must cap avail at min(avail, maxHeight) when maxHeight is supplied"


def test_attach_openmenu_is_idempotent_and_composes_onclose():
    seam = JS[JS.index("attach: function"):JS.index("closeAll:", JS.index("attach: function"))]
    # returns the live menu instead of opening a second controller.
    assert re.search(r"if\s*\(isOpen\(\)\)\s*return current;", seam), \
        "attach.openMenu must return the existing menu when already open"
    # the caller's onClose is preserved and composed with the internal current=null cleanup.
    assert "userOnClose" in seam, "attach must capture the caller's onClose (opts.onClose)"
    assert re.search(r"if\s*\(current\s*===\s*menu\)\s*current\s*=\s*null;", seam), \
        "attach's composed onClose must clear current only when it still owns the closing menu"
    assert re.search(r"userOnClose\(reason\)", seam), \
        "attach's composed onClose must also invoke the caller's onClose"
