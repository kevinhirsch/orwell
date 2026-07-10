"""Lane F / F-3 — THE RATCHET: windowing fragmentation cannot grow back.

The 2026-06-11 DWE audit censused the duplicated windowing layer (3 drag
engines, 7 geometry-key schemes, 6 chrome builders, 5+ Escape paths). The
F-1 kit + F-2 waves consolidated the game surfaces onto ONE window class
(`OrwellWindow` + the `.ow-*` family). This gate freezes that end state:

  • the windowing signatures (drag / slot / dock registration) may be called
    ONLY by the kit and the explicitly grandfathered legacy set below;
  • no module may mint a new geometry-persistence key;
  • no module may add a new per-surface Escape handler;
  • NEW WINDOWS MUST COMPOSE THE KIT.

A failure here is not a style nit — it is the audit's finding families
regrowing. Compose `window.OrwellWindowKit` instead (see orwellWindow.js).
The runtime half (every window-like element is kit-managed) lives in
frontend/scripts/browser_smoke.py.
"""
import os
import re
import glob

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JS_DIR = os.path.join(FRONTEND, "static", "js")


def _js_files():
    return sorted(glob.glob(os.path.join(JS_DIR, "**", "*.js"), recursive=True))


def _callers(pattern, define_files=()):
    out = set()
    rx = re.compile(pattern)
    for f in _js_files():
        name = os.path.relpath(f, JS_DIR)
        if name in define_files:
            continue
        with open(f, encoding="utf-8") as fh:
            if rx.search(fh.read()):
                out.add(name)
    return out


# ── the frozen allowlists (the F-2 end state; shrink-only) ────────────────

KIT = {"orwellWindow.js"}

# Legacy windowDrag consumers (the build=0 workspace family). Post-Lane-F
# work may MIGRATE these onto the kit (remove from this list); nothing may
# be added. settings.js MIGRATED onto the kit (#553; 2026-06-23 window-kit
# coverage audit §5 step 2): it composes OrwellWindowKit.create and no longer
# calls makeWindowDraggable — shrink-only, removed here. theme.js MIGRATED too
# (#660 residual / HIG F-CHROME-1): its Theme window composes the kit's native
# drag, and the generic makeDraggable helper it used to host moved to
# windowDrag.js (the drag engine's own module), so theme.js no longer calls the
# drag engine — shrink-only, removed here. planWindow / workspace are
# inherited-workspace, game-build-dropped.
GRANDFATHERED_DRAG = {"planWindow.js", "workspace.js"}

# Non-window slotted chrome (ruling-class strips/panels — placement only,
# no window behavior). orwellRetrospective.js MIGRATED onto the kit (2026-06-19,
# 0054 Phase 2) — it composes OrwellWindow now, so the kit registers its placement;
# shrink-only, removed here.
GRANDFATHERED_SLOTS = {"orwellPresence.js"}

# Files that legitimately handle their own Escape (the audit-verified set:
# the arbiter, the LIFO menu stack, self-trapping micro-dialogs, scoped
# composer modes, the no-trap holding card, the escape-scoped decision card,
# and the legacy app.js menu sites).
GRANDFATHERED_ESCAPE = {
    # the arbiter + the audit-verified self-handlers
    "ui.js", "orwellDiaryRoom.js", "orwellOnboarding.js", "orwellDecision.js",
    # legacy workspace surfaces (pre-kit; shrink-only)
    "chatRenderer.js", "colorPicker.js", "modelPicker.js", "sessions.js",
    "settings.js", "slashAutocomplete.js", "emojiPicker.js",
    "keyboard-shortcuts.js",
}

# Geometry-persistence key minters (the census §2 set, kit-mediated or
# grandfathered; the KEYS themselves are pinned below).
GRANDFATHERED_GEOMETRY_FILES = {
    "orwellSlots.js", "windowResize.js", "modalSnap.js", "modalManager.js",
}
GEOMETRY_KEY_MARKERS = (
    "orwell-slot-offset", "winsize-", "orwell-edge-dock-width",
    "orwell-email-doc-split-width", "orwell-modal-remembered-dock",
    "orwell.mobileDockState",
    # 0054 Phase 2: the kit's per-window DOCKED-vs-FLOATING flag ('orwell-<id>-docked:
    # <user>', minted via dockedKey()). It is a MODE flag, not geometry — a docked
    # window OPTS OUT of the slot-offset scheme entirely (F5's one-position-system
    # invariant holds: docked = no geometry). Kit-mediated (orwellWindow.js owns it),
    # mirroring orwellCastPin's 'orwell-cast-pinned:<user>' precedent.
    "dockedKey",
)

