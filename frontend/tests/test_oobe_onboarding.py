"""P1 — the redesigned OOBE: one continuous, guided onboarding flow.

The target flow, in order:
  1. Settings → LLM info (the model gate, J4).
  2. A WELCOME MODAL (its own modal, never folded into the chat).
  3. The houseguest IMAGE step — the player's FIRST interaction. REQUIRED: until a cast photo is
     secured (uploaded or AI-generated), the chat input + send affordance are LOCKED and the UI
     says why ("Add your cast photo to begin").
  4. The PRODUCERS reach out FIRST — once the photo is confirmed, the casting interview opens with
     a producer-initiated message (no player "start the conversation" pre-prompt).
  5. The casting interview (the engine's character-creation moment → updateCasting → createCharacter).
  6. House entry + a LIGHT-TOUCH guided first week (the agent-loop pacing leans expeditious in week 1,
     NO scripted rails).

These are source-pins (the FE pytest lane has no DOM runtime; the live DOM is covered by the
browser smoke). No fixture names — roles only.
"""
import importlib
import os

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*rel):
    with open(os.path.join(FRONTEND, *rel), encoding="utf-8") as f:
        return f.read()


# ── 1. The chat HARD GATE: no send until a cast photo is secured ────────────────────────

def test_chat_gate_module_is_loaded_before_onboarding():
    html = _read("static", "index.html")
    assert "orwellChatGate.js" in html
    # it loads before the onboarding module so the lock is in place when the flow runs
    assert html.index("orwellChatGate.js") < html.index("orwellOnboarding.js")


def test_chat_gate_exposes_a_single_blocked_check():
    js = _read("static", "js", "orwellChatGate.js")
    assert "window._orwellChatGate" in js
    assert "blocked:" in js              # the single source of truth chat.js consults
    assert "recompute:" in js
    assert "notePhotoSecured:" in js


def test_chat_gate_blocks_only_a_confirmed_pregame_image_not_secured_state():
    js = _read("static", "js", "orwellChatGate.js")
    # game build only
    assert "data-game-build" in js and "isGameBuild" in js
    # pre-game is the ONLY gated window (started === false), read from the Vault-free state route
    assert "/api/orwell/state" in js
    assert "started === false" in js
    # "secured" === the finalized intake flag from the portrait route
    assert "/api/orwell/portrait/intake" in js
    assert "finalized === true" in js


def test_chat_gate_fails_open_everywhere_else():
    js = _read("static", "js", "orwellChatGate.js")
    # the flag STARTS false (fail open) and is only raised by the positive probe
    assert "let _blocked = false" in js
    # any state we can't confirm clears the gate — a started season, a null state, a non-game build
    assert "setBlocked(false)" in js
    # the reason copy is explicit about WHY and what to do
    assert "Add your cast photo to begin" in js


def test_chat_gate_locks_the_input_and_send_affordance():
    js = _read("static", "js", "orwellChatGate.js")
    # it disables the textarea AND the send button, and swaps the placeholder to the reason
    assert "disabled = true" in js
    assert ".send-btn" in js
    assert 'setAttribute("placeholder"' in js
    # an inline note above the input bar explains the lock
    assert "ow-chat-gate-note" in js
    # …and the lock is fully reversible (the original placeholder is restored on release)
    assert "_savedPlaceholder" in js
    assert "releaseLock" in js
    # the lock self-heals: a re-render that re-enables the composer is re-asserted while gated
    # (several chat/session paths re-enable #message), then torn down on release
    assert "MutationObserver" in js
    assert "armReassert" in js and "disarmReassert" in js


def test_chat_send_path_consults_the_gate_and_returns_early():
    # The single chokepoint: handleChatSubmit bails before the send path when the gate is up.
    js = _read("static", "js", "chat.js")
    assert "window._orwellChatGate" in js
    # the guard sits at the top of the submit path, fails open, and returns without sending
    seg = js[js.index("window._orwellChatGate"):]
    seg = seg[: seg.index("_sendInFlight")]  # the guard is BEFORE the send-in-flight entry
    assert ".blocked()" in seg
    assert "return;" in seg


