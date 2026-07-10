"""WebSocket Phase-1 — fallback→WS RECOVERY (the turn-on gate, Blocker 2).

`_goFallback()` is otherwise PERMANENT. A window that boots pre-game — before the canonical game
session is live — gets `live:false` on the hello ack → `_goFallback()`, and the ONLY re-attempt hook
was `orwell:gamechanged` → `rebind()`, which early-returns unless `_mode==="ws"`. So a pre-game window
NEVER upgraded to WS even once the season started: two windows opened at different lifecycle points end
up on DIFFERENT transports (WS vs SSE) → the two-window mirror-parity / streamed-reply-strip risk
(#1085/#1086 class) that blocks turning `ORWELL_WS_TRANSPORT` on.

The fix pinned here: on `orwell:gamechanged`, a FALLBACK window re-attempts a REAL connect (constructs a
new socket) — gated on the flag + game build (dormancy) and a growing backoff (storm guard). The full
handshake resolves + liveness-validates the canonical id server-side BEFORE subscribing, so a
still-not-live game just falls back again; once live, the window upgrades to WS.

BEHAVIORAL — the REAL orwellWs.js in Node with a controllable clock + stubbed WebSocket. Plus a
STRUCTURAL pin so a revert (the permanent-fallback lock) fails. Roles only; no names.
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
let nowMs = 1000000;
Date.now = () => nowMs;   // controllable clock — only orwellWs's backoff reads Date.now

function boot(flagOn, gameBuild) {
  global.CustomEvent = function (t, i) { this.type = t; this.detail = i && i.detail; };
  global.WebSocket = function (url) {
    this.url = url; this.readyState = 0; this.sent = [];
    this.send = (s) => this.sent.push(JSON.parse(s));
    this.close = () => { this.readyState = 3; };
    lastSock = this;
  };
  const listeners = {};
  global.window = {
    API_BASE: "", ORWELL_WS_TRANSPORT: flagOn ? true : undefined,
    addEventListener(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
    removeEventListener() {},
    dispatchEvent(e) { (listeners[e.type] || []).forEach((fn) => { try { fn(e); } catch (_) {} }); return true; },
    location: { protocol: "https:", host: "example.test" },
    sessionModule: { getCurrentSessionId() { return "sess_pertab"; } },
  };
  global.document = { readyState: "complete", body: { dataset: gameBuild ? { gameBuild: "1" } : {} }, addEventListener() {} };
  global.window.document = global.document;
  delete global.window.OrwellWs;
  (0, eval)(src);
  return { WS: global.window.OrwellWs, listeners };
}

// Open the current socket and answer its hello with the given liveness.
async function helloWith(canon, live, beat) {
  lastSock.readyState = 1; lastSock.onopen();
  const hello = lastSock.sent.find((f) => f.t === "hello" || f.t === "bind");
  lastSock.onmessage({ data: JSON.stringify({ t: "ack", cid: hello.cid,
    d: { canonicalId: canon, live: live, beatSeq: beat } }) });
  await tick();
}
async function ackChat(sock) {
  const sub = sock.sent.find((f) => f.t === "subscribe" && f.ch === "chat");
  if (!sub) return;
  sock.onmessage({ data: JSON.stringify({ t: "ack", ch: "chat", cid: sub.cid, d: { fromSeq: 0, headSeq: -1 } }) });
  await tick();
}
function gamechanged() { global.window.dispatchEvent({ type: "orwell:gamechanged" }); }

(async function main() {
  // ── scenario 1: pre-game boot → fallback → gamechanged (now live) → upgrades to WS ──
  {
    const { WS } = boot(true, true);
    await tick();  // DOMContentLoaded already 'complete' → start() auto-ran → first socket
    const firstSock = lastSock;
    assert(firstSock, "flag on + game build ⇒ the client attempts the upgrade at boot");
    // Pre-game: the canonical isn't live yet → hello ack live:false → permanent-looking fallback.
    await helloWith("sess_pertab", false, 5);
    assert(WS.isFallback() === true, "a live:false hello drops the window to fallback");

    // The season starts; a mutation fires the ONE g15 dispatcher.
    nowMs += 100000;                 // past the backoff floor
    gamechanged();
    await tick();
    assert(lastSock !== firstSock, "a fallback window must RE-ATTEMPT a real connect on gamechanged");
    // This time the canonical resolves live → the window upgrades to WS.
    await helloWith("sess_live", true, 9);
    await ackChat(lastSock);
    assert(WS.isActive() === true, "the recovered connect reaches ws-active once the game is live");
    const chatSub = lastSock.sent.find((f) => f.t === "subscribe" && f.ch === "chat");
    assert(chatSub && chatSub.d.fromSeq === 0, "the upgraded socket subscribes chat (fromSeq 0)");
    const stateSub = lastSock.sent.find((f) => f.t === "subscribe" && f.ch === "state");
    assert(stateSub, "the upgraded socket arms the state/hud push edges");
  }

  // ── scenario 2: DORMANCY — flag off ⇒ a fallback window never re-attempts ──────────
  {
    const { WS } = boot(false, true);
    await tick();
    // Flag off ⇒ start() goes straight to fallback, no socket constructed.
    assert(WS.isFallback() === true, "flag off ⇒ fallback");
    const sockBefore = lastSock;   // whatever a prior scenario left (or null)
    lastSock = null;
    nowMs += 100000;
    gamechanged();
    await tick();
    assert(lastSock === null, "flag off ⇒ a fallback window must NOT attempt a WS upgrade (dormant)");
  }

  // ── scenario 3: BACKOFF storm-guard — rapid re-attempts are throttled ──────────────
  {
    const { WS } = boot(true, true);
    await tick();
    const s0 = lastSock;
    await helloWith("sess_pertab", false, 1);
    assert(WS.isFallback() === true, "baseline fallback");

    // First re-attempt (backoff floor already elapsed since boot) → a new socket.
    nowMs += 100000;
    gamechanged();
    await tick();
    const s1 = lastSock;
    assert(s1 !== s0, "first gamechanged re-attempts");
    // It fails (still not live) → back to fallback.
    await helloWith("sess_pertab", false, 1);
    assert(WS.isFallback() === true, "still not live ⇒ back to fallback");

    // An IMMEDIATE second gamechanged is inside the (now-doubled) backoff window → NO new socket.
    const s1b = lastSock;
    gamechanged();
    await tick();
    assert(lastSock === s1b, "a re-attempt inside the backoff window is throttled (storm guard)");

    // Advance well past the backoff → a re-attempt is allowed again.
    nowMs += 200000;
    gamechanged();
    await tick();
    assert(lastSock !== s1b, "past the backoff, a re-attempt is allowed again");
  }

  console.log("OK");
  process.exit(0);
})();
"""


