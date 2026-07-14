"""Casting / OOBE flow fixes (L1–L5) — SOURCE-PINS.

A live OOBE play-through surfaced a cluster of casting/headshot handoff bugs:

  L1 — the headshot studio rode up under the "orwell" header and covered the logo
       (the welcome-screen lifts the composer ~30vh; the casting card above it climbed
       into the header). Fixed by dropping the lift + capping the card while casting.
  L2 — the J4 "Open Settings" button only un-hid the sidebar (it clicked #rail-settings,
       which never opens the modal); and it was gated on `window._isAdmin`, which nothing
       sets, so it never rendered. Fixed: open via the real gear (#user-bar-settings) and
       gate on the real /api/auth/status probe.
  L3 — generated photos must show EXPANDED; the card must never auto-collapse on generate.
  L4 — picking a headshot must DISMISS the picker and hand off into the game, not park on
       "Make another"/"Remove" still covering the logo.
  L5 — after casting + headshot, the PRODUCERS open the show with the first message — the
       player never types the opening word.

These are wiring pins (JS/CSS-as-text); the behaviour is exercised by the browser smoke.
No fixture names — roles only.
"""

import json
import os
import shutil
import subprocess

import pytest

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC = os.path.join(FRONTEND, "static")


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


# ── L1: the studio never rides up under the header ──────────────────────────────────

def test_l1_casting_card_drops_the_welcome_lift_and_caps_height():
    css = _read("static", "css", "game-trim.css")
    # While the casting card is mounted, the welcome-active composer lift is dropped so the
    # card sits near the bottom (clear of the header).
    assert ".ow-casting-headshot-open" in css
    assert "welcome-active" in css and "chat-input-bar" in css
    js = _read("static", "js", "orwellHeadshot.js")
    # the card carries a max-height cap + internal scroll so it can never grow into the header
    assert "max-height" in js
    assert "ow-casting-headshot-open" in js  # the body flag is added on mount


def test_l1_body_flag_is_toggled_on_mount_and_unmount():
    js = _read("static", "js", "orwellHeadshot.js")
    assert 'classList.add("ow-casting-headshot-open")' in js
    assert 'classList.remove("ow-casting-headshot-open")' in js


# ── L2: the OOBE settings button actually opens settings ────────────────────────────

def test_l2_open_settings_prefers_the_real_gear_not_the_rail():
    js = _read("static", "js", "orwellOnboarding.js")
    # #rail-settings only un-hides the sidebar (app.js); the gear opens the modal. Prefer it.
    assert "user-bar-settings" in js
    # the gear is tried BEFORE the rail button in openSettings()
    open_fn = js[js.index("function openSettings"):]
    open_fn = open_fn[: open_fn.index("\n  }")]
    assert open_fn.index("user-bar-settings") < open_fn.index("rail-settings")


def test_l2_admin_gate_uses_the_real_probe_not_the_unset_global():
    js = _read("static", "js", "orwellOnboarding.js")
    # the live admin probe replaces the never-set window._isAdmin gate for the J4 surface
    assert "/api/auth/status" in js
    assert "async function isAdmin" in js
    assert "await isAdmin()" in js
    # #874: the J4 surface is now the no-feed notice — its "Open Settings" action + copy still
    # branch on the real probe result, not the dead global
    seg = js[js.index("async function showNoFeedNotice"):]
    seg = seg[: seg.index("\n  function openSettings")]
    assert "const admin = await isAdmin();" in seg
    assert "if (admin) {" in seg and '"Open Settings"' in seg


# ── L3: generated photos show expanded, never auto-collapse ─────────────────────────

def test_l3_studio_keeps_the_card_open_when_options_appear():
    js = _read("static", "js", "orwellHeadshot.js")
    assert "ensureOpen" in js
    # generate + the G32 restore-on-refresh path both re-assert open
    gen = js[js.index("async function studioGenerate"):]
    gen = gen[: gen.index("\n    }")]
    assert "ensureOpen()" in gen
    # P1 OOBE overhaul: the studio now mounts inside the OrwellWindow kit, whose .ow-body
    # scrolls internally (overflow:auto) — the casting window caps its body height so the
    # generated photos never grow the surface up into the header.
    assert "> .ow-body { max-height" in js


# ── L4: picking a headshot dismisses the picker and resumes the interview ─────────────

def test_l4_finalize_hands_off_instead_of_painting_the_finalized_state():
    js = _read("static", "js", "orwellHeadshot.js")
    # both finalize paths (studio finalize + library select) call the handoff and bail
    assert "onFinalized" in js
    assert "if (handoff()) return" in js
    # the host wires the handoff to unmount the box + record the step + resume the interview
    assert "onCastingHeadshotChosen" in js
    chosen = js[js.index("function onCastingHeadshotChosen"):]
    chosen = chosen[: chosen.index("\n  }")]
    # tear the WINDOW down and resume the interview (OOBE re-sequence: no longer "open the game")
    assert "teardownWindow()" in chosen
    assert "_orwellResumeAfterPhoto" in chosen
    assert "recordPhotoStep" in chosen


# ── L5: the producers send the first message automatically ──────────────────────────
# OOBE re-sequence (2026-06-20): the producers' kickoff now fires on WELCOME dismiss (route's
# onProceed), not on photo finalize. The photo finalize fires the SEPARATE resume cue.

