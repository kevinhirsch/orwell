"""Lane F / F-1 — the window kit + the F1/F2 structural fixes (SOURCE-PINS).

Wiring pins, NOT behavior coverage: the behavior (dock visible while holding
chips, trusted-click restore, drag moves + offset persists + survives restack,
kit chrome/Escape/focus-return) is exercised for real in
frontend/scripts/browser_smoke.py (the headless-browser keep-set gate).
Provenance: docs/audits/2026-06-11-dwe-window-audit.md (findings F1, F2, F4,
F5, F7, F8, F10) and the Lane F queue entry.
"""
import os

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


def test_sourcepin_f1_dock_visibility_is_class_driven():
    js = _read("static", "js", "modalManager.js")
    assert "ow-has-rows" in js                       # class-driven reveal
    assert js.count("classList.add('ow-has-rows')") == 1
    assert js.count("classList.remove('ow-has-rows')") == 1
    assert "dock.style.display = ''" not in js       # the inline-'' reveal is gone
    css = _read("static", "style.css")
    assert "#minimized-dock.ow-has-rows" in css      # the showing rule exists


def test_sourcepin_f1_dock_flip_respects_reduced_motion():
    js = _read("static", "js", "modalManager.js")
    assert "prefers-reduced-motion" in js


def test_sourcepin_f2_restack_stands_down_during_drag():
    js = _read("static", "js", "orwellSlots.js")
    assert "modal-dragging" in js                    # the drag-in-progress gate
    assert "dragInProgress" in js
    assert "_restacking" in js                       # reentrancy guard


def test_sourcepin_f5_finale_has_one_position_system():
    # Amended by wave 2: the kit owns the slot-offset persistence outright —
    # the panel no longer touches drag/persist APIs at all (see the wave-2 pin).
    js = _read("static", "js", "orwellFinale.js")
    assert 'slotKey: "finale"' in js                 # ONE position system, via the kit
    assert "localStorage.setItem" not in js          # no custom writer of any kind
    assert "mobileSkip" not in js                    # no touch-drag against sheet CSS


def test_sourcepin_kit_owns_the_contracts():
    js = _read("static", "js", "orwellWindow.js")
    for needle in (
        "data-ow-window",                            # the ratchet's selector
        "ow-titlebar", "ow-controls", "ow-body",     # the one chrome family
        "prefers-reduced-motion",                    # animations strip (F4)
        "clampPos",                                  # explicit clamp (norm c)
        "saveDragOffset",                            # ONE persistence scheme (F5)
        "dismissTop",                                # Escape participation (F7)
        "opener",                                    # focus-return (F8)
        "ArrowLeft",                                 # keyboard move (F10)
        "AbortController",                           # teardown (norm j)
    ):
        assert needle in js, needle
    assert "OrwellWindowKit" in js                   # the seam the gates drive


def test_sourcepin_kit_is_loaded_and_escape_spliced():
    html = _read("static", "index.html")
    assert "orwellWindow.js" in html
    ui = _read("static", "js", "ui.js")
    assert "OrwellWindowKit.dismissTop()" in ui      # menus -> kit windows -> modals


def test_smoke_exercises_the_kit_for_real():
    smoke = _read("scripts", "browser_smoke.py")
    assert "F1: the Windows dock is VISIBLE" in smoke
    assert "F2: dragging the title bar MOVES the panel" in smoke
    assert "ow-smoke-window" in smoke                # a real kit window end-to-end
    # H5 folded the social window into the sidebar, so the finale carries the
    # real-game-panel half of the T20/F1 behavior block now.
    assert 'page.click("#orwell-finale .ow-min")' in smoke  # trusted, not evaluate()


# ── Lane F / F-2 wave 1 pins ──────────────────────────────────────────────

def test_sourcepin_wave1_sheet_host_owns_narrow():
    slots = _read("static", "js", "orwellSlots.js")
    assert "restackNarrowSheets" in slots           # the F3 sheet host exists
    # (H5: social left the sheet world for the sidebar; finale is the game sheet.)
    for f in ("orwellFinale.js",):
        js = _read("static", "js", f)
        assert "top: 44px !important" not in js, f  # per-panel pins are gone
        assert "left: 0 !important" not in js, f


def test_sourcepin_wave1_finale_seam_for_the_gate():
    js = _read("static", "js", "orwellFinale.js")
    assert "_orwellFinaleEnsure" in js


def test_smoke_asserts_f3_for_real():
    smoke = _read("scripts", "browser_smoke.py")
    # H5 amended F3's denominator: with the social window folded into the sidebar,
    # the finale is the one mobile game sheet — the host still owns its position.
    assert "F3: the finale sheet stays full-width" in smoke
    assert "F3: the finale sheet never covers the composer" in smoke


