"""WebSocket Phase-1 — a mid-turn socket drop must NEVER strand the sender's `await`.

The reproducible FE freeze (owner-reported P0, "the game freezes and I have to reload"): `_request`
registers a per-socket pending promise for an up-frame (`turn`/`decision`) with NO timeout of its own —
only `hello` is guarded by `_helloTimer`. `handleChatSubmit` does `await OrwellWs.sendTurn(...)` and only
AFTER it resolves does it clear the response timeout and return, letting the stream-end `finally` reset
`chatState.isStreaming` + re-enable the composer. If the socket drops between the `turn` frame and its
`ack` (laptop sleep, a network blip, a uvicorn worker idle-recycle reaping the connection), the ack can
never arrive on that dead socket — and pre-fix `sock.onclose` tore the socket down and reconnected
WITHOUT rejecting the outstanding pending. So the `await` hung FOREVER, the try-block never completed,
the recovery `finally` never ran, and the UI stayed frozen (composer disabled / stuck on Stop) until the
player reloaded.

The fix: `onclose` (genuine drop) and `_goFallback` (permanent WS→SSE downgrade) reject the outstanding
turn/decision pendings, so the caller's catch reconciles from history and the finally recovers the UI; a
reconnect independently resumes the run's frames via the gap cursor. Handshake/subscribe pendings are
left to the existing reconnect/`_helloTimer` machinery.

Driven against the REAL orwellWs.js in Node with a stubbed WebSocket (the test_1087_ws_replay_churn.py
harness idiom). Roles only; no names.
"""
import os
import shutil
import subprocess

import pytest

_STATIC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static", "js")

_HARNESS = r"""
const fs = require("node:fs");
const src = fs.readFileSync(process.argv[1], "utf8");
function assert(c, m) { if (!c) { throw new Error("ASSERT: " + m); } }
process.on("unhandledRejection", (e) => { console.error("UNHANDLED:", e); process.exit(1); });
const tick = () => new Promise((r) => setImmediate(r));
let lastSock = null;

function boot() {
  global.CustomEvent = function (t, i) { this.type = t; this.detail = i && i.detail; };
  global.WebSocket = function (url) {
    this.url = url; this.readyState = 0; this.sent = [];
    this.send = (s) => this.sent.push(JSON.parse(s));
    this.close = () => { this.readyState = 3; };
    lastSock = this;
  };
  const listeners = {};
  global.window = {
    API_BASE: "", ORWELL_WS_TRANSPORT: true,
    addEventListener(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
    removeEventListener() {},
    dispatchEvent(e) { (listeners[e.type] || []).forEach((fn) => { try { fn(e); } catch (_) {} }); return true; },
    location: { protocol: "https:", host: "example.test" },
    sessionModule: { getCurrentSessionId() { return "sess_pertab"; } },
  };
  global.document = { readyState: "complete", body: { dataset: { gameBuild: "1" } }, addEventListener() {} };
  global.window.document = global.document;
  delete global.window.OrwellWs;
  (0, eval)(src);
  return global.window.OrwellWs;
}
function down(frame) { lastSock.onmessage({ data: JSON.stringify(frame) }); }
async function handshake() {
  lastSock.readyState = 1; lastSock.onopen();
  const hello = lastSock.sent.find((f) => f.t === "hello");
  down({ t: "ack", cid: hello.cid, d: { canonicalId: "sess_pertab", live: true, beatSeq: 1 } });
  await tick();
  const sub = lastSock.sent.find((f) => f.t === "subscribe" && f.ch === "chat");
  down({ t: "ack", ch: "chat", cid: sub.cid, d: { fromSeq: 0, headSeq: 0, hasRun: true, runId: "rA" } });
  await tick();
}

(async function main() {
  const WS = boot();
  await tick();
  await handshake();
  assert(WS.isActive(), "socket must be live/active after the handshake");

  // ── case 1: a mid-turn DROP (onclose) must reject the awaited turn, never hang it ──────────────
  let settled1 = null;
  const p1 = WS.sendTurn({ message: "hello house", clientMsgId: "c1" });
  p1.then(() => { settled1 = "resolved"; }, (e) => { settled1 = "rejected:" + (e && e.code); });
  // The `turn` frame went up; the server has NOT acked it yet …
  const sentTurn = lastSock.sent.find((f) => f.t === "turn");
  assert(sentTurn, "the turn frame must have been sent up");
  // … and now the socket drops (no ack will ever come on this dead socket).
  lastSock.readyState = 3;
  lastSock.onclose();
  await tick(); await tick();
  assert(settled1 !== null,
    "FREEZE: sendTurn() stayed PENDING after the socket dropped mid-request — the awaiting " +
    "handleChatSubmit hangs forever and the composer never recovers (must-reload freeze)");
  assert(settled1.startsWith("rejected"), "the stranded turn must REJECT (so the caller's catch recovers); got " + settled1);

  // ── case 2: a permanent WS→SSE downgrade (_goFallback via forbidden) must also not strand ──────
  // Re-handshake a fresh socket (the reconnect timer from case 1 is irrelevant to this check).
  const WS2 = boot();
  await tick();
  await handshake();
  let settled2 = null;
  const p2 = WS2.sendDecision({ kind: "vote", pendingId: "p1", target: "npc" });
  p2.then(() => { settled2 = "resolved"; }, (e) => { settled2 = "rejected:" + (e && e.code); });
  assert(lastSock.sent.find((f) => f.t === "decision"), "the decision frame must have been sent up");
  // The server refuses the socket at the protocol level → _goFallback("handshake"): SSE downgrade.
  down({ t: "error", d: { code: "forbidden" } });
  await tick(); await tick();
  assert(WS2.isFallback(), "a forbidden error must downgrade the socket to SSE fallback");
  assert(settled2 !== null,
    "FREEZE: sendDecision() stayed PENDING across a WS->SSE fallback — the awaiting caller hangs");
  assert(settled2.startsWith("rejected"), "the stranded decision must REJECT on fallback; got " + settled2);

  console.log("OK");
  process.exit(0);
})();
"""


def test_socket_drop_and_fallback_reject_pending_up_frames():
    """A mid-turn socket drop (onclose) and a permanent WS->SSE downgrade (_goFallback) must both REJECT
    an outstanding `turn`/`decision` request rather than leave it pending forever. A stranded pending is
    the reproducible FE freeze: `handleChatSubmit`'s `await OrwellWs.sendTurn(...)` never settles, so the
    stream-end `finally` that resets `isStreaming` + re-enables the composer never runs and the player
    must reload. Driven against the REAL orwellWs.js in Node with a stubbed WebSocket."""
    node = shutil.which("node") or (
        "/opt/node22/bin/node" if os.path.exists("/opt/node22/bin/node") else None
    )
    if not node:
        pytest.skip("node not available for the behavioral socket-drop reject check")
    proc = subprocess.run(
        [node, "-e", _HARNESS, os.path.join(_STATIC, "orwellWs.js")],
        capture_output=True, text=True, timeout=30,
    )
    assert proc.returncode == 0, f"node failed: {proc.stdout}\n{proc.stderr}"
    assert "OK" in proc.stdout
