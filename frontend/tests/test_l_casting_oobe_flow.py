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
    # the live admin probe replaces the never-set window._isAdmin gate for the J4 card
    assert "/api/auth/status" in js
    assert "async function isAdmin" in js
    assert "await isAdmin()" in js
    # the J4 button + copy branch on the probe result, not on the dead global
    assert "admin ? [{ label: \"Open Settings\"" in js


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
    # it AUTO-SENDS via the hidden-cue seam (this single cutover departs from the prefill-only rule)
    assert "sendHiddenCue" in seg
    # ...but only once, only on the game build, and never over the player's own typing /
    # an in-flight stream
    assert "data-game-build" in seg
    assert "_openSent" in seg
    assert "value.trim()" in seg
    assert "hasActiveStream" in seg


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
    # it RE-SCHEDULES (backoff) rather than dropping when a stream is busy
    assert "setTimeout" in seg
    assert "RESUME_MAX_ATTEMPTS" in seg
    # a once-guard makes a retry idempotent so it can never double-fire if the stream ends mid-retry
    assert "_resumeSent" in seg
    assert "hasActiveStream" in seg
    # still bails to the player when they're mid-thought, and stays game-build-only
    assert "value.trim()" in seg or "composerBusy" in seg
    assert "data-game-build" in seg
    # the original "return; // drop" on an active stream is GONE — the busy branch re-schedules
    busy = seg[seg.index("streamBusy"):]
    # the re-schedule lives inside the stream-busy handling
    assert "attempt(n + 1)" in busy


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
        "let _streamBusy = false; let _cues = [];\n"
        "globalThis.chatModule = { hasActiveStream: () => _streamBusy, "
        "  sendHiddenCue: (line) => { _cues.push(line); } };\n"
        "globalThis.setStreamBusy = (b) => { _streamBusy = !!b; };\n"
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