# ── hand-rolled `.modal` window chrome (2026-06-23 coverage audit §7.1) ────
# The kit's `modal:true` tier (scrim + focus-trap + inert + aria-modal, one
# z-authority) is the ONE way to build a modal dialog. A module that mints a
# `.modal` window ROOT — `element.className = 'modal…'` / `classList.add('modal')`
# — is hand-rolling the chrome the kit exists to own. Freeze the current minters
# to a shrink-only allowlist so no NEW surface regrows a bespoke `.modal` window;
# the existing ones migrate onto `OrwellWindowKit.create({ modal: true, … })`
# (coverage audit §5 steps 4/2/3) and drop off this list. This is the STATIC half
# of the audit's convention gate; its runtime companion (every game-build floating
# window carries [data-ow-window]) is the F-3+ rogue-chrome check in
# browser_smoke.py.
#
# Game-build reachability (verified against src/settings.py GAME_DROP_SCRIPTS /
# GAME_DROP_SET, coverage audit §1):
#   • ui.js — styledConfirm/styledPrompt micro-dialogs (the last GAME-BUILD-REACHABLE
#     class-B holdout, coverage audit §5 step 4): MIGRATED onto the kit's `modal:true`
#     tier (#1281 / #660; test_660_confirm_prompt_kit.py source-pins the recipe). They
#     no longer construct a bare `.modal` root — ui.js is the Escape/z-order ARBITER +
#     legacy-`.modal`-family plumbing now, never a `.modal` MINTER — so it drops off this
#     shrink-only allowlist (a NEW `.modal` root regrowing in ui.js must fail this gate),
#     mirroring how settings.js/theme.js left GRANDFATHERED_DRAG on migration.
#   • assistant.js / group.js / planWindow.js / sessions.js / workspace.js —
#     inherited-workspace surfaces, game-build-DROPPED (routers unmounted / scripts
#     stripped). Listed so a NEW minter still fails; not game-build windows.
# (settings.js / theme.js build modals from STATIC index.html nodes, not via this
# construction signature — settings.js is already kit-composed (#553); they are
# tracked by GRANDFATHERED_DRAG above, not here.)
GRANDFATHERED_MODAL_BUILDERS = {
    "assistant.js", "group.js", "planWindow.js", "sessions.js", "workspace.js",  # build=0
}
# The construction signature: assigning/adding the bare `modal` CLASS TOKEN to an
# element, in ANY class position (not just first) — so a bypass like
# `className = 'foo modal'` or `classList.add('foo', 'modal')` is caught too (a
# regression Greptile flagged on the first cut, which only matched the leading
# position). The `(?<![\w-])modal(?![\w-])` boundaries keep it to the STANDALONE
# `modal` token: the `modal-content`/`modal-header`/`modal-minimized`/
# `settings-modal-content` compounds and camel `modalManager` are chrome PARTS the
# kit + plumbing legitimately reference (incl. in comments) and must NOT false-match.
_MODAL_ROOT_RX = (
    r"""className\s*=\s*['"][^'"]*(?<![\w-])modal(?![\w-])[^'"]*['"]"""
    r"""|classList\.add\([^)]*['"]modal['"][^)]*\)"""
)


def test_ratchet_no_new_hand_rolled_modal_window():
    callers = _callers(_MODAL_ROOT_RX)
    rogue = callers - KIT - GRANDFATHERED_MODAL_BUILDERS
    assert not rogue, (
        f"NEW hand-rolled `.modal` window chrome in {sorted(rogue)} — a modal "
        "dialog composes OrwellWindowKit.create({ modal: true, … }) (scrim + "
        "focus-trap + inert + one z-authority), never a bespoke `.modal` root "
        "(2026-06-23 window-kit coverage audit §7.1)."
    )


def test_ratchet_ui_js_is_off_the_modal_builder_allowlist():
    """ui.js's styledConfirm/styledPrompt were the last game-build-reachable class-B
    `.modal` micro-dialogs; #1281/#660 migrated them onto the kit's `modal:true` tier.
    Pin that ui.js is OFF the shrink-only allowlist (so a re-added bare `.modal` root
    fails the gate) AND that it genuinely no longer mints one — mirroring how settings.js
    / theme.js left GRANDFATHERED_DRAG on migration. Re-adding ui.js here is the ratchet
    slipping back; if ui.js legitimately never mints a `.modal` root, it needs no grandfather."""
    assert "ui.js" not in GRANDFATHERED_MODAL_BUILDERS, (
        "ui.js is the Escape/z-order arbiter + legacy-`.modal` plumbing, not a `.modal` "
        "MINTER (its confirm/prompt dialogs compose OrwellWindowKit.create({modal:true}) "
        "since #1281/#660) — it must not be grandfathered back onto the modal-builder allowlist."
    )
    assert "ui.js" not in _callers(_MODAL_ROOT_RX), (
        "ui.js regrew a bare `.modal` root — compose OrwellWindowKit.create({ modal:true }) "
        "instead (2026-06-23 window-kit coverage audit §5 step 4)."
    )


