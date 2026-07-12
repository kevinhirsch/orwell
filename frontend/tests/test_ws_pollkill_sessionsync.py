"""WebSocket Phase-1 — poll-kill: sessionSync.js (the SSE chat mirror + canonical-session poll).

Sibling to test_ws_pollkill_batch2.py and test_ws_fallback_negotiation.py's
`test_hud_gadgets_cancel_their_polls_when_ws_is_active` (#1284). Those pinned the periodic HUD
polls; THIS is the big remaining redundant transport — sessionSync.js runs BOTH a 1.5s
`/api/orwell/game-session` canonical poll AND an SSE `EventSource` on `/api/chat/events/{id}`
concurrently with the WS socket. With WS on, that is a live dual-transport race.

Every leg sessionSync carries has a verified WS carrier fed from the SAME server source (all off
the canonical session): the peer's turn rides the `chat` replay-then-tail broadcast (agent_runs run
buffer → chatWsSplice.js `_onWsChatFrame`), the board reconcile rides the `state`/`hud` edge (session_events
bus → platform.js → the ONE g15 dispatcher), and layout rides the `layout` channel. The socket also
resolves the canonical id itself (its hello/bind ack), so the game-session poll is redundant too.

So while WS is active sessionSync must: tear the EventSource down, skip the 1.5s tick's poll +
connect, and STILL keep the SSE/poll path as the PERMANENT fallback (resumed on `orwell:ws-inactive`,
which also fires at startup when the flag is OFF — the zero-risk default).

Two halves, mirroring the repo convention:
  • BEHAVIORAL — eval the REAL sessionSync.js in Node against stubbed globals and drive it:
    WS off ⇒ the tick polls game-session + opens the SSE; WS on ⇒ neither; the ws-active edge tears
    an open SSE down; the ws-inactive edge resumes both (fallback intact).
  • STRUCTURAL — source-pin the `_wsActive()`/`isActive()` gate, the ws-active/ws-inactive edges, and
    the g15 single-dispatcher invariant so a revert fails.

DORMANT by construction: `ORWELL_WS_TRANSPORT` defaults OFF ⇒ `wsActive()` is always false in
production and the SSE + poll arm exactly as before (byte-identical). Structural only where possible;
roles only, no names.
"""

import os
import shutil
import subprocess

import pytest

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC = os.path.join(FRONTEND, "static", "js")


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


# ── BEHAVIORAL — the real sessionSync.js, in Node ────────────────────────────────
#
# Stub window (a REAL listener registry so we can fire ws-active/ws-inactive), document,
# EventSource, fetch, CustomEvent, and setInterval (captured, never scheduled — so the process
# never hangs), then eval the REAL sessionSync.js. start() runs immediately (readyState:complete)
# and calls tick() once; we observe the side effects (fetch URLs + EventSource constructions) and
# drive the transport edges deterministically.
_HARNESS = r"""
const fs = require("node:fs");
const src = fs.readFileSync(process.argv[1], "utf8");
function assert(c, m) { if (!c) { throw new Error("ASSERT: " + m); } }

function boot(opts) {
  opts = opts || {};
  const esInstances = [];
  const fetchUrls = [];
  const listeners = {};

  global.CustomEvent = function (t, i) { this.type = t; this.detail = i && i.detail; };
  global.EventSource = function (url) {
    this.url = url; this.readyState = 1; this.closed = false; this._l = {};
    this.addEventListener = function (t, fn) { (this._l[t] = this._l[t] || []).push(fn); };
    this.close = function () { this.readyState = 2; this.closed = true; };
    esInstances.push(this);
  };
  global.fetch = function (url) {
    fetchUrls.push(url);
    return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ sessionId: null }); } });
  };
  // Capture the 1.5s tick but NEVER schedule it (the process must not hang / auto-tick).
  global.setInterval = function () { return 1; };
  global.clearInterval = function () {};

  const W = {
    API_BASE: "",
    addEventListener: function (t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    removeEventListener: function (t, fn) { const a = listeners[t] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); },
    dispatchEvent: function (e) { (listeners[e.type] || []).slice().forEach(function (fn) { try { fn(e); } catch (_) {} }); return true; },
    location: { protocol: "https:", host: "example.test" },
    sessionModule: { getCurrentSessionId: function () { return "sess_live"; } },
    OrwellWs: opts.OrwellWs,           // undefined ⇒ WS absent (inactive)
  };
  global.window = W;
  global.document = { readyState: "complete", body: { dataset: { gameBuild: "1" } }, addEventListener: function () {} };
  global.window.document = global.document;
  (0, eval)(src);   // fresh closure each boot — no state leaks between scenarios
  return { W: W, es: esInstances, fetch: fetchUrls,
           polledSession: function () { return fetchUrls.some(function (u) { return /\/api\/orwell\/game-session/.test(u); }); } };
}

// ── scenario A: WS INACTIVE (absent) + game build ⇒ SSE opens + game-session poll fires ──
(function wsOff() {
  const b = boot({ OrwellWs: undefined });
  assert(b.polledSession(), "WS-off tick MUST poll /api/orwell/game-session (the canonical resolver)");
  assert(b.es.length === 1, "WS-off tick MUST open exactly one SSE EventSource, got " + b.es.length);
  assert(/\/api\/chat\/events\/sess_live$/.test(b.es[0].url), "SSE opens on the chat-events channel: " + b.es[0].url);
})();

// ── scenario B: WS ACTIVE + game build ⇒ NO SSE, NO game-session poll (superseded) ──
(function wsOn() {
  const b = boot({ OrwellWs: { isActive: function () { return true; } } });
  assert(!b.polledSession(), "WS-on: sessionSync must NOT poll /api/orwell/game-session");
  assert(b.es.length === 0, "WS-on: sessionSync must NOT open an SSE EventSource, got " + b.es.length);
})();

// ── scenario C1: ws-active tears an OPEN SSE down (mid-session upgrade) ──
(function upgradeEdge() {
  const stub = { _active: false, isActive: function () { return this._active; } };
  const b = boot({ OrwellWs: stub });
  // Booted WS-inactive ⇒ SSE is open + poll fired (fallback live).
  assert(b.es.length === 1 && b.polledSession(), "C1: fallback SSE + poll must be live while WS inactive");
  const openEs = b.es[0];
  // Socket goes live → orwell:ws-active must TEAR THE SSE DOWN.
  stub._active = true;
  b.W.dispatchEvent(new global.CustomEvent("orwell:ws-active"));
  assert(openEs.closed === true, "C1: orwell:ws-active MUST close the open SSE EventSource");
})();

// ── scenario C2: ws-inactive RESUMES the SSE + poll (downgrade to the permanent fallback) ──
// Booted WS-ACTIVE so the initial tick is gated (no in-flight poll / pristine canonical cache),
// isolating the downgrade: ws-inactive → an ungated tick opens the SSE AND polls game-session.
(function downgradeEdge() {
  const stub = { _active: true, isActive: function () { return this._active; } };
  const b = boot({ OrwellWs: stub });
  assert(b.es.length === 0 && !b.polledSession(), "C2: WS-active boot must open no SSE and run no poll");
  // Socket downgrades → orwell:ws-inactive must RESUME both legs (permanent fallback).
  stub._active = false;
  b.W.dispatchEvent(new global.CustomEvent("orwell:ws-inactive"));
  assert(b.es.length === 1, "C2: orwell:ws-inactive MUST re-open the SSE EventSource (fallback)");
  assert(b.polledSession(), "C2: orwell:ws-inactive MUST resume the /api/orwell/game-session poll");
})();

console.log("OK");
process.exit(0);
"""


