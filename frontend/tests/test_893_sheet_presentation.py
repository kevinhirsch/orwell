"""#893 (+ #753) — the OrwellWindow SHEET presentation mode: source-pinned conventions.

On phones the window kit's desktop primitive (floating, draggable, resizable window)
is the wrong pattern (owner report, issue #893). The kit now carries a SHEET
presentation MODE — the SAME OrwellWindow instance/chrome/semantics, presented as an
iOS-style bottom sheet on the narrow tier: bottom-pinned + edge-to-edge, a grabber,
medium/full detents, drag-to-dismiss, safe-area insets, slide-up motion, scroll
containment. It is a presentation mode of the ONE window kit, never a parallel window
family (the F-CHROME-1 lesson; the F-3 ratchet stays the anti-fragmentation gate),
kept in visual/gesture lock-step with the sibling OrwellSheet action-sheet kit (#753).

These pins freeze the contract's load-bearing pieces so a refactor can't quietly drop
one. The live behavior (mount-as-sheet, detent drag, dismiss, focus) is exercised for
real in test_893_sheet_browser.py at a phone viewport.

Roles only; no names. Vault-free (window chrome only).
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


KIT = _read("static", "js", "orwellWindow.js")


# ── the presentation mode lives IN the window kit (no parallel family) ────────

def test_sheet_mode_is_a_kit_presentation_mode_not_a_new_component():
    # The mode is resolved + built inside OrwellWindow itself…
    assert "_resolveSheet" in KIT
    assert "ow-sheet-mode" in KIT
    # …and the sheet CSS lives in the kit's ONE ensureCss() family (`.ow-*`),
    # never a separate stylesheet/component.
    assert ".ow-window.ow-sheet-mode" in KIT
    # No OTHER game-build module may mint the sheet-mode chrome classes — the kit
    # owns the family (F-3 anti-fragmentation; orwellSheet.js is the SIBLING
    # action-sheet kit with its own `.ow-sheet` family, not this mode).
    js_dir = os.path.join(FRONTEND, "static", "js")
    offenders = []
    for name in sorted(os.listdir(js_dir)):
        if not name.endswith(".js") or name == "orwellWindow.js":
            continue
        with open(os.path.join(js_dir, name), encoding="utf-8") as f:
            src = f.read()
        if "ow-sheet-mode" in src or "ow-detent-" in src:
            offenders.append(name)
    assert not offenders, (
        f"sheet-mode chrome classes minted outside the kit: {offenders} — the sheet "
        "presentation is OrwellWindow's (pass sheet:true/'auto' instead)"
    )


def test_sheet_resolution_defaults_modal_dialogs_on_and_respects_overrides():
    # The option exists with the 'auto' default…
    assert re.search(r"sheet:\s*'auto'", KIT), "the `sheet` option must default to 'auto'"
    # …and the resolver implements: docked wins → narrow tier required → true forces,
    # false forbids, 'auto' == modal.
    m = re.search(r"_resolveSheet\(\)\s*\{(.*?)\n  \}", KIT, re.S)
    assert m, "_resolveSheet() must exist"
    body = m.group(1)
    assert "this._docked" in body and "isNarrow()" in body
    assert "this.o.sheet === true" in body and "this.o.sheet === false" in body
    assert "this.o.modal" in body, "'auto' must resolve from modal:true"


# ── the sheet contract: grabber, detents, dismiss, safe-area, containment ─────

def test_sheet_has_grabber_with_touch_floor_hit_region():
    assert "ow-grabber" in KIT
    # the 44px invisible hit region (WCAG 2.5.5) around the small visible pill.
    grab = KIT[KIT.find(".ow-window.ow-sheet-mode > .ow-grabber::after"):]
    grab = grab[:grab.find("}") + 1]
    assert "height: 44px" in grab, "the grabber must carry a 44px hit region"


def test_sheet_has_medium_and_full_detents_in_lockstep():
    # class-owned resting heights (dvh with a vh fallback for engines without dvh)…
    assert ".ow-window.ow-sheet-mode.ow-detent-medium" in KIT
    assert ".ow-window.ow-sheet-mode.ow-detent-full" in KIT
    assert "dvh" in KIT
    # …and the JS settle geometry + public detent API beside them.
    assert "sheetDetentPx" in KIT
    assert "_settleSheet" in KIT
    assert "setDetent(" in KIT and "currentDetent(" in KIT


def test_sheet_drag_dismiss_is_gated_on_closable():
    # A closable:false sheet (the casting box: the in-body exits are the ONLY way
    # out) may re-detent but never be swiped away.
    m = re.search(r"_settleSheet\(h\)\s*\{(.*?)\n  \}", KIT, re.S)
    assert m, "_settleSheet must exist"
    assert "this.o.closable" in m.group(1), "drag-to-dismiss must be gated on closable"
    assert "SHEET_DISMISS_FRACTION" in KIT


def test_sheet_respects_safe_area_insets():
    block = KIT[KIT.find(".ow-window.ow-sheet-mode {"):]
    block = block[:block.find("}") + 1]
    assert "env(safe-area-inset-bottom" in block, "the sheet must pad the home-indicator inset"
    # the full detent clears the notch too.
    full = KIT[KIT.find(".ow-window.ow-sheet-mode.ow-detent-full"):]
    full = full[:full.find("}") + 1]
    assert "env(safe-area-inset-top" in full


def test_sheet_body_scroll_is_contained():
    body_rule = KIT[KIT.find(".ow-window.ow-sheet-mode > .ow-body"):]
    body_rule = body_rule[:body_rule.find("}") + 1]
    assert "overscroll-behavior: contain" in body_rule


def test_sheet_motion_is_reduced_motion_stripped():
    # slide-up in / slide-down out keyframes exist…
    assert "ow-sheet-mode-in" in KIT and "ow-sheet-mode-out" in KIT
    # …and a reduced-motion block strips BOTH plus the settle glide.
    strips = re.findall(
        r"@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*?\.ow-anim-sheet-in[^}]*?\}",
        KIT, re.S)
    assert strips, "the sheet entrance/exit must be stripped under prefers-reduced-motion"
    assert ".ow-sheet-settling" in KIT


# ── one position system (F5) + the g15 seam stay intact ──────────────────────

def test_sheet_mode_opts_out_of_slot_geometry_and_mints_no_key():
    # open() must skip OrwellSlots registration in sheet mode…
    assert re.search(r"window\.OrwellSlots\s*&&\s*!this\._sheet", KIT), (
        "sheet mode must opt OUT of the slot geometry system (F5: one position system)"
    )
    # …and the sheet machinery writes NO localStorage geometry (detent heights are
    # class-owned; the F-3 geometry-key ratchet stays the backstop).
    sheet_region = KIT[KIT.find("_wireSheetDrag(handle)"):KIT.find("_rehomeForViewport()")]
    assert "localStorage" not in sheet_region, "sheet gestures must not persist geometry"


def test_breakpoint_flip_rehomes_through_the_one_hinge():
    # Crossing 768px re-homes through the same teardown+rebuild pattern the dock
    # toggle uses (never a live geometry mutation between the two systems).
    assert "_rehomeForViewport" in KIT
    assert "onNarrowChange(" in KIT
    m = re.search(r"_rehomeForViewport\(\)\s*\{(.*?)\n  \}", KIT, re.S)
    assert m and "_rehoming" in m.group(1)


def test_kit_still_never_dispatches_gamechanged():
    # g15: chrome kits never dispatch the freshness event (platform.js is the ONE
    # dispatcher); the sheet mode must not have introduced one.
    assert "orwell:gamechanged" not in KIT


# ── the migrated surfaces ─────────────────────────────────────────────────────

def test_settings_and_theme_ride_the_auto_default():
    # Settings + Theme are modal:true kit windows → 'auto' sheets them on phones
    # with NO per-window wiring. Pin that they stay modal AND don't opt out.
    for fname in ("settings.js", "theme.js"):
        src = _read("static", "js", fname)
        assert re.search(r"modal:\s*true", src), f"{fname}: the dialog must stay modal:true"
        assert not re.search(r"sheet:\s*false", src), f"{fname}: must not opt out of sheet mode"


def test_cast_window_opts_into_sheet_presentation():
    src = _read("static", "js", "orwellCast.js")
    create = src[src.find("OrwellWindowKit.create"):]
    create = create[:create.find("content,")]
    assert re.search(r"sheet:\s*true", create), (
        "#893: the Cast roster (non-modal) must opt into the kit's sheet presentation"
    )


def test_casting_box_stays_undismissable_as_a_sheet():
    # The casting headshot box is modal:true (auto-sheets on phones) and
    # closable:false — so the sheet's drag-to-dismiss is inert for it and the two
    # in-body exits (finalize / skip) remain the only ways out.
    src = _read("static", "js", "orwellHeadshot.js")
    create = src[src.find("OrwellWindowKit.create"):]
    create = create[:create.find("content:")]
    assert re.search(r"modal:\s*true", create)
    assert re.search(r"closable:\s*false", create)
