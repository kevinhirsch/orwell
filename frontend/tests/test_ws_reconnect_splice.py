"""WebSocket Phase-1 — case (a): the reconnect-resume splice (the crown jewel).

A socket that drops mid-turn and reconnects with ``subscribe{fromSeq:N+1}`` gets the buffered gap then
the live tail — **no seq gap, no dup, one terminal ``done``** — because the socket delegates to the
shipped ``agent_runs.subscribe`` replay-then-tail (register-before-replay + de-dup-by-seq +
flush-the-raced-tail), and the frame ``seq`` is the buffer index. This is the one seam that must not
regress (protocol spec §3, test-plan §3). The single most important line: **B never RECEIVES a frame
``< fromSeq`` on the wire** (``min(B_seqs) == N+1``) — which forces the preferred ``from_seq`` param on
``agent_runs.subscribe`` rather than a lossy client-side skip.

Driven against the REAL ``agent_runs`` (never stubbed) — the socket adapter is the only new code under
test. Roles only; no names.
"""
import importlib
import tempfile
from pathlib import Path

import pytest

from tests.support import ws_harness as H

ws_routes = importlib.import_module("routes.ws_routes")
ogs = importlib.import_module("src.orwell_game_session")


@pytest.fixture(autouse=True)
def _ws_env(tmp_path, monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    monkeypatch.setattr(ogs, "GAME_SESSION_PATH", tmp_path / "orwell_game_session.json")

    async def _state(user):
        return {"started": True, "beatSeq": 7}

    monkeypatch.setattr(ws_routes, "_engine_state", _state)
    monkeypatch.setattr(ws_routes, "_is_live", lambda sid: True)
    H.reset_runs()
    yield
    H.reset_runs()


def _seqs(frames):
    return [f["seq"] for f in frames if f.get("t") == "event"]


def _visible(frames):
    """Concatenated visible (thinking-false) delta text across event frames — the reassembled body."""
    out = []
    for f in frames:
        d = f.get("d") or {}
        if f.get("t") == "event" and "delta" in d and not d.get("thinking"):
            out.append(d["delta"])
    return "".join(out)


def _script():
    # A known, ordered 6-event script (indices 0..5) + a terminal DONE (index 6).
    return [
        H.sse_delta("A0"),
        H.sse_delta("A1", thinking=True),   # a reasoning delta rides INSIDE the chat payload (§3.4)
        H.sse_delta("A2"),
        H.sse_delta("A3"),
        H.sse_delta("A4"),
        H.sse_delta("A5"),
        H.sse_done(),
    ]


def _is_done(f):
    return f.get("t") == "event" and (f.get("d") or {}).get("done") is True


async def _subscribe_chat(ws, cid, from_seq):
    ws.client_send({"t": "subscribe", "ch": "chat", "cid": cid, "d": {"fromSeq": from_seq}})
    return await ws.recv_where(lambda f: f.get("t") == "ack" and f.get("ch") == "chat")


def test_reconnect_splice_live_run_no_gap_no_dup(run):
    """A drop at seq N with the run still LIVE at reconnect: B replays only the gap then live-tails."""
    async def main():
        canon = H.seed_live_game(None, "live-canon")
        events = _script()
        M = len(events) - 1  # last buffer index (the DONE frame)
        N = 2                 # drop after rendering through seq N

        # ── Baseline (single connection) — the oracle ──
        ws0 = H.new_ws(); t0 = H.spawn(ws0)
        await H.hello(ws0, canon, cid="c_h0")
        H.push_run(canon, _script())
        await _subscribe_chat(ws0, "c_s0", 0)
        base = await ws0.collect_until(_is_done)
        baseline_seqs = _seqs(base)
        baseline_text = _visible(base)
        await H.stop(ws0, t0)
        H.reset_runs()

        # ── Reconnect run: gate so B connects while the run is still LIVE ──
        gate = __import__("asyncio").Event()
        H.push_run(canon, events, gate=gate, release_after=N + 1)  # yields 0..N then holds

        wsA = H.new_ws(); tA = H.spawn(wsA)
        await H.hello(wsA, canon, cid="c_hA")
        await _subscribe_chat(wsA, "c_sA", 0)
        a_frames = []
        for _ in range(N + 1):  # read exactly seq 0..N (the events emitted before the gate)
            a_frames.append(await wsA.recv_where(lambda f: f.get("t") == "event"))
        a_seqs = _seqs(a_frames)
        assert a_seqs == list(range(0, N + 1))
        await H.stop(wsA, tA)  # DROP mid-turn, gate still held (run alive)

        wsB = H.new_ws(); tB = H.spawn(wsB)
        ackB = await H.hello(wsB, canon, cid="c_hB")
        assert ackB["d"]["canonicalId"] == canon  # adopts the same canonical id
        ack_sub = await _subscribe_chat(wsB, "c_sB", N + 1)
        assert ack_sub["d"]["fromSeq"] == N + 1     # honored the reconnect cursor
        gate.set()                                   # NOW release the tail
        b_frames = await wsB.collect_until(_is_done)
        b_seqs = _seqs(b_frames)
        await H.stop(wsB, tB)

        # ── the exact assertions ──
        # B receives ONLY the gap-then-tail on the wire — never re-sends 0..N (the from_seq param proof)
        assert b_seqs == list(range(N + 1, M + 1))
        assert min(b_seqs) == N + 1
        # contiguity across the drop: no gap, no dup
        rendered = a_seqs + b_seqs
        assert rendered == list(range(0, M + 1))
        assert len(rendered) == len(set(rendered))
        # exactly one terminal done across the whole reassembled set
        assert sum(1 for f in (a_frames + b_frames) if _is_done(f)) == 1
        # byte-identity vs the oracle
        assert _seqs(base) == list(range(0, M + 1))  # sanity: baseline is the full contiguous stream
        assert _visible(a_frames + b_frames) == baseline_text
        assert baseline_seqs == list(range(0, M + 1))
        await H.aclose_runs()

    run(main())


def test_reconnect_splice_terminal_but_buffered(run):
    """The has_run (not is_active) case: the run FINISHES before B connects (within the 180s grace).
    B still gets ``subscribe{fromSeq:0}`` → the ENTIRE buffer replayed then a clean end — the peer that
    attaches just after settle still mirrors the whole turn."""
    async def main():
        canon = H.seed_live_game(None, "live-canon")
        events = _script()
        M = len(events) - 1

        H.push_run(canon, events)  # no gate → runs to completion, terminal-but-buffered
        # let it drain fully
        import asyncio
        for _ in range(50):
            await asyncio.sleep(0)
        assert not ws_routes.agent_runs.is_active(canon)  # finished...
        assert ws_routes.agent_runs.has_run(canon)        # ...but still buffered (within grace)

        wsB = H.new_ws(); tB = H.spawn(wsB)
        await H.hello(wsB, canon, cid="c_hB")
        ack = await _subscribe_chat(wsB, "c_sB", 0)
        assert ack["d"]["hasRun"] is True   # a subscribe for is_active=False/has_run=True SUCCEEDS
        frames = await wsB.collect_until(_is_done)
        await H.stop(wsB, tB)

        assert _seqs(frames) == list(range(0, M + 1))  # the whole buffer 0..M, one clean end
        assert sum(1 for f in frames if _is_done(f)) == 1
        await H.aclose_runs()

    run(main())


def test_subscribe_when_no_run_reports_hasRun_false(run):
    """No run at all for the canonical id → the subscribe ack says ``hasRun:false`` with ZERO event
    frames, so the client does a normal history load (spec §3.6) rather than hanging on a dead channel."""
    async def main():
        canon = H.seed_live_game(None, "live-canon")
        wsB = H.new_ws(); tB = H.spawn(wsB)
        await H.hello(wsB, canon, cid="c_hB")
        ack = await _subscribe_chat(wsB, "c_sB", 0)
        assert ack["d"]["hasRun"] is False
        # no event frame should ever arrive
        import asyncio
        with pytest.raises(asyncio.TimeoutError):
            await wsB.recv_where(lambda f: f.get("t") == "event", timeout=0.2)
        await H.stop(wsB, tB)

    run(main())