def test_l5_producers_auto_open_the_game_on_welcome_dismiss():
    js = _read("static", "js", "orwellOnboarding.js")
    assert "window._orwellOpenGameAfterCasting" in js
    seg = js[js.index("window._orwellOpenGameAfterCasting"):]
    seg = seg[: seg.index("\n  };")]
    # #967 live re-fix: it AUTO-SENDS through the shared `_sendCueWithBackoff` kernel (the single cutover
    # from the prefill-only rule), which actually calls the hidden-cue seam — but retries on a busy
    # stream / unready seam instead of single-shot-dropping the opener.
    assert "_sendCueWithBackoff" in seg
    assert "OPEN_GAME_LINE" in seg
    # ...but only once, only on the game build
    assert "data-game-build" in seg
    assert "_openSent" in seg
    # the hidden-cue seam + the busy/typing guards live on the kernel
    kern = js[js.index("function _sendCueWithBackoff"):]
    kern = kern[: kern.index("\n  }\n")]
    assert "sendHiddenCue" in kern
    assert "value.trim()" in kern or "composerBusy" in kern
    assert "hasActiveStream" in kern


def test_l5_headshot_finalize_resumes_not_opens():
    js = _read("static", "js", "orwellHeadshot.js")
    # the photo box fires the resume cue (the opener already happened at welcome dismiss)
    assert "window._orwellResumeAfterPhoto" in js


# ── #969: the post-photo resume cue RETRIES while a stream is in flight (never silently dropped) ──
# Root cause: _orwellResumeAfterPhoto fired ONCE after 250ms and bailed silently if a stream was
# still settling at that tick (no retry) — so right after the producers' "send us a photo" turn the
# cue was dropped and the player had to type "continue".

def test_969_resume_cue_reschedules_on_active_stream_with_once_guard():
    js = _read("static", "js", "orwellOnboarding.js")
    seg = js[js.index("window._orwellResumeAfterPhoto"):]
    seg = seg[: seg.index("\n  };")]
    # #969 live re-fix: the resume now DISPATCHES through the shared `_sendCueWithBackoff` kernel, which
    # re-schedules (backoff) rather than dropping when a stream is busy OR the send seam isn't ready yet.
    assert "_sendCueWithBackoff" in seg, (
        "the resume cue must dispatch through the retrying _sendCueWithBackoff kernel"
    )
    # a once-guard makes a retry idempotent so it can never double-fire if the stream ends mid-retry
    assert "_resumeSent" in seg
    # stays game-build-only
    assert "data-game-build" in seg
    # The shared kernel carries the actual retry mechanism: it re-schedules on a busy stream OR an
    # unready seam, capped, and yields to the player mid-thought. Pin those on the kernel itself.
    kern = js[js.index("function _sendCueWithBackoff"):]
    kern = kern[: kern.index("\n  }\n")]
    assert "setTimeout" in kern
    assert "_CUE_MAX_ATTEMPTS" in kern
    assert "hasActiveStream" in kern
    assert "composerBusy" in kern or "value.trim()" in kern
    # the busy / unready-seam branch re-schedules (backoff), it does NOT silently drop
    assert "attempt(n + 1)" in kern
    # the new robustness: an unready send seam (chatModule not bound yet) is treated as transient
    # (re-schedule), the exact permanent-drop gap that left the live resume un-fired
    assert "seamReady" in kern


