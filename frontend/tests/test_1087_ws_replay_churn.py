"""#1087 — the WS rebind→ring-replay churn loop, SERVER half.

The traced loop: every `orwell:gamechanged` rebind re-armed `_subscribeEdges()`; the server's
`_handle_subscribe` REPLACED the running state/hud channel task; the fresh
`session_events.subscribe()` replayed the per-session event ring (≤8 events, 180s retention —
ADR 0012 §3.4b) back at a window that had already consumed it; the replayed `state` frames
re-entered `orwell:gamechanged` via platform.js's bridge → another rebind — a self-sustaining ~2s
churn whose stale `run-started` edges also re-subscribed chat from 0 and full-replayed finished
runs (the duplicate-bubble toolturn-parity failure).

Server-side cuts pinned here:
  • **Idempotent same-socket re-arm** — a `subscribe{ch:"state"|"hud"}` for a channel already
    running for the SAME canonical id on the SAME socket is a NO-OP (no task respawn ⇒ no fresh
    `session_events.subscribe()` ⇒ no ring re-replay). The §3.4b replay durability is preserved
    where it matters: a genuinely new subscriber (fresh socket / first arm of a channel) still
    replays the ring, and a canonical CHANGE respawns to re-point the bridge.
  • **Run identity** — `run-started` state frames and the chat subscribe ack carry the run's
    stable `runId` (from `agent_runs`), so the client can reconcile-by-id and ignore a replayed
    stale edge for a run it already rendered (`session_events` is at-least-once by design).

Driven against the REAL `ws_session` handler + REAL `agent_runs`/`session_events` (never stubbed),
via the shared ws_harness. Roles only; no names.
"""
import asyncio
import importlib
import os
import shutil
import subprocess

import pytest

from tests.support import ws_harness as H

ws_routes = importlib.import_module("routes.ws_routes")
ogs = importlib.import_module("src.orwell_game_session")
agent_runs = importlib.import_module("src.agent_runs")
session_events = importlib.import_module("src.session_events")


