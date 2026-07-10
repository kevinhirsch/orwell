"""WebSocket Phase-1 — the per-tab HELLO RACE that blocked WS turn-on.

The hello frame (§2 handshake) carries ``perTabId`` and the server refuses a null/empty one with
``error{code:"bad-request"}`` (its guard is correct — a socket must name a session it can bind). At
boot the tab's chat-session id resolves ASYNCHRONOUSLY (the session bootstrap / ``selectSession``), so
``_perTabId()`` is null for the first few hundred ms after DOMContentLoaded. The pre-fix client opened
the socket and sent ``hello {perTabId: null}`` immediately → ``bad-request`` → a PERMANENT
(handshake-cause) fallback that NEVER recovered — both mirror windows sat on SSE and the WS leg was a
silent false-green. This is the exact evidence the mirror-parity WS leg reported:

    A frames: hello {perTabId: null, protocol: 1} → error {code: "bad-request"} → close 1005

The fix pinned here: the client DEFERS the connect until ``_perTabId()`` lands (never hellos null),
and connects promptly when the session bootstrap dispatches ``orwell:gamechanged`` (the g15 seam) — so
the hello ALWAYS carries a valid perTabId. Dormant-safe (flag off ⇒ no attempt) and the deferral is
bounded so a no-game page doesn't poll forever.

BEHAVIORAL — the REAL orwellWs.js in Node with a stubbed WebSocket + a MUTABLE per-tab id. Plus a
STRUCTURAL pin so a revert (hello-with-null at boot) fails. Roles only; no names.
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


_HARNESS = r"""
const fs = require("node:fs");
const src = fs.readFileSync(process.argv[1], "utf8");
function assert(c, m) { if (!c) { throw new Error("ASSERT: " + m); } }
process.on("unhandledRejection", (e) => { console.error(e); process.exit(1); });
const tick = () => new Promise((r) => setImmediate(r));

let lastSock = null;
let allSocks = [];

// The per-tab id starts NULL (the bootstrap hasn't resolved it) and is flipped ON later — exactly the
// boot race. `_perTabId()` reads it live off sessionModule each call.
let perTab = null;