def _node_drive_resume(script_body):
    """Run the real orwellOnboarding.js IIFE under Node with a controllable virtual clock + DOM stub,
    then execute `script_body` (which drives _orwellResumeAfterPhoto and prints a JSON result)."""
    node = shutil.which("node")
    if not node:
        pytest.skip("node not available for the behavioral resume-cue check")
    mod = os.path.join(STATIC, "js", "orwellOnboarding.js").replace("\\", "/")
    harness = (
        "globalThis.window = globalThis;\n"
        "globalThis.matchMedia = () => ({ matches: false });\n"
        # A controllable virtual clock: setTimeout queues {fn, due}; tick(ms) fires everything due.
        "let _now = 0; let _timers = []; let _id = 1;\n"
        "globalThis.setTimeout = (fn, ms) => { const id=_id++; _timers.push({id, fn, due:_now+(ms||0)}); return id; };\n"
        "globalThis.clearTimeout = (id) => { _timers = _timers.filter(t => t.id !== id); };\n"
        "function tick(ms){ _now += ms; "
        "  for (let guard=0; guard<10000; guard++){ "
        "    const ready = _timers.filter(t => t.due <= _now).sort((a,b)=>a.due-b.due); "
        "    if (!ready.length) break; const t = ready[0]; "
        "    _timers = _timers.filter(x => x.id !== t.id); try { t.fn(); } catch(_){} } }\n"
        "globalThis.tick = tick;\n"
        # A composer box + a chatModule whose stream-busy + cue-sends are observable.
        "let _composerValue = '';\n"
        "const box = { get value(){return _composerValue;}, set value(v){_composerValue=v;}, "
        "  focus(){}, dispatchEvent(){} };\n"
        "let _cues = [];\n"
        # CASTING-RESUME-HANG Fix 2 — the stub now models the REAL chat.js contract: hasActiveStream
        # HONORS its sessionId argument (compares against the live _streamSessionId, null when idle), and
        # there is a sessionModule.getCurrentSessionId() the onboarding streamBusy() guard must consult. A
        # BARE hasActiveStream() (the dead-guard regression) reads undefined !== the current session and is
        # permanently false — so this stub can't silently mask that rot anymore.
        "const _CURRENT_SESSION = 'casting-session';\n"
        "let _streamSessionId = null;\n"
        "globalThis.chatModule = { "
        "  hasActiveStream: (sessionId) => _streamSessionId != null && _streamSessionId === sessionId, "
        "  sendHiddenCue: (line) => { _cues.push(line); } };\n"
        "globalThis.sessionModule = { getCurrentSessionId: () => _CURRENT_SESSION };\n"
        "globalThis.window.sessionModule = globalThis.sessionModule;\n"
        # setStreamBusy(true) marks the CURRENT session's stream in flight; false clears it (idle → null).
        "globalThis.setStreamBusy = (b) => { _streamSessionId = b ? _CURRENT_SESSION : null; };\n"
        "globalThis.setComposer = (v) => { _composerValue = v; };\n"
        "globalThis.getCues = () => _cues.slice();\n"
        "const byId = { message: box };\n"
        "globalThis.localStorage = { _d:{}, getItem(k){return this._d[k]||null;}, "
        "  setItem(k,v){this._d[k]=String(v);}, removeItem(k){delete this._d[k];} };\n"
        "globalThis.document = {\n"
        "  head: { appendChild(){}, },\n"
        "  body: { dataset:{}, classList:{ add(){}, remove(){}, toggle(){} }, "
        "    hasAttribute: (a) => a === 'data-game-build', "
        "    style:{ setProperty(){}, removeProperty(){} } },\n"
        "  getElementById: (id) => byId[id] || null,\n"
        "  querySelector: () => null, createElement: () => ({ style:{}, setAttribute(){}, "
        "    addEventListener(){}, appendChild(){}, classList:{add(){},remove(){}} }),\n"
        "  addEventListener(){}, readyState:'complete',\n"
        "};\n"
        "globalThis.window.chatModule = globalThis.chatModule;\n"
        "globalThis.addEventListener = () => {};\n"
        "globalThis.removeEventListener = () => {};\n"
        "globalThis.CustomEvent = function(){};\n"
        "globalThis.dispatchEvent = () => {};\n"
        # The window kit: route()'s fail-open path (engine unreachable) mounts a holding card; stub a
        # no-op kit so that path never crashes the harness (we only care about the resume cue here).
        "globalThis.window.OrwellWindowKit = { create: () => ({ open(){}, close(){}, destroy(){}, el:{ "
        "  id:'', setAttribute(){}, addEventListener(){}, focus(){}, querySelector(){return null;} } }) };\n"
        # fetch is only touched by route()/_orwellWarm; reject so the flow fails open quietly.
        "globalThis.fetch = () => Promise.reject(new Error('no-net'));\n"
        # swallow the route() fail-open async rejection so it never crashes the process.
        "process.on('unhandledRejection', () => {});\n"
        "import fs from 'node:fs';\n"
        f"const src = fs.readFileSync('{mod}', 'utf8');\n"
        "(0, eval)(src);\n"
    )
    proc = subprocess.run(
        [node, "--input-type=module", "-e", harness + script_body],
        capture_output=True, text=True, timeout=30,
    )
    assert proc.returncode == 0, f"node failed: {proc.stderr}"
    return json.loads(proc.stdout)


def test_969_resume_cue_retries_and_fires_after_stream_ends():
    # Stream is BUSY when the cue first fires → it must NOT drop; it must RE-SCHEDULE and fire once
    # the stream settles. (The exact bug: at 250ms the photo-prompt turn was still streaming.)
    out = _node_drive_resume(
        "globalThis.setStreamBusy(true);\n"
        "globalThis.window._orwellResumeAfterPhoto();\n"
        "globalThis.tick(250);\n"           # first attempt — stream busy, must re-schedule (not drop)
        "const afterFirst = globalThis.getCues().length;\n"
        "globalThis.tick(400);\n"           # backoff rung 1 — still busy
        "const afterBackoff = globalThis.getCues().length;\n"
        "globalThis.setStreamBusy(false);\n"  # the in-flight turn settles
        "globalThis.tick(2000);\n"          # a later backoff rung fires now → the cue lands
        "const afterSettle = globalThis.getCues();\n"
        "process.stdout.write(JSON.stringify({ afterFirst, afterBackoff, "
        "  fired: afterSettle.length, cue: afterSettle[0] || null }));\n"
    )
    assert out["afterFirst"] == 0, "the cue must NOT fire while the stream is busy"
    assert out["afterBackoff"] == 0, "the cue must keep waiting (re-schedule), never drop"
    assert out["fired"] == 1, "the cue must fire exactly once after the stream settles"
    assert out["cue"] and "casting interview" in out["cue"]


