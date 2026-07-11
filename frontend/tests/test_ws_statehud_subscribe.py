"""WebSocket Phase-1 — the state/hud subscribe keystone (the HUD push edge).

Protocol spec §3.1 (subscribe) + §4 (state/hud push): the server's continuous
`session_events → state/hud` bridge (`_run_state_channel`, ws_routes.py) is spawned
ONLY when the client sends `subscribe{ch:"state"}` / `subscribe{ch:"hud"}`. Without
those subscribes the bridge never runs, the only `state` frame a client ever sees is
the one-shot inline one from the decision handler, and platform.js's correct
`state`/`hud` → `orwellGameChanged` bridge STARVES — the HUD gets no push edge.

This was a genuine gap (poll-census audit): `orwellWs.js` `_connect`/`onopen`/`rebind`
only issued `_subscribeChat(...)`. This gate proves the client now ALSO arms the two
edge channels after every successful handshake, and re-arms them on reconnect and on a
CHANGED-id rebind. A SAME-id rebind must NOT re-arm them (#1087: a same-id re-arm respawns
the server's session_events bridge, whose fresh subscribe replays the event ring back into
`orwell:gamechanged` — the rebind→ring-replay churn loop).

Unlike `chat`, the server sends NO success `ack` for a state/hud subscribe (only an
`error` on refusal — ws_routes.py `_handle_subscribe`), so these MUST be fire-and-forget
(no request/response promise that would hang forever). This file pins that too.

Two halves, mirroring the repo convention (test_ws_fallback_negotiation.py):
  • BEHAVIORAL — run the REAL orwellWs.js in Node against a stubbed WebSocket; drive the
    handshake and assert the state+hud subscribes are sent after it; then rebind and
    reconnect and assert both channels are re-armed.
  • STRUCTURAL — pin the edge-subscribe helper + its wiring so a revert fails.

Roles only; no names.
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


# ── BEHAVIORAL — the real orwellWs.js, in Node ───────────────────────────────────

_HARNESS = r"""
const fs = require("node:fs");
const src = fs.readFileSync(process.argv[1], "utf8");
function assert(c, m) { if (!c) { throw new Error("ASSERT: " + m); } }
process.on("unhandledRejection", (e) => { console.error(e); process.exit(1); });
const tick = () => new Promise((r) => setImmediate(r));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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
  const listeners = {};
  global.window = {
    API_BASE: "", ORWELL_WS_TRANSPORT: true,          // flag ON
    addEventListener(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
    removeEventListener() {},
    dispatchEvent(e) {
      events.push(e);
      (listeners[e.type] || []).forEach((fn) => { try { fn(e); } catch (_) {} });
      return true;
    },
    location: { protocol: "https:", host: "example.test" },
    sessionModule: { getCurrentSessionId() { return "sess_live"; } },
  };
  global.document = { readyState: "complete", body: { dataset: { gameBuild: "1" } }, addEventListener() {} };
  global.window.document = global.document;
  delete global.window.OrwellWs;
  (0, eval)(src);
  return { WS: global.window.OrwellWs, events, listeners };
}

// Drive a full handshake to ws-active on the current lastSock.
async function handshake(beat) {
  lastSock.readyState = 1; lastSock.onopen();
  const hello = lastSock.sent.find((f) => f.t === "hello" || f.t === "bind");
  lastSock.onmessage({ data: JSON.stringify({ t: "ack", cid: hello.cid,
    d: { canonicalId: "sess_live", live: true, beatSeq: beat } }) });
  await tick();
  const sub = lastSock.sent.find((f) => f.t === "subscribe" && f.ch === "chat");
  lastSock.onmessage({ data: JSON.stringify({ t: "ack", ch: "chat", cid: sub.cid,
    d: { fromSeq: 0, headSeq: -1 } }) });
  await tick();
}

function edgeSubs(sock) {
  const state = sock.sent.filter((f) => f.t === "subscribe" && f.ch === "state");
  const hud = sock.sent.filter((f) => f.t === "subscribe" && f.ch === "hud");
  return { state, hud };
}

