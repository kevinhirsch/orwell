"""Batch — Diary Room reliability (#655), Diary-Room ↔ season-progress independence
(#662), and library game-build gating (#663).

Source-pinned convention checks (name-agnostic; no running engine), matching the rest
of the FE test gate. The runtime counterparts live in scripts/browser_smoke.py.

  #655 — Mobile: the Diary Room often failed to open. ROOT CAUSE: the in-composer DR
         "pill" was anchored on #chat-form, a HIDDEN, EMPTY <form style="display:none">
         that sits AFTER .chat-input-bar (the send button targets it via form=).
         Anchoring the pill there dropped it BELOW the composer, off the bottom of the
         page — invisible on mobile (small viewport + on-screen keyboard), so the tap
         read as a no-op. Fix: anchor the pill on the VISIBLE .chat-input-bar so it
         always renders directly above where the player types.
         (The issue also raised a window↔gadget "unrecoverable as a gadget" defect, but
         the current Diary Room is a COMPOSER-MODE sidebar button — E88 / ruling #4 — and
         never becomes a window or gadget. There is nothing to make unrecoverable; the
         actionable defect is the flaky open. This is asserted below too.)

  #662 — CONFIRMED SAFE (no fix). Opening the Diary Room (composer-mode toggle) makes NO
         network call and dispatches NO orwell:gamechanged. Submitting an entry POSTs
         /api/orwell/diary-room, whose engine tool (diaryRoom) only records the player's
         OOC knowledge — it does not advance the loop, bump the season, or change
         week/eviction/phase/moment. computePct() reads only those board facts, so the
         progress bar cannot tick from a Diary-Room entry. These tests pin those
         guarantees so a regression that wires a game-advance or a gamechanged dispatch
         into the Diary-Room path trips the gate.

  #663 — The Chats-section "Manage Chats (Library)" button (#chats-library-btn) opened
         the inherited-workspace Library modal — the operator's reported "way in" under
         the game build. Now hidden by game-trim.css (the Library backend routers are
         already unmounted server-side; the /library slash family is already gated).
"""

import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC_JS = os.path.join(FRONTEND, "static", "js")


def _read_js(name: str) -> str:
    with open(os.path.join(STATIC_JS, name), encoding="utf-8") as f:
        return f.read()


def _read(*parts) -> str:
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


DR = _read_js("orwellDiaryRoom.js")
TRIM_CSS = _read("static", "css", "game-trim.css")
INDEX = _read("static", "index.html")
SLASH = _read_js("slashCommands.js")


# ── #655: the DR pill anchors on the VISIBLE composer, not the hidden form ──────


def test_pill_anchors_on_visible_chat_input_bar():
    """ensurePill() must mount the pill relative to .chat-input-bar (the visible
    composer), not #chat-form (the hidden, empty submit form that sits below it)."""
    assert "ensurePill" in DR
    # The pill anchor is the input bar.
    assert ".chat-input-bar" in DR, (
        "the DR pill must anchor on the VISIBLE .chat-input-bar so it renders above the "
        "composer — anchoring on the hidden #chat-form dropped it off-screen on mobile (#655)."
    )
    # The pill is inserted BEFORE its anchor (i.e. above the composer), via parentElement.
    assert re.search(r"insertBefore\(\s*pill\s*,\s*anchor\s*\)", DR), (
        "the pill must be inserted before its composer-bar anchor (so it sits ABOVE the "
        "composer)."
    )


def test_pill_anchor_is_not_the_hidden_chat_form():
    """Guard against a regression back to anchoring the pill on #chat-form. The submit
    form is still used for SUBMIT wiring (composerForm) — that's fine — but the pill's
    PLACEMENT must not key off it."""
    m = re.search(r"function ensurePill\(\)\s*\{.*?\n  \}", DR, re.S)
    assert m, "ensurePill() not found"
    body = m.group(0)
    assert "insertBefore(pill, form)" not in body, (
        "ensurePill must NOT insert the pill relative to the hidden #chat-form (the "
        "off-screen-on-mobile regression of #655)."
    )


def test_diary_room_is_composer_mode_not_a_window_or_gadget():
    """#655's 'unrecoverable as a gadget' premise does not apply: the Diary Room is a
    composer-mode sidebar button (E88 / ruling #4), never an OrwellWindow/gadget. Pin
    that so a future change that turns it back into a dockable window re-opens the
    unrecoverable-gadget risk consciously (and re-reads this test)."""
    assert "OrwellWindowKit" not in DR and "OrwellGadget" not in DR, (
        "the Diary Room must stay a composer-mode button, not a dockable window/gadget — "
        "that is what makes the 'disappears as a gadget' defect (#655) structurally "
        "impossible."
    )
    assert "enterDRMode" in DR and "composerBar" in DR


def test_mobile_open_path_closes_the_drawer_so_the_pill_is_visible():
    """On a narrow viewport, entering DR mode closes the sidebar drawer so the in-composer
    pill + placeholder are actually seen (the other half of 'it doesn't open' — #655)."""
    assert "closeMobileSidebar" in DR
    assert "max-width: 768px" in DR, "the mobile-drawer close must be viewport-gated."


# ── #662: the Diary-Room path never moves season/level state or the progress bar ──