@pytest.fixture(autouse=True)
def _ws_env(tmp_path, monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    monkeypatch.setattr(ogs, "GAME_SESSION_PATH", tmp_path / "orwell_game_session.json")

    async def _state(user):
        return {"started": True, "beatSeq": 7}

    monkeypatch.setattr(ws_routes, "_engine_state", _state)
    monkeypatch.setattr(ws_routes, "_is_live", lambda sid: True)
    H.reset_runs()
    # The replay ring is process-global module state — clear it so a prior test's invitations
    # can't replay into this one.
    session_events._RING.clear()
    yield
    H.reset_runs()
    session_events._RING.clear()


async def _wait_subscribers(canon: str, n: int) -> None:
    for _ in range(400):
        if session_events.subscriber_count(canon) == n:
            return
        await asyncio.sleep(0.005)
    raise AssertionError(
        f"expected {n} session_events subscriber(s) for the canonical id, "
        f"got {session_events.subscriber_count(canon)}"
    )


def test_same_canonical_state_resubscribe_is_a_noop(run):
    """A duplicate `subscribe{ch:"state"}` on the same socket for the same canonical must NOT
    respawn the channel task — the fresh `session_events.subscribe()` a respawn runs would replay
    the event ring back at a window that already consumed it (the churn loop's server half)."""
    async def main():
        canon = H.seed_live_game(None, "live-canon")
        ws = H.new_ws(); t = H.spawn(ws)
        await H.hello(ws, canon)

        ws.client_send({"t": "subscribe", "ch": "state", "cid": "c_s1"})
        await _wait_subscribers(canon, 1)

        # A game edge lands: the live bridge pushes ONE state frame (and the ring now holds it).
        session_events.publish(canon, "game-updated")
        st = await ws.recv_where(lambda f: f.get("t") == "state", timeout=5.0)
        assert st["d"]["reason"] == "game-updated"

        # The duplicate re-arm (what every same-id client rebind used to send): a NO-OP. Same
        # subscriber count (no respawn) and — the loop-breaker — NO ring re-replay of the
        # already-consumed game-updated edge.
        ws.client_send({"t": "subscribe", "ch": "state", "cid": "c_s2"})
        await asyncio.sleep(0.1)
        assert session_events.subscriber_count(canon) == 1, \
            "a same-canonical state re-subscribe must not respawn the channel task"
        with pytest.raises(asyncio.TimeoutError):
            await ws.recv(timeout=0.3)   # nothing replayed, nothing new

        # The §3.4b durability is intact for a genuinely NEW subscriber: the FIRST arm of the
        # sibling hud channel spawns fresh and replays the ring (the game-updated invitation).
        ws.client_send({"t": "subscribe", "ch": "hud", "cid": "c_h1"})
        hud = await ws.recv_where(lambda f: f.get("t") == "hud", timeout=5.0)
        assert hud["d"]["reason"] == "game-updated"
        assert session_events.subscriber_count(canon) == 2

        await H.stop(ws, t)

    run(main())


def test_state_resubscribe_respawns_on_a_canonical_change(run, monkeypatch):
    """The dedup is per-canonical, not per-channel-forever: after a rebind resolves a DIFFERENT
    canonical id, a state re-subscribe MUST respawn (the running bridge serves its spawn-time
    canonical, so the re-point needs a fresh `session_events.subscribe()` — including that new
    session's ring replay, which is a genuine first-attach for this socket)."""
    async def main():
        # Pre-game branch (started False ⇒ canonical == perTab) so one socket can re-point by
        # re-helloing with a different per-tab id.
        async def _pre(user):
            return {"started": False, "beatSeq": 1}
        monkeypatch.setattr(ws_routes, "_engine_state", _pre)

        ws = H.new_ws(); t = H.spawn(ws)
        await H.hello(ws, "canon-a", cid="c_h1")
        ws.client_send({"t": "subscribe", "ch": "state", "cid": "c_s1"})
        await _wait_subscribers("canon-a", 1)

        # Rebind onto a different canonical (the client's genuine re-point case).
        ack = await H.hello(ws, "canon-b", cid="c_h2")
        assert ack["d"]["canonicalId"] == "canon-b"
        # canon-b's ring already holds an invitation this socket never saw.
        session_events.publish("canon-b", "game-updated")
        ws.client_send({"t": "subscribe", "ch": "state", "cid": "c_s2"})
        await _wait_subscribers("canon-b", 1)
        st = await ws.recv_where(lambda f: f.get("t") == "state", timeout=5.0)
        assert st["d"]["reason"] == "game-updated"   # the NEW session's ring replayed (first attach)

        await H.stop(ws, t)

    run(main())


def test_run_started_state_frame_carries_run_id(run):
    """§4.1 + #1087: the `run-started` state edge names the run (`d.runId`) so a client can
    reconcile-by-id. Both the LIVE push and a ring-REPLAYED edge resolve the id — a replayed edge
    for a finished-but-buffered run carries that same run's id (which is exactly what lets the
    client skip it)."""
    async def main():
        canon = H.seed_live_game(None, "live-canon")
        ws = H.new_ws(); t = H.spawn(ws)
        await H.hello(ws, canon)

        ws.client_send({"t": "subscribe", "ch": "state", "cid": "c_s1"})
        await _wait_subscribers(canon, 1)

        # LIVE edge: a run starts (real agent_runs), the publish rides the bus.
        H.push_run(canon, [H.sse_delta("x"), H.sse_done()])
        rid = agent_runs.run_id(canon)
        assert rid, "a started run must have a stable run id"
        session_events.publish(canon, "run-started")
        st = await ws.recv_where(
            lambda f: f.get("t") == "state" and (f.get("d") or {}).get("reason") == "run-started",
            timeout=5.0)
        assert st["d"]["runId"] == rid

        # REPLAYED edge: a fresh subscriber (a second socket — a genuinely new window) replays the
        # ring; the run has FINISHED by now but is still buffered (within the 180s grace), so the
        # replayed invitation still resolves to the same id.
        for _ in range(400):
            if agent_runs.get_status(canon) != "running":
                break
            await asyncio.sleep(0.005)
        ws2 = H.new_ws(); t2 = H.spawn(ws2)
        await H.hello(ws2, canon, cid="c_h2")
        ws2.client_send({"t": "subscribe", "ch": "state", "cid": "c_s2"})
        st2 = await ws2.recv_where(
            lambda f: f.get("t") == "state" and (f.get("d") or {}).get("reason") == "run-started",
            timeout=5.0)
        assert st2["d"]["runId"] == rid, "a ring-replayed run-started must carry the finished run's id"

        await H.stop(ws2, t2)
        await H.stop(ws, t)
        await H.aclose_runs()   # drain the finished run's evict timer in-loop (#1339 hygiene)

    run(main())


def test_chat_subscribe_ack_names_the_attached_run(run):
    """The chat subscribe ack carries `runId` — the authoritative record the client keeps so a later
    replayed `run-started` for the SAME run is recognized as stale. The no-run ack stays id-less."""
    async def main():
        canon = H.seed_live_game(None, "live-canon")
        ws = H.new_ws(); t = H.spawn(ws)
        await H.hello(ws, canon)

        # No run yet → hasRun:false, no runId.
        ws.client_send({"t": "subscribe", "ch": "chat", "cid": "c_c0", "d": {"fromSeq": 0}})
        ack0 = await ws.recv_where(lambda f: f.get("t") == "ack" and f.get("ch") == "chat")
        assert ack0["d"]["hasRun"] is False
        assert ack0["d"].get("runId") is None

        # A run exists → the ack names it.
        H.push_run(canon, [H.sse_delta("x"), H.sse_done()])
        rid = agent_runs.run_id(canon)
        ws.client_send({"t": "subscribe", "ch": "chat", "cid": "c_c1", "d": {"fromSeq": 0}})
        ack1 = await ws.recv_where(lambda f: f.get("t") == "ack" and f.get("ch") == "chat")
        assert ack1["d"]["hasRun"] is True
        assert ack1["d"]["runId"] == rid

        await H.stop(ws, t)
        await H.aclose_runs()   # drain the finished run's evict timer in-loop (#1339 hygiene)

    run(main())


# ── STRUCTURAL — the WS chat splice must not ADOPT a merged multi-round live bubble ────────────────
#
# The WS splice renders a whole run into ONE holder (no per-round bubble machinery). A tool-rich
# (multi-round) turn is reconstructed from history as N bubbles sharing a db id ("Agent multi-bubble
# reconstruction"), so adopting the merged live holder at settle keeps rounds 1..N fused in one
# bubble beside/in place of the reconstruction — the residual mirror-toolturn divergence after the
# churn loop itself was cut. Pin the contract: rich markers flag the run, and the `done` branch
# discards the holder (softReloadHistory rebuilds), mirroring the SSE observer's rich resume.

def _read_static_js(name: str) -> str:
    import os
    frontend = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(frontend, "static", "js", name), encoding="utf-8") as f:
        return f.read()