# ── Lane F / F-2 wave 2 pins ──────────────────────────────────────────────

def test_sourcepin_wave2_finale_composes_the_kit():
    js = _read("static", "js", "orwellFinale.js")
    assert "OrwellWindowKit.create(" in js          # the kit owns the chrome
    assert "makeWindowDraggable" not in js          # bespoke drag wiring deleted
    assert "ofin-hdr" not in js                     # bespoke titlebar deleted
    assert "ofin-min" not in js                     # bespoke minimize button deleted
    assert "modalManager.register(" not in js       # the kit registers, not the panel
    assert "POS_KEY" not in js                      # the F5 dual-persistence era is fully over


# ── Lane F / F-2 wave 3 pins ──────────────────────────────────────────────

def test_sourcepin_wave3_shared_dismiss_affordance():
    kit = _read("static", "js", "orwellWindow.js")
    assert ".ow-dismiss" in kit                      # the rule ships from the kit css
    assert "DOMContentLoaded\", ensureCss" in kit or "ensureCss();" in kit  # injected at load
    # orwellPresence.js no longer adopts it: the presence strip was relocated from a floating
    # banner to docked sidebar chrome ("Where you are"), which has no dismiss affordance.
    # orwellRetrospective.js MIGRATED onto the kit (0054 Phase 2) — it carries the kit's own
    # close button now, not a bespoke ow-dismiss banner.
    # #642: the engine-status banner MIGRATED off the window kit's .ow-dismiss onto the
    # OrwellNotice kit (a top-banner system-notice) — its dismiss is the notice kit's shared
    # .on-dismiss now (one shared dismiss affordance, the owner add-on). It no longer carries
    # ow-dismiss; the notice ratchet (test_on_notice_kit.py) pins its kit membership.
    eng = _read("static", "js", "orwellEngineStatus.js")
    assert "OrwellNoticeKit.create(" in eng, "engine-status composes the OrwellNotice kit (#642)"
    assert "ow-dismiss" not in eng, "engine-status no longer hand-borrows the window kit's dismiss"


def test_sourcepin_wave3_modal_family_focus_return():
    ui = _read("static", "js", "ui.js")
    assert "_owOpener" in ui                         # opener stashed on hidden->visible
    assert "_restoreFocus" in ui                     # restored on visible->hidden
    # A2 (#573): the "never yank focus the user moved" rule now lives in the ONE
    # shared focus-return helper (window._owReturnFocus) both families call — the
    # guard is `container.contains(active)` there, not an inlined `!m.contains`.
    assert "window._owReturnFocus = _returnFocus" in ui
    assert "container.contains(active)" in ui         # never yank focus the user moved


def test_sourcepin_wave3_decision_card_escape_is_dismiss_only():
    js = _read("static", "js", "orwellDecision.js")
    assert 'e.key !== "Escape"' in js
    assert "removeCard()" in js
    # the Escape handler must not touch the submit path
    snippet = js[js.index('e.key !== "Escape"'):js.index('e.key !== "Escape"') + 400]
    assert "fetch" not in snippet and "confirm" not in snippet


def test_smoke_exercises_wave3_for_real():
    smoke = _read("scripts", "browser_smoke.py")
    assert "F8: focus returns to the gear" in smoke
    assert "F11: Escape dismisses the focused decision card" in smoke


# ── Lane G / G10 pins ─────────────────────────────────────────────────────

def test_sourcepin_g10_cast_composes_the_kit():
    js = _read("static", "js", "orwellCast.js")
    assert "OrwellWindowKit.create(" in js           # the kit owns the chrome
    assert "aria-modal" not in js                    # a reference panel, not a modal
    assert "oc-close" not in js                      # bespoke close deleted (it never worked)
    assert 'el.hidden' not in js                     # the [hidden]-vs-display:flex bug class is gone
    assert '"Escape"' not in js                      # the kit arbiter owns Escape now


# ── viewport re-clamp on browser resize (the DWE windowing tail) ───────────
# The kit clamps on open/drag/resize and the slot engine re-clamps on its own
# 'resize' listener (post-#345); the remaining gap was a FLOATING window that had
# no path to re-clamp when the browser viewport shrinks. ONE global, rAF-debounced
# window 'resize' listener over the open-window stack closes it. (Live behavior —
# a near-edge window re-clamping into a shrunken viewport — is exercised for real
# in browser_smoke.py; these source-pin the wiring.)


