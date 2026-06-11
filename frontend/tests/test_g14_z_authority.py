"""Lane G14 — ONE modal z-authority (SOURCE-PINS for the DWE-audit F9b tail).

The bug class: two competing z escalators. ui.js's Escape-arbiter block keeps
the modal counter (`_zCounter`, plain inline 1000s, promoted by its visibility
observer on every open), while modalManager kept a SECOND counter
(`_modalTopZ`, 300s) that `_bringToFront` stamped with `!important` on
register/auto-stack/dock-restore. Inline `!important` outlives a plain inline
re-assignment on engines whose CSSOM IDL setter does not replace an important
declaration — so a dock-restored tool window could keep its 300s stamp, paint
wherever the stamp says, and disagree with the Escape arbiter's pickTopModal
(computed z). Live verification on Chromium showed the stamp is real mid-task
(`z: 304 !important` synchronously after a chip restore) and was only rescued
by ui.js's observer re-promoting it in the same microtask batch — correctness
by race, not by design.

The fix: modalManager's `_bringToFront` DEFERS to ui.js's promote
(`window._owPromoteModal`) — one counter, plain values, no `!important`
anywhere in the module; the `_modalTopZ` machinery is gone. The fallback (the
arbiter not yet booted) is a plain assignment derived from the live `.modal`
computed values, never `!important`.

These are wiring pins, NOT behavior coverage: the behavior (dock-restore theme
→ open settings → settings paints above at the content overlap; Escape closes
settings first, then theme; no `.modal` carries an inline `!important` z) is
exercised for real in frontend/scripts/browser_smoke.py (the G14 block).
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


def test_sourcepin_no_important_z_stamp_in_modal_manager():
    # The whole module must carry NO setProperty('z-index', …, 'important') —
    # neither the old _bringToFront stamp nor the chip-drag copy.
    js = _read("static", "js", "modalManager.js")
    assert not re.search(
        r"setProperty\(\s*['\"]z-index['\"][^)]*['\"]important['\"]\s*\)", js
    ), "modalManager must never stamp a z-index with !important"


def test_sourcepin_second_counter_machinery_is_gone():
    js = _read("static", "js", "modalManager.js")
    assert "_modalTopZ" not in js, "the second z counter (_modalTopZ) must be deleted"


def test_sourcepin_bring_to_front_defers_to_ui_promote():
    # _bringToFront must (a) call ui.js's promote, and (b) scrub any legacy
    # !important stamp first so the plain ladder takes effect.
    js = _read("static", "js", "modalManager.js")
    body = js.split("function _bringToFront(modal)")[1].split("\nfunction ")[0]
    assert "_owPromoteModal" in body, \
        "_bringToFront must defer to ui.js's promote (window._owPromoteModal)"
    assert "getPropertyPriority('z-index')" in body and "removeProperty('z-index')" in body, \
        "_bringToFront must scrub a legacy !important stamp"
    # The fallback (arbiter not booted) must be a plain assignment: the only
    # priority API left in the body is the read/scrub pair — no setProperty,
    # so no path can stamp a priority at all.
    assert "style.zIndex = String(" in body
    assert "setProperty(" not in re.sub(r"//[^\n]*", "", body), \
        "no code path in _bringToFront may stamp a priority"


def test_sourcepin_ui_exposes_the_promote_helper():
    # ui.js owns the ONE counter and must export its promote for modalManager.
    js = _read("static", "js", "ui.js")
    assert re.search(r"window\._owPromoteModal\s*=\s*_promote", js), \
        "ui.js must expose its _promote as window._owPromoteModal"
    # The counter it guards stays plain-inline (the IDL setter, no priority).
    promote_body = js.split("const _promote = (m) =>")[1].split("};")[0]
    assert "m.style.zIndex = String(++_zCounter)" in promote_body
    assert "important" not in promote_body


def test_smoke_exercises_the_one_authority_for_real():
    # The browser gate must drive the scenario with TRUSTED clicks: theme →
    # minimize → chip restore → open settings; settings above at the overlap
    # (elementFromPoint), Escape order settings-then-theme, and the
    # no-inline-important sweep across every .modal.
    smoke = _read("scripts", "browser_smoke.py")
    assert "G14 (DWE audit F9b)" in smoke
    assert "page.click(\"#minimized-dock .minimized-dock-chip[data-modal-id='theme-modal']\")" in smoke
    assert "elementFromPoint" in smoke
    assert "paints ABOVE the dock-restored theme" in smoke
    assert "getPropertyPriority('z-index') !== 'important'" in smoke
    assert "Escape closes settings FIRST" in smoke
    assert "second Escape closes the restored theme" in smoke
