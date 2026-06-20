"""OOBE re-sequence (2026-06-20) — the welcome-first, photo-mid-interview onboarding flow.

The target flow, in order:
  1. Settings → LLM info (the model gate, J4).
  2. A WELCOME MODAL (its own modal, never folded into the chat) — shown on EVERY fresh game/season.
     Dismissing it opens the fresh interview session AND fires the producers' kickoff.
  3. The PRODUCERS reach out FIRST — the casting interview opens with a producer-initiated message
     (no player "start the conversation" pre-prompt), and the producers ask about the CAST PHOTO.
  4. The cast-photo box appears MID-interview (engine-gated on state.casting.missing including
     "castPhoto" + a rendered producer turn). It is OPTIONAL/skippable and does NOT lock the chat.
  5. The casting interview (the engine's character-creation moment → updateCasting → createCharacter).
  6. House entry + a LIGHT-TOUCH guided first week (the agent-loop pacing leans expeditious in week 1,
     NO scripted rails).

OOBE re-sequence reversed the OLD photo-FIRST, hard-locked flow: the chat is no longer locked for
the photo (orwellChatGate.js is retired to a no-op), the welcome shows every fresh season, and the
photo box follows the producers' question instead of preceding the interview.

These are source-pins (the FE pytest lane has no DOM runtime; the live DOM is covered by the
browser smoke). No fixture names — roles only.
"""
import importlib
import os

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*rel):
    with open(os.path.join(FRONTEND, *rel), encoding="utf-8") as f:
        return f.read()


# ── 1. The chat gate is RETIRED — the chat is never locked for the photo ─────────────────

def test_chat_gate_module_still_loads_before_onboarding():
    html = _read("static", "index.html")
    assert "orwellChatGate.js" in html
    # it still loads before onboarding so its (now-inert) public surface is present when the flow runs
    assert html.index("orwellChatGate.js") < html.index("orwellOnboarding.js")


def test_chat_gate_keeps_its_public_surface_for_callers():
    js = _read("static", "js", "orwellChatGate.js")
    # the public surface stays so every existing caller (chat.js / app.js / onboarding) keeps working
    assert "window._orwellChatGate" in js
    assert "blocked:" in js
    assert "recompute:" in js
    assert "notePhotoSecured:" in js


def test_chat_gate_recompute_is_a_fail_open_noop():
    # OOBE re-sequence: the photo lock is RETIRED. recompute() never raises the lock — it only ever
    # releases, so the chat is usable the instant the welcome is dismissed.
    js = _read("static", "js", "orwellChatGate.js")
    seg = js[js.index("async function recompute"):]
    seg = seg[: seg.index("\n  }")]
    assert "setBlocked(false)" in seg
    # it no longer probes pre-game/photo state to decide a lock
    assert "finalized === true" not in seg
    assert "started === false" not in seg


def test_chat_gate_never_raises_the_lock():
    js = _read("static", "js", "orwellChatGate.js")
    # the module header marks it RETIRED / a no-op, and the only setBlocked call is the false release
    assert "RETIRED" in js or "no-op" in js
    assert "setBlocked(true)" not in js


def test_image_step_offers_both_upload_and_generate():
    # The cast-photo box (now mid-interview, OPTIONAL) still lets the player pick HOW: upload a photo
    # OR generate with AI. The reusable headshot studio exposes both doors.
    js = _read("static", "js", "orwellHeadshot.js")
    assert "Use photo as-is" in js                 # upload path (exact)
    assert "Make AI studio portraits" in js        # generate path (studio)
    assert "/api/orwell/portrait/intake" in js


def test_photo_box_is_a_kit_window():
    # The cast-photo box composes the OrwellWindow kit (no bespoke chrome — the F-3 ratchet pins
    # this). It keeps no close/minimize chrome; its two exits are in-body (finalize or skip).
    js = _read("static", "js", "orwellHeadshot.js")
    assert "OrwellWindowKit.create(" in js
    assert "closable: false" in js
    assert "minimizable: false" in js
    assert 'title: "Your Cast Photo"' in js
    assert "icon: CAST_ICON" in js or "CAST_ICON" in js
    # the old collapsible-card chrome is gone (no chevron/head toggle)
    assert "hs-chev" not in js
    assert 'class="hs-head"' not in js


