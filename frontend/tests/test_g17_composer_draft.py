"""G17 (refresh-persistence audit F3/F5/F7 + F4) — the composer draft survives a refresh.

The G5 audit's commission was literal: "text will prefill, I will refresh, and the text
will not persist." Lane G17 ships the fix the audit specified:

  * F3 — ONE session-scoped record per user (`orwell-composer-draft:<user>` →
    `{ text, drMode, pendingApproachId }`), written debounced on composer input and
    immediately when DR mode / the pending approach change; restored on boot; cleared
    on send.
  * F5 (THE PRIVACY GATE — F3 must not merge without it) — a Diary-Room draft re-enters
    DR mode BEFORE its text lands back in the composer; if DR mode cannot engage, the
    confessional text is WITHHELD. A restored confessional must never be sendable to
    the house (the Diary Room's "no in-game pathway to any NPC" contract).
  * F7 — the pending approach chip's accent + send-dismisses contract ride the record
    (the orwellSocial.js seam).
  * F4 — the casting-seat marker used to one-shot at PREFILL time, stranding an empty
    composer forever after a pre-send refresh; the seated path now RE-ARMS the prefill
    (never the fresh-session click) when nothing has been spoken and no draft came back.

Static source contract (name-agnostic; no running engine). The behavioral counterpart —
real typing, real reloads, the DR-before-text order spy, the chip accent surviving, and
the seat re-arm — is driven in the headless browser by scripts/browser_smoke.py (the
G17 block).
"""

import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC = os.path.join(FRONTEND, "static", "js")


def _read(name: str) -> str:
    with open(os.path.join(STATIC, name), encoding="utf-8") as f:
        return f.read()


def _read_root(*parts) -> str:
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


SRC = _read("orwellComposerDraft.js")
DR = _read("orwellDiaryRoom.js")
SOC = _read("orwellSocial.js")
OB = _read("orwellOnboarding.js")
CHAT = _read("chat.js")


# ── 1. F3: ONE record, one key, session-scoped, per user ──────────────────────

def test_one_record_one_key():
    # The fix spec is explicit: ONE sessionStorage record carrying all three legs —
    # never three keys that can drift apart (the F1-class split-key trap).
    assert SRC.count('"orwell-composer-draft:"') == 1
    assert SRC.count("sessionStorage.setItem") == 1  # exactly one write site
    write = SRC[SRC.index("sessionStorage.setItem"):]
    assert "JSON.stringify(rec)" in write[:80]       # ...and it writes the whole record


def test_record_carries_all_three_legs():
    rec = SRC[SRC.index("function liveRecord"):SRC.index("let _timer")]
    for leg in ("text:", "drMode:", "pendingApproachId:"):
        assert leg in rec, leg


def test_session_scoped_and_per_user():
    # sessionStorage on purpose (the M21 precedent: a session draft, not a forever
    # draft), scoped per user (the E71 precedent) so accounts never share a draft.
    assert "localStorage" not in SRC
    assert "sessionStorage" in SRC
    assert "document.body.dataset.user" in SRC


def test_written_debounced_on_input_and_on_mode_changes():
    # Debounced on typing; only a TRUSTED clear (the player's own delete) writes the
    # empty state through; immediate on the two non-input legs.
    assert "DEBOUNCE_MS" in SRC
    assert re.search(r"if \(b\.value\) \{ saveSoon\(\); return; \}", SRC)
    assert "if (e.isTrusted) saveNow();" in SRC
    assert 'window.addEventListener("orwell:drmode", saveNow)' in SRC
    assert 'window.addEventListener("orwell:approachpending", saveNow)' in SRC


def test_boot_noise_cannot_eat_the_record():
    # The inherited boot wipes the composer programmatically (chatRenderer's
    # showWelcomeScreen reset dispatches input; init.js's fresh-workspace wipe rides
    # pageshow; sessions.js clears on session-select) — none may drop the record:
    # programmatic empties are ignored (isTrusted), the restore itself rides pageshow
    # so it runs AFTER init.js's wipe, and it re-attempts on a short boot schedule.
    assert "if (e.isTrusted) saveNow();" in SRC
    assert 'window.addEventListener("pageshow"' in SRC
    assert "BOOT_RETRY_MS" in SRC
    restore_call = SRC[SRC.index('window.addEventListener("pageshow"'):]
    assert "restore()" in restore_call[:120]


def test_cleared_on_send_from_the_chat_pipeline():
    # chat.js calls the clear seam exactly where the send path empties the composer.
    assert "_orwellComposerDraftClear" in SRC
    i_clear = CHAT.index("_orwellComposerDraftClear")
    i_send_clear = CHAT.index("messageInput.value = '';")
    assert 0 < i_clear - i_send_clear < 400, \
        "the draft clear must ride the send path's composer clear"