def _run_node(harness, modpath):
    node = shutil.which("node")
    if not node:
        pytest.skip("node not available for the behavioral sessionSync poll-kill check")
    proc = subprocess.run(
        [node, "-e", harness, modpath],
        capture_output=True, text=True, timeout=30,
    )
    assert proc.returncode == 0, f"node failed: {proc.stdout}\n{proc.stderr}"
    return proc.stdout


def test_sessionsync_stands_down_sse_and_poll_when_ws_active():
    out = _run_node(_HARNESS, os.path.join(STATIC, "sessionSync.js"))
    assert "OK" in out


# ── STRUCTURAL — source-pin the gate, the edges, and the g15 invariant ───────────

SYNC = _read("static", "js", "sessionSync.js")


def test_sessionsync_reads_the_shared_ws_active_helper():
    # The exact helper #1284 established (OrwellWs.isActive), defensively guarded — one source of truth.
    assert "window.OrwellWs && window.OrwellWs.isActive && window.OrwellWs.isActive()" in SYNC, \
        "sessionSync must resolve activeness through OrwellWs.isActive()"


def test_sessionsync_tick_is_ws_gated():
    # The 1.5s tick short-circuits (disconnect + return) while WS is active — no poll, no connect.
    assert "if (wsActive()) { disconnect(); return; }" in SYNC


def test_sessionsync_canonical_poll_is_ws_gated():
    # No /api/orwell/game-session request leaves this module while WS carries the game (covers the
    # tick path AND the orwell:gamechanged re-resolve path, which both call refreshCanonical).
    assert "if (wsActive()) { _canon = { id: null, at: 0, inflight: false }; return; }" in SYNC


def test_sessionsync_listens_for_both_mode_edges():
    assert "'orwell:ws-active'" in SYNC, "must listen for orwell:ws-active (tear down SSE)"
    assert "'orwell:ws-inactive'" in SYNC, "must listen for orwell:ws-inactive (resume fallback)"


def test_sessionsync_keeps_gamechanged_listener_and_never_dispatches_it():
    # g15: exactly ONE dispatcher (platform.js). sessionSync only LISTENS + routes freshness through
    # window.orwellGameChanged — it must never `new CustomEvent('orwell:gamechanged')` itself.
    assert "addEventListener('orwell:gamechanged'" in SYNC, "must keep its orwell:gamechanged listener"
    assert "new CustomEvent('orwell:gamechanged')" not in SYNC, \
        "g15 violation: sessionSync must NOT dispatch orwell:gamechanged (platform.js is the ONE dispatcher)"
    assert "window.orwellGameChanged" in SYNC, "freshness must route through the single g15 dispatcher"