def test_969_resume_cue_never_double_fires_when_stream_ends_between_attempts():
    # The once-guard must hold even if a retry races the stream ending: many ticks → exactly ONE send.
    out = _node_drive_resume(
        "globalThis.setStreamBusy(true);\n"
        "globalThis.window._orwellResumeAfterPhoto();\n"
        "globalThis.tick(250);\n"
        "globalThis.tick(400);\n"
        "globalThis.setStreamBusy(false);\n"
        # drive a long virtual span so every queued backoff rung would fire if unguarded
        "for (let i=0;i<12;i++){ globalThis.tick(1000); }\n"
        "process.stdout.write(JSON.stringify({ fired: globalThis.getCues().length }));\n"
    )
    assert out["fired"] == 1, "the once-guard must prevent any double-fire across retries"


def test_969_resume_cue_yields_to_the_player_typing():
    # If the player is mid-thought (composer non-empty), the cue must never stomp it.
    out = _node_drive_resume(
        "globalThis.setComposer('my own message');\n"
        "globalThis.window._orwellResumeAfterPhoto();\n"
        "for (let i=0;i<6;i++){ globalThis.tick(1000); }\n"
        "process.stdout.write(JSON.stringify({ fired: globalThis.getCues().length }));\n"
    )
    assert out["fired"] == 0, "the resume cue must yield to the player's own typing"


# ── #967 / #969 LIVE re-fix: the cue retries when the SEND SEAM (window.chatModule) isn't ready ──
# Salvaged cold-start log: after setup completed, the producers' opener never fired (n_ai_msgs=0) and
# the player had to speak first; and the post-photo resume needed a manual "continue". Both were the
# SAME single-shot drop: the cue fired in one 250ms timeout and, if the send seam was momentarily
# unavailable (chatModule not yet bound on a fresh load) OR a stream was settling, it bailed with no
# retry. The shared `_sendCueWithBackoff` kernel now re-schedules on an unready seam too. These drive
# the REAL IIFE with the seam INITIALLY ABSENT, then bound, and prove the cue still lands exactly once.


def _node_drive_with_late_seam(trigger_call):
    """Drive the real orwellOnboarding.js IIFE where `window.chatModule` is ABSENT at first (the send
    seam isn't ready), can be installed later via setSeamReady(), and the stream is idle. `trigger_call`
    is the JS that invokes the cue under test (the opener or the resume). Returns the cues + the count
    captured before vs. after the seam is installed."""
    node = shutil.which("node")
    if not node:
        pytest.skip("node not available for the late-seam check")
    mod = os.path.join(STATIC, "js", "orwellOnboarding.js").replace("\\", "/")
    harness = (
        "globalThis.window = globalThis;\n"
        "globalThis.matchMedia = () => ({ matches: false });\n"
        "let _now = 0; let _timers = []; let _id = 1;\n"
        "globalThis.setTimeout = (fn, ms) => { const id=_id++; _timers.push({id, fn, due:_now+(ms||0)}); return id; };\n"
        "globalThis.clearTimeout = (id) => { _timers = _timers.filter(t => t.id !== id); };\n"
        "function tick(ms){ _now += ms; "
        "  for (let guard=0; guard<10000; guard++){ "
        "    const ready = _timers.filter(t => t.due <= _now).sort((a,b)=>a.due-b.due); "
        "    if (!ready.length) break; const t = ready[0]; "
        "    _timers = _timers.filter(x => x.id !== t.id); try { t.fn(); } catch(_){} } }\n"
        "globalThis.tick = tick;\n"
        "let _composerValue = '';\n"
        "const box = { get value(){return _composerValue;}, set value(v){_composerValue=v;}, "
        "  focus(){}, dispatchEvent(){} };\n"
        "let _cues = [];\n"
        "globalThis.getCues = () => _cues.slice();\n"
        # The send seam (window.chatModule) is ABSENT initially — exactly the fresh-load race where the
        # cue fires before chat.js has bound chatModule. Installing it later proves the retry waited.
        "globalThis.setSeamReady = () => { globalThis.chatModule = { hasActiveStream: () => false, "
        "  hideWelcomeScreen: () => {}, sendHiddenCue: (line) => { _cues.push(line); } }; "
        "  globalThis.window.chatModule = globalThis.chatModule; };\n"
        "const byId = { message: box };\n"
        "globalThis.localStorage = { _d:{}, getItem(k){return this._d[k]||null;}, "
        "  setItem(k,v){this._d[k]=String(v);}, removeItem(k){delete this._d[k];} };\n"
        # #chat-history has NO assistant turn so the opener's empty-conversation belts pass.
        "globalThis.document = {\n"
        "  head: { appendChild(){}, },\n"
        "  body: { dataset:{}, classList:{ add(){}, remove(){}, toggle(){} }, "
        "    hasAttribute: (a) => a === 'data-game-build', "
        "    style:{ setProperty(){}, removeProperty(){} } },\n"
        "  getElementById: (id) => byId[id] || null,\n"
        "  querySelector: () => null, createElement: () => ({ style:{}, setAttribute(){}, "
        "    addEventListener(){}, appendChild(){}, classList:{add(){},remove(){}} }),\n"
        "  addEventListener(){}, readyState:'complete',\n"
        "};\n"
        "globalThis.addEventListener = () => {};\n"
        "globalThis.removeEventListener = () => {};\n"
        "globalThis.CustomEvent = function(){};\n"
        "globalThis.dispatchEvent = () => {};\n"
        "globalThis.window.OrwellWindowKit = { create: () => ({ open(){}, close(){}, destroy(){}, el:{ "
        "  id:'', setAttribute(){}, addEventListener(){}, focus(){}, querySelector(){return null;} } }) };\n"
        # The opener awaits GET /api/orwell/game-session (converge) — resolve it to NOTHING bound so the
        # opener proceeds to dispatch; the warm POST resolves empty. The resume touches no fetch here.
        "globalThis.fetch = (url) => {\n"
        "  const u = String(url);\n"
        "  if (u.indexOf('/api/orwell/game-session') !== -1) return Promise.resolve({ ok:true, json:()=>Promise.resolve({ sessionId:null }) });\n"
        "  return Promise.resolve({ ok:true, json:()=>Promise.resolve({}) });\n"
        "};\n"
        "process.on('unhandledRejection', () => {});\n"
        "import fs from 'node:fs';\n"
        f"const src = fs.readFileSync('{mod}', 'utf8');\n"
        "(0, eval)(src);\n"
    )
    script = (
        trigger_call +
        # settle any awaited microtasks (the opener awaits converge), then the 250ms first attempt fires
        # with NO seam → it must re-schedule, NOT drop.
        "await (async () => { for (let i=0;i<20;i++){ await new Promise(r => setImmediate(r)); } })();\n"
        "globalThis.tick(250);\n"
        "for (let i=0;i<20;i++){ await new Promise(r => setImmediate(r)); }\n"
        "const beforeSeam = globalThis.getCues().length;\n"
        # now the send seam binds (chat.js loaded) — a backoff rung must fire the cue
        "globalThis.setSeamReady();\n"
        "for (let i=0;i<5;i++){ globalThis.tick(1000); "
        "  for (let j=0;j<10;j++){ } }\n"
        "const afterSeam = globalThis.getCues();\n"
        "process.stdout.write(JSON.stringify({ beforeSeam, fired: afterSeam.length, cue: afterSeam[0] || null }));\n"
    )
    proc = subprocess.run(
        [node, "--input-type=module", "-e", harness + script],
        capture_output=True, text=True, timeout=30,
    )
    assert proc.returncode == 0, f"node failed: {proc.stderr}"
    return json.loads(proc.stdout)