def test_new_game_is_a_clean_slate():
    # A dead season's draft must not ride into the next casting interview (G15/E71).
    assert 'window.addEventListener("orwell:gamechanged", clearDraft)' in SRC


# ── 2. F5: DR mode restores BEFORE the text — the privacy gate ─────────────────

def test_restore_enters_dr_mode_before_the_text_lands():
    body = SRC[SRC.index("function restore"):SRC.index("function wire")]
    i_dr = body.index("_orwellOpenDiaryRoom")
    i_text = body.index("b.value = rec.text")
    assert i_dr < i_text, "F5: DR mode must re-enter BEFORE the draft text lands"


def test_a_confessional_is_withheld_if_dr_mode_cannot_engage():
    # The hazard pin from the audit: a stored DR draft is never restored while
    # _orwellDiaryRoomActive() is false — if the mode can't engage, the text is
    # withheld (return BEFORE the text write), record kept for a safer boot.
    body = SRC[SRC.index("function restore"):SRC.index("function wire")]
    guard = body[body.index("rec.drMode"):body.index("b.value = rec.text")]
    assert "_orwellDiaryRoomActive" in guard
    assert "return" in guard, "failing the DR gate must bail before any text lands"


def test_diary_room_announces_every_mode_change():
    # Both doors notify — enter AND exit — so the record's drMode flag can never go
    # stale against the live composer.
    assert DR.count("notifyModeChange()") >= 2
    enter = DR[DR.index("function enterDRMode"):DR.index("function exitDRMode")]
    exit_ = DR[DR.index("function exitDRMode"):DR.index("async function submitDR")]
    assert "notifyModeChange()" in enter and "notifyModeChange()" in exit_
    assert '"orwell:drmode"' in DR
    # ...and the read seam the draft module composes is still there.
    assert "window._orwellDiaryRoomActive" in DR and "_orwellDiaryRoomActive" in SRC


# ── 3. F7: the pending approach rides the record ───────────────────────────────

def test_social_exposes_the_pending_seam():
    assert "window._orwellPendingApproach" in SOC
    seam = SOC[SOC.index("window._orwellPendingApproach"):]
    assert "get:" in seam[:200] and "restore:" in seam[:300]
    assert '"orwell:approachpending"' in SOC  # live changes notify the draft module


def test_every_live_pending_mutation_goes_through_the_notifying_door():
    # startScene / send / the chip's X / the new-game reset all use the setter; the
    # bare assignment survives only inside the setter and the silent boot restore.
    assert SOC.count("pendingApproachId = id") == 2  # setPendingApproach + restore
    assert "setPendingApproach(id)" in SOC           # startScene
    assert SOC.count("setPendingApproach(null)") >= 3  # send, X, clearDismissed


def test_restore_hands_the_id_back_to_social():
    assert "window._orwellPendingApproach.restore" in SRC


# ── 4. F4: the casting-seat marker no longer one-shots the prefill ─────────────

def test_seated_path_rearms_instead_of_dead_ending():
    seated = OB[OB.index('sessionStorage.getItem(SEAT_TAKEN_KEY)'):OB.index("sessionStorage.setItem(SEAT_TAKEN_KEY")]
    assert "rearmSeatPrefill()" in seated, \
        "F4: the seated branch must re-arm the prefill, not return into a dead composer"


def test_rearm_is_prefill_only_never_a_second_session():
    body = OB[OB.index("function rearmSeatPrefill"):]
    body = body[:body.index("\n  }") + 4]
    assert "sidebar-new-chat-btn" not in body and "rail-new-session" not in body, \
        "F4: the re-arm must never repeat the fresh-session click (the F7 fence)"
    assert "SEAT_LINE" in body
    # Guards: a restored F3 draft / live typing wins; a spoken interview wins.
    assert "box.value.trim()" in body
    assert ".msg-user" in body


def test_the_f7_fence_itself_is_intact():
    # The marker still sets once per interview (fresh-session spam stays impossible),
    # and the prefill is one shared constant.
    assert OB.count('sessionStorage.setItem(SEAT_TAKEN_KEY, "1")') == 1
    assert OB.count('"I take my seat for the casting interview."') == 1  # the SEAT_LINE const
    assert OB.count("SEAT_LINE;") == 2  # takeASeat + rearmSeatPrefill share it


# ── 5. shipped + the behavioral gate moved with the feature ────────────────────

def test_index_ships_the_draft_module():
    html = _read_root("static", "index.html")
    assert '<script src="/static/js/orwellComposerDraft.js"></script>' in html


def test_browser_smoke_drives_the_draft_for_real():
    smoke = _read_root("scripts", "browser_smoke.py")
    assert "G17/F3: the typed draft is restored into the composer after reload" in smoke
    assert "G17/F5: DR mode was active BEFORE the restored text landed" in smoke
    assert "G17/F7: pendingApproachId survives the reload" in smoke
    assert "G17/F4: with the marker set and no draft, the seat prefill RE-ARMS" in smoke