def test_photo_box_reveals_mid_interview_engine_gated():
    # OOBE re-sequence: the box is no longer the FIRST step — it appears MID-interview, gated on the
    # engine's casting status (state.casting.missing includes "castPhoto") AND a rendered producer
    # turn (.msg.msg-ai), so it FOLLOWS the producers' question and never auto-mounts at page load.
    js = _read("static", "js", "orwellHeadshot.js")
    route = js[js.index("async function route"):]
    assert "/api/orwell/state" in route
    assert "casting" in route and "missing" in route
    assert '"castPhoto"' in route or "'castPhoto'" in route
    assert "_conversationHasAssistantTurn" in route
    # it does not gate on the portrait intake finalized-flag anymore (that was the hard-gate signal)
    assert "finalized === true" not in route


def test_photo_box_clears_with_no_lingering_set_indicator():
    # Finalizing/skipping tears the window down, and the box paints NO persistent "set ✓" chip above
    # the composer — the summary callback is a no-op in this host (Settings keeps its chip).
    js = _read("static", "js", "orwellHeadshot.js")
    seg = js[js.index("function mount()"):]
    seg = seg[: seg.index("function onCastingHeadshotChosen")]
    assert "onSummary: function () {}" in seg
    # …and the window is destroyed on handoff (unmount → destroy)
    assert "_win.destroy()" in js


def test_photo_finalize_records_uploaded_and_resumes_the_interview():
    # Finalizing the photo records the step with the engine ({status:"uploaded"}) and resumes the
    # interview via the hidden resume cue (the producers acknowledge + continue).
    js = _read("static", "js", "orwellHeadshot.js")
    assert "/api/orwell/casting/photo" in js
    assert '"uploaded"' in js
    assert "_orwellResumeAfterPhoto" in js
    assert "orwell:avatarchanged" in js


def test_photo_box_offers_skip_for_now_only_in_the_pregame_box():
    # OOBE re-sequence: the photo is OPTIONAL — the pre-game box carries a "Skip for now" button that
    # records {status:"skipped"} and resumes the interview. Settings → Account (no onSkip) shows no
    # skip affordance.
    js = _read("static", "js", "orwellHeadshot.js")
    assert "Skip for now" in js
    # the skip button only renders when the host wires onSkip
    assert "canSkip" in js
    assert "hs-skip" in js
    # the pre-game casting mount wires onSkip; the studio (shared with Settings) gates the button on it
    mount = js[js.index("function mount()"):]
    mount = mount[: mount.index("function onCastingHeadshotChosen")]
    assert "onSkip:" in mount
    # skipping records {skipped} + resumes
    skipped = js[js.index("function onCastingPhotoSkipped"):]
    skipped = skipped[: skipped.index("\n  }")]
    assert "recordPhotoStep" in skipped
    assert "_orwellResumeAfterPhoto" in skipped
    assert '"skipped"' in js


# ── 2. The PRODUCERS reach out first (no player-start pre-prompt) ────────────────────────

def test_casting_seat_preprompt_is_gone():
    onb = _read("static", "js", "orwellOnboarding.js")
    # the removed pre-prompt + its helpers no longer exist anywhere
    assert "I take my seat for the casting interview." not in onb
    assert "SEAT_LINE" not in onb
    assert "function takeASeat" not in onb
    assert "rearmSeatPrefill" not in onb


def test_producers_open_with_a_hidden_kickoff_on_welcome_dismiss():
    # OOBE re-sequence: the kickoff fires when the WELCOME is dismissed (route()'s onProceed), not
    # after a photo. The producers reach out first: the kickoff auto-sends with the user bubble
    # HIDDEN via the synchronous hidden-cue seam, so the first VISIBLE message is the producers'.
    onb = _read("static", "js", "orwellOnboarding.js")
    seg = onb[onb.index("window._orwellOpenGameAfterCasting"):]
    seg = seg[: seg.index("\n  };")]
    assert "sendHiddenCue" in seg
    # fired once, game-build only, never over the player's own typing or an in-flight stream
    assert "_openSent" in seg
    assert "data-game-build" in seg
    assert "value.trim()" in seg
    assert "hasActiveStream" in seg
    # item 6: the welcome-active lift is cleared at send time so the composer docks immediately
    assert "hideWelcomeScreen" in seg


