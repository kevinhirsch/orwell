"""Regression coverage for the WS-harness teardown lifecycle (issue #1339).

The fe-unit flakes traced to background tasks surviving a per-test ``_run`` loop close: cancelling a
still-DRAINING ``agent_runs`` run makes ``_drain``'s ``finally`` arm a FRESH ``_schedule_evict`` timer
as it unwinds, which a single-pass ``aclose_runs`` snapshot misses — so it lingers pending across the
loop close (``Task was destroyed but it is pending!``) and, under xdist, resurfaces as a stray
``CancelledError``/teardown error on an unrelated later test. This pins the quiescent teardown: after
``aclose_runs`` returns, the registry is empty AND no task it ever armed is still pending. Roles only.
"""
import asyncio

import pytest

from tests.support import ws_harness as H
import src.agent_runs as agent_runs


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    # Keep the evict grace long (the production 180s) so the armed timer is unambiguously still
    # pending when we assert — the whole point is that aclose_runs must cancel it, not out-wait it.
    H.reset_runs()
    yield
    H.reset_runs()


def test_aclose_runs_quiesces_a_finally_armed_evict_task(run):
    """Cancelling a mid-drain run arms a fresh evict task in ``_drain``'s finally; ``aclose_runs`` must
    leave NOTHING pending. Fails on the old single-pass teardown (the re-armed evict task survives)."""
    async def main():
        gate = asyncio.Event()  # never set → the run BLOCKS mid-stream, so aclose_runs must cancel it
        H.push_run("canon-x", [H.sse_delta("a"), H.sse_delta("b")], gate=gate, release_after=1)
        # Let the drain buffer its first event and then block on the gate.
        for _ in range(200):
            if agent_runs.head_seq("canon-x") >= 0:
                break
            await asyncio.sleep(0.005)
        run_obj = agent_runs._RUNS["canon-x"]
        assert run_obj.task is not None and not run_obj.task.done(), "run should still be draining"

        await H.aclose_runs()

        # Registry cleared, the drain finished, and the evict timer its finally armed is NOT left
        # pending — nothing can survive the loop close.
        assert not agent_runs._RUNS
        assert run_obj.task.done()
        assert run_obj.evict_task is None or run_obj.evict_task.done(), \
            "aclose_runs left a re-armed evict task pending (the #1339 teardown race)"

    run(main())
