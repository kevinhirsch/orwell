"""#753 (Genius #15/16/17) — the OrwellSheet iOS bottom-sheet kit + the casting/decision
migrations onto it (SOURCE-PINS).

Wiring + convention pins, NOT live behavior: the live gestures (drag-to-detent, swipe-dismiss,
opaque-up at full height, chat peeking through behind the casting sheet, the decision card as a
non-blocking anchored action-sheet) are exercised for real in browser_smoke.py. These pin the
contract the issue asks for so a regression can't quietly remove a piece.

Provenance: GitHub issue #753 (Genius #15/16/17 — the foundational iOS-phase sheet primitive).
"""
import os

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


# ── the kit primitive ─────────────────────────────────────────────────────────

def test_sheet_kit_is_loaded_after_the_notice_kit():
    html = _read("static", "index.html")
    assert "orwellSheet.js" in html, "the sheet kit must be loaded in index.html"
    # it must load AFTER orwellNotice.js so the anchored host can reuse the notice zone anchor.
    assert html.index("orwellNotice.js") < html.index("orwellSheet.js")


def test_sheet_kit_exposes_the_seam():
    js = _read("static", "js", "orwellSheet.js")
    assert "window.OrwellSheetKit" in js          # the public seam (mirrors OrwellWindowKit etc.)
    assert "create:" in js
    assert "dismissTop:" in js                     # Escape participation (parity with the window kit)


def test_sheet_kit_has_medium_and_large_detents():
    js = _read("static", "js", "orwellSheet.js")
    # both named detents exist as snap heights, programmatic + drag-to-detent.
    assert "medium" in js and "large" in js
    assert "DETENT_FRACTION" in js
    # the public detent API (programmatic snap) + the drag-release nearest-detent settle.
    assert "snap = function" in js or "prototype.snap" in js
    assert "_settle" in js                          # drag-release → nearest detent / dismiss
    assert "currentDetent" in js                    # consumers can read the active detent


def test_sheet_kit_is_opaque_up_at_full_height():
    js = _read("static", "js", "orwellSheet.js")
    # the Apple behavior: translucent glass at medium → opaque/solid as it climbs to large.
    assert "--ow-sheet-prog" in js                  # the 0→1 progress custom property
    assert "_writeProgress" in js                   # written on every height change
    # the opaque layer cross-fades in via the progress (a ::before solid fill over the glass).
    assert ".ow-sheet::before" in js
    assert "opacity: var(--ow-sheet-prog" in js


def test_sheet_kit_has_grabber_and_swipe_dismiss():
    js = _read("static", "js", "orwellSheet.js")
    assert "ow-sheet-grabber" in js                 # the iOS pill handle
    # the grabber hit region meets the touch floor (WCAG 2.5.5).
    assert "height: 44px" in js
    # drag the grabber/header between detents; drag down past medium → dismiss; tap scrim → dismiss.
    assert "_wireDrag" in js
    assert "swipeDismiss" in js and 'dismiss("swipe")' in js
    assert "scrimDismiss" in js and 'dismiss("scrim")' in js


def test_sheet_kit_carries_the_a11y_trio():
    js = _read("static", "js", "orwellSheet.js")
    # reduced-transparency → opaque fallback at every detent.
    assert "prefers-reduced-transparency: reduce" in js
    # reduced-motion → no slide/spring (instant snap).
    assert "prefers-reduced-motion: reduce" in js
    # prefers-contrast → a hard rim.
    assert "prefers-contrast: more" in js
    # the dialog/sheet a11y: focus-trap + aria-modal (modal sheets) + focus-return to the opener.
    assert "aria-modal" in js
    assert "_trapFocus" in js
    assert "_inertBackground" in js
    assert "_owReturnFocus" in js or "opener" in js


def test_sheet_kit_is_built_on_the_liquid_glass_tokens():
    js = _read("static", "js", "orwellSheet.js")
    # composes the shared kit material/tokens, never a bespoke glass.
    assert "--ow-glass-light-color" in js
    assert "--ow-glass-light-fill" in js
    assert "--ow-glass-radius" in js
    assert "--ow-ui-font" in js


def test_sheet_kit_uses_the_ensurecss_inline_pattern_and_style_css_region():
    js = _read("static", "js", "orwellSheet.js")
    # the runtime ensureCss() inline-CSS pattern (sibling kits' convention) + injected at load.
    assert "function ensureCss" in js
    assert "ow-sheet-css" in js                      # the injected <style> id
    # the linked-stylesheet copy of the family exists too (so the house themes paint it).
    css = _read("static", "style.css")
    for cls in (".ow-sheet", ".ow-sheet-grabber", ".ow-sheet-head", ".ow-sheet-body",
                ".ow-sheet-scrim", ".ow-sheet.ow-sheet-anchored"):
        assert cls in css, cls