def test_enter_to_send_is_also_gated():
    # Every send path must be covered: the Enter-to-send handler also consults the gate.
    js = _read("static", "app.js")
    assert "_orwellChatGate" in js
    # in the Enter keydown handler, gated ⇒ return before the send / new-chat branch
    ks = js[js.index("messageInput.addEventListener('keydown'"):]
    ks = ks[: ks.index("handleSubmit(e)")]
    assert "_orwellChatGate" in ks and ".blocked()" in ks


def test_image_step_offers_both_upload_and_generate():
    # The image is REQUIRED but the player picks HOW: upload a photo OR generate with AI. The casting
    # headshot studio is the image step and exposes both doors.
    js = _read("static", "js", "orwellHeadshot.js")
    assert "Use photo as-is" in js                 # upload path (exact)
    assert "Make AI studio portraits" in js        # generate path (studio)
    assert "/api/orwell/portrait/intake" in js


def test_image_step_unlocks_the_chat_the_instant_it_is_secured():
    # Finalizing a photo dispatches avatarchanged (the gate re-derives) AND the producers' open
    # path proactively notes the unlock so it never waits on the next poll.
    js = _read("static", "js", "orwellHeadshot.js")
    assert "orwell:avatarchanged" in js
    gate = _read("static", "js", "orwellChatGate.js")
    assert 'addEventListener("orwell:avatarchanged"' in gate
    onb = _read("static", "js", "orwellOnboarding.js")
    assert "notePhotoSecured" in onb


# ── 2. The PRODUCERS reach out first (no player-start pre-prompt) ────────────────────────

def test_casting_seat_preprompt_is_gone():
    onb = _read("static", "js", "orwellOnboarding.js")
    # the removed pre-prompt + its helpers no longer exist anywhere
    assert "I take my seat for the casting interview." not in onb
    assert "SEAT_LINE" not in onb
    assert "function takeASeat" not in onb
    assert "rearmSeatPrefill" not in onb


def test_producers_open_with_a_hidden_kickoff_after_the_image():
    onb = _read("static", "js", "orwellOnboarding.js")
    seg = onb[onb.index("window._orwellOpenGameAfterCasting"):]
    seg = seg[: seg.index("\n  };")]
    # the producers reach out first: the kickoff auto-sends with the user bubble HIDDEN, so the
    # first VISIBLE message is the producers' — the player never types the opening word
    assert "setHideUserBubble" in seg
    assert "handleChatSubmit" in seg
    # fired once, game-build only, never over the player's own typing or an in-flight stream
    assert "_openSent" in seg
    assert "data-game-build" in seg
    assert "value.trim()" in seg
    assert "hasActiveStream" in seg


def test_headshot_finalize_triggers_the_producers_open():
    js = _read("static", "js", "orwellHeadshot.js")
    # picking the casting headshot hands off to the producers' open
    assert "window._orwellOpenGameAfterCasting" in js
    assert "onCastingHeadshotChosen" in js


def test_the_kickoff_bubble_seam_exists_in_chat():
    js = _read("static", "js", "chat.js")
    assert "setHideUserBubble" in js
    assert "_hideUserBubble" in js


# ── 3. The WELCOME MODAL (kept as its own modal) ────────────────────────────────────────

def test_welcome_modal_is_its_own_modal_not_in_chat():
    onb = _read("static", "js", "orwellOnboarding.js")
    assert "function mountWelcome" in onb
    # it is a real dialog overlay (aria-modal), the same overlay machinery as the holding cards
    assert 'aria-modal", "true"' in onb
    # it greets and points at the FIRST step (the cast photo)
    assert "Welcome to the house" in onb
    assert "cast photo" in onb


def test_welcome_modal_shows_once_per_account_pregame():
    onb = _read("static", "js", "orwellOnboarding.js")
    # per-user persisted (E71 pattern) so it greets once, not every reload
    assert "orwell-welcome-seen" in onb
    assert "document.body.dataset.user" in onb or "document.body && document.body.dataset.user" in onb
    assert "welcomeSeen()" in onb and "markWelcomeSeen()" in onb
    # it is shown from route() only pre-game (started === false), after the model gate
    route = onb[onb.index("async function route"):]
    assert "if (!welcomeSeen())" in route
    assert "mountWelcome()" in route


def test_welcome_modal_sequenced_after_the_model_gate():
    onb = _read("static", "js", "orwellOnboarding.js")
    route = onb[onb.index("async function route"):]
    # the model gate (J4) returns BEFORE the welcome modal mounts — production needs a feed first
    assert route.index("anyModelConfigured") < route.index("mountWelcome()")
    assert "Production needs a feed source" in onb