def test_welcome_dismiss_runs_the_kickoff():
    # The welcome's onProceed opens the fresh interview session then fires the producers' kickoff.
    onb = _read("static", "js", "orwellOnboarding.js")
    route = onb[onb.index("async function route"):]
    assert "const onProceed" in route
    assert "openFreshInterviewSession" in route
    assert "_orwellOpenGameAfterCasting" in route
    assert "mountWelcome(onProceed)" in route


def test_resume_cue_after_photo_exists():
    # OOBE re-sequence: after the photo is finalized/skipped, a SEPARATE hidden resume cue nudges
    # the producers to acknowledge and continue the interview.
    onb = _read("static", "js", "orwellOnboarding.js")
    assert "window._orwellResumeAfterPhoto" in onb
    seg = onb[onb.index("window._orwellResumeAfterPhoto"):]
    seg = seg[: seg.index("\n  };")]
    assert "sendHiddenCue" in seg
    assert "data-game-build" in seg
    assert "value.trim()" in seg
    assert "hasActiveStream" in seg


def test_headshot_finalize_triggers_the_resume_cue():
    js = _read("static", "js", "orwellHeadshot.js")
    # picking/finalizing the casting headshot records the step and resumes the interview
    assert "_orwellResumeAfterPhoto" in js
    assert "onCastingHeadshotChosen" in js


def test_the_hidden_cue_seam_exists_in_chat():
    js = _read("static", "js", "chat.js")
    # the synchronous hidden-cue seam: hides the bubble AND clears the composer in the same tick so
    # the cue text never flashes in the input
    assert "export function sendHiddenCue" in js
    assert "sendHiddenCue," in js   # exported on the chatModule public API
    assert "setHideUserBubble" in js
    assert "_hideUserBubble" in js


# ── 3. The WELCOME MODAL (kept as its own modal) ────────────────────────────────────────

def test_welcome_modal_is_its_own_modal_not_in_chat():
    onb = _read("static", "js", "orwellOnboarding.js")
    assert "function mountWelcome" in onb
    # it is a real dialog overlay (aria-modal), the same overlay machinery as the holding cards
    assert 'aria-modal", "true"' in onb
    # it greets and frames the casting interview (the producers reach out next)
    seg = onb[onb.index("function mountWelcome"):]
    seg = seg[: seg.index("\n  }\n")]
    assert "Welcome to the house" in seg
    assert "casting interview" in seg


def test_welcome_modal_shows_on_every_fresh_season():
    # OOBE re-sequence: the welcome shows on EVERY fresh game/season (not once per account). The
    # per-user seen-marker only debounces page RELOADS within the same pre-game session; the restart
    # entry points CLEAR it so a new season greets again.
    onb = _read("static", "js", "orwellOnboarding.js")
    assert "orwell-welcome-seen" in onb
    assert "document.body.dataset.user" in onb or "document.body && document.body.dataset.user" in onb
    assert "welcomeSeen()" in onb and "markWelcomeSeen()" in onb
    # the marker is cleared at restart so the welcome re-shows for a fresh season
    assert "function clearWelcomeSeen" in onb
    # _orwellMarkRestart clears it (both restart entry points call markRestart)
    mr = onb[onb.index("window._orwellMarkRestart"):]
    mr = mr[: mr.index("\n  };")]
    assert "clearWelcomeSeen()" in mr
    # it is shown from route() only pre-game (started === false), after the model gate
    route = onb[onb.index("async function route"):]
    assert "if (!welcomeSeen())" in route
    assert "mountWelcome(onProceed)" in route


def test_welcome_modal_sequenced_after_the_model_gate():
    onb = _read("static", "js", "orwellOnboarding.js")
    route = onb[onb.index("async function route"):]
    # the model gate (J4) returns BEFORE the welcome modal mounts — production needs a feed first
    assert route.index("anyModelConfigured") < route.index("mountWelcome(onProceed)")
    assert "Production needs a feed source" in onb


