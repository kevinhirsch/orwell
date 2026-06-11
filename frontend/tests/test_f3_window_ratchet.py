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
# be added.
GRANDFATHERED_DRAG = {"planWindow.js", "settings.js", "theme.js", "workspace.js"}

# Non-window slotted chrome (ruling-class strips/panels — placement only,
# no window behavior).
GRANDFATHERED_SLOTS = {"orwellPresence.js", "orwellRetrospective.js"}

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
)


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
    for f in ("orwellSocial.js", "orwellFinale.js"):
        with open(os.path.join(JS_DIR, f), encoding="utf-8") as fh:
            src = fh.read()
        assert "OrwellWindowKit.create(" in src, f
        for banned in ("makeWindowDraggable", "modalManager.register(",
                       "OrwellSlots.register(", 'title="Drag to move"'):
            assert banned not in src, f"{f}: {banned} regrew — compose the kit"