def test_ws_chat_splice_discards_rich_run_holder_instead_of_adopting():
    # #1414 (R3 PR4): the WS chat-splice cluster (_onWsChatFrame / _wsResetRound) moved from
    # chat.js to chatWsSplice.js (a behavior-preserving extraction). The consumer is now a
    # top-level `export function`, so the body is isolated on the `\nexport function ` boundary.
    src = _read_static_js("chatWsSplice.js")
    body = src.split("function _onWsChatFrame")[1].split("\nexport function ")[0]
    for marker in ("agent_step", "tool_start"):
        assert f"'{marker}'" in body, f"the WS splice must detect the {marker} rich-run marker"
    assert "_wsRichRun = true" in body, "a rich marker must flag the run"
    done_branch = body.split("if (d.done)")[1]
    assert "_wsRichRun" in body.split("if (d.done)")[0] or "rich" in done_branch, \
        "the done branch must consult the rich flag"
    assert ".remove()" in done_branch, \
        "a rich run's merged live holder must be DISCARDED at done (softReloadHistory rebuilds)"
    # The flag is per-run: reset alongside the round release.
    reset = src.split("function _wsResetRound")[1].split("\n")[0]
    assert "_wsRichRun = false" in reset, "_wsResetRound must clear the rich flag (per-run scope)"


def test_run_ids_are_distinct_per_run(run):
    """Reconcile-by-id only works if consecutive runs on one session get DIFFERENT ids."""
    async def main():
        canon = "role-session"
        H.push_run(canon, [H.sse_delta("a"), H.sse_done()])
        first = agent_runs.run_id(canon)
        for _ in range(400):
            if agent_runs.get_status(canon) != "running":
                break
            await asyncio.sleep(0.005)
        H.push_run(canon, [H.sse_delta("b"), H.sse_done()])
        second = agent_runs.run_id(canon)
        assert first and second and first != second
        await H.aclose_runs()

    run(main())


