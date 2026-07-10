"""WebSocket Phase-1 — case (c): multiplex isolation (frames never cross channels).

Protocol spec §7 case (c) / test plan §5: one multiplexed socket carries `chat`,
`state`, `hud`, `layout`, `notice`. The CLIENT frame router (orwellWs.js) MUST dispatch
strictly by `ch` — a `hud`/`state`/`layout` frame never reaches the chat renderer, and a
`chat` delta never reaches the layout/HUD stores. And the reasoning split (§3.4) rides
INSIDE the one `chat` channel as a `d.thinking` flag — never a separate `ch` — so a stray
channel can never become a second public path (the reasoning-scrub contract).

Two halves, mirroring the repo convention (e.g. test_985_crossdevice_peer_resume.py):
  • BEHAVIORAL — run the REAL orwellWs.js router in Node against stubbed globals, feed an
    interleaved frame sequence, assert strict per-`ch` dispatch with zero cross-bleed.
  • STRUCTURAL — pin the router legs + the platform.js `state`/`hud` → one-dispatcher
    bridge + the chat.js reasoning split so a revert that collapses the router fails.

The full two-window browser-integration + the F5 mirror-parity gate (WS and fallback mode)
run once the server route (claude/ws-phase1-server) is on main; this file is the client-half
gate that stands now, key-free, against the frozen wire contract. Roles only; no names.
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


# ── BEHAVIORAL — the real orwellWs.js router, in Node ────────────────────────────

# A self-contained harness: stub window/document/CustomEvent/WebSocket, eval the REAL
# orwellWs.js (a plain IIFE — no import/export), register per-channel spies, feed an
# interleaved frame burst through the public `_handleFrame`, and assert routing.
_HARNESS = r"""
const fs = require("node:fs");
// `node -e <code> <modpath>` puts the module path at argv[1] (no script path in -e mode).
const src = fs.readFileSync(process.argv[1], "utf8");

function assert(c, m) { if (!c) { throw new Error("ASSERT: " + m); } }

const events = [];
global.CustomEvent = function (type, init) { this.type = type; this.detail = init && init.detail; };
global.WebSocket = function () { this.readyState = 0; };   // never opened — router test needs no socket
global.window = {
  API_BASE: "",
  ORWELL_WS_TRANSPORT: undefined,          // flag OFF: no socket attempt; _handleFrame still routes
  addEventListener() {}, removeEventListener() {},
  dispatchEvent(e) { events.push({ type: e.type, detail: e.detail }); return true; },
  location: { protocol: "http:", host: "localhost" },
  sessionModule: { getCurrentSessionId() { return "sess_test"; } },
};
global.document = { readyState: "complete", body: { dataset: {} }, addEventListener() {} };
global.window.document = global.document;

(0, eval)(src);
const WS = global.window.OrwellWs;
assert(WS && typeof WS.onFrame === "function", "OrwellWs.onFrame missing");
assert(typeof WS._handleFrame === "function", "OrwellWs._handleFrame missing");

const seen = { chat: [], state: [], hud: [], layout: [], notice: [] };
WS.onFrame("chat", (f) => seen.chat.push(f));
WS.onFrame("state", (f) => seen.state.push(f));
WS.onFrame("hud", (f) => seen.hud.push(f));
WS.onFrame("layout", (f) => seen.layout.push(f));
WS.onFrame("notice", (f) => seen.notice.push(f));

// Interleave chat deltas with hud/layout/state/notice frames on the ONE socket (§5 case c).
WS._handleFrame({ t: "event", ch: "chat",  seq: 0, d: { delta: "He glances", thinking: false } });
WS._handleFrame({ t: "hud",   ch: "hud",           d: { beatSeq: 7, kind: "whereabouts" } });
WS._handleFrame({ t: "event", ch: "chat",  seq: 1, d: { delta: "at the wall", thinking: true } }); // reasoning rides IN chat
WS._handleFrame({ t: "layout", ch: "layout",       d: { windowId: "hud-roster", state: { x: 40 } } });
WS._handleFrame({ t: "state", ch: "state",         d: { beatSeq: 8, reason: "advance" } });
WS._handleFrame({ t: "notice", ch: "notice",       d: { id: "n_1", kind: "system" } });
WS._handleFrame({ t: "event", ch: "chat",  seq: 2, d: { done: true } });

