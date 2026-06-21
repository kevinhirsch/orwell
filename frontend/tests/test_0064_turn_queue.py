"""Feature 0064 Part C — Messenger serialization: a game turn QUEUES behind an in-flight run
instead of stomping it (agent_runs.start(..., queue=True)).

Pure-asyncio unit test of the agent_runs queue seam (no app/engine). The generators append to a
shared list so ordering is deterministic regardless of subscribers.
"""

import asyncio
import importlib

agent_runs = importlib.import_module("src.agent_runs")


def _run(coro):
    """Run a coroutine on a REUSED event loop. Deliberately NOT asyncio.run(): asyncio.run closes
    the loop AND unsets the thread's current loop, which poisons every later test in the process that
    calls asyncio.get_event_loop() (the repo's async-test idiom). Reuse/create-and-keep instead."""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_closed():
            raise RuntimeError
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    return loop.run_until_complete(coro)


async def _gen(label, events, *, n=3, delay=0.03):
    try:
        for i in range(n):
            await asyncio.sleep(delay)
            events.append(f"{label}{i}")
            yield f"data: {label}{i}\n\n"
    except asyncio.CancelledError:
        events.append(f"{label}-cancelled")
        raise


def test_queue_chains_without_stomping_the_live_run():
    async def main():
        events = []
        sid = "s-queue-0064"
        a = agent_runs.start(sid, _gen("A", events))
        await asyncio.sleep(0.01)                       # let A's run get going
        b = agent_runs.start(sid, _gen("B", events), queue=True)  # game turn: queue behind A
        await asyncio.gather(a.task, b.task, return_exceptions=True)
        return events

    events = _run(main())
    assert "A-cancelled" not in events                 # A was NOT stomped — it finished in full
    assert "A2" in events and "B2" in events           # both turns ran to completion
    assert events.index("A2") < events.index("B0")     # strictly serialized: all of A, then B


def test_default_still_cancels_inflight_for_plain_chat():
    async def main():
        events = []
        sid = "s-cancel-0064"
        a = agent_runs.start(sid, _gen("A", events))
        await asyncio.sleep(0.01)
        b = agent_runs.start(sid, _gen("B", events))   # plain chat: replace-on-double-send (stomp)
        await asyncio.gather(a.task, b.task, return_exceptions=True)
        return events

    events = _run(main())
    assert "A-cancelled" in events                     # the in-flight run was cancelled (historical behavior)
    assert "B2" in events                              # the replacing run still completes


def test_chat_route_queues_framed_turns():
    """Drift pin: the game/casting (framed) path opts into queuing; plain chat does not.

    ADR 0012 §3.1 re-keyed the run on the CANONICAL session for framed turns (`run_key`), so the
    queue flag is now the precomputed `_framed`. The two invariants this pin protects: a framed turn
    QUEUES (queue=_framed), and a plain chat does NOT (run_key == session for a non-framed turn)."""
    import os
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(root, "routes", "chat_routes.py"), encoding="utf-8") as f:
        src = f.read()
    assert 'run_key = (getattr(ctx, "canonical_session", None) or session) if _framed else session' in src
    assert "agent_runs.start(run_key, _safe_stream(), queue=_framed)" in src
    assert '_framed = bool(getattr(ctx, "framed", False))' in src
