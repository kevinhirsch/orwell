"""Lane G16 — the first two fixes from the G5 refresh-persistence audit (SOURCE-PINS).

Provenance: docs/audits/2026-06-11-refresh-persistence-audit.md, findings F1 + F2.

F1 (status HUD, M19): the collapse state was WRITTEN under the full per-user+game
key (`orwell-status-collapsed:<player>:<user>`) but the one-time boot restore in
ensurePanel() ran BEFORE `_gameKey` was assigned (renderRoster, mid-render), so
it always read the bare `orwell-status-collapsed:` — the persisted value was
unreachable forever and the E71 "persists per user+game" promise was silently
broken. Fix: render() derives the key from the payloads in hand BEFORE the panel
build, and the persisted collapse re-applies whenever the key changes (game
change / season 2). E71 scoping is unchanged.

F2 (the window kit, M14): a minimized kit window snapped back OPEN on refresh
(and its dock chip vanished) because the minimized state lived only in
modalManager's in-memory registry and the kit persisted nothing. Fix at the KIT
level (the F-3 ratchet — no per-panel reimplementation): orwellWindow.js
persists a per-window parked flag (`orwell-win-parked:<id>:<user>`, mirroring
the slot-offset key scheme) on minimize(), clears it on a dock restore and on
close/teardown, and open() mounts a persisted-parked window DIRECTLY into the
minimized state (chip in the dock, panel hidden, no open animation — no flash).
Post-H5 the kit windows are the FINALE and the CAST window. The chip-park kit
primitives (parkedKey / loadParked / saveParked, the boot-parked open() branch,
_afterDockRestore) REMAIN — they still serve every NON-dockable kit window.

#573 GESTURE UNIFICATION (window-system audit Direction B): the finale and cast
are DOCKABLE windows, and a dockable window's minimize now IS the dock — ONE
gesture, ONE destination (the control-room rail). So minimize() routes a dockable
window through toggleDock() (the full window mounts into #gadget-rail-body as a
static .ow-docked window) instead of parking a compact chip. The docked flag
(`orwell-<id>-docked:<user>`, loadDocked/saveDocked) is the refresh-durable state
for these windows, honored by the constructor on the next open. So the F2 pins for
the finale/cast are migrated here to the DOCKED-refresh path (docked → reload →
comes back docked → undock → reload → floats); the non-dockable chip primitives
are still pinned above and exercised by the ow-smoke-window block in the smoke.

These are wiring pins, NOT behavior coverage: the behavior (minimize → dock →
reload → comes back docked; undock → reload → floats; HUD collapse → reload →
still collapsed) is exercised for real in frontend/scripts/browser_smoke.py (the
G16 block, with the audit's sanctioned route mocks for a live-game /state +
/status + /roster).
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


def _method_body(js, start_marker, end_marker):
    assert start_marker in js, f"missing {start_marker!r}"
    body = js.split(start_marker, 1)[1]
    assert end_marker in body, f"missing {end_marker!r} after {start_marker!r}"
    return body.split(end_marker, 1)[0]


# ── F1 — the status-HUD collapse key (orwellStatusPanel.js) ──────────────────


def test_sourcepin_f1_key_is_computed_before_the_panel_build():
    js = _read("static", "js", "orwellStatusPanel.js")
    # One derivation for the per-user+game key…
    assert "function computeGameKey(state)" in js
    assert re.search(
        r"function computeGameKey\(state\)\s*\{\s*"
        r"return \(\(state && state\.player && state\.player\.name\) \|\| \"\"\) \+ \":\" \+\s*"
        r"\(\(document\.body && document\.body\.dataset\.user\) \|\| \"\"\);",
        js,
    ), "computeGameKey must derive player-name:user — the E71 scheme the clicks write"
    # …assigned in render() BEFORE ensurePanel() runs its one-time restore read.
    render_body = _method_body(js, "function render(st) {", "function renderRoster(")
    assign = render_body.find("_gameKey = computeGameKey(st._state)")
    build = render_body.find("const el = ensurePanel()")
    assert assign != -1 and build != -1 and assign < build, (
        "render() must assign _gameKey from the payloads IN HAND before the panel "
        f"build (assign at {assign}, ensurePanel call at {build})"
    )
    # renderRoster keeps the same single source (no drifting inline duplicate).
    roster_body = _method_body(js, "function renderRoster(", "function esc(")
    assert "_gameKey = computeGameKey(state)" in roster_body


def test_sourcepin_f1_restore_read_and_write_share_one_key():
    js = _read("static", "js", "orwellStatusPanel.js")
    # The write (every header click) and the boot read both go through
    # storageKey("orwell-status-collapsed") — never a bare or divergent key.
    assert 'localStorage.setItem(storageKey("orwell-status-collapsed")' in js
    assert 'localStorage.getItem(storageKey("orwell-status-collapsed"))' in js
    assert "'orwell-status-collapsed'" not in js  # no second key spelling
    assert 'localStorage.getItem("orwell-status-collapsed' not in js  # no bare read


def test_sourcepin_f1_collapse_reapplies_on_a_game_key_change():
    js = _read("static", "js", "orwellStatusPanel.js")
    # Season 2 / a game change re-applies THAT game's persisted collapse (E71:
    # one game's state never leaks into another's).
    assert "function reapplyPersistedCollapse()" in js
    assert "_collapseKeyApplied === _gameKey" in js, \
        "the re-apply must be keyed to the game (no per-poll churn, real re-apply on change)"
    render_body = _method_body(js, "function render(st) {", "function renderRoster(")
    assert "reapplyPersistedCollapse()" in render_body
    # ensurePanel exposes its setter and records the key its build read applied.
    panel_body = _method_body(js, "function ensurePanel() {", "function hidePanel() {")
    assert "_applyCollapsed = setCollapsed" in panel_body
    assert "_collapseKeyApplied = _gameKey" in panel_body


# ── F2 — kit-level parked-means-parked (orwellWindow.js) ─────────────────────


def test_sourcepin_f2_parked_key_mirrors_the_slot_offset_scheme():
    js = _read("static", "js", "orwellWindow.js")
    # Per-window, per-user — the same key shape as orwell-slot-offset:<key>:<user>.
    assert re.search(
        r"return 'orwell-win-parked:' \+ id \+ ':' \+ "
        r"\(\(document\.body && document\.body\.dataset\.user\) \|\| ''\);",
        js,
    ), "parkedKey must be 'orwell-win-parked:<id>:<user>'"
    assert "function loadParked(id)" in js
    assert "function saveParked(id, on)" in js


def test_sourcepin_f2_minimize_routes_dockable_through_dock_and_persists_nondockable():
    js = _read("static", "js", "orwellWindow.js")
    min_body = _method_body(js, "minimize() {", "_afterDockRestore() {")
    # #573 gesture unification: a DOCKABLE window's minimize IS the dock (one gesture, one
    # destination — the rail), routed through toggleDock() BEFORE any chip-park path.
    assert "if (this.o.dockable) { this.toggleDock(); return; }" in min_body, \
        "minimize() must route a dockable window through the dock (the #573 gesture unification)"
    # A NON-dockable window still parks to the chip dock and persists the parked flag (unchanged).
    assert "saveParked(this.o.id, true)" in min_body, \
        "a non-dockable minimize() must still persist the parked flag"
    restore_body = _method_body(js, "_afterDockRestore() {", "restore() {")
    assert "saveParked(this.o.id, false)" in restore_body, "a dock (chip) restore must un-park durably"
    teardown_body = _method_body(js, "_teardown() {", "destroy() {")
    assert "saveParked(this.o.id, false)" in teardown_body, "close/teardown must clear the flag"


def test_sourcepin_f2_open_mounts_a_parked_window_into_the_dock():
    js = _read("static", "js", "orwellWindow.js")
    open_body = _method_body(js, "open(opener) {", "raise() {")
    # The parked branch: gated on the capability, registered first (the chip
    # needs the label), minimized state + hidden panel, and an early return so
    # neither the open animation nor the raise/focus ever runs (no flash).
    gate = open_body.find("this.o.minimizable && loadParked(this.o.id)")
    assert gate != -1, "open() must consult the persisted parked flag (minimizable windows only)"
    register = open_body.find("Modals.register(")
    assert -1 < register < gate, "the parked mount needs the Modals registration (chip label) first"
    branch = open_body[gate:].split("return this;")[0]
    assert "Modals.minimize(this.o.id)" in branch
    assert "display = 'none'" in branch
    # _displayBeforeMin is seeded so the later dock restore has a value to re-apply.
    assert "this._displayBeforeMin = el.style.display" in branch
    anim = open_body.find("ow-anim-open")
    raise_call = open_body.find("this.raise()")
    assert gate < anim and gate < raise_call, \
        "the parked branch must return BEFORE the open animation and the raise (no flash)"


def test_sourcepin_f2_dock_restore_always_yields_a_visible_window():
    js = _read("static", "js", "orwellWindow.js")
    # A boot-parked window never captured a real pre-minimize display; restoring
    # to '' can fall through to a consumer stylesheet's display:none (the finale
    # defaults hidden — the F1 bug class one layer up). The restore must force
    # visibility.
    restore_body = _method_body(js, "_afterDockRestore() {", "restore() {")
    assert "getComputedStyle(this.el).display === 'none'" in restore_body
    assert "this.el.style.display = 'block'" in restore_body


def test_sourcepin_f2_kit_exposes_isminimized_for_consumer_gates():
    js = _read("static", "js", "orwellWindow.js")
    # Consumers gate their open/poll flows on the kit's own minimized read. (0054
    # Phase 2 added a docked guard — a docked window lives in the rail, never the
    # chip dock — so the body now ANDs !this._docked with the modalManager read.)
    assert "isMinimized() { return !this._docked && Modals.isMinimized(this.o.id); }" in js, \
        "consumers gate their open/poll flows on the kit's own minimized read"


# ── F2 — the kit windows' flows still gate correctly (finale + cast) ─────────


def test_sourcepin_f2_finale_docks_on_minimize_and_shows_docked():
    # #573 gesture unification: the finale is a DOCKABLE window, so its minimize DOCKS it into
    # the control-room rail (one gesture, one destination). render()/ensure must show the docked
    # finale with an EXPLICIT inline `display:flex` — a plain "" would fall through to the
    # finale's own `#orwell-finale{display:none}` ID rule (which out-ranks the .ow-docked class
    # rule) and leave a docked finale invisible, hiding the rail. Floating still shows as a block.
    js = _read("static", "js", "orwellFinale.js")
    render_body = _method_body(js, "function render(finale) {", "async function refresh()")
    assert 'el.style.display = "flex"' in render_body, \
        "a docked finale must be shown with inline flex (beats #orwell-finale display:none)"
    assert 'else if (!isMinimized()) el.style.display = "block"' in render_body, \
        "a floating finale still shows as a block"
    # the docked branch gates on the kit's own docked read (the rail owns docked visibility)
    assert "_win.isDocked && _win.isDocked()" in render_body
    # the ensure seam keeps the same docked(flex)/floating(block) contract
    assert "window._orwellFinaleEnsure" in js
    assert 'else if (!isMinimized()) el.style.display = "block"' in js
    # onDock re-asserts the finale's display on a dock/undock re-home (the kit rebuilds the
    # element, whose content CSS defaults to display:none) so a just-docked finale is visible now.
    assert "onDock:" in js and "_orwellFinaleEnsure" in js, \
        "the finale must re-show itself on a dock/undock via onDock"
    # The finale window has no close (it exists while one is staging): when the finale ENDS,
    # hidePanel un-parks through the real restore path — so no stale minimized flag outlives it.
    hide_body = _method_body(js, "function hidePanel() {", "let _win = null;")
    assert "if (isMinimized())" in hide_body and "modalManager.restore(ID)" in hide_body


def test_sourcepin_f2_cast_toggle_reopens_a_boot_docked_mount_docked():
    # #573 gesture unification: the cast is a DOCKABLE window, so its minimize DOCKS it. On a
    # reload the seam re-opens it and the kit honors the persisted docked flag (loadDocked in the
    # constructor). togglePanel must NOT force-show a boot-DOCKED mount as a floating block (an
    # inline `block` breaks the .ow-docked flex-column rail layout) — it clears the inline display
    # so the rail's content-driven visibility owns it; a floating mount still un-hides + restores.
    js = _read("static", "js", "orwellCast.js")
    toggle_body = _method_body(js, "function togglePanel(open) {", "window._orwellCastEnsure")
    # the DOCKED-refresh branch: a docked mount clears inline display so the .ow-docked layout applies
    dgate = toggle_body.find("_win.isDocked && _win.isDocked()")
    assert dgate != -1, "the toggle must consult the kit's docked read (the docked-refresh path)"
    clear = toggle_body.find('el.style.display = ""')
    assert clear != -1 and dgate < clear, "a docked mount clears inline display (the rail shows it)"
    # a FLOATING mount still force-shows + restores/raises, exactly as before
    show = toggle_body.find('el.style.display = "block"')
    assert show != -1 and dgate < show, "the docked gate precedes the floating force-show"
    assert "_win.restore()" in toggle_body


def test_sourcepin_f2_no_per_panel_parked_persistence():
    # The F-3 ratchet: parked persistence lives in the kit, nowhere else.
    for panel in ("orwellCast.js", "orwellFinale.js"):
        js = _read("static", "js", panel)
        assert "orwell-win-parked" not in js, f"{panel} must not mint its own parked key"


# ── the browser gate drives both fixes for real ──────────────────────────────


def test_smoke_drives_both_fixes_for_real():
    # The browser gate must drive the real thing on the CAST window. #573 unification: the
    # dockable cast's minimize DOCKS it, so the F2 cycle is now DOCKED-refresh — minimize →
    # docks → reload → comes back DOCKED, undock → floats → reload → comes back OPEN (floating);
    # HUD collapse → reload → still collapsed under the key the panel writes (F1 unchanged).
    smoke = _read("scripts", "browser_smoke.py")
    assert "G16 (G5 refresh-persistence audit, F1+F2)" in smoke
    # F2 — the dockable cast docks (not a chip) and the docked flag survives the reload
    assert "orwell-orwell-cast-docked:" in smoke
    assert "comes back DOCKED" in smoke
    assert "comes back OPEN" in smoke
    # F1 — the status HUD collapse still survives the reload under its per-user+game key
    assert "still collapsed" in smoke
    assert "orwell-status-collapsed" in smoke
