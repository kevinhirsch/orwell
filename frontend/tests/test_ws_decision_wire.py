"""WebSocket Phase-1 — the decision-card confirm routes through the `decision` up-frame.

Protocol spec §3.5. The decision card (`orwellDecision.js`) submits ENGINE-DIRECT. Phase-1
adds a socket-native path: when the OrwellWs socket is LIVE (flag `ORWELL_WS_TRANSPORT` ON +
a successful handshake) the confirm goes UP as a `decision` frame carrying the 0065
`expectedBeatSeq` CAS; the server relay runs the EXACT existing POST /api/orwell/decision
handler below the transport. When the socket is not active (flag OFF — the zero-risk Phase-1
default — or a failed/downgraded upgrade) the byte-identical HTTP POST stands.

Two halves, mirroring the repo convention:
  • BEHAVIORAL — run the REAL orwellWs.js in Node, drive it to ws-active, and assert
    `sendDecision(<real decision-card payload>)` emits a `decision` frame that carries the
    FULL body VERBATIM (kind + kind-specific fields), the last-seen beatSeq as the CAS token,
    and the idempotency key on its own normalized slot (snake_case `idempotency_key` accepted).
    A stale-beat error rejects the RIGHT promise by cid and refreshes the beat for the retry.
  • STRUCTURAL — pin the confirm-handler branch in orwellDecision.js: WS-active ⇒ sendDecision;
    else ⇒ the HTTP POST fallback; the g15 ONE-dispatcher seam + the per-signature dismiss are
    untouched; a stale-beat maps onto the existing 409 desync recovery. Roles only; no names.
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


# ── BEHAVIORAL — the real orwellWs.js sendDecision, in Node ──────────────────────

_HARNESS = r"""
const fs = require("node:fs");
const src = fs.readFileSync(process.argv[1], "utf8");
function assert(c, m) { if (!c) { throw new Error("ASSERT: " + m); } }
process.on("unhandledRejection", (e) => { console.error(e); process.exit(1); });
const tick = () => new Promise((r) => setImmediate(r));

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

// Drive the handshake to ws-active with a seeded beatSeq, return the live socket.
async function goLive(beatSeq) {
  const { WS } = boot();
  lastSock.readyState = 1; lastSock.onopen();
  const hello = lastSock.sent.find((f) => f.t === "hello");
  lastSock.onmessage({ data: JSON.stringify({ t: "ack", cid: hello.cid, d: { canonicalId: "sess_live", live: true, beatSeq: beatSeq } }) });
  await tick();
  const sub = lastSock.sent.find((f) => f.t === "subscribe");
  lastSock.onmessage({ data: JSON.stringify({ t: "ack", ch: "chat", cid: sub.cid, d: { fromSeq: 0, headSeq: -1 } }) });
  await tick();
  assert(WS.isActive() === true, "socket must be ws-active for the decision path");
  return WS;
}

