"""#1596 / #1570 — engine-restart mid-stream reconnect: beatSeq self-heal, resync, and the
observer live-render lock (the reconcile-vs-stream race).

Three fixes on the ONE WS/mirror/render seam, pinned here:

  • #1596 beatSeq SELF-HEAL — `orwellWs.js` holds a monotonic-forward last-seen `beatSeq` (0065 CAS
    token). When the engine RESTARTS (power outage) its committed head can move BACKWARDS; if the client
    keeps attaching its now-FUTURE `expectedBeatSeq` it 409s every up-frame forever (the wedge). An
    AUTHORITATIVE source (the stale-beat CAS refusal, or the reconnect handshake ack) that reports a
    LOWER beat must be ADOPTED downward (`_adoptBeat`) and emit `orwell:ws-resync` so the chat reconciles.

  • #1596 RECONNECT run-gone — a reconnect whose chat re-subscribe finds NO live run (`hasRun:false`)
    means the mid-tail run was interrupted by the restart; the client emits `orwell:ws-resync` (never
    sits wedged on the half-painted bubble).

  • #1570 observer LOCK — the peer/observer live render must hold an active-stream lock so a racing
    `softReloadHistory` DEFERS to the shared incremental renderer (pinned structurally in chatWsSplice).

BEHAVIORAL legs drive the REAL orwellWs.js in Node with a stubbed WebSocket (the same idiom as
test_ws_run_started_reattach.py / test_1087_ws_replay_churn.py). Roles only; no names.
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


# ── BEHAVIORAL — the REAL orwellWs.js in Node ──────────────────────────────────────────────────────

_HARNESS = r"""
const fs = require("node:fs");
const src = fs.readFileSync(process.argv[1], "utf8");
function assert(c, m) { if (!c) { throw new Error("ASSERT: " + m); } }
process.on("unhandledRejection", (e) => { console.error(e); process.exit(1); });
const tick = () => new Promise((r) => setImmediate(r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let lastSock = null;
let resyncs = [];

function boot() {
  resyncs = [];
  global.CustomEvent = function (t, i) { this.type = t; this.detail = i && i.detail; };
  global.console = console;
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
  global.window.addEventListener("orwell:ws-resync", (e) => resyncs.push(e.detail || {}));
  global.document = { readyState: "complete", body: { dataset: { gameBuild: "1" } }, addEventListener() {} };
  global.window.document = global.document;
  delete global.window.OrwellWs;
  (0, eval)(src);
  return global.window.OrwellWs;
}

function down(frame) { lastSock.onmessage({ data: JSON.stringify(frame) }); }
function chatSubs() { return lastSock.sent.filter((f) => f.t === "subscribe" && f.ch === "chat"); }

async function handshake(beat, hasRun) {
  lastSock.readyState = 1; lastSock.onopen();
  const hello = lastSock.sent.find((f) => f.t === "hello");
  down({ t: "ack", cid: hello.cid, d: { canonicalId: "sess_pertab", live: true, beatSeq: beat } });
  await tick();
  const sub = chatSubs()[chatSubs().length - 1];
  down({ t: "ack", ch: "chat", cid: sub.cid, d: { fromSeq: 0, headSeq: 0, hasRun: !!hasRun } });
  await tick();
}

(async function main() {
  // ── scenario 1: stale-beat CAS refusal with a LOWER beat heals DOWNWARD + resyncs ──
  {
    const WS = boot();
    await tick();
    await handshake(60, true);
    // advance last-seen to 60 via a live state frame (monotonic-forward is the normal rule).
    down({ t: "state", ch: "state", d: { beatSeq: 60, reason: "advance" } });
    await tick();
    assert(WS.lastBeatSeq() === 60, "last-seen tracks the live head; got " + WS.lastBeatSeq());

    // The player sends a turn; the engine RESTARTED and its head is now 5 → stale-beat refusal.
    const p = WS.sendTurn({ message: "I pull them aside" });
    const turn = lastSock.sent.find((f) => f.t === "turn");
    assert(turn && turn.d.expectedBeatSeq === 60, "the turn attached the (now stale) last-seen beat");
    down({ t: "error", cid: turn.cid, d: { code: "stale-beat", beatSeq: 5 } });
    await p.then(() => { throw new Error("turn should have rejected"); }, () => {});
    await tick();
    assert(WS.lastBeatSeq() === 5,
      "a stale-beat error with a LOWER authoritative beat must HEAL DOWNWARD; got " + WS.lastBeatSeq());
    assert(resyncs.some((r) => r.reason === "beat-backwards"),
      "a backwards heal must emit orwell:ws-resync{reason:beat-backwards}");

    // …and the NEXT turn now attaches the healed beat (5), not the stale 60 — the wedge is broken.
    const before = lastSock.sent.filter((f) => f.t === "turn").length;
    WS.sendTurn({ message: "again" });
    const turn2 = lastSock.sent.filter((f) => f.t === "turn")[before];
    assert(turn2 && turn2.d.expectedBeatSeq === 5,
      "the next up-frame attaches the HEALED beat (no infinite 409); got " + (turn2 && turn2.d.expectedBeatSeq));
  }

  // ── scenario 2: a NORMAL stale-beat (a peer moved the board FORWARD) still advances, no resync ──
  {
    const WS = boot();
    await tick();
    await handshake(10, true);
    down({ t: "state", ch: "state", d: { beatSeq: 10, reason: "advance" } });
    await tick();
    const p = WS.sendTurn({ message: "x" });
    const turn = lastSock.sent.find((f) => f.t === "turn");
    down({ t: "error", cid: turn.cid, d: { code: "stale-beat", beatSeq: 12 } });  // peer advanced 10 -> 12
    await p.then(() => {}, () => {});
    await tick();
    assert(WS.lastBeatSeq() === 12, "a forward stale-beat still advances last-seen; got " + WS.lastBeatSeq());
    assert(!resyncs.some((r) => r.reason === "beat-backwards"),
      "a normal forward reconcile must NOT emit a backwards resync");
  }

  // ── scenario 3: RECONNECT after a restart — a LOWER handshake beat heals + the run-gone resync ──
  {
    const WS = boot();
    await tick();
    await handshake(60, true);
    down({ t: "event", ch: "chat", seq: 0, d: { delta: "streaming..." } });  // mid-tail; highestChatSeq = 0
    await tick();
    resyncs = [];

    // DROP mid-stream (engine/box restart). onclose schedules a reconnect (RECONNECT_BASE_MS = 500ms).
    lastSock.onclose();
    await sleep(700);   // let the reconnect timer fire → a fresh socket
    // The reconnected handshake: the engine came back with a LOWER head (5) and the mid-tail run is GONE.
    await handshake(5, false);
    assert(WS.lastBeatSeq() === 5,
      "a reconnect handshake with a LOWER beat must adopt it (engine restart); got " + WS.lastBeatSeq());
    assert(resyncs.some((r) => r.reason === "beat-backwards"),
      "the reconnect backwards-beat must emit a resync");
    assert(resyncs.some((r) => r.reason === "reconnect-run-gone"),
      "a reconnect that finds hasRun:false must emit a run-gone resync (never sit wedged)");
  }

  // ── scenario 4: RECONNECT where the beat is UNCHANGED but the run is gone → still resyncs ──
  {
    const WS = boot();
    await tick();
    await handshake(30, true);
    down({ t: "event", ch: "chat", seq: 0, d: { delta: "partial" } });
    await tick();
    resyncs = [];
    lastSock.onclose();
    await sleep(700);
    await handshake(30, false);   // same beat, but the interrupted run is gone
    assert(WS.lastBeatSeq() === 30, "an unchanged beat stays put; got " + WS.lastBeatSeq());
    assert(!resyncs.some((r) => r.reason === "beat-backwards"), "no backwards heal when the beat is unchanged");
    assert(resyncs.some((r) => r.reason === "reconnect-run-gone"),
      "a reconnect onto a vanished run must still resync so the wedged bubble reconciles");
  }

  console.log("OK");
  process.exit(0);
})();
"""


def _run_node(harness, modpath):
    node = shutil.which("node")
    if not node:
        pytest.skip("node not available for the behavioral beatSeq self-heal check")
    proc = subprocess.run([node, "-e", harness, modpath], capture_output=True, text=True, timeout=30)
    assert proc.returncode == 0, f"node failed: {proc.stdout}\n{proc.stderr}"
    return proc.stdout


def test_beatseq_self_heal_and_reconnect_resync():
    out = _run_node(_HARNESS, os.path.join(STATIC, "orwellWs.js"))
    assert "OK" in out


# ── STRUCTURAL — pin the seam so a revert fails ────────────────────────────────────────────────────

WS = _read("static", "js", "orwellWs.js")
SPLICE = _read("static", "js", "chatWsSplice.js")
CHAT = _read("static", "js", "chat.js")


def test_adopt_beat_can_heal_downward_and_resync():
    body = WS.split("function _adoptBeat")[1].split("\n  function ")[0]
    assert "b < _beatSeq" in body, "_adoptBeat must detect a BACKWARDS engine head (the restart signal)"
    assert "orwell:ws-resync" in body, "a backwards heal must emit orwell:ws-resync"
    # #1599 — the auto-correction must be LOGGED, never silently swallowed.
    assert "console.warn" in body and "#1596" in body, \
        "a backwards heal is an auto-corrected real anomaly — it must log at WARN (#1599)"


def test_stale_beat_error_adopts_authoritatively():
    on_err = WS.split("function _onError")[1].split("\n  function ")[0]
    assert 'd.code === "stale-beat"' in on_err and "_adoptBeat(d.beatSeq)" in on_err, \
        "the stale-beat CAS refusal must ADOPT the surfaced beat (heal downward), not _noteBeat it"


def test_reconnect_handshake_adopts_and_run_gone_resyncs():
    onopen = WS.split("sock.onopen = function ()")[1].split("sock.onmessage")[0]
    assert "wasReconnect" in onopen, "the reconnect handshake must capture reconnect-ness before _activate"
    assert "_adoptBeat(_hb)" in onopen, "a reconnect handshake must adopt its ack beat authoritatively"
    assert 'reason: "reconnect-run-gone"' in onopen and "hasRun === false" in onopen, \
        "a reconnect finding no live run must emit a run-gone resync"


def _strip_comments(src: str) -> str:
    # Drop // line comments (crude but enough: our dispatch-guard only cares about CODE, and comments
    # legitimately reference gamechanged/orwellGameChanged in the prose). Block comments left intact —
    # they don't contain the dispatch call forms we guard.
    out = []
    for line in src.splitlines():
        idx = line.find("//")
        out.append(line if idx == -1 else line[:idx])
    return "\n".join(out)


def test_ws_resync_is_not_the_gamechanged_dispatcher():
    # #1596 must NOT add a second orwell:gamechanged dispatcher (the g15 rule); ws-resync is a DISTINCT
    # event. The authoritative g15 gate is test_g15_gamechanged.py — here we just prove the new resync
    # path never dispatches gamechanged in CODE (comments referencing it are fine).
    for hay in (_strip_comments(WS), _strip_comments(SPLICE)):
        # LISTENING for gamechanged is fine (orwellWs rebinds on it); only DISPATCHING is banned. The
        # dispatch signatures are the CustomEvent literal + the platform.js helper call.
        assert "orwellGameChanged(" not in hay, "the single dispatcher lives in platform.js only"
        assert "CustomEvent('orwell:gamechanged'" not in hay
        assert 'CustomEvent("orwell:gamechanged"' not in hay
    assert "orwell:ws-resync" in SPLICE, \
        "the resync handler must reconcile via softReloadHistory, on the distinct ws-resync event"


def test_observer_live_render_holds_the_stream_lock_1570():
    ensure = SPLICE.split("function _wsEnsureRound")[1].split("\nexport function ")[0]
    assert "_resumingStreams.add" in ensure, \
        "#1570 — the observer live render must register an active-stream lock so softReloadHistory DEFERS"
    done = SPLICE.split("if (d.done)")[1]
    assert "_resumingStreams.delete" in done, \
        "#1570 — the observer lock must be released at the run's done"


def test_resync_handler_breaks_the_wedge():
    body = SPLICE.split("function _onWsResync")[1].split("\nexport function ")[0]
    assert "_wsResetRound" in body and ".remove()" in body, \
        "the resync handler must tear down the wedged live holder"
    assert "_resumingStreams.delete" in body and "_softReloadHistory" in body, \
        "the resync handler must RELEASE the dead lock then reconcile from history (else it stays deferred)"
    assert "console.warn" in body, "#1599 — the resync auto-correction must log at WARN"
    assert "console.error" in body, "#1599 — a reconcile that THROWS must be surfaced, never swallowed"


def test_chat_wires_the_resync_listener():
    assert "_onWsResync" in CHAT and "orwell:ws-resync" in CHAT, \
        "chat.js must import _onWsResync and add the orwell:ws-resync window listener"