def test_welcome_modal_hands_off_to_the_image_step():
    onb = _read("static", "js", "orwellOnboarding.js")
    seg = onb[onb.index("function mountWelcome"):]
    seg = seg[: seg.index("\n  }\n")]
    # the welcome's primary action proceeds (no data entry; it IS the welcome, not a blocker)
    assert "Add my cast photo" in seg
    # dismissing marks it seen and proceeds (the image step + chat lock are already underneath)
    assert "markWelcomeSeen()" in seg


# ── 4. OOBE resume after a restart still works ─────────────────────────────────────────

def test_incremental_casting_intake_persists_for_resume():
    # The engine persists the half-done casting intake (durable pre-game intake) so a restart
    # mid-OOBE resumes. The FE casting agent contract reflects that the engine OWNS the interview
    # state (what is captured / the next step) — the FE never re-asks what is on file.
    al = _read("src", "agent_loop.py")
    assert "CASTING_AGENT_PREAMBLE" in al
    assert "updateCasting" in al
    assert "casting status says what is already on file and the next" in al


def test_resume_reuses_the_fresh_session_fence_not_a_new_one_each_load():
    onb = _read("static", "js", "orwellOnboarding.js")
    # the fresh-session marker one-shots per interview, so a reload mid-OOBE never spawns extra
    # sessions (the F7 fence) — resume lands back in the same interview session
    assert "SEAT_TAKEN_KEY" in onb
    assert onb.count('sessionStorage.setItem(SEAT_TAKEN_KEY, "1")') == 1
    assert "function openFreshInterviewSession" in onb


def test_gate_recomputes_on_resume_signals():
    gate = _read("static", "js", "orwellChatGate.js")
    # on reload the gate re-derives from live state, and it tracks the game lifecycle so a resumed
    # OOBE re-locks (image not yet secured) or unlocks (already secured) correctly
    assert "ready(recompute)" in gate
    assert 'addEventListener("orwell:gamechanged", recompute)' in gate


def test_image_secured_signal_is_the_durable_finalized_intake():
    # "Secured" is the engine-durable finalized headshot (survives a restart), not a transient flag —
    # so a resumed OOBE with a photo already finalized stays unlocked.
    gate = _read("static", "js", "orwellChatGate.js")
    assert "finalized === true" in gate
    portraits = _read("src", "orwell_portraits.py")
    assert "def intake_status" in portraits
    assert '"finalized":' in portraits


# ── 5. The LIGHT-TOUCH guided first week (pacing only, no scripted rails) ───────────────

def test_first_week_pacing_is_brisker_but_engagement_gated():
    al = importlib.import_module("src.agent_loop")
    # week 1 uses a SHORTER staleness grace than the standard, so a lull on a settled beat seizes
    # the moment sooner — but it is strictly pacing (never changes WHAT gets nudged)
    assert al._FIRST_WEEK_GRACE_TURNS < al._ADVANCE_GRACE_TURNS
    assert al._effective_advance_grace("nobody") == al._ADVANCE_GRACE_TURNS  # default safe
    al._FIRST_WEEK_HINT["u1"] = True
    assert al._effective_advance_grace("u1") == al._FIRST_WEEK_GRACE_TURNS
    al._FIRST_WEEK_HINT.pop("u1", None)


def test_first_week_pacing_is_no_scripted_rails():
    src = _read("src", "agent_loop.py")
    # the first-week window is detected from the Vault-free state read the nudge block already does
    # (no extra fetch, no engine-authored content)
    assert "_FIRST_WEEK_HINT" in src
    assert "_effective_advance_grace" in src
    assert 'PACING ONLY' in src
    # the lull gate itself is unchanged — engaging play still never nudges
    assert "_player_turn_is_lull" in src
    assert "and _stale" in src


def test_premiere_tutorial_still_frames_the_first_week_lightly():
    # The FE premiere card (L31) is the light-touch companion: it sets the weekly-rhythm
    # expectation in week 1 without replacing the chat. Still present, still week-1 gated.
    js = _read("static", "js", "orwellPremiereTutorial.js")
    assert "week === 1" in js
    for beat in ("Meet the house", "HOH", "Nominations", "Veto", "Eviction"):
        assert beat in js
