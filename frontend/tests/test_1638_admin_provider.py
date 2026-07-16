"""#1638 (consumer #9b) — the ADMIN provider picker migration onto OrwellMenuKit.

The twin of the search-provider picker (test_1638_menu_provider.py). The admin twin lives in
admin.js `initEndpointForm` and is a `.adm-provider-combo` with an EMBEDDED `#adm-epUrl` URL
input, so it differs materially from the search twin: the selection and the URL field stay in
BIDIRECTIONAL sync through the hidden native <select id="adm-epProvider">.

The load-bearing correctness invariant (both directions):
  • picking a provider must write provider.value AND dispatch a 'change' event — the change
    handler sets #adm-epUrl + kind, and every downstream reaction hangs off it, so a dropped
    dispatch silently desyncs the endpoint form; and
  • typing a URL that no longer matches the picked provider must reset provider.value to
    "Custom URL" and re-sync the picker's current display.

This pins the migration so it cannot silently regress back to a bespoke floating
.adm-provider-menu with a hand-rolled document-click dismissal, and pins that the shared CSS
was retired now that both twins are migrated.
"""
import os

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*p):
    with open(os.path.join(FRONTEND, *p), encoding="utf-8") as f:
        return f.read()


ADMIN = _read("static", "js", "admin.js")
INDEX = _read("static", "index.html")
CSS = _read("static", "style.css")


# ── the admin provider picker now composes the kit ─────────────────────────────────────────
def test_admin_provider_picker_attaches_through_the_kit():
    # the button is wired as an OrwellMenuKit trigger (the kit owns click-toggle + aria wiring).
    assert "OrwellMenuKit.attach(pickerBtn, _buildAdminProviderItems" in ADMIN, (
        "the admin provider picker must attach to OrwellMenuKit"
    )
    assert "ariaLabel: 'Provider'" in ADMIN, (
        "the migrated provider menu must pass an accessible name"
    )
    assert "matchAnchorWidth: true" in ADMIN


def test_admin_provider_items_preserve_the_hidden_select_mirror_write():
    # THE correctness pin (direction 1 — picking a provider): onSelect writes provider.value AND
    # dispatches 'change'. Both lines must survive together — the dispatch is what propagates the
    # pick into the URL field / kind via the change handler.
    build = ADMIN.split("_buildAdminProviderItems")[1].split("_syncPickerCurrent")[0]
    assert "provider.value = value;" in build, (
        "onSelect must mirror the pick onto the hidden <select> value"
    )
    assert "provider.dispatchEvent(new Event('change', { bubbles: true }));" in build, (
        "onSelect MUST dispatch 'change' or the endpoint form silently desyncs"
    )
    # the current provider is marked via the kit's tri-state `checked` (menuitemcheckbox + check).
    assert "checked: value === provider.value" in build


def test_admin_provider_change_handler_still_syncs_url_and_kind():
    # THE correctness pin (direction 1 continued): the provider 'change' handler still drives the
    # URL input + endpoint kind off the picked provider (the effect the dispatch above triggers).
    form = ADMIN.split("function initEndpointForm")[1]
    change = form.split("provider.addEventListener('change'")[1].split("urlInput.addEventListener")[0]
    assert "urlInput.value = provider.value;" in change, (
        "selecting a provider must still populate the #adm-epUrl base URL"
    )
    assert "kindSel.value = provider.value ? 'api' : 'proxy';" in change, (
        "selecting a provider must still set the endpoint kind"
    )


def test_admin_url_input_still_resets_provider_and_resyncs_picker():
    # THE correctness pin (direction 2 — typing a URL): the urlInput 'input' handler resets
    # provider.value to Custom and re-syncs the picker's current display so the two never diverge.
    form = ADMIN.split("function initEndpointForm")[1]
    inp = form.split("urlInput.addEventListener('input'")[1].split("});")[0]
    assert "provider.value = '';" in inp, (
        "typing a non-matching URL must reset the picked provider to Custom URL"
    )
    assert "_syncPickerCurrent();" in inp, (
        "typing a non-matching URL must re-sync the picker's current display"
    )


def test_admin_provider_dropped_its_bespoke_dom_toggle_and_outside_click():
    # the retired bespoke render + hand-rolled toggle + outside-click listener are gone.
    assert "_renderPickerMenu" not in ADMIN, (
        "the bespoke .adm-provider-item innerHTML builder must be gone (kit item model owns rows)"
    )
    assert "pickerMenu" not in ADMIN, (
        "the bespoke .adm-provider-menu container reference must be gone (the kit owns the surface)"
    )
    # no ad-hoc document-click dismissal in the picker init — the kit/escMenuStack owns it.
    assert "if (!picker.contains(e.target)) pickerMenu.classList.add('hidden')" not in ADMIN, (
        "the ad-hoc outside-click dismissal must be removed (the kit wires dismissal)"
    )
    assert "pickerMenu.classList.toggle('hidden')" not in ADMIN, (
        "the ad-hoc click-toggle must be removed (the kit wires the trigger toggle)"
    )


def test_admin_provider_html_has_no_bespoke_menu_container():
    # the empty bespoke dropdown div is removed from the markup; the button trigger + hidden
    # <select> mirror remain.
    assert 'id="adm-provider-menu"' not in INDEX, (
        "the bespoke #adm-provider-menu container must be removed from the markup"
    )
    assert 'id="adm-provider-btn"' in INDEX, (
        "the trigger button must remain (it is the kit anchor)"
    )
    assert 'id="adm-epProvider"' in INDEX, (
        "the hidden native <select> mirror must remain (source of truth for provider.value)"
    )


def test_admin_shared_provider_menu_css_retired():
    # both twins migrated → the shared bespoke CSS is gone; the kit's .ow-menu family paints now.
    assert ".adm-provider-menu" not in CSS, (
        "the shared .adm-provider-menu CSS must be retired (both twins now use the kit)"
    )
    assert ".adm-provider-item" not in CSS, (
        "the shared .adm-provider-item CSS must be retired (both twins now use the kit)"
    )
    # caret rotation is preserved off the trigger's aria-expanded (kit-driven), for both twins.
    assert '.adm-provider-btn[aria-expanded="true"] .adm-provider-caret' in CSS, (
        "the caret must rotate off aria-expanded (kit-driven)"
    )
