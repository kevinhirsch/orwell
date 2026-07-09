"""#890 (settings-window visual integrity) + #659 (one Settings tab component) —
verify-and-pin. Both issues are scoped to the SAME file cluster (settings.js /
admin.js / index.html / style.css), so they're closed together.

#890 root causes (all fixed on the settings surface, pinned below):
  1+2. Respawn/animation jump on admin-category tabs + "Add Models": clicking an
       admin tab used to route adminModule.open() -> settingsModule.open() -> win.open(),
       which on an ALREADY-OPEN kit window falls through to restore() and re-plays the
       kit fly-in (ow-anim-restore) even though the window never moved. Every tab
       (admin included) is now ONE in-place [data-settings-panel] class-swap
       (_swapToPanel), and open() only calls win.open() when the window was not yet
       on screen (win.raise() otherwise — z-order only, no re-animate).
  3. Extraneous sidebar dividers: pruneSidebarDividers() hides any divider/label that
     no longer separates two visible nav-item groups (game-build trims, admin gating).
  4+5. Users-page scrollbars + lost bottom-left border-radius: the desktop layout grew
     to CONTENT height and the kit .ow-body scrolled the WHOLE sidebar+panel block,
     producing a whole-window scrollbar and letting the sidebar's square background
     overflow the body's scroll rect past the rounded corner. Fixed by making .ow-body
     a non-scrolling flex column and moving the scroll into .settings-panels only — the
     sidebar stays pinned inside the rounded body.

#659 — one tab component: the click/activation unification above already gives every
Settings tab (including admin ones) the SAME activation code path (no per-tab special
casing). This file additionally pins the accessibility half the issue asks for
("uniform ... keyboard behavior (arrow-key roving tabindex, aria-selected)"): every
Settings tab is a proper WAI-ARIA APG vertical-tabs `role="tab"` with `aria-selected`
and a roving `tabindex`, wired through the SAME `_swapToPanel()` that already owns the
class toggle — so aria-selected/tabIndex can never drift from the visible `.active`
state, and a shared sidebar keydown handler drives ArrowUp/ArrowDown/Home/End.
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SETTINGS_JS = os.path.join(FRONTEND, "static", "js", "settings.js")
ADMIN_JS = os.path.join(FRONTEND, "static", "js", "admin.js")
INDEX_HTML = os.path.join(FRONTEND, "static", "index.html")
STYLE_CSS = os.path.join(FRONTEND, "static", "style.css")


def _read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


SETTINGS_TAB_NAMES = [
    "services", "ai", "search", "integrations", "email", "reminders",
    "appearance", "shortcuts", "account", "tools", "users", "system",
]


# ── #890: no respawn / re-animation on tab switch ──────────────────────────

def test_sourcepin_single_in_place_swap_primitive():
    """Exactly one shared function toggles the tab .active class + the panel .hidden
    class — every activation (click, admin lazy-init, open(tab) landing) routes
    through it, so admin tabs cannot diverge from plain tabs."""
    js = _read(SETTINGS_JS)
    assert "function _swapToPanel(tab)" in js
    # activateTab (click target) and open() (the public API) both call it — the ONE
    # controller, not two divergent code paths.
    assert "_swapToPanel(tab);" in js  # inside activateTab
    assert "_swapToPanel(activeTab);" in js  # inside open()


def test_sourcepin_admin_tabs_never_reopen_the_window():
    """Admin-category tabs (services/integrations/tools/users/system) must NOT call
    win.open()/win.restore() — only a lazy _initData() plus the same panel swap
    every other tab gets."""
    js = _read(SETTINGS_JS)
    assert "const ADMIN_TABS = new Set(" in js
    # Assert the names live INSIDE the ADMIN_TABS set literal (not merely anywhere in the
    # file) so a regression that drops one from the set but references it elsewhere is caught.
    set_start = js.index("const ADMIN_TABS = new Set(")
    set_end = js.index(")", set_start)
    set_literal = js[set_start:set_end]
    for name in ("services", "integrations", "tools", "users", "system"):
        assert f"'{name}'" in set_literal, f"{name} missing from ADMIN_TABS set literal"
    fn_start = js.index("function activateTab(tab)")
    fn_end = js.index("\n}\n", fn_start)
    body = js[fn_start:fn_end]
    assert "win.open(" not in body
    assert "win.restore(" not in body
    assert "_initData()" in body  # lazy admin data fetch, no window re-entry
    assert "_swapToPanel(tab)" in body


def test_sourcepin_open_only_reanimates_on_a_genuine_fresh_open():
    """open(tab) must guard win.open() behind `_wasHidden` (window not yet on
    screen) and use win.raise() (z-order only, no fly-in) for re-entry — this is
    what stops "Add Models" / any admin tab from re-spawning the window."""
    js = _read(SETTINGS_JS)
    assert "const _wasHidden = !(win && win.el && win.el.isConnected);" in js
    assert "if (win && _wasHidden) win.open(document.activeElement);" in js
    assert "else if (win) win.raise();" in js


def test_sourcepin_prune_sidebar_dividers_runs_after_visibility_sync():
    """Extraneous dividers are pruned every time admin/game-build visibility is
    recomputed, not just once at boot."""
    js = _read(SETTINGS_JS)
    assert "function pruneSidebarDividers()" in js
    fn_start = js.index("function syncAdminVisibility()")
    fn_end = js.index("\n}\n", fn_start)
    body = js[fn_start:fn_end]
    assert "pruneSidebarDividers();" in body


def test_sourcepin_divider_pruning_css_hides_pruned_separators():
    css = _read(STYLE_CSS)
    assert (
        ".settings-sidebar-divider.settings-divider-pruned,\n"
        ".settings-sidebar-label.settings-divider-pruned { display: none !important; }"
    ) in css


# ── #890: no whole-window scrollbar / no lost border-radius ────────────────

def test_sourcepin_settings_scroll_lives_only_in_panels_not_the_kit_body():
    """The Users page (and any other long admin page) must not produce a
    whole-window scrollbar or push the sidebar past the kit's rounded corner:
    .ow-body is a non-scrolling flex column; only .settings-panels scrolls."""
    css = _read(STYLE_CSS)
    body_rule = re.search(
        r"#settings-modal\.ow-window > \.ow-body \{([^}]*)\}", css
    )
    assert body_rule, "expected a #settings-modal.ow-window > .ow-body rule"
    assert "overflow: hidden" in body_rule.group(1)
    panels_rule = re.search(
        r"#settings-modal\.ow-window > \.ow-body > \.settings-modal-content \.settings-panels \{([^}]*)\}",
        css,
    )
    sidebar_rule = re.search(
        r"#settings-modal\.ow-window > \.ow-body > \.settings-modal-content \.settings-sidebar \{([^}]*)\}",
        css,
    )
    assert panels_rule and sidebar_rule
    # The panel content owns the scroll (via the base .settings-panels overflow-y:auto
    # rule); the sidebar stays pinned (no whole-window scroll growing past the radius).
    assert (
        ".settings-panels {\n  flex: 1;\n  overflow-y: auto;" in css
    ), "the base .settings-panels rule must own the scroll (flex + overflow-y: auto)"


def test_sourcepin_settings_modal_content_drops_its_own_frame_inside_the_kit():
    """The .settings-modal-content must not double-frame (own border/radius) inside
    the kit body on desktop — the kit .ow-window IS the frame, so its rounded corner
    is never overflowed by an inner square-cornered box."""
    css = _read(STYLE_CSS)
    rule = re.search(
        r"#settings-modal\.ow-window > \.ow-body > \.settings-modal-content \{([^}]*)\}",
        css,
    )
    assert rule
    assert "border-radius: 0" in rule.group(1)
    assert "border: none" in rule.group(1)


# ── #659: one tab component — click/activation ──────────────────────────────

def test_sourcepin_every_settings_tab_click_routes_through_one_handler():
    """initTabs() wires every [data-settings-tab] button to the SAME activateTab
    call — no per-button/per-tab special casing."""
    js = _read(SETTINGS_JS)
    fn_start = js.index("function initTabs()")
    fn_end = js.index("\n}\n", fn_start)
    body = js[fn_start:fn_end]
    assert "modalEl.querySelectorAll('[data-settings-tab]').forEach(btn => {" in body
    assert "activateTab(btn.dataset.settingsTab)" in body
    # only ONE addEventListener('click', ...) call for tabs in this function
    assert body.count("addEventListener('click'") == 1


def test_sourcepin_admin_open_delegates_to_the_shared_settings_open():
    """admin.js's public open(tab) is a thin delegate to settingsModule.open —
    it must not maintain its own tab-activation logic."""
    js = _read(ADMIN_JS)
    fn_start = js.index("export function open(tab)")
    fn_end = js.index("\n}\n", fn_start)
    body = js[fn_start:fn_end]
    assert "settingsModule.open(tab || 'services');" in body
    assert "win.open(" not in body
    assert "win.restore(" not in body


# ── #659: one tab component — ARIA + roving tabindex ────────────────────────

def test_sourcepin_sidebar_is_an_aria_tablist():
    html = _read(INDEX_HTML)
    m = re.search(r'<div class="settings-sidebar" ([^>]*)>', html)
    assert m, "expected the settings sidebar to declare its ARIA role inline"
    attrs = m.group(1)
    assert 'role="tablist"' in attrs
    assert 'aria-orientation="vertical"' in attrs


def test_sourcepin_every_settings_tab_button_has_matching_aria_wiring():
    """Every data-settings-tab button is role="tab" with an id, aria-selected, and
    aria-controls pointing at its panel — and every data-settings-panel div is
    role="tabpanel" with a matching id + aria-labelledby. Catches drift if a future
    tab is added without the accessible wiring."""
    html = _read(INDEX_HTML)
    for name in SETTINGS_TAB_NAMES:
        btn_pat = (
            rf'<button class="settings-nav-item[^"]*" data-settings-tab="{name}" '
            rf'id="settings-tab-{name}" role="tab" aria-selected="(?:true|false)" '
            rf'aria-controls="settings-panel-{name}" tabindex="(?:0|-1)">'
        )
        assert re.search(btn_pat, html), f"tab button {name!r} missing accessible wiring"
        panel_pat = (
            rf'<div data-settings-panel="{name}"[^>]* id="settings-panel-{name}" '
            rf'role="tabpanel" aria-labelledby="settings-tab-{name}" tabindex="0">'
        )
        assert re.search(panel_pat, html), f"panel {name!r} missing accessible wiring"


def test_sourcepin_exactly_one_tab_starts_selected():
    html = _read(INDEX_HTML)
    selected = re.findall(r'data-settings-tab="[a-z]+" id="settings-tab-[a-z]+" role="tab" aria-selected="true"', html)
    assert len(selected) == 1


def test_sourcepin_swap_to_panel_syncs_aria_and_roving_tabindex():
    """_swapToPanel — the ONE controller every activation path shares — is where
    aria-selected + roving tabIndex get synced, so they can never drift from the
    `.active` class."""
    js = _read(SETTINGS_JS)
    fn_start = js.index("function _swapToPanel(tab)")
    fn_end = js.index("\n}\n", fn_start)
    body = js[fn_start:fn_end]
    assert "b.classList.toggle('active', isActive)" in body
    assert "b.setAttribute('aria-selected', isActive ? 'true' : 'false')" in body
    assert "b.tabIndex = isActive ? 0 : -1" in body


def test_sourcepin_roving_tabindex_keyboard_handler_exists():
    js = _read(SETTINGS_JS)
    assert "function _settingsTabsKeydown(e)" in js
    fn_start = js.index("function _settingsTabsKeydown(e)")
    fn_end = js.index("\n}\n", fn_start)
    body = js[fn_start:fn_end]
    for key in ("ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End"):
        assert key in body
    assert "activateTab(tabs[next].dataset.settingsTab)" in body
    assert "tabs[next].focus()" in body


def test_sourcepin_keydown_handler_is_wired_on_the_sidebar_once():
    js = _read(SETTINGS_JS)
    fn_start = js.index("function initTabs()")
    fn_end = js.index("\n}\n", fn_start)
    body = js[fn_start:fn_end]
    assert "sidebar.addEventListener('keydown', _settingsTabsKeydown);" in body
    assert "sidebar.dataset.tabsKeyboardBound" in body  # idempotent re-init guard


def test_sourcepin_roving_candidates_respect_visibility():
    """Arrow-key roving must skip admin-gated / game-build-trimmed (display:none)
    tabs — otherwise keyboard nav could land on (or skip past) a tab the pointer
    path would never let you click into."""
    js = _read(SETTINGS_JS)
    assert "function _visibleSettingsTabs()" in js
    fn_start = js.index("function _visibleSettingsTabs()")
    fn_end = js.index("\n}\n", fn_start)
    body = js[fn_start:fn_end]
    assert "getComputedStyle(b).display !== 'none'" in body


def test_sourcepin_dividers_and_labels_are_not_announced_as_tabs():
    """Non-interactive tablist children (dividers, the "Admin" section label) must
    not be exposed as tabs to assistive tech."""
    html = _read(INDEX_HTML)
    for m in re.finditer(r'<div class="settings-sidebar-divider[^"]*"([^>]*)>', html):
        assert 'role="separator"' in m.group(1)
        assert 'aria-hidden="true"' in m.group(1)
    label = re.search(r'<div class="settings-sidebar-label admin-only"([^>]*)>', html)
    assert label
    assert 'aria-hidden="true"' in label.group(1)