def test_sourcepin_kit_reclamps_open_windows_on_viewport_resize():
    js = _read("static", "js", "orwellWindow.js")
    # a single global window resize listener (not per-instance) is wired
    assert "window.addEventListener('resize'" in js
    # it is debounced (rAF, falling back to a ~120ms timer) — never a layout thrash
    assert "requestAnimationFrame" in js
    # the per-window re-clamp method exists and is driven over the open-window stack
    assert "_reclamp()" in js
    assert "reclampOpenWindows" in js
    # it skips docked + minimized windows (the rail owns docked; minimized are hidden)
    reclamp = js[js.index("_reclamp() {"):js.index("_reclamp() {") + 1600]
    assert "this._docked" in reclamp and "isMinimized()" in reclamp
    # all three jobs: slot re-clamp (restack), position clamp into the viewport (full
    # containment when it fits), and shrink-to-fit respecting the window's own minimums.
    assert "this._slot.restack()" in reclamp
    assert "window.innerWidth - r.width" in reclamp and "window.innerHeight - r.height" in reclamp
    assert "this.o.minWidth" in reclamp and "this.o.minHeight" in reclamp


def test_smoke_exercises_resize_reclamp_for_real():
    smoke = _read("scripts", "browser_smoke.py")
    assert "resize re-clamp: a floating window re-anchors INTO the shrunken viewport" in smoke
    assert "ow-reclamp-smoke" in smoke
    assert "new Event('resize')" in smoke


# ── A7 [ruling #19 / E97 follow-up] — the Windows-7 fly-out ────────────────
# The shared animation CONTRACT exposes DISTINCT minimize vs. close keyframes;
# prefers-reduced-motion removes them. (The live motion is exercised in
# browser_smoke.py; these source-pin the contract the audit asks for.)


def test_sourcepin_a7_distinct_minimize_and_close_keyframes():
    js = _read("static", "js", "orwellWindow.js")
    # two NAMED, distinct keyframes — minimize is the fly-out (translate+scale toward
    # the dock), close is the scale+fade fly-away — plus the surviving open keyframe.
    assert "@keyframes ow-minimize" in js
    assert "@keyframes ow-close" in js
    assert "@keyframes ow-open" in js
    assert ".ow-anim-minimize" in js and ".ow-anim-close" in js
    # the minimize keyframe is the fly-out (a translate along the path to the dock)
    assert "translate(var(--ow-fly-x" in js
    # the JS hands the keyframe its fly vector + applies the distinct classes
    assert "setProperty('--ow-fly-x'" in js
    assert "classList.add('ow-anim-minimize')" in js
    assert "classList.add('ow-anim-close')" in js
    # the old single shared transition (ow-anim-fly) is fully retired
    assert "ow-anim-fly" not in js


def test_sourcepin_a7_reduced_motion_strips_the_flyout():
    js = _read("static", "js", "orwellWindow.js")
    # the @media (prefers-reduced-motion: reduce) block disables ALL of
    # open/minimize/close under reduced motion (the rule names all three + none).
    marker = "@media (prefers-reduced-motion: reduce) {"
    assert marker in js
    block = js[js.index(marker): js.index(marker) + 220]
    assert ".ow-anim-open" in block and ".ow-anim-minimize" in block and ".ow-anim-close" in block
    # the restore fly-IN is stripped under reduced motion too (it joins the same rule)
    assert ".ow-anim-restore" in block
    assert "animation: none" in block
    # and the JS short-circuits the fly when REDUCED() (no class, straight to done)
    assert "if (REDUCED()) { done(); return; }" in js


def test_sourcepin_a7_restore_flyin_mirrors_the_minimize_flyout():
    """restore↔minimize are mirror-image animations (just as open↔close are).

    The window flies OUT to the dock on minimize and flies back IN from the dock
    on restore, via a dedicated ow-restore keyframe that reverses ow-minimize
    along the SAME fly-vector contract (--ow-fly-x/-y). reduced-motion strips it.
    """
    js = _read("static", "js", "orwellWindow.js")
    # a NAMED restore keyframe that flies IN from the dock (translated + scaled-down → identity)
    assert "@keyframes ow-restore" in js
    assert ".ow-anim-restore" in js
    # it reuses the SAME fly-vector contract as the minimize fly-out
    assert "translate(var(--ow-fly-x, 0), var(--ow-fly-y, 0)) scale(.12)" in js
    # the restore path computes the dock delta + applies the class — guarded by REDUCED()
    restore = js[js.index("_afterDockRestore() {"):js.index("_afterDockRestore() {") + 2400]
    assert "flyTargetRect()" in restore                 # fly FROM the dock chip
    assert "setProperty('--ow-fly-x'" in restore
    assert "classList.add('ow-anim-restore')" in restore
    assert "if (!REDUCED())" in restore                 # reduced-motion skips the fly-in