(async function main() {
  // scenario 1: a REAL decision-card payload rides the `decision` frame VERBATIM.
  {
    const WS = await goLive(118);
    // The exact shape orwellDecision.js buildPayload() produces for a veto save, plus the
    // stable idempotency key it attaches (snake_case) — nothing dropped or renamed.
    WS.sendDecision({ kind: "veto-decision", use: true, save: "npc_3", idempotency_key: "dec:veto|abc" });
    const dec = lastSock.sent.find((f) => f.t === "decision");
    assert(dec && dec.ch === "chat", "decision rides the chat channel (§3.5)");
    assert(dec.cid, "decision carries a correlation id");
    assert(dec.d.kind === "veto-decision", "the engine-required `kind` MUST survive (not dropped)");
    assert(dec.d.use === true && dec.d.save === "npc_3", "the kind-specific fields survive verbatim");
    assert(dec.d.expectedBeatSeq === 118, "expectedBeatSeq defaults to the last-seen beatSeq (0065 CAS)");
    assert(dec.d.idempotencyKey === "dec:veto|abc", "snake_case idempotency_key is normalized to idempotencyKey");
    assert(!("idempotency_key" in dec.d), "the snake_case key does NOT leak into the decision body");
  }

  // scenario 2: a nominations pair (array `choice`) + an explicit expectedBeatSeq pin.
  {
    const WS = await goLive(200);
    WS.sendDecision({ kind: "nominations", choice: ["npc_1", "npc_2"], expectedBeatSeq: 205 });
    const dec = lastSock.sent.find((f) => f.t === "decision");
    assert(dec.d.kind === "nominations", "kind survives");
    assert(Array.isArray(dec.d.choice) && dec.d.choice.length === 2, "the nominations pair survives as an array");
    assert(dec.d.expectedBeatSeq === 205, "an explicit expectedBeatSeq pin overrides the default");
  }

  // scenario 3: a stale-beat error rejects the RIGHT promise by cid + refreshes the beat.
  {
    const WS = await goLive(300);
    const p = WS.sendDecision({ kind: "eviction-vote", vote: "npc_4" });
    const dec = lastSock.sent.find((f) => f.t === "decision");
    let rejected = null;
    const guard = p.then(() => { throw new Error("decision promise must REJECT on stale-beat"); },
                         (err) => { rejected = err; });
    lastSock.onmessage({ data: JSON.stringify({ t: "error", cid: dec.cid, d: { code: "stale-beat", beatSeq: 301 } }) });
    await guard;
    assert(rejected && rejected.code === "stale-beat", "reject carries the stale-beat code for the 409 map");
    assert(WS.lastBeatSeq() === 301, "beatSeq refreshed from the stale-beat error for the retry");
  }

  console.log("OK");
  process.exit(0);
})();
"""


def _run_node(harness, modpath):
    node = shutil.which("node")
    if not node:
        pytest.skip("node not available for the behavioral decision-frame check")
    proc = subprocess.run(
        [node, "-e", harness, modpath],
        capture_output=True, text=True, timeout=30,
    )
    assert proc.returncode == 0, f"node failed: {proc.stdout}\n{proc.stderr}"
    return proc.stdout


def test_send_decision_carries_full_body_and_cas_token():
    out = _run_node(_HARNESS, os.path.join(STATIC, "orwellWs.js"))
    assert "OK" in out


# ── STRUCTURAL — the confirm-handler branch in orwellDecision.js ─────────────────

DECISION = _read("static", "js", "orwellDecision.js")


def _confirm_handler():
    # The confirm click handler — from the buildPayload() gate through the outer catch.
    start = DECISION.find("confirm.addEventListener(\"click\"")
    assert start != -1, "the decision confirm click handler must exist"
    return DECISION[start:]


def test_confirm_routes_through_ws_sendDecision_when_active():
    body = _confirm_handler()
    # WS-active gate + the up-frame call.
    assert "OrwellWs" in body and ".isActive()" in body, \
        "the confirm handler must gate on OrwellWs.isActive() for the WS path"
    assert ".sendDecision(" in body, "the confirm handler must call OrwellWs.sendDecision when live"
    assert "expectedBeatSeq" in body, "the WS decision up-frame must carry the 0065 expectedBeatSeq CAS"


def test_http_post_stays_the_fallback():
    body = _confirm_handler()
    # The byte-identical HTTP path is preserved as the fallback (WS off / not active).
    assert 'fetch("/api/orwell/decision"' in body, \
        "the HTTP POST /api/orwell/decision fallback must remain (flag off / socket not active)"
    # The WS branch precedes the HTTP fetch (the fetch is the else fallback).
    ws_at = body.find(".sendDecision(")
    http_at = body.find('fetch("/api/orwell/decision"')
    assert ws_at != -1 and http_at != -1 and ws_at < http_at, \
        "the WS up-frame is the primary branch; the HTTP POST is its else fallback"


def test_ws_stale_beat_maps_onto_the_existing_409_recovery():
    body = _confirm_handler()
    # A WS stale-beat is mapped to httpStatus 409 so it reconciles through the EXISTING desync
    # path (the 409 branch already runs _recoverFrom409()) — exactly as the HTTP 409 does.
    assert "stale-beat" in body, "the WS branch must recognize the stale-beat error code"
    assert "409" in body, "a WS stale-beat must map onto the existing 409 recovery branch"
    assert "_recoverFrom409" in DECISION, "the existing 409 desync recovery seam must remain the reconcile path"


def test_g15_one_dispatcher_seam_preserved():
    body = _confirm_handler()
    # No ad-hoc CustomEvent — the ONE g15 dispatcher (window.orwellGameChanged) still owns it,
    # and the success branch routes through it for BOTH transports.
    assert "new CustomEvent('orwell:gamechanged'" not in DECISION \
        and 'new CustomEvent("orwell:gamechanged"' not in DECISION, \
        "the g15 ONE-dispatcher rule forbids an ad-hoc orwell:gamechanged CustomEvent"
    assert 'window.orwellGameChanged("decision:"' in body, \
        "the decision success branch must nudge the panels through the shared dispatcher"
