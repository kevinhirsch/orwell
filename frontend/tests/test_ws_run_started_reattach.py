"""WebSocket Phase-1 — the `run-started` chat RE-ATTACH (protocol §4.1).

`agent_runs.subscribe()` replays a run's per-run buffer then returns WHEN THAT RUN ENDS — a standing
chat subscription does NOT tail across runs (each turn is a fresh `_Run` with its own buffer). So a
window that streamed turn #1 over WS is NO LONGER attached for turn #2: neither the sender nor a peer
receives the next run's live `event` frames, and the peer falls back to a static reconcile instead of
the shared incremental renderer (the mirror-parity WS leg's `bUsesIncrementalRenderer=false`).

Spec §4.1 (the `run-started` invitation edge): on a `state{reason:"run-started"}` for a run it is not
already tailing, the client must issue `subscribe{ch:"chat", fromSeq:0}` and mirror the new run from
its buffer. This pins that behavior in the REAL orwellWs.js: a `run-started` edge re-subscribes chat
(fromSeq 0), and — critically — it does NOT re-attach while a run is still actively tailing (§4.1
"a run it is not already tailing"), so a back-to-back turn never tears down an in-flight tail.

BEHAVIORAL — the REAL orwellWs.js in Node with a stubbed WebSocket. Roles only; no names.
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

function chatSubs() { return lastSock.sent.filter((f) => f.t === "subscribe" && f.ch === "chat"); }
function down(frame) { lastSock.onmessage({ data: JSON.stringify(frame) }); }

async function handshake(hasRunFirst, runId) {
  lastSock.readyState = 1; lastSock.onopen();
  const hello = lastSock.sent.find((f) => f.t === "hello");
  down({ t: "ack", cid: hello.cid, d: { canonicalId: "sess_pertab", live: true, beatSeq: 1 } });
  await tick();
  // The initial chat subscribe's ack: hasRun controls whether we're tailing a live run; runId
  // (when the server knows it) names that run for the #1087 reconcile-by-id guard.
  const sub = chatSubs()[0];
  const d = { fromSeq: 0, headSeq: hasRunFirst ? 0 : -1, hasRun: hasRunFirst };
  if (runId != null) d.runId = runId;
  down({ t: "ack", ch: "chat", cid: sub.cid, d: d });
  await tick();
}

(async function main() {
  // ── scenario 1: idle-at-attach (hasRun:false) → a run-started RE-ATTACHES chat ──
  {
    const WS = boot();
    await tick();
    await handshake(false);   // no live run at attach → not tailing
    assert(WS.isActive(), "socket engaged");
    const before = chatSubs().length;   // just the initial subscribe
    assert(before === 1, "one initial chat subscribe; got " + before);

    // A peer/self turn begins — the server pushes the run-started edge.
    down({ t: "state", ch: "state", d: { beatSeq: 2, reason: "run-started" } });
    await tick();
    const after = chatSubs();
    assert(after.length === 2, "run-started must RE-SUBSCRIBE chat (want 2), got " + after.length);
    assert(after[1].d.fromSeq === 0, "the re-attach subscribes the NEW run from seq 0; got " + after[1].d.fromSeq);
  }

  // ── scenario 2: a run's `done` ends the tail; the NEXT run-started re-attaches ──
  {
    const WS = boot();
    await tick();
    await handshake(true);    // a live run at attach → tailing it
    // The first run streams and ends.
    down({ t: "event", ch: "chat", seq: 0, d: { delta: "hi" } });
    down({ t: "event", ch: "chat", seq: 1, d: { done: true } });
    await tick();
    const before = chatSubs().length;
    assert(before === 1, "still just the initial subscribe after the first run; got " + before);

    // The next turn begins → re-attach (the previous tail is terminal).
    down({ t: "state", ch: "state", d: { beatSeq: 3, reason: "run-started" } });
    await tick();
    assert(chatSubs().length === 2, "a run-started after a run's done must re-attach; got " + chatSubs().length);
  }

  // ── scenario 3: NO re-attach while a run is still actively tailing (§4.1) ─────────
  {
    const WS = boot();
    await tick();
    await handshake(true);    // tailing a live run
    down({ t: "event", ch: "chat", seq: 0, d: { delta: "streaming..." } });
    await tick();
    const before = chatSubs().length;
    // A spurious/duplicate run-started while we're mid-stream must NOT tear the tail down.
    down({ t: "state", ch: "state", d: { beatSeq: 2, reason: "run-started" } });
    await tick();
    assert(chatSubs().length === before, "a run-started while ACTIVELY tailing must NOT re-subscribe (no tear-down)");
  }

  // ── scenario 4: a non-run-started state edge never re-subscribes chat ────────────
  {
    const WS = boot();
    await tick();
    await handshake(false);
    const before = chatSubs().length;
    down({ t: "state", ch: "state", d: { beatSeq: 5, reason: "advance" } });
    down({ t: "state", ch: "state", d: { beatSeq: 6, reason: "game-updated" } });
    await tick();
    assert(chatSubs().length === before, "a non-run-started state edge must NOT re-subscribe chat");
  }

  // ── scenario 5 (#1087 reconcile-by-id): a STALE replayed run-started for a run this window
  // already fully rendered must be IGNORED. session_events is at-least-once — its replay ring
  // re-delivers a finished run's run-started edge — and the boolean tail guard can't catch it
  // (the run's `done` already cleared it). Pre-fix this reset the cursor and full-replayed the
  // finished run: the repeating duplicate-bubble churn the toolturn gate failed on.
  {
    const WS = boot();
    await tick();
    await handshake(true, "r1");   // tailing run r1 (the ack names it)
    down({ t: "event", ch: "chat", seq: 0, d: { delta: "hi" } });
    down({ t: "event", ch: "chat", seq: 1, d: { done: true } });   // r1 finishes → tail cleared
    await tick();
    const before = chatSubs().length;   // 1 (the initial subscribe)
    // The ring replays r1's stale invitation (same runId) — possibly repeatedly. All ignored.
    down({ t: "state", ch: "state", d: { beatSeq: 4, reason: "run-started", runId: "r1" } });
    down({ t: "state", ch: "state", d: { beatSeq: 4, reason: "run-started", runId: "r1" } });
    await tick();
    assert(chatSubs().length === before,
      "a replayed run-started for an already-rendered run (same runId) must NOT re-subscribe; got " + chatSubs().length);
    // A genuinely NEW run (fresh runId) still re-attaches.
    down({ t: "state", ch: "state", d: { beatSeq: 5, reason: "run-started", runId: "r2" } });
    await tick();
    assert(chatSubs().length === before + 1,
      "a run-started with a NEW runId must re-attach; got " + chatSubs().length);
    assert(chatSubs()[before].d.fromSeq === 0, "the new run's re-attach subscribes from seq 0");
    // …and once r2 is rendered to its done, r2's OWN stale replay is ignored too (the loop-breaker).
    const sub2 = chatSubs()[before];
    down({ t: "ack", ch: "chat", cid: sub2.cid, d: { fromSeq: 0, headSeq: 0, hasRun: true, runId: "r2" } });
    down({ t: "event", ch: "chat", seq: 0, d: { delta: "next" } });
    down({ t: "event", ch: "chat", seq: 1, d: { done: true } });
    await tick();
    down({ t: "state", ch: "state", d: { beatSeq: 6, reason: "run-started", runId: "r2" } });
    await tick();
    assert(chatSubs().length === before + 1,
      "after rendering r2, a replayed r2 run-started must be ignored (no churn); got " + chatSubs().length);
  }

  // ── scenario 6 (#1087 back-compat): an id-less run-started (older server / evicted run) keeps
  // the boolean-only behavior — it re-attaches when not tailing, exactly as before.
  {
    const WS = boot();
    await tick();
    await handshake(true, "r1");
    down({ t: "event", ch: "chat", seq: 0, d: { delta: "hi" } });
    down({ t: "event", ch: "chat", seq: 1, d: { done: true } });
    await tick();
    const before = chatSubs().length;
    down({ t: "state", ch: "state", d: { beatSeq: 7, reason: "run-started" } });  // no runId
    await tick();
    assert(chatSubs().length === before + 1,
      "an id-less run-started must fall back to the boolean guard (re-attach when not tailing)");
  }

  // ── scenario 7 (the WS mirror-parity F5 flake — orphaned-invitation drain): a stale replayed
  // run-started issues an IN-FLIGHT subscribe (optimistically setting _chatTailActive=true); a
  // GENUINELY-NEW run-started that arrives before that subscribe's ack queues in _pendingRunId; the
  // in-flight subscribe then resolves `hasRun:false` (the stale run was already finished). Pre-fix,
  // _onAck cleared the tail but NEVER drained the pending — so the new (live) run was orphaned, the
  // peer window received zero delta frames and fell back to a full-repaint reconcile
  // (B incrementalStream=false). The fix drains the pending on the hasRun:false ack.
  {
    const WS = boot();
    await tick();
    await handshake(false);           // not tailing; _lastRunId UNSET (so a stale edge isn't id-skipped)
    const base = chatSubs().length;   // 1 (the initial subscribe)

    // A STALE replayed run-started for a now-finished run "W" arrives while the tail is free → it
    // issues an in-flight subscribe and optimistically marks the tail active.
    down({ t: "state", ch: "state", d: { beatSeq: 3, reason: "run-started", runId: "W" } });
    await tick();
    assert(chatSubs().length === base + 1, "stale edge W issues an in-flight subscribe; got " + chatSubs().length);
    const subW = chatSubs()[base];

    // Before W's ack lands, a GENUINELY-NEW run "M" starts → it must QUEUE behind the busy tail.
    down({ t: "state", ch: "state", d: { beatSeq: 4, reason: "run-started", runId: "M" } });
    await tick();
    assert(chatSubs().length === base + 1, "M queues behind the in-flight W subscribe (no new subscribe yet)");

    // W's subscribe resolves hasRun:false (W was already finished) → clears the tail. The orphan-drain
    // must now attach the queued live run M (pre-fix: M is orphaned and NEVER subscribed → the flake).
    down({ t: "ack", ch: "chat", cid: subW.cid, d: { fromSeq: 0, headSeq: -1, hasRun: false, runId: "W" } });
    await tick();
    assert(chatSubs().length === base + 2,
      "the orphaned pending run M must attach after the hasRun:false ack drains it; got " + chatSubs().length);
    assert(chatSubs()[base + 1].d.fromSeq === 0, "the drained run M attaches from seq 0");
  }

  console.log("OK");
  process.exit(0);
})();
"""


