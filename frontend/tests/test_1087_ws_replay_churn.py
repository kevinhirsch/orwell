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
    src = _read_static_js("chat.js")
    body = src.split("function _onWsChatFrame")[1].split("\n  function ")[0]
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
