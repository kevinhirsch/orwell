"""#987 — a duplicate empty "Casting interview" session must NOT be minted mid-interview on a fresh
surface.

Root cause (confirmed; not re-investigated here): a FRESH surface (a 2nd tab/device, or a reloaded
tab) boots pre-game and routes through `_orwellOpenGameAfterCasting` (orwellOnboarding.js), which
fires the casting kickoff `sendHiddenCue(OPEN_GAME_LINE)`. That hidden-cue send MATERIALIZES a NEW
session row (name "Casting interview", mode=null, 0 msgs) BEFORE `loadSessions()`'s canonical-game
ladder re-points to the REAL bound session — orphaning that new row (0 msgs, mode=null,
lastAccessed==createdAt). The race window is between the row-insert and the canonical re-point.

The fix (FE-only, orwellOnboarding.js ONLY): in `_orwellOpenGameAfterCasting`, BEFORE firing the
kickoff / materializing a session, `await _convergeOnCanonicalGame()` and BAIL (do not send the cue,
do not materialize a session) if it resolves a bound canonical game session — so a fresh surface
RESUMES the canonical game instead of minting a second per-tab identity. The existing
`_openSent` / `SEAT_TAKEN_KEY` guards stay intact; this ADDS a canonical-exists guard.

This file pins the guard as source (the await-converge-then-bail ordering) AND drives the REAL
orwellOnboarding.js IIFE under node to prove the behaviour: with a canonical bound game session, the
opener cue is NOT sent (it converges); with NOTHING bound, the opener cue still fires (no regression).
No fixture names — roles only; g15 respected (no ad-hoc orwell:gamechanged dispatch).
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


# ── source pins: the canonical-exists guard is wired into the opener, ordered BEFORE the cue ──

def test_987_opener_awaits_converge_and_bails_before_sending_the_cue():
    js = _read("static", "js", "orwellOnboarding.js")
    seg = js[js.index("window._orwellOpenGameAfterCasting"):]
    seg = seg[: seg.index("\n  };")]
    # the opener is async (it must await the canonical probe before deciding to fire)
    assert "_orwellOpenGameAfterCasting = async function" in js
    # it AWAITS the canonical-game convergence and BAILS when one resolves (never sends the cue)
    assert "await _convergeOnCanonicalGame()" in seg, (
        "the opener must await the canonical-game probe before firing the kickoff"
    )
    # the converge+bail happens BEFORE the OPEN_GAME_LINE cue is dispatched (ordering is the whole fix).
    # #967 live re-fix: the actual send now routes through the shared `_sendCueWithBackoff` kernel, so the
    # opener DISPATCHES the cue via `_sendCueWithBackoff({ line: OPEN_GAME_LINE … })` (the literal
    # `sendHiddenCue(OPEN_GAME_LINE)` moved into the kernel). The ordering invariant is unchanged: the
    # canonical-exists converge must precede the cue dispatch.
    converge_at = seg.index("await _convergeOnCanonicalGame()")
    cue_at = seg.index("OPEN_GAME_LINE")
    assert converge_at < cue_at, (
        "the canonical-exists guard must run BEFORE the kickoff cue, or the duplicate session is "
        "already materialized by the time we converge (the exact #987 race)"
    )
    # the opener dispatches through the robust backoff kernel (the live re-fix), not a single-shot send
    assert "_sendCueWithBackoff" in seg, (
        "the opener must dispatch the cue through the retrying _sendCueWithBackoff kernel so a busy "
        "stream / unready send seam re-schedules instead of single-shot-dropping (#967 live re-fix)"
    )
    # references the issue for traceability, and keeps the existing once/seat guards intact
    assert "#987" in seg
    assert "_openSent" in seg
    assert "SEAT_TAKEN_KEY" in js  # the per-tab seat guard is untouched


def test_987_no_ad_hoc_gamechanged_dispatch():
    # g15: the ONLY orwell:gamechanged dispatcher is orwellGameChanged() in platform.js. The #987
    # guard must NOT add an ad-hoc gamechanged dispatch.
    js = _read("static", "js", "orwellOnboarding.js")
    seg = js[js.index("window._orwellOpenGameAfterCasting"):]
    seg = seg[: seg.index("\n  };")]
    assert "orwell:gamechanged" not in seg
    assert "new CustomEvent('orwell:gamechanged')" not in seg


# ── behavioral: drive the REAL IIFE under node, with a controllable canonical-binding probe ──

def _node_drive_opener(bound_session_id, session_known=False):
    """Run the real orwellOnboarding.js IIFE under node with a DOM/fetch/session stub, then call
    _orwellOpenGameAfterCasting and report whether the opener cue was sent and whether the canonical
    session was selected (converged). `bound_session_id` controls what GET /api/orwell/game-session
    returns (a string ⇒ a canonical game is already bound; None ⇒ nothing bound). `session_known`
    controls whether getSessions() already lists the bound id — _convergeOnCanonicalGame only
    selectSession()s a KNOWN session, but its boolean return (which the #987 guard reads) is true on
    ANY bound id, known or not."""
    node = shutil.which("node")
    if not node:
        pytest.skip("node not available for the behavioral opener check")
    mod = os.path.join(STATIC, "js", "orwellOnboarding.js").replace("\\", "/")
    bound_js = json.dumps(bound_session_id)
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
        # The composer box + a chatModule whose cue-sends are observable; no active stream.
        "let _composerValue = '';\n"
        "const box = { get value(){return _composerValue;}, set value(v){_composerValue=v;}, "
        "  focus(){}, dispatchEvent(){} };\n"
        "let _cues = [];\n"
        "globalThis.chatModule = { hasActiveStream: () => false, "
        "  hideWelcomeScreen: () => {}, "
        "  sendHiddenCue: (line) => { _cues.push(line); } };\n"
        "globalThis.getCues = () => _cues.slice();\n"
        # The session module: observe selectSession (the in-place convergence action). When
        # session_known is false getSessions returns [] so the `known` flag is FALSE — proving the
        # guard works off _convergeOnCanonicalGame's BOOLEAN (a bound id) even when the session isn't
        # yet in getSessions(). When session_known is true, the bound id is listed and selectSession()
        # fires (the in-place resume).
        f"const _known = {json.dumps(bool(session_known))};\n"
        f"const _boundForList = {json.dumps(bound_session_id)};\n"
        "let _selected = [];\n"
        "globalThis.window.sessionModule = { "
        "  getSessions: () => (_known && _boundForList ? [{ id:_boundForList }] : []), "
        "  getCurrentSessionId: () => null, "
        "  selectSession: (id) => { _selected.push(id); return Promise.resolve(); } };\n"
        "globalThis.getSelected = () => _selected.slice();\n"
        "const byId = { message: box };\n"
        "globalThis.localStorage = { _d:{}, getItem(k){return this._d[k]||null;}, "
        "  setItem(k,v){this._d[k]=String(v);}, removeItem(k){delete this._d[k];} };\n"
        # #chat-history has NO assistant turn (a fresh surface) so the empty-conversation belts pass.
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
        # window kit stub so route()'s fail-open path never crashes the harness.
        "globalThis.window.OrwellWindowKit = { create: () => ({ open(){}, close(){}, destroy(){}, el:{ "
        "  id:'', setAttribute(){}, addEventListener(){}, focus(){}, querySelector(){return null;} } }) };\n"
        # fetch: the only call the opener path touches is GET /api/orwell/game-session (via converge)
        # and the fire-and-forget warm-portraits POST. Resolve the binding per the test; everything
        # else resolves empty so the flow fails open quietly.
        f"const _bound = {bound_js};\n"
        "globalThis.fetch = (url) => {\n"
        "  const u = String(url);\n"
        "  if (u.indexOf('/api/orwell/game-session') !== -1) return Promise.resolve({ ok:true, json:()=>Promise.resolve({ sessionId:_bound }) });\n"
        "  return Promise.resolve({ ok:true, json:()=>Promise.resolve({}) });\n"
        "};\n"
        "process.on('unhandledRejection', () => {});\n"
        "import fs from 'node:fs';\n"
        f"const src = fs.readFileSync('{mod}', 'utf8');\n"
        "(0, eval)(src);\n"
    )
    script = (
        # Call the opener; it awaits the canonical probe. Settle microtasks, then drain the 250ms
        # post-converge timer (only relevant on the NOT-bound path) so the cue, if any, is captured.
        "await globalThis.window._orwellOpenGameAfterCasting();\n"
        "for (let i=0;i<20;i++){ await new Promise(r => setImmediate(r)); }\n"
        "globalThis.tick(300);\n"
        "for (let i=0;i<20;i++){ await new Promise(r => setImmediate(r)); }\n"
        "process.stdout.write(JSON.stringify({ "
        "  cues: globalThis.getCues(), selected: globalThis.getSelected() }));\n"
    )
    proc = subprocess.run(
        [node, "--input-type=module", "-e", harness + script],
        capture_output=True, text=True, timeout=30,
    )
    assert proc.returncode == 0, f"node failed: {proc.stderr}"
    return json.loads(proc.stdout)


def test_987_fresh_surface_with_canonical_game_does_not_mint_a_second_session():
    # A canonical game is ALREADY bound (another device opened it) but it is NOT yet in this fresh
    # surface's getSessions() — the exact #987 window. The opener must STILL bail (the boolean return
    # of _convergeOnCanonicalGame is true on any bound id) and NOT send the kickoff cue (the cue is
    # what materializes the orphan "Casting interview" row). FAIL-BEFORE: without the guard the cue
    # fires here regardless.
    out = _node_drive_opener("canonical-sess", session_known=False)
    assert out["cues"] == [], (
        "with a canonical game already bound, the opener must NOT send the kickoff cue (that send "
        "materializes the duplicate empty 'Casting interview' session — #987)"
    )


def test_987_fresh_surface_resumes_a_known_canonical_session_in_place():
    # When the bound session is already KNOWN to getSessions(), the opener bails AND selectSession()s
    # it — the fresh surface resumes the canonical game in place (true convergence), never its own.
    out = _node_drive_opener("canonical-sess", session_known=True)
    assert out["cues"] == [], "a known canonical game must still suppress the kickoff cue"
    # The opener's converge resumes the bound session in place (selectSession). (route()'s own
    # started-season converge on IIFE load may also select it — both target the same canonical id,
    # so we assert it was selected, never that a parallel session was minted.)
    assert out["selected"] and all(s == "canonical-sess" for s in out["selected"]), (
        "a known canonical session must be selected in place (resumed), never a parallel id"
    )


def test_987_no_canonical_game_still_fires_the_opener():
    # NOTHING bound (the genuine first surface): the opener must still fire the kickoff cue so the
    # producers open the show — the fix must not regress the normal cold-start path.
    out = _node_drive_opener(None)
    assert len(out["cues"]) == 1, "with no canonical game bound, the opener must still fire once"
    assert "casting interview" in out["cues"][0]
    # nothing to converge onto, so no session was selected here
    assert out["selected"] == []
