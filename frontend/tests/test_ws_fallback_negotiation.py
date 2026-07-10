"""WebSocket Phase-1 — case (e): fallback negotiation (no WS ⇒ SSE/poll, still F1–F5).

Protocol spec §6 / test plan §7. The client attempts the WS upgrade ONLY when the
`ORWELL_WS_TRANSPORT` flag is on (default OFF — zero-risk Phase-1 default) and the game
build is active. On a blocked/timed-out upgrade (~3s to the first `ack`) it falls back to
the PERMANENT SSE/poll stack. A mid-session WS→SSE downgrade carries the resume cursor
(highest chat `seq` + last `beatSeq`) forward so nothing is replayed from 0 or skipped.

Two halves, mirroring the repo convention:
  • BEHAVIORAL — run the REAL orwellWs.js negotiator in Node against a stubbed WebSocket,
    assert: flag OFF ⇒ no socket attempt + fallback; a close-before-ack ⇒ fallback; a full
    handshake ⇒ ws-active; and a mid-session teardown emits the downgrade cursor.
  • STRUCTURAL — pin the flag gate, the ~3s timeout, the fallback events, and the poll-timer
    cancellation in the two HUD gadgets so a revert fails.

The F5 mirror-parity gate in BOTH modes (spec §7 case e3/f) runs once the server route
(claude/ws-phase1-server) is on main. Roles only; no names.
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


# ── BEHAVIORAL — the real orwellWs.js negotiator, in Node ────────────────────────

# Stub window/document/CustomEvent/WebSocket, eval the REAL orwellWs.js, and drive the
# lifecycle deterministically (no wall-clock waits): we grab the stub socket the client
# constructs and fire its onopen/onclose/onmessage ourselves.
_HARNESS = r"""
const fs = require("node:fs");
const src = fs.readFileSync(process.argv[1], "utf8");
function assert(c, m) { if (!c) { throw new Error("ASSERT: " + m); } }
process.on("unhandledRejection", (e) => { console.error(e); process.exit(1); });
// The handshake resolves through Promise `.then` chains — drain microtasks between steps.
const tick = () => new Promise((r) => setImmediate(r));

// ── scenario 1: flag OFF ⇒ never attempt the upgrade, land in fallback ──────────
(function flagOff() {
  const events = [];
  let wsCtorCalls = 0;
  global.CustomEvent = function (t, i) { this.type = t; this.detail = i && i.detail; };
  global.WebSocket = function () { wsCtorCalls++; this.readyState = 0; };
  global.window = {
    API_BASE: "", ORWELL_WS_TRANSPORT: undefined,     // flag OFF
    addEventListener() {}, removeEventListener() {},
    dispatchEvent(e) { events.push(e); return true; },
    location: { protocol: "http:", host: "localhost" },
    sessionModule: { getCurrentSessionId() { return "sess_1"; } },
  };
  global.document = { readyState: "complete", body: { dataset: { gameBuild: "1" } }, addEventListener() {} };
  global.window.document = global.document;
  delete global.window.OrwellWs;
  (0, eval)(src);
  const WS = global.window.OrwellWs;
  assert(wsCtorCalls === 0, "flag OFF must NOT construct a WebSocket");
  assert(WS.mode() === "fallback", "flag OFF ⇒ fallback mode, got " + WS.mode());
  assert(WS.isActive() === false, "flag OFF ⇒ not active");
  assert(events.some((e) => e.type === "orwell:ws-inactive"), "flag OFF must announce ws-inactive");
})();

// ── scenario 2: non-game build ⇒ never attempt, even with the flag ON ───────────
(function nonGameBuild() {
  let wsCtorCalls = 0;
  global.CustomEvent = function (t, i) { this.type = t; this.detail = i && i.detail; };
  global.WebSocket = function () { wsCtorCalls++; this.readyState = 0; };
  global.window = {
    API_BASE: "", ORWELL_WS_TRANSPORT: "1",           // flag ON
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    location: { protocol: "http:", host: "localhost" },
    sessionModule: { getCurrentSessionId() { return "sess_2"; } },
  };
  global.document = { readyState: "complete", body: { dataset: {} }, addEventListener() {} }; // NOT game build
  global.window.document = global.document;
  delete global.window.OrwellWs;
  (0, eval)(src);
  assert(wsCtorCalls === 0, "non-game build must NOT construct a WebSocket");
  assert(global.window.OrwellWs.mode() === "fallback", "non-game build ⇒ fallback");
})();

