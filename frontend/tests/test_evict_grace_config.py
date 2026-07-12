"""ADR 0012 #7 — the streamed-buffer retention grace is an operator knob.

`agent_runs` keeps a FINISHED run's replay buffer around for a grace period so a
reconnect can still replay the result, then evicts it to bound memory. That grace
used to be a hard-coded 180 s constant; it is now read per-use from
ORWELL_EVICT_GRACE_S (seconds) so operators can tune the retention window without a
code change. Default unchanged ⇒ behavior byte-identical.

These gates assert (1) the default is 180 with no override, (2) a numeric override
is honored, (3) blank / non-numeric values fall back to the default, and (4) the
value is actually WIRED into the real eviction path (a tiny override evicts a
finished run for real — not a dead helper). Role-agnostic; no game state involved.
"""
import asyncio

import src.agent_runs as agent_runs


def _run(coro):
    """Reused-loop runner (the repo async-test idiom — never asyncio.run, which poisons
    get_event_loop for later tests)."""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_closed():
            raise RuntimeError
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    return loop.run_until_complete(coro)


def test_evict_grace_default_is_180(monkeypatch):
    """With ORWELL_EVICT_GRACE_S unset, the retention grace is the historical 180 s default."""
    monkeypatch.delenv("ORWELL_EVICT_GRACE_S", raising=False)
    assert agent_runs._evict_grace_s() == 180


def test_evict_grace_env_override_honored(monkeypatch):
    """A numeric ORWELL_EVICT_GRACE_S overrides the default, read per-call (no restart)."""
    monkeypatch.setenv("ORWELL_EVICT_GRACE_S", "45")
    assert agent_runs._evict_grace_s() == 45
    # Read per-use: a live change is picked up on the next call, no re-import.
    monkeypatch.setenv("ORWELL_EVICT_GRACE_S", "0.5")
    assert agent_runs._evict_grace_s() == 0.5


def test_evict_grace_blank_or_invalid_falls_back_to_default(monkeypatch):
    """A blank or non-numeric value is ignored so a fat-fingered env can never break eviction."""
    monkeypatch.setenv("ORWELL_EVICT_GRACE_S", "   ")
    assert agent_runs._evict_grace_s() == 180
    monkeypatch.setenv("ORWELL_EVICT_GRACE_S", "not-a-number")
    assert agent_runs._evict_grace_s() == 180


def test_env_override_drives_real_eviction_timing(monkeypatch):
    """End-to-end: the configured grace actually drives eviction. With a tiny override a finished
    run's buffer is torn down after the (tiny) grace with no re-subscribe — proving the knob is
    wired into the real eviction path (`_schedule_evict`), not merely a helper nobody reads."""
    monkeypatch.setenv("ORWELL_EVICT_GRACE_S", "0.01")

    async def main():
        async def quick():
            yield 'data: {"delta": "x"}\n\n'
            yield "data: [DONE]\n\n"

        sid = "evict-grace-config-e2e"
        agent_runs._RUNS.pop(sid, None)
        run = agent_runs.start(sid, quick())
        await run.task                       # drain to completion → terminal → evict armed (0.01 s)
        buffered_immediately = agent_runs.has_run(sid)
        await asyncio.sleep(0.05)            # let the (tiny) configured grace expire, no re-subscribe
        return buffered_immediately, agent_runs.has_run(sid)

    buffered_immediately, buffered_after = _run(main())
    assert buffered_immediately is True, "a just-finished run stays buffered within the grace"
    assert buffered_after is False, "the configured (tiny) grace evicts the run — the knob is wired"
