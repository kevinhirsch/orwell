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
    # The setup wizard's onProceed ("Start casting") opens the fresh interview session then fires the
    # producers' kickoff — the season begins on the player's explicit confirm, not on feed-probe.
    onb = _read("static", "js", "orwellOnboarding.js")
    route = onb[onb.index("async function route"):]
    assert "const onProceed" in route
    assert "openFreshInterviewSession" in route
    assert "_orwellOpenGameAfterCasting" in route
    assert "mountSetup(onProceed)" in route


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


# ── 3. The SETUP WIZARD (pre-game model setup; replaces the verbose welcome modal) ──────
# Owner request (2026-06-23): set the LLM/models in a wizard-like step BEFORE the game starts,
# borrowing the Settings model controls, showing NO welcome data apart from the framing line
# "Production needs the feeds". And the premature-start bug: adding a feed used to start the
# season before the player could pick their models — now the season begins only on "Start casting".

def _setup_seg(onb):
    """The mountSetup function body (helper-robust slice: from the fn to the next top-level fn)."""
    start = onb.index("function mountSetup")
    end = onb.index("function openSettings", start)
    return onb[start:end]


def test_setup_wizard_is_its_own_modal_not_in_chat():
    onb = _read("static", "js", "orwellOnboarding.js")
    assert "function mountSetup" in onb
    # #709: it is a real dialog modal — RECREATED on the OrwellWindow kit (modal:true owns the
    # scrim + inert + focus-trap + aria-modal), the same overlay machinery as the holding cards.
    assert "OrwellWindowKit.create" in onb
    assert "modal: true" in onb
    # the ONLY welcome copy is the framing line; the rest is feed/model setup
    seg = _setup_seg(onb)
    assert "Production needs the feeds" in seg
    # the old verbose welcome copy is gone
    assert "Welcome to the house" not in onb


def test_setup_wizard_shows_on_every_fresh_season():
    # The wizard shows on EVERY fresh game/season (not once per account). The per-user seen-marker
    # only debounces page RELOADS within the same pre-game session; the restart entry points CLEAR
    # it so a new season sets up again.
    onb = _read("static", "js", "orwellOnboarding.js")
    assert "orwell-welcome-seen" in onb
    assert "document.body.dataset.user" in onb or "document.body && document.body.dataset.user" in onb
    assert "welcomeSeen()" in onb and "markWelcomeSeen()" in onb
    # the marker is cleared at restart so the wizard re-shows for a fresh season
    assert "function clearWelcomeSeen" in onb
    # _orwellMarkRestart clears it (both restart entry points call markRestart)
    mr = onb[onb.index("window._orwellMarkRestart"):]
    mr = mr[: mr.index("\n  };")]
    assert "clearWelcomeSeen()" in mr
    # it is shown from route() only pre-game (started === false), after the model gate
    route = onb[onb.index("async function route"):]
    assert "if (!welcomeSeen())" in route
    assert "mountSetup(onProceed)" in route


def test_setup_wizard_reshows_after_a_backend_reset_via_fresh_intake():
    # A BACKEND/host factory reset runs server-side and never reaches the FE restart hooks
    # (settings.js / orwellNewSeason.js), so the per-user marker can go stale and skip the wizard on
    # the new season's first open. route() detects a genuinely fresh casting (the engine intake is
    # empty — casting.known has no captured fields) with NO interview yet underway and clears the
    # stale marker so the wizard shows again — without re-popping on a same-session mid-interview reload.
    onb = _read("static", "js", "orwellOnboarding.js")
    route = onb[onb.index("async function route"):]
    assert "st.casting.known" in route
    assert "_intakeEmpty" in route and "!_conversationHasAssistantTurn()" in route
    assert "!_seatTakenBefore" not in route   # the per-tab seat-flag gate is retired
    # the stale marker is cleared so the wizard re-shows, BEFORE the !welcomeSeen() gate
    clear_at = route.index("clearWelcomeSeen()")
    gate_at = route.index("if (!welcomeSeen())")
    assert clear_at < gate_at


def test_setup_wizard_sequenced_after_the_model_gate():
    onb = _read("static", "js", "orwellOnboarding.js")
    route = onb[onb.index("async function route"):]
    # the model gate (J4) returns BEFORE the wizard mounts — production needs a feed first
    assert route.index("anyModelConfigured") < route.index("mountSetup(onProceed)")
    # the framing line (the user's exact phrase) is the J4 holding card title AND the wizard h1
    assert "Production needs the feeds" in onb
    assert "Production needs a feed source" not in onb