def test_sheet_kit_is_vault_free():
    js = _read("static", "js", "orwellSheet.js")
    # the kit paints chrome + geometry only — it never reads game state and (g15) never dispatches
    # the single orwell:gamechanged event (consumers that mutate state do that themselves).
    assert "new CustomEvent('orwell:gamechanged')" not in js
    assert 'new CustomEvent("orwell:gamechanged")' not in js
    # no fetch of game/vault state from the kit itself.
    assert "fetch(" not in js


def test_sheet_kit_spliced_into_the_escape_arbiter():
    ui = _read("static", "js", "ui.js")
    assert "OrwellSheetKit.dismissTop()" in ui      # menus → windows → SHEETS → settings


# ── decision-card migration: a non-blocking anchored action-sheet ──────────────

def test_decision_card_renders_as_an_anchored_action_sheet():
    js = _read("static", "js", "orwellDecision.js")
    # the decision card now mounts into an OrwellSheet ANCHORED (non-modal) action-sheet — the
    # player keeps reading the room (no whole-screen snap-modal).
    assert "OrwellSheetKit.create(" in js
    assert "anchored: true" in js
    # it is a live HARD-STOP: the sheet renders no kit ×/swipe-away — the card owns its own dismiss.
    assert "dismissible: false" in js
    # the existing rich card element is appended INTO the sheet body (internals untouched).
    assert "host.appendChild(card)" in js


def test_decision_card_preserves_the_post_flow_and_gamechanged():
    js = _read("static", "js", "orwellDecision.js")
    # the engine-direct decision POST + the single g15 dispatch survive the migration.
    assert '"/api/orwell/decision"' in js
    assert 'window.orwellGameChanged("decision:" + kind)' in js
    # the consequential-action a11y (confirm-on-binding + the card-scoped Escape dismiss) survive.
    assert "Confirm" in js
    assert 'e.key !== "Escape"' in js


def test_decision_card_keeps_the_notice_kit_fallback():
    # the OrwellNotice anchor stays as the pre-#753 fallback (back-compat; the notice ratchet pins
    # decision membership), so a missing sheet kit still reaches the player.
    js = _read("static", "js", "orwellDecision.js")
    assert "OrwellNoticeKit.create(" in js


# ── casting/headshot is NOT a sheet — it stays a MODAL OrwellWindow ─────────────
# CONTRACT (corrected): OrwellSheet applies to DECISIONS only. The cast-photo / casting
# surface keeps its HARD modal-a11y contract — a kit OrwellWindow with a title, an
# aria-modal BACKDROP SCRIM covering the viewport, and a FOCUS-TRAP (P1 / J1-23 / J1-25,
# pinned in scripts/browser_smoke.py). A peek-through bottom-sheet (no full scrim, no focus
# trap) would break that contract, so casting must NOT migrate onto OrwellSheet.

def test_casting_stays_a_modal_window_not_a_sheet():
    js = _read("static", "js", "orwellHeadshot.js")
    # the cast-photo box composes the WINDOW kit as a real modal (J1-25): aria-modal + scrim +
    # focus-trap come from modal:true on the OrwellWindow kit.
    assert "OrwellWindowKit.create(" in js
    assert "modal: true" in js
    # it carries a (title-cased) title and is a dialog (P1 / browser_smoke title + role checks).
    assert 'title: "Your Cast Photo"' in js
    assert 'role: "dialog"' in js
    # it must NOT mount the cast-photo on the peek-through OrwellSheet (that has no full scrim /
    # focus-trap and broke P1/J1-23/J1-25).
    assert "OrwellSheetKit.create(" not in js, "casting must not migrate onto OrwellSheet (modal a11y)"


def test_casting_preserves_its_oobe_seams():
    js = _read("static", "js", "orwellHeadshot.js")
    # every load-bearing OOBE seam survives.
    for needle in (
        "onCastingHeadshotChosen",     # finalize → record {uploaded} + resume
        "onCastingPhotoSkipped",       # skip → record {skipped} + resume
        "recordPhotoStep",             # the engine POST
        "_orwellResumeAfterPhoto",     # the interview-resume cue
        "teardownWindow",              # clean teardown (destroys the kit window)
        "OrwellHeadshotStudio",        # the reusable studio (Settings → Account shares it)
    ):
        assert needle in js, needle
