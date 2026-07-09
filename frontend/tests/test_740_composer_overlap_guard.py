"""Issue #740 (Genius #3) — the gadget RAIL / cast-PIN card must never occlude the
composer. This is the FAST-LANE source-pinned guard for that invariant.

"The conversation is the game" (ADR 0003), so the composer (`.chat-input-bar`) is the
single most-used surface and must never be painted over by a rail or pinned-cast card.
The fix (#740) is DEFENCE-IN-DEPTH:

  1. The desktop rail is an in-FLOW flex column and each HUD gadget (incl. the pinned
     cast) mounts INTO `#gadget-rail-body`, so it clears the composer by construction.
  2. A runtime GUARD (`guardComposerOverlap` in orwellGadgetRail.js) catches the
     degraded case where the rail has somehow gone FLOATING (computed position
     fixed/absolute) yet is NOT the deliberately-open mobile drawer, and lifts it so its
     bottom clears the composer's top edge. It is a no-op for an in-flow rail and leaves
     the intentional open drawer alone.
  3. A CSS ORPHAN BELT keeps a cast-pin gadget that escaped the rail body (the kit's
     body-level mount fallback) in NORMAL FLOW (`position: static !important`), so an
     orphaned card can never become a floating tile over the composer.

The LIVE render behaviour is proved by the `#740` sweep in
`scripts/responsive_matrix.py` (the `fe-responsive` browser job) across every viewport.
But that gate is a standalone browser script — an engine/FE-only PR SKIPS the browser
lanes (CI path-filtering), so a regression that deletes the guard, the orphan belt, or
the matrix sweep would land latent and only erupt on a later browser-touching PR.

This file is the fast-lane (`fe-unit`) counterpart, in the same source-pinned shape as
test_0752: it pins the three mechanisms so any edit that removes one breaks a test that
runs on EVERY PR — never guessing at pixels (CI has no compositor here).
"""
from pathlib import Path

FE = Path(__file__).resolve().parents[1]
RAIL_JS = (FE / "static" / "js" / "orwellGadgetRail.js").read_text(encoding="utf-8")
CASTPIN_JS = (FE / "static" / "js" / "orwellCastPin.js").read_text(encoding="utf-8")
MATRIX_PY = (FE / "scripts" / "responsive_matrix.py").read_text(encoding="utf-8")


# ── 1. The runtime guard exists and is FLOATING-ONLY ────────────────────────────────
def test_rail_has_composer_overlap_guard():
    """orwellGadgetRail.js must carry the guardComposerOverlap belt (#740)."""
    assert "function guardComposerOverlap()" in RAIL_JS, (
        "the rail must define guardComposerOverlap() — the #740 composer-clearance belt"
    )


def test_guard_only_lifts_a_FLOATING_rail_never_an_in_flow_column():
    """The guard must act ONLY when the rail's computed position is fixed/absolute — a
    normal in-flow desktop flex column clears the composer by construction and must be
    left untouched (lifting it would fight the layout)."""
    assert 'var floating = cs.position === "fixed" || cs.position === "absolute";' in RAIL_JS, (
        "the guard must gate on a FLOATING computed position (fixed/absolute), so it is a "
        "no-op for the in-flow desktop rail (#740)"
    )
    # An in-flow rail short-circuits (can't overlap) before any measurement.
    assert 'if (!floating) { _clearGuard(); return; }' in RAIL_JS, (
        "a non-floating (in-flow) rail must short-circuit the guard (#740)"
    )


def test_guard_leaves_the_open_mobile_drawer_alone():
    """The mobile drawer is a DELIBERATE full-height slide-over (opened on purpose,
    dismissed by ×/tap-outside) — the guard must never fight it, only a rail that has
    gone floating while NOT the open drawer."""
    assert 'if (rail.classList.contains("grail-open")) { _clearGuard(); return; }' in RAIL_JS, (
        "the guard must exempt the intentionally-open drawer (.grail-open) (#740)"
    )


def test_guard_anchors_by_bottom_to_clear_the_composer_top():
    """When a floating rail DOES intersect, the guard lifts it by anchoring `bottom`
    (releasing any `top`) so its bottom clears the composer's top edge."""
    assert 'rail.style.top = "auto";' in RAIL_JS and 'rail.style.bottom = clear + "px";' in RAIL_JS, (
        "the guard must anchor by bottom (top:auto) to clear the composer (#740)"
    )


# ── 2. The guard is WIRED on the freshness + resize seams and exposed for the gate ──
def test_guard_runs_on_visibility_sync_and_resize():
    """The guard must fire whenever layout can change — the content/visibility re-sync
    (mutation observer / gamechanged / interval funnel through syncVisibility) and on
    window resize — so it can't miss a rail that goes floating after first paint."""
    assert "guardComposerOverlap();  // #740" in RAIL_JS, (
        "syncVisibility must run guardComposerOverlap() so a floating rail is caught on "
        "every content/visibility re-sync (#740)"
    )
    assert 'addEventListener("resize", function () { _refreshOpener(); guardComposerOverlap(); });' in RAIL_JS, (
        "the guard must also run on resize (a viewport change can flip the rail floating) (#740)"
    )


def test_guard_is_exposed_for_the_responsive_matrix_gate():
    """The responsive-matrix browser gate can re-run the guard on demand; the seam must
    stay on the public OrwellGadgetRail object."""
    assert "guardComposerOverlap: guardComposerOverlap," in RAIL_JS, (
        "guardComposerOverlap must be exposed on window.OrwellGadgetRail for the gate (#740)"
    )


# ── 3. The cast-pin CSS ORPHAN BELT keeps an escaped gadget in normal flow ──────────
def test_cast_pin_orphan_belt_forces_static_position():
    """A cast-pin gadget that escaped the rail body (kit body-level mount fallback) must
    stay in NORMAL FLOW so it can never float over the composer. In the normal case the
    gadget IS inside #gadget-rail-body and the selector never matches."""
    assert "#orwell-cast-pin:not(#gadget-rail-body > #orwell-cast-pin) { position: static !important; }" in CASTPIN_JS, (
        "the cast-pin must force position:static when NOT inside the rail body, so an "
        "orphaned card can't become a floating tile over the composer (#740)"
    )


def test_cast_pin_mounts_into_the_rail_body():
    """The pinned cast is a RAIL gadget — it mounts into the in-flow rail column (which
    clears the composer), never a free-floating overlay."""
    assert "gadget-rail-body" in CASTPIN_JS, (
        "the cast-pin gadget must mount into the in-flow rail body (#740)"
    )


# ── 4. The responsive-matrix browser SWEEP for #740 must not be silently removed ────
def test_responsive_matrix_keeps_the_740_composer_sweep():
    """The live render proof lives in the browser gate; pin its presence so an edit can't
    quietly delete it (leaving #740 with no runtime coverage at all)."""
    assert "rail/cast-pin clears composer" in MATRIX_PY, (
        "responsive_matrix.py must keep the #740 rail/cast-pin composer sweep (its "
        "PASS line) (#740)"
    )
    # both degraded candidates are measured, and the open drawer is exempted
    for anchor in ("gadget-rail(floating)", "cast-pin(orphaned)", "drawerOpen"):
        assert anchor in MATRIX_PY, (
            f"the #740 matrix sweep must still check {anchor!r} against the composer (#740)"
        )
    # the sweep is measured against the actual composer element
    assert "'.chat-input-bar'" in MATRIX_PY or '".chat-input-bar"' in MATRIX_PY, (
        "the #740 matrix sweep must measure against the .chat-input-bar composer (#740)"
    )
