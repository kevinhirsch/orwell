"""Lane S1+S2 — the 2026-06-11 settings-wiring audit's dead-wiring repairs.

Source-pins for the wave-S1/S2 findings (F1, F2, F3, F6). F4 (the teacher
enable toggle) and F5 (keybind default-table drift) are deliberately NOT
covered here — they are the foreman's product decision.

F1 (MAJOR): the Shortcuts tab persists rebinds per-profile via
PUT /api/prefs/keybinds (C30), but the runtime keymap booted from
/api/auth/settings ONLY — which nothing writes anymore — so every custom
shortcut silently reverted on reload while the tab still displayed it as
saved. The fix makes the runtime loader read the SAME layering the tab
renders from: defaults <- global `keybinds` <- per-user /api/prefs/keybinds.
The live rebind -> reload -> fires pin runs in scripts/browser_smoke.py.
"""

import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(rel):
    with open(os.path.join(FRONTEND, rel), encoding="utf-8") as f:
        return f.read()


def _block(src, start_marker, length=2500):
    idx = src.index(start_marker)
    return src[idx: idx + length]


# ── F1 — the runtime keymap loads from the canonical store ────────────────

def test_runtime_keymap_loads_from_per_user_prefs():
    js = _read("static/js/keyboard-shortcuts.js")
    # The canonical store the rebind UI saves to (C30) must be read back at boot.
    assert "/api/prefs/keybinds" in js, (
        "F1: the runtime keymap must load the per-user store the Shortcuts tab "
        "saves to (/api/prefs/keybinds) — /api/auth/settings alone is a key "
        "nothing writes anymore"
    )


def test_runtime_keymap_layering_defaults_global_then_per_user():
    js = _read("static/js/keyboard-shortcuts.js")
    loader = _block(js, "window._orwellKeybinds = { ..._defaultKeybinds };")
    # All three layers present in the loader block…
    assert "_defaultKeybinds" in loader, "F1: defaults fallback must survive"
    i_global = loader.index("fetch('/api/auth/settings'")
    i_prefs = loader.index("fetch('/api/prefs/keybinds'")
    # …and the per-user layer lands ON TOP of the global seed (same layering
    # the Shortcuts tab renders from: defaults <- global <- per-user).
    assert i_global < i_prefs, (
        "F1: the per-user /api/prefs/keybinds merge must come AFTER the global "
        "/api/auth/settings seed so a personal rebind wins"
    )
    # The per-user value-object merge is real, not just a fetch.
    assert re.search(r"value\s*&&\s*typeof value === 'object'", loader), (
        "F1: the prefs payload's {value} object must merge into the keymap"
    )


def test_rebind_save_keeps_the_in_page_assignment():
    # The audit fix spec: keep the in-page assignment on save so a rebind
    # works immediately, before any reload.
    js = _read("static/js/settings.js")
    save_block = _block(js, "async function saveKeybinds", 1000)
    assert "window._orwellKeybinds = keybinds" in save_block, (
        "F1: saveKeybinds must keep assigning the live keymap in-page"
    )
    assert "fetch('/api/prefs/keybinds'" in save_block, (
        "F1: the save side stays on the per-user prefs store (C30)"
    )


# ── F2 — the custom search-result count saves on its own ──────────────────

def test_search_custom_count_has_its_own_change_listener():
    js = _read("static/js/settings.js")
    assert "countCustomInput.addEventListener('change', saveSearch)" in js, (
        "F2: a typed custom result count must persist on its own change — "
        "not only when some other search control happens to fire a save"
    )


def test_selecting_custom_mode_skips_save_until_a_real_value_exists():
    js = _read("static/js/settings.js")
    # The countSel save listener must guard the 'custom' branch: an
    # empty/invalid custom field skips the save instead of posting a stale
    # count. Find the listener that wraps saveSearch (the display-toggle
    # listener doesn't save).
    m = re.search(
        r"countSel\.addEventListener\('change', function\(\) \{(?:(?!\}\);).)*"
        r"countSel\.value === 'custom'(?:(?!\}\);).)*return;(?:(?!\}\);).)*saveSearch\(\);",
        js,
        re.S,
    )
    assert m, (
        "F2: selecting 'Custom' must not fire saveSearch while the custom "
        "field is empty/invalid (the save belongs to the input's own change)"
    )


# ── F3 — the window-position reset sweeps the kit's keys ──────────────────

def test_reset_window_positions_sweeps_slot_offset_and_parked_prefixes():
    js = _read("static/js/settings.js")
    handler = _block(js, "el('reset-window-positions-btn')")
    assert "orwell-slot-offset:" in handler, (
        "F3: the reset sweep must clear the slot system's drag offsets "
        "('orwell-slot-offset:<key>:<user>', orwellSlots.js)"
    )
    assert "orwell-win-parked:" in handler, (
        "F3: the reset sweep must clear G16's parked flags "
        "('orwell-win-parked:<id>:<user>', orwellWindow.js)"
    )
    # Legacy prefixes keep riding the same sweep.
    for legacy in ("winpos-", "winsize-", "modal-pos-"):
        assert legacy in handler, f"F3: the legacy '{legacy}' sweep must survive"
    # Kit-level reset, not per-panel enumeration (the F-3 ratchet): the
    # restore goes through modalManager + OrwellSlots, and the handler never
    # writes a geometry key.
    assert "OrwellSlots.restackAll" in handler, (
        "F3: after the sweep, slotted windows snap back via the kit"
    )
    assert "restore(" in handler and "modalManager" in handler, (
        "F3: a parked window comes back via modalManager.restore (kit-level)"
    )
    assert "localStorage.setItem" not in handler, (
        "F3: the reset handler only clears keys — it must never mint one"
    )


# ── F6 — the Export card stops promising dropped verticals ────────────────

def test_export_card_copy_names_no_dropped_vertical():
    html = _read("static/index.html")
    # The Data Backup card region (the export/import buttons' card).
    idx = html.index("adm-exportDataBtn")
    card = html[max(0, idx - 1200): idx + 400]
    for stale in ("memories", "presets", "skills"):
        assert stale not in card, (
            f"F6: the Export card copy still promises '{stale}' — a dropped "
            "vertical under the game build (S5 leftover)"
        )
    assert "settings and preferences" in card, (
        "F6: the card should describe what /api/export genuinely carries for "
        "a game-build user (settings and preferences; backup_routes.py "
        "exports no chats, so the audit's literal 'chats' copy would be a "
        "new inaccuracy)"
    )
