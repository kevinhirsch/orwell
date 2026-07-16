"""Ship-gate F2 ("right status at the right time") — the "stuck Production Responding after
refresh" bug (owner-reported, frequent).

ROOT CAUSE (traced end to end): a page reload spawns a BRAND-NEW `ws_session` socket, whose
state-channel subscribe REPLAYS the per-session `session_events` ring (ADR 0012 §3.4b — a bounded,
≤8-event durable invitation kept alive as long as SOME viewer stays attached, e.g. across every
single refresh, since the momentary disconnect→reconnect never outlasts the 180s ring-evict grace).
That ring almost always still holds the LAST turn's `run-started` invitation — but by the time a
player refreshes after even a few minutes idle, `agent_runs` has *already* evicted that turn's own
180s-grace buffer. So the replayed `run-started` state edge is STALE: the client (orwellWs.js
`_onRunStarted`) cannot tell it apart from a genuinely new run — an id-less edge (which an evicted
run's replay always is: `agent_runs.run_id()` returns `None`) is, by design (#1087 back-compat),
treated as "assume it's live" — so it re-subscribes chat AND emits `orwell:ws-run-boundary`, which
(chatWsSplice.js `_onWsRunBoundary`) mounts a fresh observer bubble + a "Responding" spinner in
ANTICIPATION of that run. The re-attach's own chat-subscribe ack then reports `hasRun:false` (there
really is no run) — and because a dead run streams no further `event` frames (no delta, no `done`),
that speculative spinner/holder was, pre-fix, NEVER cleared. A phantom in-flight indicator that
never clears — exactly the reported bug.

This file pins the SERVER half of that trace (the exact combination the client hits): a replayed
`run-started` edge for an evicted run carries no `runId`, and the client's own re-attach
subsequently gets `hasRun:false`. The CLIENT half — the `orwellWs.js` self-heal that emits
`orwell:ws-resync` when it sees that combination, tearing down the orphaned spinner/holder and
reconciling from history — is pinned in `tests/test_ws_run_started_reattach.py` (scenarios 8/9 +
`test_run_started_reattach_self_heals_when_hasrun_false`), which drives the REAL `orwellWs.js` in
Node against exactly this server-observed wire sequence.

Driven against the REAL `ws_session` handler + REAL `agent_runs`/`session_events` (never stubbed),
via the shared ws_harness (mirrors test_1087_ws_replay_churn.py). Roles only; no names.
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


def test_refresh_after_settle_replays_a_stale_run_started_with_no_live_run(run, monkeypatch):
    """The repro recipe that actually reproduces the bug ("refresh AFTER settle", not mid-stream and
    not with no run ever started): a turn happens and fully finishes; the (tiny, test-configured)
    retention grace evicts it from `agent_runs`; a page reload then opens a FRESH socket whose state
    subscribe replays the session_events ring's `run-started` invitation for that now-gone turn.
    Assert the exact server-side hand-off that trips the client: the replayed edge is id-less (an
    evicted run has no `agent_runs.run_id()`), and the client's own chat re-attach — driven by that
    edge — gets `hasRun:false`. Pre-fix, this combination is exactly what orphans the client's
    speculative "Responding" spinner forever (see test_ws_run_started_reattach.py for the client
    self-heal this proves is needed)."""
    monkeypatch.setenv("ORWELL_EVICT_GRACE_S", "0.01")  # evict almost immediately (test speed only)

    async def main():
        canon = H.seed_live_game(None, "live-canon")

        # A turn happens and finishes (mirrors chat_routes.py: start the run, then publish the
        # SAME run-started invitation to session_events that the ring durably keeps).
        H.push_run(canon, [H.sse_delta("hi"), H.sse_done()])
        for _ in range(400):
            if agent_runs.get_status(canon) != "running":
                break
            await asyncio.sleep(0.005)
        session_events.publish(canon, "run-started")

        # Let the (tiny, configured) grace evict the run for real — the player has gone idle a
        # while before refreshing, a completely ordinary case.
        for _ in range(400):
            if not agent_runs.has_run(canon):
                break
            await asyncio.sleep(0.005)
        assert not agent_runs.has_run(canon), \
            "the turn must be fully evicted from agent_runs before the refresh (setup precondition)"

        # The refresh: a BRAND-NEW socket (nothing seen before — exactly what a page reload does)
        # connects and arms the state channel.
        ws = H.new_ws()
        t = H.spawn(ws)
        await H.hello(ws, canon)
        ws.client_send({"t": "subscribe", "ch": "state", "cid": "c_s1"})
        st = await ws.recv_where(
            lambda f: f.get("t") == "state" and (f.get("d") or {}).get("reason") == "run-started",
            timeout=5.0)
        assert "runId" not in st["d"], (
            "a replayed run-started for an EVICTED run must carry no runId — the id-less edge the "
            "client (#1087 back-compat) cannot distinguish from a genuine new run, so it re-attaches"
        )

        # The client's own chat re-attach (what that edge triggers client-side) finds no live run.
        ws.client_send({"t": "subscribe", "ch": "chat", "cid": "c_c1", "d": {"fromSeq": 0}})
        ack = await ws.recv_where(lambda f: f.get("t") == "ack" and f.get("ch") == "chat")
        assert ack["d"]["hasRun"] is False, (
            "the re-attach must find no live run — exactly the combination that, without the "
            "client-side self-heal, orphans the speculative spinner/holder forever"
        )

        await H.stop(ws, t)
        await H.aclose_runs()

    run(main())


def test_refresh_with_no_run_ever_started_never_emits_a_run_started_edge(run):
    """Negative control (a repro recipe that must NOT trip the bug): a session that has never run a
    single turn has nothing in its session_events ring, so a fresh reload's state subscribe gets NO
    `run-started` replay at all — the client never mounts the speculative spinner in the first
    place. Confirms the bug is specific to "refresh after a completed turn," not every refresh."""
    async def main():
        canon = H.seed_live_game(None, "live-canon")
        ws = H.new_ws()
        t = H.spawn(ws)
        await H.hello(ws, canon)
        ws.client_send({"t": "subscribe", "ch": "state", "cid": "c_s1"})
        # Nothing to replay — assert no state frame arrives within a bounded window.
        with pytest.raises(asyncio.TimeoutError):
            await ws.recv_where(lambda f: f.get("t") == "state", timeout=0.3)
        await H.stop(ws, t)

    run(main())