def _run_node(harness, modpath):
    node = shutil.which("node")
    if not node:
        pytest.skip("node not available for the behavioral run-started re-attach check")
    proc = subprocess.run(
        [node, "-e", harness, modpath],
        capture_output=True, text=True, timeout=30,
    )
    assert proc.returncode == 0, f"node failed: {proc.stdout}\n{proc.stderr}"
    return proc.stdout


def test_run_started_edge_reattaches_chat_channel():
    out = _run_node(_HARNESS, os.path.join(STATIC, "orwellWs.js"))
    assert "OK" in out


# ── STRUCTURAL — pin the re-attach so a revert (no run-started chat re-subscribe) fails ────

WS = _read("static", "js", "orwellWs.js")


def test_state_run_started_triggers_chat_reattach():
    state_case = WS.split('case "state":')[1].split("case ")[0]
    assert '"run-started"' in state_case and "_onRunStarted" in state_case, \
        "the state-frame router must re-attach chat on a run-started edge (§4.1)"


def test_reattach_is_guarded_by_active_tail():
    body = WS.split("function _onRunStarted")[1].split("\n  function ")[0]
    assert "_chatTailActive" in body, "the re-attach must be guarded on whether a run is already being tailed"
    assert "_subscribeChat(0)" in body, "the re-attach must subscribe the new run from seq 0"
    assert "_highestChatSeq = -1" in body, "the re-attach must reset the per-run cursor (new buffer starts at 0)"