// ── scenarios 3–5 (async: the handshake resolves through microtasks) ────────────
let lastSock = null;
function boot() {
  const events = [];
  global.CustomEvent = function (t, i) { this.type = t; this.detail = i && i.detail; };
  global.WebSocket = function (url) {
    this.url = url; this.readyState = 0; this.sent = [];
    this.send = (s) => this.sent.push(JSON.parse(s));
    this.close = () => { this.readyState = 3; };
    lastSock = this;
  };
  global.window = {
    API_BASE: "", ORWELL_WS_TRANSPORT: true,          // flag ON
    addEventListener() {}, removeEventListener() {},
    dispatchEvent(e) { events.push(e); return true; },
    location: { protocol: "https:", host: "example.test" },
    sessionModule: { getCurrentSessionId() { return "sess_live"; } },
  };
  global.document = { readyState: "complete", body: { dataset: { gameBuild: "1" } }, addEventListener() {} };
  global.window.document = global.document;
  delete global.window.OrwellWs;
  (0, eval)(src);
  return { WS: global.window.OrwellWs, events };
}

(async function main() {
  // scenario 3: flag ON + game build ⇒ attempt; close-before-ack ⇒ fallback (§6).
  {
    const { WS, events } = boot();
    assert(lastSock, "flag ON + game build must construct a WebSocket");
    assert(/^wss:\/\/example\.test\/api\/ws\/session$/.test(lastSock.url), "wss URL: " + lastSock.url);
    assert(WS.mode() === "negotiating", "before ack ⇒ negotiating, got " + WS.mode());
    lastSock.readyState = 3; lastSock.onclose();
    assert(WS.mode() === "fallback", "close-before-ack ⇒ fallback, got " + WS.mode());
    assert(events.some((e) => e.type === "orwell:ws-inactive"), "must announce ws-inactive on failed upgrade");
  }

  // scenario 4: full handshake ⇒ ws-active; mid-session teardown carries the cursor.
  {
    const { WS, events } = boot();
    lastSock.readyState = 1; lastSock.onopen();
    const hello = lastSock.sent.find((f) => f.t === "hello");
    assert(hello && hello.d && hello.d.protocol === 1, "hello frame must carry protocol:1");
    assert(hello.d.perTabId === "sess_live", "hello carries the perTabId");
    lastSock.onmessage({ data: JSON.stringify({ t: "ack", cid: hello.cid, d: { canonicalId: "sess_live", live: true, beatSeq: 118 } }) });
    await tick();
    assert(WS.isActive() === true, "a live ack ⇒ ws mode active");
    assert(events.some((e) => e.type === "orwell:ws-active"), "must announce ws-active");
    assert(WS.lastBeatSeq() === 118, "beatSeq seeded from the ack");
    const sub = lastSock.sent.find((f) => f.t === "subscribe" && f.ch === "chat");
    assert(sub && sub.d.fromSeq === 0, "fresh window subscribes chat fromSeq:0");
    lastSock.onmessage({ data: JSON.stringify({ t: "ack", ch: "chat", cid: sub.cid, d: { fromSeq: 0, headSeq: -1 } }) });
    await tick();
    assert(WS.isChatSubscribed() === true, "subscribe ack marks the chat channel subscribed");
    lastSock.onmessage({ data: JSON.stringify({ t: "event", ch: "chat", seq: 0, d: { delta: "a" } }) });
    lastSock.onmessage({ data: JSON.stringify({ t: "event", ch: "chat", seq: 1, d: { delta: "b" } }) });
    lastSock.onmessage({ data: JSON.stringify({ t: "event", ch: "chat", seq: 2, d: { delta: "c" } }) });
    assert(WS.highestChatSeq() === 2, "cursor tracks the highest rendered chat seq");
    // A hard failure tears the socket down → fallback carrying the WS→SSE downgrade
    // cursor (fromSeq = highest+1) + the last beatSeq (§6).
    events.length = 0;
    lastSock.onmessage({ data: JSON.stringify({ t: "error", d: { code: "forbidden" } }) });
    assert(WS.mode() === "fallback", "a hard failure ⇒ fallback");
    const down = events.find((e) => e.type === "orwell:ws-inactive");
    assert(down, "downgrade must announce ws-inactive");
    assert(down.detail.fromSeq === 3, "downgrade cursor fromSeq must be highest+1 (=3), got " + down.detail.fromSeq);
    assert(down.detail.beatSeq === 118, "downgrade carries the last beatSeq for the 0065 CAS");
  }

  // scenario 5: a `turn` up-frame carries expectedBeatSeq (0065 CAS, §3.5).
  {
    const { WS } = boot();
    lastSock.readyState = 1; lastSock.onopen();
    const hello = lastSock.sent.find((f) => f.t === "hello");
    lastSock.onmessage({ data: JSON.stringify({ t: "ack", cid: hello.cid, d: { canonicalId: "sess_live", live: true, beatSeq: 200 } }) });
    await tick();
    const sub = lastSock.sent.find((f) => f.t === "subscribe");
    lastSock.onmessage({ data: JSON.stringify({ t: "ack", ch: "chat", cid: sub.cid, d: { fromSeq: 0, headSeq: -1 } }) });
    await tick();
    const p = WS.sendTurn({ message: "I pull them aside", clientMsgId: "tmp_5" });
    const turn = lastSock.sent.find((f) => f.t === "turn");
    assert(turn && turn.ch === "chat", "turn rides the chat channel (§3.5)");
    assert(turn.d.expectedBeatSeq === 200, "turn MUST carry expectedBeatSeq = last-seen beatSeq");
    assert(turn.d.clientMsgId === "tmp_5", "turn round-trips the optimistic bubble id");
    // A stale-beat error rejects the RIGHT promise by cid (§3.5) and refreshes the beat.
    let rejected = null;
    const guard = p.then(() => { throw new Error("turn promise must REJECT on stale-beat"); },
                         (err) => { rejected = err; });
    lastSock.onmessage({ data: JSON.stringify({ t: "error", cid: turn.cid, d: { code: "stale-beat", beatSeq: 201 } }) });
    await guard;
    assert(rejected && rejected.code === "stale-beat", "reject carries the stale-beat code");
    assert(WS.lastBeatSeq() === 201, "beatSeq refreshed from the stale-beat error for the retry");
  }

  console.log("OK");
  process.exit(0);
})();
"""


def _run_node(harness, modpath):
    node = shutil.which("node")
    if not node:
        pytest.skip("node not available for the behavioral negotiation check")
    proc = subprocess.run(
        [node, "-e", harness, modpath],
        capture_output=True, text=True, timeout=30,
    )
    assert proc.returncode == 0, f"node failed: {proc.stdout}\n{proc.stderr}"
    return proc.stdout


def test_negotiation_flag_gate_handshake_and_downgrade_cursor():
    out = _run_node(_HARNESS, os.path.join(STATIC, "orwellWs.js"))
    assert "OK" in out


# ── STRUCTURAL — pin the negotiation + poll-cancellation legs ────────────────────

WS = _read("static", "js", "orwellWs.js")
PRESENCE = _read("static", "js", "orwellPresence.js")
STATUS = _read("static", "js", "orwellStatusPanel.js")


def test_flag_defaults_off_and_gates_the_upgrade_attempt():
    # The flag is read defensively (global or body data-attr) and gates start().
    assert "ORWELL_WS_TRANSPORT" in WS
    assert "_flagOn()" in WS and "_gameBuild()" in WS
    # Non-game build OR flag off ⇒ fallback, never a socket.
    assert "_mode = \"fallback\"" in WS


def test_upgrade_has_a_timeout_and_a_permanent_fallback():
    assert "HELLO_TIMEOUT_MS = 3000" in WS, "~3s upgrade budget to the first ack (§6)"
    assert "_goFallback" in WS
    # The SSE/poll stack is the permanent fallback: the module announces the mode so the
    # HUD gadgets can cancel/resume their polls.
    assert "orwell:ws-active" in WS and "orwell:ws-inactive" in WS


def test_downgrade_carries_the_resume_cursor():
    # WS→SSE downgrade hands fromSeq (highest+1) + beatSeq forward (§6).
    assert "fromSeq: _highestChatSeq + 1" in WS
    assert "beatSeq: _beatSeq" in WS


def test_hud_gadgets_cancel_their_polls_when_ws_is_active():
    # Presence (25s) and status (20s) polls stand down in WS mode and resume on fallback.
    for src, name in ((PRESENCE, "presence"), (STATUS, "status")):
        assert "_wsActive()" in src, f"{name} must gate its poll on the WS-active check"
        assert "orwell:ws-active" in src and "orwell:ws-inactive" in src, \
            f"{name} must listen for the WS mode edges"
    # The reschedule is guarded — the timer does not re-arm while WS is active.
    assert "if (!_wsActive()) timer = setTimeout(tick" in PRESENCE
    assert "if (!_wsActive()) timer = setTimeout(tick" in STATUS