def _run_node(harness, modpath):
    node = shutil.which("node")
    if not node:
        pytest.skip("node not available for the behavioral fallback-upgrade check")
    proc = subprocess.run(
        [node, "-e", harness, modpath],
        capture_output=True, text=True, timeout=30,
    )
    assert proc.returncode == 0, f"node failed: {proc.stdout}\n{proc.stderr}"
    return proc.stdout


def test_fallback_window_upgrades_to_ws_when_game_becomes_live():
    out = _run_node(_HARNESS, os.path.join(STATIC, "orwellWs.js"))
    assert "OK" in out


# ── STRUCTURAL — pin the recovery so the permanent-fallback lock cannot return ────

WS = _read("static", "js", "orwellWs.js")


def test_fallback_has_a_gamechanged_recovery_hook():
    # The gamechanged listener must have a fallback branch (not only the ws→rebind branch).
    listener = WS.split('addEventListener("orwell:gamechanged"')[1][:400]
    assert '_mode === "fallback"' in listener, \
        "the orwell:gamechanged listener must recover a fallback window (not only rebind in ws mode)"
    assert "_maybeUpgradeFromFallback" in listener


def test_recovery_is_flag_and_gamebuild_gated_and_backed_off():
    body = WS.split("function _maybeUpgradeFromFallback")[1].split("\n  function ")[0]
    # Dormancy: flag off / non-game build ⇒ never attempt.
    assert "_flagOn()" in body and "_gameBuild()" in body, \
        "recovery must be gated on the flag + game build (dormancy)"
    # Storm guard: a backoff comparison before re-attempting.
    assert "_upgradeBackoffMs" in body and "_lastUpgradeAttempt" in body, \
        "recovery must throttle re-attempts with a backoff"
    # A REAL connect, not a rebind no-op: it re-opens the start() gate.
    assert 'idle' in body and "start()" in body, \
        "recovery must re-run the full connect (start()), not rebind()"