def test_ratchet_modal_signature_catches_bypass_forms():
    """The `.modal`-root signature must catch `modal` in ANY class position, not just
    the leading one — otherwise `className = 'foo modal'` / `classList.add('foo',
    'modal')` slip past and the convention gate is bypassable (Greptile P1 repro).
    Compound/camel names (`modal-*`, `*-modal`, `modalFoo`) must NOT false-match, or the
    shrink-only allowlist breaks on legitimate chrome-part references."""
    rx = re.compile(_MODAL_ROOT_RX)
    # both bypass forms + the canonical forms are CAUGHT
    caught = (
        "el.className = 'foo modal';",          # modal not first (the bypass)
        "el.classList.add('foo', 'modal');",    # modal not first arg (the bypass)
        "el.className = 'modal';",
        "el.className = 'modal hidden';",
        "el.classList.add('modal');",
        'el.className = "panel modal open";',
    )
    for s in caught:
        assert rx.search(s), f"bypass slipped past the gate: {s!r}"
    # compound / camel class names are NOT the bare `modal` root — must NOT match
    ignored = (
        "el.className = 'modal-primary';",
        "el.className = 'modalFoo';",
        "el.className = 'settings-modal-content';",
        "el.className = 'foo-modal-bar';",
        "el.classList.add('modal-minimized');",
        "el.classList.add('modalManager');",
    )
    for s in ignored:
        assert not rx.search(s), f"false-matched a chrome-part compound: {s!r}"


def test_ratchet_drag_engine_callers_are_frozen():
    callers = _callers(r"makeWindowDraggable\s*\(", define_files={"windowDrag.js"})
    rogue = callers - KIT - GRANDFATHERED_DRAG
    assert not rogue, (
        f"NEW makeWindowDraggable caller(s) {sorted(rogue)} — new windows must "
        "compose OrwellWindowKit (Lane F / F-3); the kit owns drag."
    )


def test_ratchet_slot_registration_is_kit_or_chrome():
    callers = _callers(r"OrwellSlots\.register\s*\(", define_files={"orwellSlots.js"})
    rogue = callers - KIT - GRANDFATHERED_SLOTS
    assert not rogue, (
        f"NEW OrwellSlots.register caller(s) {sorted(rogue)} — windows compose "
        "the kit; only ruling-class strips register placement directly."
    )


def test_ratchet_dock_registration_is_kit_only():
    callers = _callers(r"(?:modalManager|Modals)\.register\s*\(", define_files={"modalManager.js"})
    rogue = callers - KIT
    assert not rogue, (
        f"NEW dock registration in {sorted(rogue)} — minimize-to-dock comes "
        "from the kit (OrwellWindowKit), never hand-wired."
    )


def test_ratchet_no_new_geometry_persistence_keys():
    rx = re.compile(r"localStorage\.setItem\(\s*([^,]+),")
    hits = {}
    for f in _js_files():
        name = os.path.relpath(f, JS_DIR)
        with open(f, encoding="utf-8") as fh:
            src = fh.read()
        for m in rx.finditer(src):
            keyexpr = m.group(1).strip().strip("'\"`")
            if re.search(r"pos|offset|winsize|geometry|dock|minimi", keyexpr, re.I):
                hits.setdefault(name, set()).add(keyexpr)
    rogue = {
        name: keys for name, keys in hits.items()
        if name not in GRANDFATHERED_GEOMETRY_FILES
        and not all(any(mk in k for mk in GEOMETRY_KEY_MARKERS) for k in keys)
    }
    assert not rogue, (
        f"NEW geometry-persistence key(s) {rogue} — position/size persistence "
        "is the kit's slot-offset scheme (audit F5: one system, clamped)."
    )


def test_ratchet_no_new_per_surface_escape_handlers():
    rx = re.compile(r"""\.key\s*[!=]==?\s*['"]Escape['"]""")
    callers = set()
    for f in _js_files():
        name = os.path.relpath(f, JS_DIR)
        with open(f, encoding="utf-8") as fh:
            if rx.search(fh.read()):
                callers.add(name)
    rogue = callers - GRANDFATHERED_ESCAPE - KIT
    assert not rogue, (
        f"NEW per-surface Escape handler(s) in {sorted(rogue)} — Escape flows "
        "through ui.js's single arbiter (menus → escape-scoped → modals → kit "
        "windows); mark an in-flow surface data-ow-escape-scope instead."
    )


def test_ratchet_game_panels_stay_on_the_kit():
    # The migrated end state, pinned: no orwell* game panel re-grows bespoke chrome.
    # H5/G7 (2026-06-11, user verdict): the approaches surface is no longer a window AT ALL —
    # "The House" approaches surface is sidebar chrome now (the ruling #3/E64 status-panel
    # pattern), so the finale is the remaining kit game panel.
    for f in ("orwellFinale.js",):
        with open(os.path.join(JS_DIR, f), encoding="utf-8") as fh:
            src = fh.read()
        assert "OrwellWindowKit.create(" in src, f
        for banned in ("makeWindowDraggable", "modalManager.register(",
                       "OrwellSlots.register(", 'title="Drag to move"'):
            assert banned not in src, f"{f}: {banned} regrew — compose the kit"