def test_setup_wizard_starts_only_on_explicit_confirm_not_on_feed_probe():
    # The PREMATURE-START FIX: the season begins on the wizard's "Start casting" button, NOT
    # automatically when a feed is probed. The kickoff (_orwellOpenGameAfterCasting) is reached
    # through onProceed, which fires from the Start button's dismiss — never from the model-change
    # listener (which only re-renders the wizard's model summary).
    onb = _read("static", "js", "orwellOnboarding.js")
    seg = _setup_seg(onb)
    assert "Start casting" in seg
    assert "data-ob-setup-start" in seg
    # the Start button gates on a resolved chat model (no narrator ⇒ disabled)
    assert "_startBtn" in seg and "disabled" in seg
    # dismissing marks it seen and runs onProceed (open the interview + producers' kickoff)
    assert "markWelcomeSeen()" in seg
    assert "onProceed && onProceed()" in seg
    # the model-change listener re-renders (refresh) but does NOT proceed/kickoff
    assert "orwell:models-changed" in seg and "refresh" in seg


def test_setup_wizard_borrows_the_settings_model_controls():
    # Owner request: copy the elements from the Settings page. The wizard shows the model summary
    # (read from the same projections the chatbox/Settings use) and a "Choose models" door into the
    # real Settings model controls — no parallel source of truth.
    onb = _read("static", "js", "orwellOnboarding.js")
    seg = _setup_seg(onb)
    assert "Choose models" in seg
    assert "data-ob-choose-models" in seg
    assert "openSettings" in seg
    # the summary is read from the chatbox/Settings projections, not a separate store
    assert "/api/default-chat" in onb
    assert "image_model" in onb
    # narrator + portrait model rows
    assert "Narrator model" in seg
    assert "Portrait model" in seg


# ── 3b. Auto-advance after the model is configured (no manual reload, no premature start) ──

def test_flow_re_renders_after_model_config_without_a_reload():
    # Once the player connects/changes a feed in Settings, the wizard must re-evaluate WITHOUT a page
    # reload — but it must NOT start the season (premature-start fix). models.js fires
    # orwell:models-changed on the none→some transition; onboarding listens.
    models = _read("static", "js", "models.js")
    assert "orwell:models-changed" in models
    assert "_modelsAvailable" in models       # the none→some guard
    onb = _read("static", "js", "orwellOnboarding.js")
    assert 'addEventListener("orwell:models-changed"' in onb
    # the re-route clears a stale holding card immediately (not on the 5s re-probe)
    assert "_reRouteAfterModelConfig" in onb
    assert "data-ob-holding" in onb           # only a holding card is auto-dismissed
    # the re-route ultimately calls route()
    seg = onb[onb.index("function _reRouteAfterModelConfig"):]
    seg = seg[: seg.index("\n  }")]
    assert "route()" in seg


def test_splash_tips_are_suppressed_during_onboarding():
    # The welcome splash's rotating gameplay tips + the "house is waiting" tagline must NOT show
    # during the setup wizard / cast-photo step (they bleed through behind the surface). A body flag
    # drives a CSS suppression.
    onb = _read("static", "js", "orwellOnboarding.js")
    assert "setOnboardingActive" in onb
    assert 'classList.toggle("ow-onboarding"' in onb
    # the wizard arms it on mount
    seg = _setup_seg(onb)
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
    # J3-09: tutorial now names the 15-HG gate instead of "Meet the house" as a rhythm phase.
    js = _read("static", "js", "orwellPremiereTutorial.js")
    assert "week === 1" in js
    assert "fifteen houseguests" in js  # the gate condition
    for beat in ("HOH", "Nominations", "Veto", "Eviction"):
        assert beat in js


def test_issue2_production_cues_filtered_by_one_shared_seam():
    # Issue 2 / J2-07: production cues ("(Production cue …)") must NEVER render as the player's "You"
    # bubble. They leaked because the skip lists DRIFTED — chat.js had the cue case, sessions.js's
    # session/archive renders didn't. Fix: ONE shared seam (chat.js isSkippableUserPrompt) used by
    # every history-render path, so they can't drift again.
    chat = _read("static", "js", "chat.js")
    assert "isSkippableUserPrompt: _isSkippableUserPrompt" in chat   # exposed on window.chatModule
    assert "(production cue" in chat.lower()                          # the envelope is matched
    sess = _read("static", "js", "sessions.js")
    # BOTH sessions.js render paths route through the shared seam (was: a hardcoded list missing cues)
    assert sess.count("window.chatModule.isSkippableUserPrompt") >= 2


def test_issue1_meta_strip_hidden_in_game_build():
    # Issue 1 / J1-22: the tok/s + context-% strip is an OOC dev artifact ("38.57 tok/s · 12% context")
    # that breaks immersion and confuses players after a reset — never render it in the game build.
    cr = _read("static", "js", "chatRenderer.js")
    dm = cr[cr.index("export function displayMetrics"):]
    head = dm[:dm.index("const responseTime")]   # the guard sits at the top, before any work
    assert "data-game-build" in head and "return" in head