def test_welcome_modal_proceeds_into_the_interview():
    onb = _read("static", "js", "orwellOnboarding.js")
    seg = onb[onb.index("function mountWelcome"):]
    seg = seg[: seg.index("\n  }\n")]
    # the welcome's primary action proceeds (no data entry; it IS the welcome, not a blocker)
    assert "Meet the producers" in seg
    # dismissing marks it seen and runs onProceed (open the interview + producers' kickoff)
    assert "markWelcomeSeen()" in seg
    assert "onProceed && onProceed()" in seg


def test_welcome_modal_copy_drops_the_photo_first_framing():
    # OOBE re-sequence: the welcome no longer says the cast photo is "first up" — the producers reach
    # out first, and the photo comes mid-interview.
    onb = _read("static", "js", "orwellOnboarding.js")
    seg = onb[onb.index("function mountWelcome"):]
    seg = seg[: seg.index("\n  }\n")]
    assert "Welcome to the house" in seg
    assert "One house, sixteen strangers,\n          one winner — and production is watching everything." in seg
    # the photo-FIRST line is gone; the welcome frames the producers reaching out
    assert "First up: your cast photo" not in seg
    assert "they'll reach out the moment you're ready" in seg
    # the dropped ordered-list scaffolding is still gone
    assert "ob-steps" not in seg
    assert "ob-step-n" not in seg


# ── 3b. Auto-advance after the model is configured (no manual reload) ──────────────────

def test_flow_auto_advances_after_model_config_without_a_reload():
    # P1 OOBE overhaul (item 4): once the player configures an LLM model in Settings, the flow
    # must re-evaluate and proceed to the welcome modal WITHOUT a page reload. models.js fires
    # orwell:models-changed on the none→some transition; onboarding listens and re-runs route().
    models = _read("static", "js", "models.js")
    assert "orwell:models-changed" in models
    assert "_modelsAvailable" in models       # the none→some guard
    onb = _read("static", "js", "orwellOnboarding.js")
    assert 'addEventListener("orwell:models-changed"' in onb
    # the re-route clears a stale holding card immediately (not on the 5s re-probe)
    assert "_reRouteAfterModelConfig" in onb
    assert "data-ob-holding" in onb           # only a holding card is auto-dismissed
    # the re-route ultimately calls route() so the welcome modal opens
    seg = onb[onb.index("function _reRouteAfterModelConfig"):]
    seg = seg[: seg.index("\n  }")]
    assert "route()" in seg


def test_splash_tips_are_suppressed_during_onboarding():
    # P1 OOBE overhaul (item 3): the welcome splash's rotating gameplay tips + the "house is
    # waiting" tagline must NOT show during the welcome modal / cast-photo step (they bleed
    # through behind the surface). A body flag drives a CSS suppression.
    onb = _read("static", "js", "orwellOnboarding.js")
    assert "setOnboardingActive" in onb
    assert 'classList.toggle("ow-onboarding"' in onb
    # the welcome modal arms it on mount
    seg = onb[onb.index("function mountWelcome"):]
    seg = seg[: seg.index("\n  }\n")]
    assert "setOnboardingActive(true)" in seg
    css = _read("static", "css", "game-trim.css")
    # both onboarding flags hide the splash tip + tagline
    assert ".ow-onboarding #welcome-screen .welcome-tip" in css
    assert ".ow-casting-headshot-open #welcome-screen .welcome-tip" in css
    assert "welcome-sub" in css


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


def test_gate_keeps_its_resume_wiring_but_is_inert():
    gate = _read("static", "js", "orwellChatGate.js")
    # the wiring is intact (so callers/events don't break), but recompute is now a no-op that never
    # locks — a resumed OOBE is never re-locked for the photo
    assert "ready(recompute)" in gate
    assert 'addEventListener("orwell:gamechanged", recompute)' in gate
    assert "setBlocked(true)" not in gate


def test_photo_box_reveal_is_driven_by_the_engine_casting_status():
    # OOBE re-sequence: the box reveal is driven by the engine's casting status (state.casting.missing
    # includes "castPhoto"), not the portrait intake finalized-flag. The portrait route still exists
    # for the actual upload/generate, but it no longer gates anything.
    js = _read("static", "js", "orwellHeadshot.js")
    route = js[js.index("async function route"):]
    assert "casting" in route and "missing" in route
    assert '"castPhoto"' in route or "'castPhoto'" in route
    portraits = _read("src", "orwell_portraits.py")
    assert "def intake_status" in portraits


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