def test_967_opener_retries_until_the_send_seam_is_ready():
    # #967 LIVE root cause: the opener fired once at 250ms; if window.chatModule wasn't bound yet it
    # dropped the cue with no retry → the chat sat silent, the player spoke first. The kernel must
    # re-schedule on an unready seam and fire the opener once the seam binds.
    out = _node_drive_with_late_seam(
        "await globalThis.window._orwellOpenGameAfterCasting();\n")
    assert out["beforeSeam"] == 0, "the opener must NOT drop to a no-op while the send seam is unready"
    assert out["fired"] == 1, "the opener must fire exactly once after the send seam binds"
    assert out["cue"] and "casting interview" in out["cue"]


def test_969_resume_retries_until_the_send_seam_is_ready():
    # #969 LIVE root cause: the resume's earlier retry covered a busy stream but STILL permanently
    # dropped the cue (box.focus + latch sent) when the send seam was momentarily unavailable. The
    # kernel must treat an unready seam as transient and fire the resume once it binds.
    out = _node_drive_with_late_seam(
        "globalThis.window._orwellResumeAfterPhoto();\n")
    assert out["beforeSeam"] == 0, "the resume must NOT drop to a no-op while the send seam is unready"
    assert out["fired"] == 1, "the resume must fire exactly once after the send seam binds"
    assert out["cue"] and "casting interview" in out["cue"]


# ── #968: a transient, Vault-free seeding indicator during casting ──────────────────────────
# Root cause: cast seeding/pre-warm is kicked fire-and-forget when Settings closes, with NO
# player-visible signal — so the setup reads as frozen. We surface a non-blocking advisory toast
# off the prewarm-cast response (counts/flags only — Vault-free).

def test_968_seeding_indicator_is_wired_off_the_prewarm_response():
    js = _read("static", "js", "orwellOnboarding.js")
    # the prewarm-cast warm reads its response and surfaces the advisory indicator
    assert "_orwellShowSeedingIndicator" in js
    warm = js[js.index("function _orwellWarm"):]
    warm = warm[: warm.index("\n  }")]
    assert "prewarm-cast" in warm
    assert "_orwellShowSeedingIndicator" in warm
    ind = js[js.index("function _orwellShowSeedingIndicator"):]
    ind = ind[: ind.index("\n  }\n")]
    # rendered via the OrwellNotice kit as an EPHEMERAL toast (advisory, auto-dismissing)
    assert "OrwellNoticeKit" in ind
    assert "toast" in ind
    assert "autoDismissMs" in ind
    # advisory copy + Vault-free (counts only, never identity/content); never a "dismissed forever" bit
    assert "getting the house ready" in ind
    assert "persistDismiss: false" in ind
    # it must NOT signal a game change (g15: the single dispatcher in platform.js owns that)
    assert "orwellGameChanged" not in ind
    assert "orwell:gamechanged" not in ind


