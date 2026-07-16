"""#1638 consumers #3 (session-sort) + #5 (model-sort) — migrated onto OrwellMenuKit.

Both bespoke `.dropdown.sort-dropdown` trays are retired. Each sort trigger now wires through
`OrwellMenuKit.attach(trigger, buildItems)`: the kit body-appends a `.ow-popover[role=menu]`
surface and owns anchoring, escMenuStack dismissal (no more ad-hoc document-click/Escape
handlers), and role=menu roving-keyboard a11y.

Item-model mapping (the lane brief):
  • plain sorts        → { label, onSelect }
  • Rearrange toggle   → { label, checked, keepOpen, onSelect }   (menuitemcheckbox)
  • Select             → { label, onSelect }
  • the Tidy compound  → { render: (row)=>…, keepOpen }           (render escape hatch keeps the
                          split-button + spinner layout exactly, via the detached
                          #session-sort-tidy-control template)

These are the SOURCE pins (fast fe-unit lane). The runtime proof — open → one kit surface with
the Tidy control, re-click toggles closed, no duplicate popover stacks — lives in the sibling
browser file tests/test_1638_sorts_browser.py (fe-browser lane).
"""
import os
import re


FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*p):
    with open(os.path.join(FRONTEND, *p), encoding="utf-8") as f:
        return f.read()


APP = _read("static", "app.js")
CSS = _read("static", "style.css")
INDEX = _read("static", "index.html")
SESSIONS = _read("static", "js", "sessions.js")


# ── 1. both sorts wire through OrwellMenuKit.attach ─────────────────────────────────────────

def test_both_sorts_wire_via_menu_kit_attach():
    assert "OrwellMenuKit.attach(sortBtn, window._buildSortItems" in APP, (
        "the session-sort trigger must wire through OrwellMenuKit.attach"
    )
    assert "OrwellMenuKit.attach(modelSortBtn, window._buildModelSortItems" in APP, (
        "the model-sort trigger must wire through OrwellMenuKit.attach"
    )
    # the builder form (() => items[]) — re-evaluated per open so active-sort / rearrange state
    # is always fresh.
    assert "function buildSortItems()" in APP
    assert "function buildModelSortItems()" in APP


def test_bespoke_dropdown_toggle_and_dismissal_are_gone():
    # the retired trays + their hand-rolled open/close + document-click dismissal must not regrow.
    assert 'id="session-sort-dropdown"' not in INDEX, "the #session-sort-dropdown tray is retired"
    assert 'id="model-sort-dropdown"' not in INDEX, "the #model-sort-dropdown tray is retired"
    assert 'class="dropdown sort-dropdown"' not in INDEX, (
        "no `.dropdown.sort-dropdown` element may survive — the kit owns the surface"
    )
    assert "sortDropdown.style.display" not in APP, (
        "the bespoke session-sort display-toggle must be gone (the kit toggles on re-click)"
    )
    assert "modelSortDropdown.style.display" not in APP, (
        "the bespoke model-sort display-toggle must be gone"
    )


# ── 2. the `.dropdown.sort-dropdown` CSS is retired ─────────────────────────────────────────

def test_sort_dropdown_css_is_retired():
    # the dedicated rule blocks are gone (a `.sort-dropdown { … }` / `.sort-dropdown-item { … }`
    # selector opening a brace). Dead members surviving in shared `:is()` hover lists are fine
    # (the composer-overflow precedent), so match the RULE form only.
    assert not re.search(r"\.sort-dropdown\s*\{", CSS), (
        "the bespoke `.sort-dropdown { … }` rule must be retired"
    )
    assert not re.search(r"\.sort-dropdown-item\s*\{", CSS), (
        "the bespoke `.sort-dropdown-item { … }` rule must be retired"
    )
    assert "#session-sort-dropdown" not in CSS, (
        "the mobile `#session-sort-dropdown` overrides must be retired with the tray"
    )


# ── 3. Rearrange is a checked + keepOpen kit item, in BOTH builders ─────────────────────────

def test_rearrange_is_checked_keepopen_in_both_builders():
    # a menuitemcheckbox that stays open on toggle, recomputed from live UI-vis state (not the
    # old .rearrange-check DOM sync).
    rearrange_items = re.findall(
        r"label:\s*'Rearrange',\s*\n\s*checked:\s*loadUIVis\(\)\['section-drag-reorder'\]\s*===\s*true,\s*\n\s*keepOpen:\s*true",
        APP,
    )
    assert len(rearrange_items) >= 2, (
        f"both sort builders must express Rearrange as checked+keepOpen (found {len(rearrange_items)})"
    )
    # the retired DOM-sync helper is gone.
    assert "syncRearrangeChecks" not in APP, (
        "the bespoke syncRearrangeChecks DOM checkmark sync must be retired (kit rebuilds `checked`)"
    )
    assert ".rearrange-check" not in APP and ".rearrange-toggle" not in APP, (
        "the bespoke .rearrange-toggle / .rearrange-check DOM wiring must be retired"
    )


# ── 4. the Tidy compound row is preserved via the render() escape hatch ─────────────────────

def test_tidy_row_preserved_via_render_hatch():
    assert re.search(r"render:\s*\(row\)\s*=>\s*_renderTidyControl\(row\),\s*keepOpen:\s*true", APP), (
        "the Tidy compound row must ride the kit's render() escape hatch (keepOpen)"
    )
    assert "function _renderTidyControl(row)" in APP
    # the split-button + spinner layout is preserved as a detached template with its exact ids.
    assert 'id="session-sort-tidy-control"' in INDEX
    for _id in ("auto-sort-sessions-btn", "auto-sort-sessions-more", "auto-sort-sessions-noai-btn"):
        assert f'id="{_id}"' in INDEX, f"the Tidy control keeps #{_id}"
    assert "auto-sort-spinner" in INDEX and "auto-sort-noai-spinner" in INDEX, (
        "the Tidy split-control keeps its inline spinners"
    )


def test_select_delegates_to_sessions_module():
    # the Select item drives bulk-select mode through the sessions module's public entry.
    assert "sessionModule.enterSelectMode()" in APP, (
        "the Select kit item must call sessionModule.enterSelectMode()"
    )
    assert "export function enterSelectMode()" in SESSIONS, (
        "sessions.js must expose enterSelectMode for the kit Select item"
    )
    assert 'id="session-select-from-dropdown"' not in INDEX, (
        "the old #session-select-from-dropdown row is retired (Select is a kit item now)"
    )
