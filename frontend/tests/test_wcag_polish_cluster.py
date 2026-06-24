"""Pre-launch E2E audit — WCAG/polish cluster (source-pinned).

CI can't drive the live stack here, so we pin the WIRING for each fix by reading the
static assets. See `docs/audits/2026-06-19-e2e-smoke-test-audit.md`.

Shipped here: S6-1 (HUD header legibility), S3-1 (roster count matches the list),
S8-1 (welcome dismiss tap target), S7-1 (settings modal focus trap), S6-3
(retrospective pathway-id humanized), S1-4 (native password glyph hidden).
NOT here: S1-3 (already styled on main via ::file-selector-button) and S6-4 (white-on
-accent contrast — deferred: it needs a luminance-aware on-accent token because the
accent is theme-set AND user-customizable, so it can't be fixed statically).
"""
import os

FE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(rel):
    with open(os.path.join(FE, rel), encoding="utf-8") as fh:
        return fh.read()


# ── S6-1: roster header never falls below the ~11px legibility floor ──────────

def test_s6_1_roster_header_has_a_min_legible_size():
    css = _read("static/js/orwellStatusPanel.js")
    assert "max(.8em, 11px)" in css, (
        ".os-roster-h must clamp to a minimum legible size (>=11px), not a bare .8em that "
        "renders ~9-10px at narrow widths."
    )


# ── S3-1: the player appears in the roster so the count matches the visible list ─

def test_s3_1_player_row_in_roster():
    js = _read("static/js/orwellStatusPanel.js")
    assert "os-you" in js and "playerActive" in js, (
        "the roster must include a player ('you') row when active so the visible list matches "
        "the active/total count (which counts the player)."
    )


# ── S8-1: the welcome dismiss button meets the coarse-pointer tap-target floor ──

def test_s8_1_dismiss_tap_target():
    css = _read("static/style.css")
    # the .tour-hint-dismiss rule must carry a min-height (>=36) and a coarse-pointer bump.
    assert "min-height: 36px" in css and "pointer: coarse) { .tour-hint-dismiss { min-height: 44px" in css, (
        ".tour-hint-dismiss must enforce a >=36px tap target (>=44px on coarse pointers)."
    )


# ── S7-1: the settings modal traps focus (WCAG 2.4.3 / 2.1.2) ────────────────

def test_s7_1_settings_focus_trap():
    # #553: Settings now composes the OrwellWindow kit as a MODAL window. The kit's modal chrome
    # owns the focus-trap (Tab cycles inside), the inert background, and focus-return to the opener
    # on close (orwellWindow.js _mountModalChrome/_trapFocus/_focusIntoModal) — replacing the
    # bespoke _settingsTrapKeydown handler. Assert settings opts into that contract instead.
    js = _read("static/js/settings.js")
    assert "OrwellWindowKit.create(" in js, "Settings must compose the OrwellWindow kit (#553)."
    assert "modal: true" in js, (
        "the Settings kit window must be modal:true so the kit provides the focus-trap + "
        "inert background + focus-return (S7-1 / WCAG 2.4.3+2.1.2)."
    )
    kit = _read("static/js/orwellWindow.js")
    assert "_trapFocus" in kit and "_focusIntoModal" in kit, (
        "the kit must implement the modal focus-trap + focus-into-modal the settings window relies on."
    )


# ── S6-3: raw internal pathway ids are humanized in the retrospective ─────────

def test_s6_3_retrospective_humanizes_pathway_type():
    js = _read("static/js/orwellRetrospective.js")
    assert "humanizeStoryType" in js, (
        "the retrospective must humanize hiddenStory[].type (a raw pathway id like "
        "'overheard:offscreen:strategy:…' must never render verbatim)."
    )
    assert "humanizeStoryType(h.type)" in js, "the list render must route h.type through the humanizer."
    assert '"[" + h.type + "]"' not in js.replace(" ", ""), "the raw h.type must no longer be rendered."


# ── S1-4: the native password reveal/clear glyph is hidden (custom toggle owns it) ─

def test_s1_4_native_password_glyph_hidden():
    html = _read("static/login.html")
    assert "::-ms-reveal" in html and "::-ms-clear" in html and "display: none" in html, (
        "login must hide the browser-native password reveal/clear glyphs so the custom "
        ".pw-toggle is the single, unambiguous reveal control."
    )