function boot(flagOn, gameBuild) {
  lastSock = null; allSocks = [];
  global.CustomEvent = function (t, i) { this.type = t; this.detail = i && i.detail; };
  global.WebSocket = function (url) {
    this.url = url; this.readyState = 0; this.sent = [];
    this.send = (s) => this.sent.push(JSON.parse(s));
    this.close = () => { this.readyState = 3; };
    lastSock = this; allSocks.push(this);
  };
  const listeners = {};
  global.window = {
    API_BASE: "", ORWELL_WS_TRANSPORT: flagOn ? true : undefined,
    addEventListener(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
    removeEventListener() {},
    dispatchEvent(e) { (listeners[e.type] || []).forEach((fn) => { try { fn(e); } catch (_) {} }); return true; },
    location: { protocol: "https:", host: "example.test" },
    sessionModule: { getCurrentSessionId() { return perTab; } },
  };
  global.document = { readyState: "complete", body: { dataset: gameBuild ? { gameBuild: "1" } : {} }, addEventListener() {} };
  global.window.document = global.document;
  delete global.window.OrwellWs;
  (0, eval)(src);
  return { WS: global.window.OrwellWs, listeners };
}

function gamechanged() { global.window.dispatchEvent({ type: "orwell:gamechanged" }); }
function helloFrames() { return allSocks.flatMap((s) => s.sent.filter((f) => f.t === "hello" || f.t === "bind")); }

(async function main() {
  // ── scenario 1: boot with a NULL per-tab id → DEFER (no socket, no null hello) ──
  {
    perTab = null;
    const { WS } = boot(true, true);
    await tick();  // DOMContentLoaded 'complete' → start() auto-ran; the id is not ready yet
    assert(lastSock === null, "flag on + game build but perTabId NULL ⇒ NO socket opened (deferred, not a null hello)");
    assert(WS.mode() === "idle", "a null perTabId leaves the client IDLE (deferring), NOT locked in fallback");
    assert(helloFrames().length === 0, "no hello frame may be sent while perTabId is null");

    // The session bootstrap resolves the id and fires the g15 dispatcher.
    perTab = "sess_pertab";
    gamechanged();
    await tick();
    assert(lastSock !== null, "once perTabId lands, a gamechanged connects promptly");
    // The hello now carries the REAL, non-null perTabId.
    lastSock.readyState = 1; lastSock.onopen();
    const hellos = helloFrames();
    assert(hellos.length === 1, "exactly one hello, sent only after the id resolved; got " + hellos.length);
    assert(hellos[0].d.perTabId === "sess_pertab", "the hello must carry the resolved perTabId; got " + JSON.stringify(hellos[0].d.perTabId));
    // And NO hello was EVER sent with a null/absent perTabId.
    assert(!helloFrames().some((f) => !f.d || f.d.perTabId == null),
           "no hello may EVER carry a null/absent perTabId (the server refuses it bad-request)");

    // Complete the handshake live → the socket engages (proves the deferred path reaches ws-active).
    lastSock.onmessage({ data: JSON.stringify({ t: "ack", cid: hellos[0].cid, d: { canonicalId: "sess_pertab", live: true, beatSeq: 3 } }) });
    await tick();
    const sub = lastSock.sent.find((f) => f.t === "subscribe" && f.ch === "chat");
    if (sub) lastSock.onmessage({ data: JSON.stringify({ t: "ack", ch: "chat", cid: sub.cid, d: { fromSeq: 0, headSeq: -1 } }) });
    await tick();
    assert(WS.isActive() === true, "the deferred-then-connected socket reaches ws-active with a valid hello");
  }

  // ── scenario 2: DORMANCY — flag off with a null id ⇒ no poll, no socket ──────────
  {
    perTab = null;
    const { WS } = boot(false, true);
    await tick();
    assert(WS.isFallback() === true, "flag off ⇒ fallback (dormant), regardless of perTabId");
    assert(lastSock === null, "flag off ⇒ never a socket");
    perTab = "sess_late";
    gamechanged();
    await tick();
    assert(lastSock === null, "flag off ⇒ a landed perTabId still constructs NO socket (dormant)");
  }

  // ── scenario 3: a READY id at boot connects immediately (no regression) ──────────
  {
    perTab = "sess_ready";
    const { WS } = boot(true, true);
    await tick();
    assert(lastSock !== null, "perTabId ready at boot ⇒ connect immediately (unchanged fast path)");
    lastSock.readyState = 1; lastSock.onopen();
    const hellos = helloFrames();
    assert(hellos.length === 1 && hellos[0].d.perTabId === "sess_ready", "the immediate hello carries the ready perTabId");
  }

  console.log("OK");
  process.exit(0);
})();
"""


def _run_node(harness, modpath):
    node = shutil.which("node")
    if not node:
        pytest.skip("node not available for the behavioral per-tab hello-race check")
    proc = subprocess.run(
        [node, "-e", harness, modpath],
        capture_output=True, text=True, timeout=30,
    )
    assert proc.returncode == 0, f"node failed: {proc.stdout}\n{proc.stderr}"
    return proc.stdout


def test_client_defers_connect_until_pertab_id_is_ready():
    out = _run_node(_HARNESS, os.path.join(STATIC, "orwellWs.js"))
    assert "OK" in out


# ── STRUCTURAL — pin the deferral so a revert (hello-with-null at boot) fails ────

WS = _read("static", "js", "orwellWs.js")


def test_start_defers_when_pertab_id_is_not_ready():
    # start() must gate the connect on a resolved perTabId — deferring rather than hello-ing null.
    body = WS.split("function start()")[1].split("\n  function ")[0]
    assert "_perTabId()" in body and "_deferForPerTab" in body, \
        "start() must defer the connect when the per-tab id is not yet resolved"


def test_deferral_is_bounded_and_flag_gated():
    body = WS.split("function _deferForPerTab")[1].split("\n  function ")[0]
    assert "_flagOn()" in body and "_gameBuild()" in body, \
        "the deferral poll must respect dormancy (flag off / non-game build ⇒ stop)"
    assert "PERTAB_WAIT_MAX_MS" in body, "the deferral must be BOUNDED (no infinite poll)"
    assert "_connect()" in body, "the deferral must connect for real once the id lands"


def test_pertab_pending_fallback_is_recoverable():
    # A timed-out deferral falls back with a RECOVERABLE cause so a later game-load re-arms the wait.
    assert '_goFallback("pertab-pending")' in WS, "the deferral timeout must use a recoverable cause"
    body = WS.split("function _maybeUpgradeFromFallback")[1].split("\n  function ")[0]
    assert '"pertab-pending"' in body, "recovery must attempt for the pertab-pending cause too"
    # The pre-existing pregame recovery cause is untouched.
    assert '_fallbackReason !== "pregame-not-live"' in body


def test_gamechanged_connects_a_deferring_idle_window():
    listener = WS.split('addEventListener("orwell:gamechanged"')[1][:600]
    assert '_mode === "idle"' in listener and "_maybeConnectWhenPerTabReady" in listener, \
        "the gamechanged listener must connect an idle window that was deferring for the per-tab id"
