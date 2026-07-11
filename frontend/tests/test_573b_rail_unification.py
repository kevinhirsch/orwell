"""#573 B — RAIL UNIFICATION (WAY-7 / J2-09/04/05): the two parked-window destinations
converge onto ONE surface — the control-room gadget rail.

Before this increment a parked kit window could land in TWO places: the legacy
`#minimized-dock` chip strip (bottom of the nav sidebar) OR the gadget rail (a 0054
Phase-2 `dockable` window docks into `#gadget-rail-body`). This is the "no single rail
grammar" the audit tracked (`docs/audits/2026-06-21-window-system-scope.md`, Direction B
/ WAY-7).

SAFE FIRST INCREMENT — "converge the destination" (the audit's Direction-B step 1). This
does NOT change minimize/restore SEMANTICS (that would rip out the deeply-pinned finale/
cast chip-park refresh-persistence gate, test_g16_refresh_fixes.py — the "same GESTURE"
step is deferred). Instead it makes the `#minimized-dock` chip strip a THIN ALIAS that is
HOMED INTO the control-room rail in the game build, so both a minimized window's chip and a
docked window now live in the ONE control room. The full inherited build (no rail) keeps
the legacy nav-sidebar cluster verbatim.

These are wiring/convention source-pins; the live behaviour (minimize → chip appears in the
rail → restore) is exercised for real in frontend/scripts/browser_smoke.py (the T20/G16
dock blocks + the new `dockInRail` assertion).
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


def _fn_body(js, sig):
    """The body of a `function <sig> { ... }` up to its matching close brace (1-depth scan)."""
    i = js.index(sig)
    brace = js.index("{", i)
    depth, j = 0, brace
    while j < len(js):
        c = js[j]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return js[brace:j + 1]
        j += 1
    raise AssertionError(f"unbalanced braces after {sig!r}")


MODAL = _read("static", "js", "modalManager.js")
RAIL = _read("static", "js", "orwellGadgetRail.js")


# ── modalManager: the dock is HOMED into the rail (game build) via one seam ──────────


def test_dock_has_a_single_home_seam():
    # One place decides where the "Windows" dock mounts — _homeDock — called from _ensureDock.
    assert "function _homeDock(dock)" in MODAL
    ensure = _fn_body(MODAL, "function _ensureDock()")
    assert "_homeDock(dock)" in ensure, "_ensureDock must delegate placement to the single _homeDock seam"


def test_dock_homes_into_the_gadget_rail_in_the_game_build():
    home = _fn_body(MODAL, "function _homeDock(dock)")
    # game build: home into #gadget-rail…
    assert "getElementById('gadget-rail')" in home
    assert "rail.appendChild(dock)" in home
    # …and NOT into #gadget-rail-body: the body is display:none when the rail collapses, and its
    # children are the rail's draggable GADGETS. A sibling of the body survives collapse AND stays
    # out of the gadget order/drag/strip machinery.
    assert "gadget-rail-body" not in home, "the dock must be a SIBLING of the body, not a body child"


def test_dock_falls_back_to_the_sidebar_in_the_full_build():
    # No rail (the full inherited workspace) → the legacy nav-sidebar "Windows" cluster, unchanged.
    home = _fn_body(MODAL, "function _homeDock(dock)")
    assert "getElementById('sidebar')" in home
    assert ".sidebar-user-bar" in home
    assert "insertBefore(dock, userBar)" in home


def test_minimize_restore_semantics_are_unchanged_thin_alias():
    # THIN ALIAS: only the dock's HOME moves — the chip element, its id, and the class-driven
    # F1 reveal are untouched (so every chip-park gate, incl. G16 refresh-persistence, still holds).
    assert "dock.id = 'minimized-dock'" in MODAL
    assert MODAL.count("classList.add('ow-has-rows')") == 1
    assert MODAL.count("classList.remove('ow-has-rows')") == 1
    # minimize() still persists the parked flag through the kit (G16); this increment didn't touch it.
    kit = _read("static", "js", "orwellWindow.js")
    assert "saveParked(this.o.id, true)" in kit


# ── the rail is notified so a parked chip is never stranded ──────────────────────────


def test_modalmanager_notifies_on_dock_change_without_reminting_gamechanged():
    assert "function _notifyDockChanged()" in MODAL
    notify = _fn_body(MODAL, "function _notifyDockChanged()")
    assert "orwell:dock-changed" in notify
    # g15: the sole `orwell:gamechanged` dispatcher stays platform.js — this seam must NOT mint it
    # (the string may appear in a comment; what's forbidden is a dispatch of it here).
    assert "CustomEvent('orwell:gamechanged'" not in MODAL
    assert 'CustomEvent("orwell:gamechanged"' not in MODAL
    # _renderDock fires the notice on BOTH transitions (a chip parked; the last chip cleared).
    assert MODAL.count("_notifyDockChanged()") >= 3  # the def + the two _renderDock exits


def test_rail_reveals_for_a_parked_chip_and_listens_for_the_change():
    # The rail counts the homed-in chip dock as content, so a parked window keeps the control room
    # open (never stranded behind the content-driven hide).
    assert "function _dockHasParkedChips()" in RAIL
    dchips = _fn_body(RAIL, "function _dockHasParkedChips()")
    assert 'getElementById("minimized-dock")' in dchips
    assert "rail.contains(d)" in dchips
    assert 'classList.contains("ow-has-rows")' in dchips
    hc = _fn_body(RAIL, "function _hasContent()")
    assert "_dockHasParkedChips()" in hc, "_hasContent must count the parked-chip dock"
    # …and it re-runs its visibility on the dock-change notice.
    assert 'addEventListener("orwell:dock-changed", syncVisibility)' in RAIL
    # g15: the rail LISTENS but never DISPATCHES orwell:gamechanged (unchanged).
    assert 'new CustomEvent("orwell:gamechanged"' not in RAIL
    assert "new CustomEvent('orwell:gamechanged'" not in RAIL


def test_dock_stays_out_of_the_gadget_machinery():
    # The gadget order/drag/strip machinery reads #gadget-rail-body children (gadgets()). The dock is
    # a sibling of the body, so it is never enumerated as a gadget — pin that `gadgets()` reads the
    # body, not the whole rail, so a rail-child dock can't be dragged/reordered as a gadget.
    gadgets = _fn_body(RAIL, "function gadgets()")
    assert "body.children" in gadgets
    assert "minimized-dock" not in gadgets  # no special-casing needed — it's simply not a body child


def test_smoke_proves_the_dock_lives_in_the_rail():
    smoke = _read("scripts", "browser_smoke.py")
    # the runtime gate asserts a minimized window's chip dock is a descendant of the control room.
    assert "#573 B" in smoke
    assert "dockInRail" in smoke
