"""#1638 (consumer #9) — the Search / admin provider picker migration onto OrwellMenuKit.

Companion to test_1638_menu_popover_kit.py (the KIT) and test_1638_menu_consumers_batch_a.py
(the first consumers). This pins the SEARCH provider picker (settings.js) so it cannot silently
regress back to a bespoke floating .adm-provider-menu with a hand-rolled document-click dismissal.

The load-bearing correctness invariant: the picker mirrors a hidden native
<select id="set-searchProvider">. A selection MUST write provSel.value AND dispatch a 'change'
event — every downstream reaction (updateVisibility / saveSearch / _syncSearchPicker) hangs off
that change listener, so a dropped dispatch silently desyncs the real search setting.

NOTE on the admin twin (admin.js initEndpointForm): it migrated onto OrwellMenuKit in the
follow-up (#1638 consumer #9b) — its own pin lives in test_1638_admin_provider.py. With both
twins migrated, the shared .adm-provider-menu / .adm-provider-item CSS has been retired.
"""
import os

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*p):
    with open(os.path.join(FRONTEND, *p), encoding="utf-8") as f:
        return f.read()


SETTINGS = _read("static", "js", "settings.js")
INDEX = _read("static", "index.html")


# ── the search provider picker now composes the kit ────────────────────────────────────────
def test_search_provider_picker_attaches_through_the_kit():
    # the button is wired as an OrwellMenuKit trigger (the kit owns click-toggle + aria wiring).
    assert "OrwellMenuKit.attach(pickerBtn, _buildSearchProviderItems" in SETTINGS, (
        "the search provider picker must attach to OrwellMenuKit"
    )
    assert "ariaLabel: 'Search provider'" in SETTINGS, (
        "the migrated provider menu must pass an accessible name"
    )
    # full-width menu (mirrors the old left:0;right:0 dropdown) via the kit option, not CSS.
    assert "matchAnchorWidth: true" in SETTINGS


def test_search_provider_items_preserve_the_hidden_select_mirror_write():
    # THE correctness pin: onSelect writes provSel.value AND dispatches 'change'. Both lines must
    # survive together — the dispatch is what propagates the pick to the real setting.
    build = SETTINGS.split("_buildSearchProviderItems")[1].split("_syncSearchPicker")[0]
    assert "provSel.value = value;" in build, (
        "onSelect must mirror the pick onto the hidden <select> value"
    )
    assert "provSel.dispatchEvent(new Event('change', { bubbles: true }));" in build, (
        "onSelect MUST dispatch 'change' or the search setting silently desyncs"
    )
    # the current provider is marked via the kit's tri-state `checked` (menuitemcheckbox + check).
    assert "checked: value === provSel.value" in build


def test_search_provider_dropped_its_bespoke_dom_toggle_and_outside_click():
    # the retired bespoke render + hand-rolled toggle + outside-click listener are gone.
    assert "_renderSearchPickerMenu" not in SETTINGS, (
        "the bespoke .adm-provider-item innerHTML builder must be gone (kit item model owns rows)"
    )
    assert "pickerMenu" not in SETTINGS, (
        "the bespoke .adm-provider-menu container reference must be gone (the kit owns the surface)"
    )
    # no ad-hoc document-click dismissal in the search-picker init — the kit/escMenuStack owns it.
    assert "if (!picker.contains(e.target)) pickerMenu.classList.add('hidden')" not in SETTINGS, (
        "the ad-hoc outside-click dismissal must be removed (the kit wires dismissal)"
    )
    assert "pickerMenu.classList.toggle('hidden')" not in SETTINGS, (
        "the ad-hoc click-toggle must be removed (the kit wires the trigger toggle)"
    )


def test_search_provider_html_has_no_bespoke_menu_container():
    # the empty bespoke dropdown div is removed from the markup; the button trigger remains.
    assert 'id="search-provider-menu"' not in INDEX, (
        "the bespoke #search-provider-menu container must be removed from the markup"
    )
    assert 'id="search-provider-btn"' in INDEX, (
        "the trigger button must remain (it is the kit anchor)"
    )


def test_search_caret_rotation_driven_by_aria_expanded():
    # caret rotation is preserved off the trigger's aria-expanded (the kit toggles it), since the
    # migrated picker no longer has a sibling .adm-provider-menu for the :has() rule to see.
    css = _read("static", "style.css")
    assert '.adm-provider-btn[aria-expanded="true"] .adm-provider-caret' in css, (
        "the search caret must rotate off aria-expanded (kit-driven)"
    )