def test_thing2_cast_photo_is_a_pill_not_an_auto_open():
    # Thing 2: the cast-photo box no longer AUTO-opens after the producer's opener — route() surfaces a
    # competition-style "Choose Your Character" pill; clicking it opens the box.
    hs = _read("static", "js", "orwellHeadshot.js")
    route = hs[hs.index("async function route"):]
    # route surfaces the pill as the reveal action and must NOT auto-call mount() (the box opens on
    # the pill click). Strip 'unmount' first so its substring 'mount(' isn't a false positive.
    assert "showPill();" in route
    assert "mount(" not in route.replace("unmount", "_um_")
    assert "Choose Your Character" in hs
    assert "orwell-choose-character" in hs
    # the pill's click is what opens the box
    pill = hs[hs.index("function showPill"):hs.index("function removePill")]
    assert "mount()" in pill and "hs-choose-btn" in pill


# ── 6. Welcome polish (#606 cluster: J1-31 focus ring, J1-10 desktop weight) + J1-30 producers copy ──

def test_welcome_ctas_have_a_focus_visible_ring():
    # J1-31 → #709: the onboarding CTAs are the journey's FIRST interactive elements and must carry a
    # visible keyboard-focus ring (WCAG 2.4.7). The bespoke .ob-btn focus CSS (keyed to --brand-color)
    # is GONE — the CTAs compose the element kit (.ow-btn / -secondary / -prominent), which OWNS the
    # focus-visible ring as one source of truth (neutral system-blue, never the theme red). The ring
    # lives in style.css's .ow-btn rules, not in this module.
    onb = _read("static", "js", "orwellOnboarding.js")
    assert "ow-btn" in onb
    assert "ow-btn-prominent" in onb     # the primary CTA
    assert "ow-btn-secondary" in onb     # the dismiss / secondary CTAs
    # the bespoke brand-keyed focus ring is retired
    assert ".ob-btn:focus-visible" not in onb


def test_primary_cta_uses_on_accent_token_not_hardcoded_white():
    # #709: the primary CTA is now the kit's .ow-btn-prominent — the kit owns its (legible, glass)
    # styling. The bespoke .ob-btn-primary { background: var(--red) } block (the dark-on-accent
    # anti-pattern this test once guarded) is DELETED, so there is no longer a hardcoded accent fill
    # in this module to contrast-check; the kit guarantees legibility.
    onb = _read("static", "js", "orwellOnboarding.js")
    assert "ow-btn-prominent" in onb
    assert ".ob-btn-primary {" not in onb           # the bespoke accent-fill block is gone
    assert "var(--red, #e06c75)" not in onb         # no red anywhere in the overlay


def test_welcome_card_scales_up_on_desktop():
    # J1-10 → #709: the card filled too little of a desktop viewport and read as under-confident. The
    # card is now the kit window (auto-sized to content); this module gives it a confident min-width on
    # wide screens (>=1024px). Mobile/narrow keeps the kit's max-width:64vw clamp.
    onb = _read("static", "js", "orwellOnboarding.js")
    assert "@media (min-width: 1024px)" in onb
    seg = onb[onb.index("@media (min-width: 1024px)"):]
    seg = seg[: seg.index("`") if "`" in seg else 400]
    assert ".ob-card" in seg and "min-width: 480px" in seg


def test_pre_token_wait_copy_is_in_universe_in_the_game_build():
    # J1-30: the pre-token wait (most visible right after "Start casting") read as OOC lag
    # ("Processing request…"). In the game build the GENERIC waiting stages get a production voice;
    # the literal strings remain as the non-game-build fallback.
    chat = _read("static", "js", "chat.js")
    assert "function _waitLabel" in chat
    # the in-universe copy is producers-framed and gated on the game build
    seg = chat[chat.index("function _waitLabel"):]
    seg = seg[: seg.index("\n  }")]
    assert "isGameBuild()" in seg
    assert "producers" in seg.lower()
    # the generic spinner stages route through the helper (with the literal fallback preserved)
    assert "_waitLabel('init', 'Initializing')" in chat
    assert "_waitLabel('waiting', 'Processing request')" in chat
    assert "_waitLabel('still', 'Still waiting for model')" in chat


def test_pre_token_copy_stays_consistent_with_producers_framing():
    # CONVENTION: the FE's in-universe "producers" voice must stay consistent with the engine-side
    # framing (apply_game_framing's PRE_GAME_PROMPT casts the show's voice as the PRODUCER). The
    # pre-token wait copy uses the same "producers" framing — no competing fiction.
    ch = _read("routes", "chat_helpers.py")
    assert "PRODUCER" in ch  # the pre-game framing voice
    chat = _read("static", "js", "chat.js")
    assert "producers" in chat[chat.index("function _waitLabel"):chat.index("function _waitLabel") + 600].lower()