# ── 0054 Phase 2 — DOCKED kit mode ─────────────────────────────────────────
# A `dockable` window can render its full body INTO #gadget-rail-body, opting OUT
# of the slot geometry (F5 stays one position system) and the chip dock; the flag
# persists per-window/per-user, mirroring the L12 cast-pin key pattern.

DOCKABLE_WINDOWS = ("orwellFinale.js", "orwellCast.js", "orwellRetrospective.js")


def test_kit_has_a_docked_render_mode():
    js = _read("static", "js", "orwellWindow.js")
    assert "dockable" in js and "defaultDocked" in js
    assert "toggleDock" in js                         # the dock/undock seam
    assert "isDocked" in js                           # consumers can read the mode
    assert "ow-docked" in js                          # the docked CSS class
    # docked = mounts into the rail body, opts out of slot + chip
    assert 'getElementById(\'gadget-rail-body\')' in js or 'getElementById("gadget-rail-body")' in js
    # the per-window docked flag persists, mirroring castPin's key pattern
    assert "-docked:" in js
    # docked windows DON'T register a slot or a dock chip (the early return in open)
    assert "if (this._docked) {" in js


def test_kit_docked_css_opts_out_of_geometry():
    js = _read("static", "js", "orwellWindow.js")
    # the docked rule neutralises fixed position + the slot-offset geometry, so the
    # rail owns placement (ONE position system — docked = NO geometry).
    assert ".ow-window.ow-docked" in js
    assert "position: static" in js


def test_three_windows_are_dockable():
    for f in DOCKABLE_WINDOWS:
        js = _read("static", "js", f)
        assert "dockable: true" in js, f
        # default FLOATING (the documented owner-flippable choice) — a one-line flip
        assert "defaultDocked: false" in js, f


def test_docked_windows_have_canonical_rail_order():
    css = _read("static", "style.css")
    # docked windows slot in after the always-on HUD gadgets (scroll handles tall ones)
    assert ".gadget-rail-body > #orwell-finale { order:" in css
    assert ".gadget-rail-body > #orwell-cast { order:" in css
    assert ".gadget-rail-body > #orwell-retro { order:" in css


def test_retrospective_migrated_onto_the_kit():
    js = _read("static", "js", "orwellRetrospective.js")
    # the plainer panel now COMPOSES the kit (the migration that 0054 Phase 2 asked
    # for first) — bespoke fixed-position banner + direct slot register are gone.
    assert "OrwellWindowKit.create(" in js
    assert "OrwellSlots.register" not in js
    # the panel no longer sets its own fixed geometry (the kit's slot owns it now);
    # the only 'fixed' left is in prose, so check for the CSS declaration form.
    assert "position:fixed" not in js.replace(" ", "")  # no inline/css fixed-position rule
    assert "dockable: true" in js


# ── A1 / J1-25 — the opt-in per-window modal option ────────────────────────
# The UX audit deferred its #1 launch-blocker (J1-25: the cast-photo dialog let
# focus escape into the chat and floated over live narration with no scrim) to a
# "next gated set" because the kit had no modal capability (UX-AUDIT-LOG.md:191).
# A1 adds an OPT-IN `modal` option — aria-modal + scrim + inert background +
# focus-trap — WITHOUT forcing it on the floating/lingering windows. (Behavior is
# exercised for real in browser_smoke.py; these source-pin the wiring.)


def test_sourcepin_a1_kit_has_opt_in_modal_option():
    js = _read("static", "js", "orwellWindow.js")
    assert "modal: false" in js                        # the opt-in DEFAULT (off)
    assert "aria-modal" in js                           # the dialog promise to AT
    assert "ow-scrim" in js                             # the backdrop dim (J1-23/J1-04)
    assert "_trapFocus" in js                           # Tab can't escape the dialog
    assert "_inertBackground" in js                     # the rest of the page goes inert
    assert "n.inert = true" in js                       # …really inert (not aria-only)
    # the kit RESTORES on teardown (no stuck scrim / permanently-inert page)
    assert "_unmountModalChrome" in js
    assert "_uninertBackground" in js


def test_sourcepin_a1_cast_photo_opts_in_roster_does_not():
    # the cast-photo dialog (the J1-25 surface) opts IN…
    hs = _read("static", "js", "orwellHeadshot.js")
    assert "modal: true" in hs
    # …while the cast ROSTER stays a free-floating, non-modal reference panel
    cast = _read("static", "js", "orwellCast.js")
    assert "modal: true" not in cast