def test_diary_open_makes_no_network_call():
    """Opening the Diary Room (enterDRMode) only toggles composer mode — no fetch, so no
    game read/advance is triggered by the act of opening it."""
    m = re.search(r"function enterDRMode\(\)\s*\{.*?\n  \}", DR, re.S)
    assert m, "enterDRMode() not found"
    body = m.group(0)
    assert "fetch(" not in body, (
        "enterDRMode must not call fetch — opening the Diary Room must not read or advance "
        "the game (#662)."
    )


def test_diary_path_never_dispatches_gamechanged():
    """The Diary-Room module must never DISPATCH orwell:gamechanged (a dispatch would force a
    season-progress recompute; the Diary Room is OOC and changes no board state — #662). It
    may LISTEN for gamechanged (to re-gate its own button visibility), but it must not emit
    one. The only event it dispatches is its private orwell:drmode mode-change."""
    # No dispatchEvent of a gamechanged CustomEvent, and no call to the single gamechanged
    # dispatcher helper (orwellGameChanged) — those are the only two ways to emit it.
    assert "orwellGameChanged" not in DR, (
        "orwellDiaryRoom.js must not call the orwell:gamechanged dispatcher — a Diary-Room "
        "entry changes no board state, so it must not kick a season-progress recompute (#662)."
    )
    assert not re.search(r"new CustomEvent\(\s*['\"]orwell:gamechanged['\"]", DR), (
        "orwellDiaryRoom.js must not construct an orwell:gamechanged event (#662)."
    )
    # Every dispatchEvent it DOES make is its own private drmode channel, never gamechanged.
    for m in re.finditer(r"dispatchEvent\(\s*new CustomEvent\(\s*['\"]([^'\"]+)['\"]", DR):
        assert m.group(1) == "orwell:drmode", (
            f"the Diary Room dispatches only orwell:drmode; found a dispatch of {m.group(1)!r} "
            "(#662)."
        )
    # It DOES notify its own private mode-change channel — that's the only event it emits.
    assert "orwell:drmode" in DR


def test_diary_submit_posts_only_the_ooc_entry_endpoint():
    """submitDR posts to /api/orwell/diary-room and nothing else — not /advance, not
    /new-game, not /decision. The entry is recorded as OOC player knowledge only (#662)."""
    m = re.search(r"function submitDR\(.*?\)\s*\{.*?\n  \}", DR, re.S)
    assert m, "submitDR() not found"
    body = m.group(0)
    assert "/api/orwell/diary-room" in body
    for forbidden in ("/api/orwell/advance", "/api/orwell/new-game",
                      "/api/orwell/decision", "advanceGame", "submitDecision"):
        assert forbidden not in body, (
            f"submitDR must not touch {forbidden!r} — a Diary-Room entry must not advance "
            "the game or the season (#662)."
        )


def test_season_progress_pct_is_a_pure_function_of_board_facts():
    """Defensive: computePct reads only public board facts (evictions, week, phase,
    moment, player status) — none of which a Diary-Room entry changes. Pin that the
    function reads no diary-room / OOC input, so the bar cannot tick from the Diary
    Room even if a stray gamechanged fires (#662)."""
    sp = _read_js("orwellSeasonProgress.js")
    m = re.search(r"function computePct\(.*?\)\s*\{.*?\n  \}", sp, re.S)
    assert m, "computePct() not found"
    body = m.group(0)
    assert "diary" not in body.lower(), "computePct must not read any Diary-Room input (#662)."
    # It is keyed on the board cadence (evictions + the within-week phase), nothing OOC.
    assert "TOTAL_EVICTIONS" in body and "PHASE_FRACTION" in body


# ── #663: the library has no entry point under the game build ──────────────────


def test_chats_library_button_hidden_under_game_build():
    """The 'Manage Chats (Library)' button opens the inherited Library modal — hide it
    under the game build (game-trim.css) so the operator has no launcher into it (#663)."""
    assert "#chats-library-btn" in TRIM_CSS, (
        "#chats-library-btn (the Library opener in the Chats section) must be hidden by "
        "game-trim.css — it was the operator's reported 'way in' to the library (#663)."
    )
    # …and it is a real element the CSS targets.
    assert 'id="chats-library-btn"' in INDEX


def test_all_known_library_launchers_are_gated_under_game_build():
    """Every static button that opens the Library modal is gated: the Tools-section
    entry (#tool-library-btn), the icon-rail mirror (#rail-archive), and the Chats-section
    opener (#chats-library-btn) — so no visible button reaches the library (#663)."""
    for sel in ("#tool-library-btn", "#rail-archive", "#chats-library-btn"):
        assert sel in TRIM_CSS, f"{sel} must be hidden by game-trim.css (#663)."


def test_library_slash_commands_refused_in_game_build():
    """The /library family is a dropped vertical, refused at slash dispatch under the game
    build (the keep-set is session/theme/settings/help/find + easter eggs only) — so there
    is no command-line way into the library either (#663)."""
    assert "isGameSlashAllowed" in SLASH
    m = re.search(r"const GAME_SLASH_KEEP = new Set\(\[(.*?)\]\)", SLASH, re.S)
    assert m, "GAME_SLASH_KEEP set not found"
    keep = m.group(1)
    for blocked in ("'library'", "'documents'", "'archive'", "'research'"):
        assert blocked not in keep, (
            f"{blocked} must NOT be in the game-build slash keep-set — the library family "
            "is a dropped vertical (#663)."
        )