def _node_drive_seeding(warmed_resp):
    """Drive the real route() pre-game path (started:false + a configured model) so the closure's
    _orwellWarm("prewarm-cast") fires, with the OrwellNotice kit loaded, and count toast mounts."""
    node = shutil.which("node")
    if not node:
        pytest.skip("node not available for the behavioral seeding-indicator check")
    mod = os.path.join(STATIC, "js", "orwellOnboarding.js").replace("\\", "/")
    kit = os.path.join(STATIC, "js", "orwellNotice.js").replace("\\", "/")
    script = (
        "globalThis.window = globalThis;\n"
        "globalThis.matchMedia = () => ({ matches: false });\n"
        "let toastMounts = 0;\n"
        "function mkEl(){ const children=[]; const el = { tagName:'DIV', id:'', className:'', "
        "  style:{}, dataset:{}, children, firstElementChild:null, "
        "  classList:{ add(){}, remove(){}, toggle(){}, contains(){return false;} }, "
        "  setAttribute(){}, getAttribute(){return null;}, removeAttribute(){}, "
        "  appendChild(c){ children.push(c); c.parentNode=el; if (el.id==='orwell-notice-toast') toastMounts++; return c; }, "
        "  insertBefore(c){ children.unshift(c); c.parentNode=el; return c; }, "
        "  addEventListener(){}, removeEventListener(){}, querySelector(){return null;}, "
        "  querySelectorAll(){return [];}, remove(){ this.parentNode=null; }, "
        "  get isConnected(){ return !!this.parentNode; }, focus(){}, "
        "  get innerHTML(){return '';}, set innerHTML(_v){} }; return el; }\n"
        "globalThis.Node = function(){};\n"   # OrwellNotice.setBody does `content instanceof Node`
        "const head = mkEl();\n"
        "const byId = {};\n"
        "globalThis.localStorage = { _d:{}, getItem(k){return this._d[k]||null;}, "
        "  setItem(k,v){this._d[k]=String(v);}, removeItem(k){delete this._d[k];} };\n"
        "globalThis.document = { head, "
        "  body:{ dataset:{}, classList:{add(){},remove(){},toggle(){}}, "
        "    hasAttribute:(a)=>a==='data-game-build', appendChild(c){c.parentNode=globalThis.document.body; return c;}, children:[], "
        "    style:{ setProperty(){}, removeProperty(){} } }, "
        "  getElementById:(id)=>byId[id]||null, querySelector:()=>null, "
        "  createElement:()=>mkEl(), addEventListener(){}, readyState:'complete' };\n"
        "globalThis.addEventListener = () => {};\n"
        "globalThis.removeEventListener = () => {};\n"
        "globalThis.CustomEvent = function(){};\n"
        "globalThis.dispatchEvent = () => {};\n"
        "globalThis.ResizeObserver = function(){ return { observe(){}, disconnect(){} }; };\n"
        # the setup wizard mounts on the window kit; stub a no-op kit so the pre-game path runs cleanly.
        "globalThis.window.OrwellWindowKit = { create: () => ({ open(){}, close(){}, destroy(){}, "
        "  el:{ id:'', setAttribute(){}, addEventListener(){}, focus(){}, querySelector(){return null;}, "
        "  querySelectorAll(){return [];} } }) };\n"
        "globalThis.sessionStorage = { _d:{}, getItem(k){return this._d[k]||null;}, "
        "  setItem(k,v){this._d[k]=String(v);}, removeItem(k){delete this._d[k];} };\n"
        # virtual setTimeout so the toast's auto-dismiss timer never blocks the process
        "globalThis.setTimeout = () => 0; globalThis.clearTimeout = () => {};\n"
        # fetch routes the pre-game flow: started:false + a configured model → route reaches the
        # prewarm-cast warm, whose response drives the seeding indicator.
        f"const _warm = {json.dumps(warmed_resp)};\n"
        "globalThis.fetch = (url) => {\n"
        "  const u = String(url);\n"
        "  if (u.indexOf('/api/orwell/state') !== -1) return Promise.resolve({ ok:true, json:()=>Promise.resolve({ started:false, casting:{ known:{} } }) });\n"
        "  if (u.indexOf('/api/models') !== -1) return Promise.resolve({ ok:true, json:()=>Promise.resolve({ items:[{ models:['m'], offline:false }] }) });\n"
        "  if (u.indexOf('/api/orwell/game-session') !== -1) return Promise.resolve({ ok:true, json:()=>Promise.resolve({}) });\n"
        "  if (u.indexOf('prewarm-cast') !== -1) return Promise.resolve({ ok:true, json:()=>Promise.resolve(_warm) });\n"
        "  return Promise.resolve({ ok:true, json:()=>Promise.resolve({}) });\n"
        "};\n"
        "process.on('unhandledRejection', () => {});\n"
        "import fs from 'node:fs';\n"
        f"(0, eval)(fs.readFileSync('{kit}', 'utf8'));\n"          # window.OrwellNoticeKit
        f"(0, eval)(fs.readFileSync('{mod}', 'utf8'));\n"          # runs ready(route) → the pre-game warm
        # let the async route()/warm/indicator chain settle.
        "for (let i=0;i<20;i++){ await new Promise(r => setImmediate(r)); }\n"
        "process.stdout.write(JSON.stringify({ toastMounts }));\n"
    )
    proc = subprocess.run(
        [node, "--input-type=module", "-e", script],
        capture_output=True, text=True, timeout=30,
    )
    assert proc.returncode == 0, f"node failed: {proc.stderr}"
    return json.loads(proc.stdout)


