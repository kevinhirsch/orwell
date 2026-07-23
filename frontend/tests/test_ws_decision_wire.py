"""WebSocket Phase-1 — the decision-card confirm routes through the `decision` up-frame.

Protocol spec §3.5. The decision card (`orwellDecision.js`) submits ENGINE-DIRECT. Phase-1
adds a socket-native path: when the OrwellWs socket is LIVE (flag `ORWELL_WS_TRANSPORT` ON +
a successful handshake) the confirm goes UP as a `decision` frame carrying the 0065
`expectedBeatSeq` CAS; fix #1866: the server relay now runs the EXACT post-submit seams the
HTTP handler runs (via shared ``_post_decision_tail``) — F14 advance, pending cache, CON-4
reconcile, DB1 debounce — so the parity claim is TRUE. When the socket is not active (flag
OFF — the zero-risk Phase-1 default — or a failed/downgraded upgrade) the byte-identical
HTTP POST stands.

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


# ── STRUCTURAL — fix #1866: WS decision relay now matches HTTP decision tail seams ────

WS = _read("routes", "ws_routes.py")


def test_ws_calls_remember_clear_pending():
    assert "_post_decision_tail" in WS, \
        "ws_routes must call the shared _post_decision_tail (which runs remember/clear_pending)"
    assert "post_decision_tail(decision" in WS, \
        "_post_decision_tail must be called with the decision dict in the success path"


def test_ws_calls_handle_stale_beat():
    assert "_handle_stale_beat" in WS, \
        "ws_routes must import and call _handle_stale_beat in the stale-beat reconcile path"
    assert "_is_stale_beat" in WS, "the stale-beat detection helper must be present"


def test_ws_checks_recent_decision_failure_before_submit():
    body = WS
    assert "_recent_decision_failure" in body, \
        "ws_routes must check _recent_decision_failure BEFORE calling submit_decision"
    # Scope the check to _handle_decision's function body — extract from the function
    # definition through its closing.
    fn_start = body.find("async def _handle_decision")
    assert fn_start != -1, "_handle_decision function must exist"
    fn_body = body[fn_start:]
    sub_call = fn_body.find("submit_decision")
    deb_check = fn_body.find("_recent_decision_failure")
    assert deb_check != -1 and sub_call != -1 and deb_check < sub_call, \
        "the debounce check (call to _recent_decision_failure) must appear BEFORE the submit_decision call within _handle_decision"


def test_ws_calls_remember_decision_failure():
    body = WS
    assert "_remember_decision_failure" in body, \
        "ws_routes must call _remember_decision_failure after an engine error for debounce"


def test_ws_advance_game_on_goodbye():
    assert "_post_decision_tail" in WS, \
        "_post_decision_tail is the shared function that includes F14 post-goodbye advance_game"


def test_ws_state_edge_goodbye_reconciled():
    body = WS
    assert "decision-reconciled" in body, \
        "the stale-beat reconcile success path must emit a state edge with reason decision-reconciled"


def test_ws_debounce_frame():
    body = WS
    assert "debounced" in body, \
        "the WS debounce path must emit an error frame with code 'debounced'"
    assert "_recent_decision_failure(user, decision)" in body, \
        "the debounce query must pass user and decision to the shared helper"


def test_parity_claim_now_true_in_orwellDecision_js():
    js = _read("static", "js", "orwellDecision.js")
    # The comment should say the parity claim is TRUE, not a future promise.
    assert "the parity claim is TRUE" in js, \
        "orwellDecision.js comment must acknowledge that the parity claim is now true"
    assert "_post_decision_tail" in js, \
        "orwellDecision.js comment must reference the shared function by name"


def test_parity_claim_now_true_in_orwellWs_js():
    js = _read("static", "js", "orwellWs.js")
    assert "the parity claim is TRUE" in js, \
        "orwellWs.js comment must acknowledge that the parity claim is now true"


def test_parity_claim_now_true_in_test_header():
    header = _read("tests", "test_ws_decision_wire.py")
    assert "the parity claim is TRUE" in header, \
        "test file header must acknowledge that the parity claim is now true"


# ── BEHAVIORAL ── fix #1866: Node harness for goodbye-advance and debounce ────────

_HARNESS_SEAMS = r"""
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
    API_BASE: "", ORWELL_WS_TRANSPORT: true,
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

async function goLive(beatSeq) {
  const { WS } = boot();
  lastSock.readyState = 1; lastSock.onopen();
  const hello = lastSock.sent.find((f) => f.t === "hello");
  lastSock.onmessage({ data: JSON.stringify({ t: "ack", cid: hello.cid, d: { canonicalId: "sess_live", live: true, beatSeq: beatSeq } }) });
  await tick();
  const sub = lastSock.sent.find((f) => f.t === "subscribe");
  lastSock.onmessage({ data: JSON.stringify({ t: "ack", ch: "chat", cid: sub.cid, d: { fromSeq: 0, headSeq: -1 } }) });
  await tick();
  assert(WS.isActive() === true, "socket must be ws-active");
  return WS;
}

(async function main() {
  // seam 1: goodbye decision frame carries the full payload verbatim (feeds _post_decision_tail)
  {
    const WS = await goLive(42);
    WS.sendDecision({ kind: "goodbye-message", target: "npc_7", idempotency_key: "dec:gb|xyz" });
    const dec = lastSock.sent.find((f) => f.t === "decision");
    assert(dec.d.kind === "goodbye-message", "goodbye kind survives");
    assert(dec.d.target === "npc_7", "goodbye target survives");
    assert(dec.d.idempotencyKey === "dec:gb|xyz", "idempotencyKey survives");
  }

  // seam 2: WS sendDecision has idempotency_key / expectedBeatSeq just like HTTP
  {
    const WS = await goLive(77);
    WS.sendDecision({ kind: "eviction-vote", vote: "npc_3", idempotency_key: "dec:ev|abc", expectedBeatSeq: 80 });
    const dec = lastSock.sent.find((f) => f.t === "decision");
    assert(dec.d.expectedBeatSeq === 80, "explicit expectedBeatSeq pins correctly");
    assert(dec.d.idempotencyKey === "dec:ev|abc", "snake_case normalized to camelCase");
  }

  console.log("OK");
  process.exit(0);
})();
"""


def _run_node_harness(harness, modpath):
    node = shutil.which("node")
    if not node:
        pytest.skip("node not available for the behavioral seam check")
    proc = subprocess.run(
        [node, "-e", harness, modpath],
        capture_output=True, text=True, timeout=30,
    )
    assert proc.returncode == 0, f"node failed: {proc.stdout}\n{proc.stderr}"
    return proc.stdout


def test_ws_goodbye_payload_rides_decision_frame():
    """A goodbye-message decision over WS carries the full body verbatim for _post_decision_tail."""
    out = _run_node_harness(_HARNESS_SEAMS, os.path.join(STATIC, "orwellWs.js"))
    assert "OK" in out