// Strict per-channel dispatch: each channel got exactly its own frames.
assert(seen.chat.length === 3, "chat got " + seen.chat.length + " (want 3)");
assert(seen.hud.length === 1, "hud got " + seen.hud.length);
assert(seen.state.length === 1, "state got " + seen.state.length);
assert(seen.layout.length === 1, "layout got " + seen.layout.length);
assert(seen.notice.length === 1, "notice got " + seen.notice.length);

// NO cross-bleed: a non-chat frame never reached the chat channel, and no chat delta
// reached the layout/hud/state/notice channels.
for (const f of seen.chat) { assert(f.ch === "chat", "non-chat frame reached chat: " + JSON.stringify(f)); }
for (const ch of ["state", "hud", "layout", "notice"]) {
  for (const f of seen[ch]) {
    assert(f.ch === ch, ch + " channel got a foreign frame: " + JSON.stringify(f));
    assert(!(f.d && typeof f.d.delta === "string"), ch + " channel got a chat delta (leak)");
  }
}

// The reasoning delta (d.thinking:true) is delivered on the `chat` channel — NEVER a
// separate `ch` (§3.4). The reply/reasoning SPLIT happens client-side inside chat.js.
const thinking = seen.chat.filter((f) => f.d && f.d.thinking === true);
assert(thinking.length === 1, "the thinking delta must ride the chat channel");

// The reconnect cursor tracks the highest chat seq seen (§3.3 monotonicity).
assert(WS.highestChatSeq() === 2, "highestChatSeq should track the max chat seq");

console.log("OK");
"""


def _run_node(harness, modpath):
    node = shutil.which("node")
    if not node:
        pytest.skip("node not available for the behavioral multiplex-isolation check")
    proc = subprocess.run(
        [node, "-e", harness, modpath],
        capture_output=True, text=True, timeout=30,
    )
    assert proc.returncode == 0, f"node failed: {proc.stdout}\n{proc.stderr}"
    return proc.stdout


def test_router_dispatches_strictly_by_channel_no_cross_bleed():
    out = _run_node(_HARNESS, os.path.join(STATIC, "orwellWs.js"))
    assert "OK" in out


# ── STRUCTURAL — pin the router legs so a revert fails ───────────────────────────

WS = _read("static", "js", "orwellWs.js")
PLATFORM = _read("static", "js", "platform.js")
CHAT = _read("static", "js", "chat.js")


def test_orwellws_routes_by_ch_with_a_registry_per_channel():
    # A per-channel handler registry keyed by the five Phase-1 channels.
    assert "_handlers = {" in WS
    for ch in ("chat", "state", "hud", "layout", "notice"):
        assert ch in WS, f"router must know the {ch} channel"
    # `event` frames route by `ch`, and chat is the only stream-buffer channel.
    assert 'frame.ch === "chat"' in WS
    assert "_handleFrame" in WS and "function onFrame" in WS


def test_state_and_hud_bridge_calls_the_one_gamechanged_dispatcher():
    # platform.js — the ONE caller of orwellGameChanged for socket board edges (§4/g15).
    assert "onFrame('state'" in PLATFORM and "onFrame('hud'" in PLATFORM
    assert "orwellGameChanged('ws:state'" in PLATFORM
    # NO ad-hoc dispatch — the g15 single-dispatcher invariant is untouched (that gate,
    # test_g15_gamechanged.py, asserts the only `new CustomEvent('orwell:gamechanged')`
    # lives in platform.js; our bridge calls the HELPER, never dispatches).
    assert "new CustomEvent('orwell:gamechanged'" not in \
        _read("static", "js", "orwellWs.js")


def test_chat_reasoning_split_survives_on_the_socket():
    # The chat consumer keeps the reasoning split VERBATIM (§3.4): d.thinking → reasoning
    # buffer (the accordion), else → the reply body — reasoning can never reach the body.
    assert "_onWsChatFrame" in CHAT
    assert "d.thinking" in CHAT and "round.reasoning" in CHAT and "round.reply" in CHAT
    # It reuses the SHARED incremental renderer, not a second engine (ADR 0015).
    assert "_renderLiveStream(round.contentDiv" in CHAT
