"""H5 (= the long-parked G7) — "The House" folds into the sidebar; the floating window dies.

USER VERDICT (2026-06-11): "There's an empty window that popped up that says 'the house'
but it's useless and I'm unsure what its function is. If we are to keep it at all, it
should probably be rolled up into the sidebar and be coherent with previous visual
standards."

The behavior is kept — NPC approaches are real game signal (0036/U6/U7, E60 motive
framing, the E89 first-ceremony belt) — but the SURFACE is retired as a window and
rebuilt as SIDEBAR CHROME on the ruling #3/E64 precedent (the status-HUD pattern:
orwellStatusPanel.js injects a <section> into #sidebar; Diary Room and the minimized
dock live there too, rulings #4/#10). And because an approaches surface with no
approaches is exactly the "useless empty window" the verdict describes, the section
renders NOTHING while no approach is pending.

Static source contract (name-agnostic; no running engine). The behavioral counterpart
— the section actually mounts inside #sidebar, shows nothing while empty, renders
chips, and no floating #orwell-social window or dock chip exists — is exercised in the
headless browser by scripts/browser_smoke.py (the H5 block).
"""

import os

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC = os.path.join(FRONTEND, "static", "js")


def _read(name: str) -> str:
    with open(os.path.join(STATIC, name), encoding="utf-8") as f:
        return f.read()


def _read_root(*parts) -> str:
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


SRC = _read("orwellSocial.js")


# ── 1. not a window: composes NO window machinery of any kind ─────────────────

def test_composes_no_window_kit():
    # The kit is for WINDOWS (Lane F). The House is sidebar chrome now — it must not
    # create a kit window, register a slot, wire the dock, or advertise drag.
    assert "OrwellWindowKit" not in SRC
    assert "modalManager" not in SRC
    assert "OrwellSlots" not in SRC
    assert "makeWindowDraggable" not in SRC
    assert 'title="Drag to move"' not in SRC


def test_no_window_state_or_geometry():
    # No minimize bookkeeping, no mobile auto-park, no saved position — a static
    # sidebar section has none of a window's state.
    assert "isMinimized" not in SRC
    assert "_mobileParkedOnce" not in SRC
    assert "slotKey" not in SRC
    assert "position: fixed" not in SRC
    assert "z-index:" not in SRC  # no z games at all — static sidebar flow
    assert "_win" not in SRC


# ── 2. sidebar chrome: the status-panel mount pattern (ruling #3/E64) ─────────

def test_injects_a_section_into_the_sidebar():
    assert 'createElement("section")' in SRC
    assert 'getElementById("sidebar")' in SRC
    # Anchored near the game-status section / session list (the converging order:
    # sessions → status → approaches), with the status panel's degraded-DOM fallback.
    assert '"orwell-status"' in SRC
    assert '"sessions-section"' in SRC
    assert "document.body.appendChild(el)" in SRC  # headless/degraded DOM fallback


def test_visual_standard_matches_the_status_panel():
    # Coherent with the established sidebar chrome: the same card treatment the
    # status HUD uses (E64), not a bespoke look.
    for token in ("var(--space-2)", "color-mix(in srgb, var(--panel",
                  "border-radius: 10px", "var(--fs-xs)", "'Fira Code'"):
        assert token in SRC, token


def test_empty_means_invisible_never_an_empty_box():
    # The verdict's core complaint, pinned: visibility is CONTENT-DRIVEN — the
    # section shows only while it holds at least one chip.
    assert 'el.style.display = items.length ? "block" : "none"' in SRC
    # and the section's base state is hidden until content arrives.
    assert "display: none" in SRC


# ── 3. the real behavior is all kept ──────────────────────────────────────────

def test_keeps_e60_motive_framing():
    assert "MOTIVE_FRAMING" in SRC and "MOTIVE_FALLBACK" in SRC
    assert "osoc-motive-bond" in SRC and "osoc-motive-probe" in SRC
    assert "framing.cls" in SRC and "dataset.motive" in SRC


def test_keeps_the_e89_first_ceremony_belt():
    assert "firstCeremonyResolved" in SRC
    assert 'phase.indexOf("hoh")' in SRC
    assert "if (!_ceremonyResolved) { renderApproaches([]); return; }" in SRC


def test_keeps_dismissals_and_the_composer_prefill():
    assert "orwell-social-dismissed" in SRC          # per-user persisted dismissals (E71)
    assert "_APPROACH_LINES" in SRC                  # varied NPC-initiated prefills (U6)
    assert "MAX_APPROACHES = 3" in SRC               # a few at once (U7)
    assert "box.focus()" in SRC                      # prefill, never auto-send
    assert "pendingApproachId" in SRC                # send-or-X clears the chip


def test_keeps_the_poll_loop_and_fail_open():
    assert "document.hidden" in SRC and "_pollDelay" in SRC          # C18
    assert SRC.count("OrwellReport.fail(") >= 2                      # G11
    assert "orwell:gamechanged" in SRC                               # G15
    for seam in ("_orwellSocialEnsure", "_orwellSocialDriveApproaches",
                 "_orwellFirstCeremonyResolved", "orwellRefreshSocial"):
        assert seam in SRC, seam                                     # the gate seams survive


# ── 4. the gates moved with the surface ────────────────────────────────────────

def test_browser_smoke_asserts_the_rail_reality():
    # 0054 relocated The House from #sidebar into the control-room gadget rail; the smoke
    # asserts it mounts as a (non-window) section in the rail, still shows nothing while
    # empty, and renders chips there.
    smoke = _read_root("scripts", "browser_smoke.py")
    assert "0054: The House mounts as a section in the gadget rail" in smoke
    assert "H5: with no pending approach the section shows nothing" in smoke
    assert "0054: approach chips render inside the gadget rail section" in smoke
    assert "H5: no orwell-social dock chip exists" in smoke
    # the window-era social assertions are gone
    assert 'page.click("#orwell-social .ow-min")' not in smoke
    assert "orwell-slot-offset:social" not in smoke


def test_ratchet_no_longer_pins_social_to_the_kit():
    ratchet = _read_root("tests", "test_f3_window_ratchet.py")
    pin = ratchet[ratchet.index("def test_ratchet_game_panels_stay_on_the_kit"):]
    assert '"orwellSocial.js"' not in pin
    assert '"orwellFinale.js"' in pin