def test_968_seeding_indicator_renders_during_casting_when_warm_engaged():
    # A warmed prewarm-cast response (a model is wired, seeding engaged) surfaces the advisory toast
    # during the setup wizard / first casting turn — so the setup never reads as frozen.
    out = _node_drive_seeding({"warmed": True, "count": 15})
    assert out["toastMounts"] >= 1, "a warmed seeding response must surface the advisory toast"


def test_968_seeding_indicator_silent_when_no_model_wired():
    # No model wired (warmed:false) → there is nothing to wait on; the deterministic floor stands and
    # no indicator should appear.
    out = _node_drive_seeding({"warmed": False, "count": 0})
    assert out["toastMounts"] == 0, "no model wired (warmed:false) must show NO indicator"


# ── CASTING-RESUME-HANG Fix 1: a SOFT season restart (no page reload) must re-arm the cue latches ──
# `_openSent` (producers' opener) and `_resumeSent` (post-photo resume) are MODULE-LEVEL once-guards.
# "Reset this season" / next-season is a soft SPA restart with NO reload, so left set they stay `true`
# forever → season 2+ the opener AND the resume cue never fire and the casting interview HANGS.

def test_soft_restart_rearms_the_post_photo_resume_cue():
    # Fails-before: without the _resumeSent reset in _orwellMarkRestart, afterS2 stays 1 (the season-2
    # resume never re-fires). Passes-after: the soft restart re-arms the latch and the cue fires again.
    out = _node_drive_resume(
        # Season 1: the resume cue fires once and latches _resumeSent = true.
        "globalThis.window._orwellResumeAfterPhoto();\n"
        "globalThis.tick(250);\n"
        "const afterS1 = globalThis.getCues().length;\n"
        # A duplicate resume in the SAME (season-1) session must be a NO-OP (the once-guard holds).
        "globalThis.window._orwellResumeAfterPhoto();\n"
        "globalThis.tick(2000);\n"
        "const afterS1Dup = globalThis.getCues().length;\n"
        # A soft restart (season 2) — NO page reload — must re-arm the latch so the resume fires again.
        "globalThis.window._orwellMarkRestart();\n"
        "globalThis.window._orwellResumeAfterPhoto();\n"
        "globalThis.tick(250);\n"
        "const afterS2 = globalThis.getCues().length;\n"
        "process.stdout.write(JSON.stringify({ afterS1, afterS1Dup, afterS2 }));\n"
    )
    assert out["afterS1"] == 1, "the season-1 resume must fire once"
    assert out["afterS1Dup"] == 1, "a duplicate resume in the same season must NOT re-fire (latch holds)"
    assert out["afterS2"] == 2, "after a soft restart the resume cue must fire AGAIN (latch re-armed)"


def test_mark_restart_rearms_both_soft_restart_latches():
    # Source-pin: _orwellMarkRestart must clear BOTH module-level cue latches (opener + resume) — the
    # opener re-arm has no clean synchronous harness drive, so pin it here alongside the resume.
    js = _read("static", "js", "orwellOnboarding.js")
    seg = js[js.index("window._orwellMarkRestart"):]
    seg = seg[: seg.index("\n  };")]
    assert "_openSent = false" in seg, "the producers' opener latch must re-arm on a soft restart"
    assert "_resumeSent = false" in seg, "the post-photo resume latch must re-arm on a soft restart"


# ── CASTING-RESUME-HANG Fix 2: the stream-busy guard must consult the LIVE session id (not a bare call) ──

def test_stream_busy_guard_passes_the_live_session_id_not_a_bare_call():
    # chat.js hasActiveStream(sessionId) compares _streamSessionId === sessionId (null when idle), so a
    # BARE hasActiveStream() compared against `undefined` and was PERMANENTLY false — a dead guard. The
    # fix must pass the live current-session id so the "defer the cue while a stream is in flight" branch
    # actually works. (The behavioral proof rides the arg-honoring stub above: the #969 stream-busy tests
    # only pass because streamBusy now hands hasActiveStream the real session id.)
    js = _read("static", "js", "orwellOnboarding.js")
    seg = js[js.index("const streamBusy = ()"):]
    seg = seg[: seg.index("\n    };")]
    assert "getCurrentSessionId" in seg, "the guard must read the live current-session id"
    assert "hasActiveStream(sid)" in seg, "the guard must pass the session id into hasActiveStream"
    assert "hasActiveStream()" not in seg, "the bare no-arg call was the dead guard — never reintroduce it"


# ── CASTING-RESUME-HANG Fix 3: a reasoning-only casting turn (empty visible reply) fires ONE re-prompt ──
# NEEDS LIVE-MODEL VERIFY on prod (the stubbed gates never produce a real reasoning-only completion).
# The deterministic coverage below exercises the pure predicate's truth table + pins the finalize wiring.