# ── #1087 CLIENT half — the QUEUED-RUN attach (orwellWs.js) ─────────────────────────────────────────
#
# A run queued behind the one a window is tailing publishes its ONLY `run-started` edge UP-FRONT:
# `ws_routes._handle_turn` calls `agent_runs.start(..., queue=True)` (which replaces `_RUNS[canonical]`
# with the queued run immediately, so `run_id()` already names IT) then `session_events.publish(
# canonical, "run-started")` — but the queued run does not STREAM until the active run drains, and no
# second edge ever follows. The tailing window can't attach mid-run (that tears the active tail down),
# so it must REMEMBER the queued run's id and attach when the active run's `done` frees the tail.
# Pre-fix the edge was dropped (`_chatTailActive` still true) and, with no later edge, every peer
# window silently MISSED the queued turn. Driven against the REAL orwellWs.js in Node (stubbed WS) —
# the same harness idiom as test_ws_run_started_reattach.py. Roles only; no names.

_STATIC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static", "js")

_QUEUED_RUN_HARNESS = r"""
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
async function handshake(runId) {
  lastSock.readyState = 1; lastSock.onopen();
  const hello = lastSock.sent.find((f) => f.t === "hello");
  down({ t: "ack", cid: hello.cid, d: { canonicalId: "sess_pertab", live: true, beatSeq: 1 } });
  await tick();
  const sub = chatSubs()[0];   // the initial chat subscribe attached to the live run
  down({ t: "ack", ch: "chat", cid: sub.cid, d: { fromSeq: 0, headSeq: 0, hasRun: true, runId: runId } });
  await tick();
}

(async function main() {
  const WS = boot();
  await tick();
  await handshake("rA");           // tailing the ACTIVE run rA
  down({ t: "event", ch: "chat", seq: 0, d: { delta: "active..." } });   // rA is mid-stream
  await tick();
  const before = chatSubs().length;
  assert(before === 1, "one initial chat subscribe before the queued run; got " + before);

  // A SECOND turn queues behind rA — its run-started edge (the QUEUED run's id) arrives WHILE we tail rA.
  down({ t: "state", ch: "state", d: { beatSeq: 2, reason: "run-started", runId: "rB" } });
  await tick();
  assert(chatSubs().length === before,
    "a queued run's edge must NOT tear down the active tail (no immediate re-subscribe); got " + chatSubs().length);
  assert(WS.pendingRunId() === "rB",
    "the queued run's id must be REMEMBERED while the active run tails; got " + WS.pendingRunId());

  // rA finishes — the remembered queued run attaches NOW (its single edge never repeats).
  down({ t: "event", ch: "chat", seq: 1, d: { done: true } });
  await tick();
  assert(chatSubs().length === before + 1,
    "the queued run must attach after the active run's done; got " + chatSubs().length);
  assert(chatSubs()[before].d.fromSeq === 0, "the queued run attaches from seq 0 (fresh per-run buffer)");
  assert(WS.pendingRunId() === null, "the pending slot is cleared once drained; got " + WS.pendingRunId());
  assert(WS.lastRunId() === "rB", "the newly-attached run becomes the reconcile-by-id anchor; got " + WS.lastRunId());

  // …and once the queued run renders to its `done`, its OWN stale replay is inert (no re-churn).
  const sub2 = chatSubs()[before];
  down({ t: "ack", ch: "chat", cid: sub2.cid, d: { fromSeq: 0, headSeq: 0, hasRun: true, runId: "rB" } });
  down({ t: "event", ch: "chat", seq: 0, d: { delta: "queued..." } });
  down({ t: "event", ch: "chat", seq: 1, d: { done: true } });
  await tick();
  down({ t: "state", ch: "state", d: { beatSeq: 3, reason: "run-started", runId: "rB" } });
  await tick();
  assert(chatSubs().length === before + 1,
    "after rendering the queued run, its replayed edge must be ignored (no churn); got " + chatSubs().length);

  console.log("OK");
  process.exit(0);
})();
"""


def test_client_remembers_and_attaches_a_queued_run_after_done():
    """#1087 CLIENT half: a `run-started` edge for a run QUEUED behind the active one arrives while the
    window is still tailing (ws_routes publishes it up-front, stamped with the queued run's id). The
    client must REMEMBER it (not tear down the active tail, not drop it) and attach when the active
    run's `done` frees the tail — otherwise every peer window silently misses the queued turn. Driven
    against the REAL orwellWs.js in Node with a stubbed WebSocket (fail-before / pass-after)."""
    node = shutil.which("node")
    if not node:
        pytest.skip("node not available for the behavioral queued-run attach check")
    proc = subprocess.run(
        [node, "-e", _QUEUED_RUN_HARNESS, os.path.join(_STATIC, "orwellWs.js")],
        capture_output=True, text=True, timeout=30,
    )
    assert proc.returncode == 0, f"node failed: {proc.stdout}\n{proc.stderr}"
    assert "OK" in proc.stdout