def test_reattach_reconciles_by_run_id():
    # #1087: at-least-once run-started edges (the session_events replay ring) need an identity guard
    # beyond the boolean tail flag — a stale replayed edge for an already-rendered run must be a no-op.
    body = WS.split("function _onRunStarted")[1].split("\n  function ")[0]
    assert "_lastRunId" in body, "the re-attach must reconcile-by-id (skip an already-rendered run's edge)"
    # The authoritative id source is the chat subscribe ack (d.runId), recorded in _onAck.
    on_ack = WS.split("function _onAck")[1].split("\n  function ")[0]
    assert "runId" in on_ack and "_lastRunId" in on_ack, \
        "the chat subscribe ack's runId must be recorded for the reconcile-by-id guard"


def test_on_ack_drains_orphaned_pending_run():
    # The WS mirror-parity F5 flake: a `hasRun:false` chat subscribe ack clears the tail but must ALSO
    # drain a run-started that QUEUED behind the in-flight subscribe (in _pendingRunId) — otherwise the
    # newly-live run is orphaned (it never sends a chat `done`, the only OTHER drain site), the peer
    # window receives zero delta frames and converges via a full-repaint reconcile instead of mounting
    # the incremental renderer (the mirror-parity WS leg's `B incrementalStream=false`). Symmetric with
    # the chat-`done` drain.
    on_ack = WS.split("function _onAck")[1].split("\n  function ")[0]
    assert "hasRun === false" in on_ack and "_drainPendingRun()" in on_ack, \
        "a hasRun:false chat subscribe ack must drain an orphaned pending run (the WS mirror-parity orphan-drain)"