(async function main() {
  // ── scenario 1: after the handshake, the client arms state AND hud ──────────────
  {
    const { WS } = boot();
    await handshake(118);
    assert(WS.isActive() === true, "handshake should reach ws-active");
    const { state, hud } = edgeSubs(lastSock);
    assert(state.length === 1, "must send exactly one subscribe{ch:'state'}, got " + state.length);
    assert(hud.length === 1, "must send exactly one subscribe{ch:'hud'}, got " + hud.length);
    // §3.1 frame shape: t/ch/cid, and NO fromSeq (edge channels have no replay).
    for (const f of [state[0], hud[0]]) {
      assert(typeof f.cid === "string" && f.cid, f.ch + " subscribe must carry a cid (§3.1)");
      assert(!f.d || f.d.fromSeq === undefined, f.ch + " subscribe must NOT carry a fromSeq (edge, no replay)");
    }
    // Fire-and-forget: a state/hud subscribe registers NO pending promise, so an
    // out-of-band ack for it is a harmless no-op and never wedges the pipe. Feeding a
    // bare (untracked-cid) state edge down-frame still routes to the state handler.
    let bridged = 0;
    WS.onFrame("state", () => { bridged++; });
    lastSock.onmessage({ data: JSON.stringify({ t: "state", ch: "state", d: { beatSeq: 119, reason: "advance" } }) });
    assert(bridged === 1, "an incoming state edge must route to the state handler");
  }

  // ── scenario 2: a rebind re-arms the edges ONLY on a genuine canonical change (#1087) ──
  // A SAME-id rebind must NOT re-arm: the live server bridge already serves this canonical, and a
  // re-arm respawns it → a fresh session_events.subscribe() → the event ring REPLAYS back at a
  // window that already consumed it → platform.js bridges the replayed frames into
  // `orwell:gamechanged` → another rebind — the self-sustaining churn loop issue #1087 traced.
  // A CHANGED-id rebind (adoption / season-reset re-resolve) DOES re-arm: the running bridge
  // serves its spawn-time canonical, so the re-point needs a fresh subscribe.
  {
    const { WS, listeners } = boot();
    await handshake(200);
    const before = edgeSubs(lastSock);
    assert(before.state.length === 1 && before.hud.length === 1, "baseline: one each after handshake");
    // SAME-id gamechanged rebind → no new edge subscribes.
    global.window.dispatchEvent({ type: "orwell:gamechanged" });
    await tick();
    const bind = lastSock.sent.find((f) => f.t === "bind");
    assert(bind, "orwell:gamechanged should trigger a bind");
    lastSock.onmessage({ data: JSON.stringify({ t: "ack", cid: bind.cid,
      d: { canonicalId: "sess_live", live: true, beatSeq: 201 } }) });
    await tick(); await tick();
    const same = edgeSubs(lastSock);
    assert(same.state.length === 1, "a same-id rebind must NOT re-arm state (#1087 churn guard), got " + same.state.length);
    assert(same.hud.length === 1, "a same-id rebind must NOT re-arm hud (#1087 churn guard), got " + same.hud.length);
    // CHANGED-id rebind → both edges re-arm (the genuine re-point).
    global.window.dispatchEvent({ type: "orwell:gamechanged" });
    await tick();
    const binds = lastSock.sent.filter((f) => f.t === "bind");
    lastSock.onmessage({ data: JSON.stringify({ t: "ack", cid: binds[binds.length - 1].cid,
      d: { canonicalId: "sess_other", live: true, beatSeq: 202 } }) });
    await tick(); await tick();
    const after = edgeSubs(lastSock);
    assert(after.state.length === 2, "a changed-id rebind must RE-arm state (want 2), got " + after.state.length);
    assert(after.hud.length === 2, "a changed-id rebind must RE-arm hud (want 2), got " + after.hud.length);
  }

  // ── scenario 3: a dropped socket reconnects and re-arms all three channels ───────
  {
    const { WS } = boot();
    await handshake(300);
    const firstSock = lastSock;
    assert(edgeSubs(firstSock).state.length === 1, "first socket armed state");
    // Render a couple chat events so the reconnect resumes from a gap cursor.
    firstSock.onmessage({ data: JSON.stringify({ t: "event", ch: "chat", seq: 0, d: { delta: "a" } }) });
    firstSock.onmessage({ data: JSON.stringify({ t: "event", ch: "chat", seq: 1, d: { delta: "b" } }) });
    // Socket drops while live → the client schedules a reconnect (bounded backoff).
    firstSock.readyState = 3; firstSock.onclose();
    assert(WS.mode() === "negotiating", "a live drop ⇒ reconnect (negotiating), got " + WS.mode());
    // First backoff is ~500ms → a NEW socket is constructed. Poll to a bounded deadline
    // instead of a fixed sleep, so a slow CI runner that delays the timer past a hard
    // wait isn't flaky (the following assert still fails clearly if no new socket appears).
    const deadline = Date.now() + 5000;
    while (lastSock === firstSock && Date.now() < deadline) await wait(50);
    assert(lastSock !== firstSock, "reconnect must construct a NEW socket");
    await handshake(301);
    const re = edgeSubs(lastSock);
    assert(re.state.length === 1, "reconnected socket must re-arm state, got " + re.state.length);
    assert(re.hud.length === 1, "reconnected socket must re-arm hud, got " + re.hud.length);
    // And the chat resub used the gap cursor (highest rendered + 1 = 2).
    const chatSub = lastSock.sent.find((f) => f.t === "subscribe" && f.ch === "chat");
    assert(chatSub.d.fromSeq === 2, "reconnect chat subscribe resumes from the gap (fromSeq 2), got " + chatSub.d.fromSeq);
  }

  console.log("OK");
  process.exit(0);
})();
"""


def _run_node(harness, modpath):
    node = shutil.which("node")
    if not node:
        pytest.skip("node not available for the behavioral state/hud subscribe check")
    proc = subprocess.run(
        [node, "-e", harness, modpath],
        capture_output=True, text=True, timeout=30,
    )
    assert proc.returncode == 0, f"node failed: {proc.stdout}\n{proc.stderr}"
    return proc.stdout


def test_client_subscribes_state_and_hud_and_rere_arms_on_reconnect():
    out = _run_node(_HARNESS, os.path.join(STATIC, "orwellWs.js"))
    assert "OK" in out


# ── STRUCTURAL — pin the edge-subscribe helper + its wiring ───────────────────────

WS = _read("static", "js", "orwellWs.js")
PLATFORM = _read("static", "js", "platform.js")


def test_edge_subscribe_helper_arms_state_and_hud():
    # A dedicated helper sends the two edge subscribes.
    assert "_subscribeEdges" in WS, "an edge-subscribe helper must exist"
    assert '"state"' in WS and '"hud"' in WS
    # It rides the §3.1 subscribe frame shape.
    assert 't: "subscribe"' in WS


def test_edge_subscribe_is_fire_and_forget_not_a_promise():
    # State/hud get NO success ack, so the helper must use the fire-and-forget `_send`,
    # NOT `_request` (which would register a pending promise that never resolves).
    import re
    body = WS.split("function _subscribeEdges")[1].split("function ")[0]
    assert "_send(" in body, "edge subscribes must go through the fire-and-forget _send"
    assert "_request(" not in body, "edge subscribes must NOT use the request/response _request"


def test_edges_armed_on_handshake_rebind_and_reconnect():
    # Called from the successful-handshake onopen path (fresh connect AND reconnect both
    # re-enter this onopen) and from rebind — so all three arm the HUD push edge.
    assert WS.count("_subscribeEdges()") >= 2, \
        "edges must be armed from BOTH the handshake onopen and rebind"
    # The onopen wiring sits right beside the chat subscribe.
    onopen = WS.split("sock.onopen")[1].split("sock.onmessage")[0]
    assert "_subscribeChat(" in onopen and "_subscribeEdges()" in onopen


def test_platform_bridge_consumes_the_now_fed_state_hud_frames():
    # The bridge that STARVED without this change: platform.js routes state/hud down-frames
    # to the ONE g15 dispatcher. Its presence proves the client subscribe is the missing
    # keystone, not a duplicate — orwellWs.js must NOT re-bridge to orwellGameChanged.
    assert "onFrame('state'" in PLATFORM and "onFrame('hud'" in PLATFORM
    assert "orwellGameChanged('ws:state'" in PLATFORM
    # orwellWs.js must not duplicate that bridge — it may MENTION the dispatcher in a
    # comment (the module contract), but never CALL it in live code.
    for line in WS.splitlines():
        code = line.split("//", 1)[0]
        assert "orwellGameChanged(" not in code, \
            "orwellWs.js must not call orwellGameChanged (that is platform.js's bridge)"