def _eval_casting_reprompt_predicate(cases):
    """Slice the PURE _isCastingEmptyReplyReprompt predicate out of chatReconcile.js (which otherwise
    imports browser-only modules) and run it under bare Node against `cases` — no browser, no live
    stream. Returns the boolean the predicate yields for each case."""
    node = shutil.which("node")
    if not node:
        pytest.skip("node not available for the casting re-prompt predicate check")
    src = _read("static", "js", "chatReconcile.js")
    i = src.index("export function _isCastingEmptyReplyReprompt(")
    # anchor on the END of the single-return body (…=== '');\n  }) — NOT the first "\n  }", which is the
    # `} = {}` destructuring default in the signature.
    j = src.index("');\n  }", i) + len("');\n  }")
    fn = src[i:j].replace("export function", "function", 1)
    harness = (
        fn + "\n"
        f"const cases = {json.dumps(cases)};\n"
        "process.stdout.write(JSON.stringify(cases.map((c) => _isCastingEmptyReplyReprompt(c))));\n"
    )
    proc = subprocess.run(
        [node, "--input-type=module", "-e", harness],
        capture_output=True, text=True, timeout=15,
    )
    assert proc.returncode == 0, f"node failed: {proc.stderr}"
    return json.loads(proc.stdout)


def test_casting_empty_reply_reprompt_predicate_truth_table():
    base = dict(gameBuild=True, seasonStarted=False, sawDone=True, cancelled=False,
                usedTools=False, producedVisible=False, visibleReply="", hadReasoning=True,
                alreadyReprompted=False)

    def m(**over):
        d = dict(base)
        d.update(over)
        return d

    cases = [
        m(),                                     # 0: THE hang — casting, clean [DONE], reasoning, empty reply, no tools → fire
        m(visibleReply="Welcome to the house"),  # 1: a real producer line landed → don't fire
        m(seasonStarted=True),                   # 2: in-game (season started) — scoped OUT of casting
        m(gameBuild=False),                      # 3: non-game build → never
        m(usedTools=True),                       # 4: a tool turn legitimately has no prose → don't fire
        m(producedVisible=True),                 # 5: image/ask_user/budget/error artifact → don't fire
        m(sawDone=False),                        # 6: thrown/interrupted (not a clean [DONE]) → handled elsewhere
        m(cancelled=True),                       # 7: user-cancelled → don't fire
        m(alreadyReprompted=True),               # 8: the one-shot latch is already spent → hard loop-guard
        m(visibleReply="   "),                   # 9: whitespace-only reply is still empty → fire
        m(hadReasoning=False),                   # 10: fully-silent turn (no reasoning) → clean-empty Retry path ONLY, don't fire
    ]
    out = _eval_casting_reprompt_predicate(cases)
    assert out == [True, False, False, False, False, False, False, False, False, True, False], out


def test_casting_empty_reply_reprompt_is_wired_and_bounded():
    recon = _read("static", "js", "chatReconcile.js")
    assert "export function _isCastingEmptyReplyReprompt(" in recon, "the casting re-prompt predicate must exist"
    js = _read("static", "js", "chat.js")
    assert "_isCastingEmptyReplyReprompt({" in js, "the finalize must consult the casting re-prompt predicate"
    seg = js[js.index("_isCastingEmptyReplyReprompt({"):]
    seg = seg[: seg.index("}, 50);")]
    # scoped to the casting register (game build + season NOT started), single-round (no tool node),
    # and keyed on the empty VISIBLE reply — not `accumulated` (which carries reasoning).
    assert "gameBuild: isGameBuild()" in seg
    assert "seasonStarted: isSeasonStarted()" in seg
    # `usedTools` reads the TURN-SCOPED flag, not `holder.querySelector('.agent-thread-node')`: the
    # tool rail is appended to `#chat-history` as a SIBLING of `holder`, so the DOM query always read
    # false and a tool-only casting turn could wrongly trip the re-prompt (P1 review, #1595). The flag
    # is declared with `_producedVisibleOutput` and set true in the tool_start branch.
    assert "usedTools: _usedToolsThisTurn" in seg
    assert "holder.querySelector('.agent-thread-node')" not in seg, \
        "the dead DOM query must not gate usedTools — the tool rail is a sibling of holder"
    assert "let _usedToolsThisTurn = false;" in js, "the turn-scoped tool flag must be declared"
    # the flag must actually flip on a tool call, or it would be a constant-false (same bug, hidden)
    _ts = js[js.index("else if (json.type === 'tool_start')"):]
    _ts = _ts[: _ts.index("_cancelThinkingTimer();")]
    assert "_usedToolsThisTurn = true" in _ts, "tool_start must set the turn-scoped tool flag"
    assert "visibleReply: _castingVisibleReply" in seg
    # reasoning-present gate — makes the casting re-prompt mutually exclusive with _isEmptyTurnNoSave
    # (which requires BLANK accumulated), so a fully-silent turn never trips both recoveries (#1595).
    assert "hadReasoning:" in seg
    assert "hadReasoning" in recon, "the predicate must accept a hadReasoning gate"
    assert "alreadyReprompted: _castingEmptyRepromptSent" in seg
    # a HARD one-shot: the latch is set BEFORE the deferred send, and the re-prompt only RE-ASKS the
    # model (a hidden cue) — it never engine-authors content.
    assert "_castingEmptyRepromptSent = true" in seg
    assert "handleChatSubmit(null, _CASTING_EMPTY_REPROMPT, { hideUserBubble: true })" in seg
    # the latch is cleared once a casting turn lands a visible reply (re-arm for a future genuine hang)
    assert "_castingEmptyRepromptSent = false" in js
    # the re-prompt line must NOT script content — it only nudges the model to continue in-character
    assert "_CASTING_EMPTY_REPROMPT" in js
