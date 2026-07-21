"""Issue #1713 — the casting-finalize turn (createCharacter -> the #1711 champagne-circle premiere)
could block the FE for close to five minutes under contention (observed ~300s in CI; ~10s locally).

Diagnosis (see docs/audits/2026-07-21-campaign-report-and-exhaustive-backlog.md #1713 and the earlier
golden-replay diagnostic dumps): the engine itself was proven IDLE for the whole hang — the FE never
even reached the engine's createCharacter call. The actual long pole is the INLINE, pre-finalize model-
authored cast-genesis grind in ``do_create_character`` (``tool_implementations.py``), which authors the
whole 15-NPC cast one houseguest per LLM call (bounded-concurrency waves) and is awaited INSIDE the
player's chat turn. Those calls ride ``stream_llm_with_fallback``, which — unlike the non-streaming
``llm_call_async`` chokepoint (already given a wall-clock ceiling by the unrelated N4 fix) — has no
equivalent bound: its per-chunk httpx read-timeout resets on any received byte, so a stalled-but-
trickling stream under the documented #1057 concurrent-authoring burst inherited the narration-sized
300s default as its ONLY ceiling.

The fix is two bounded belts, both fail-soft (a timeout is treated exactly like any other model-call
failure — the deterministic floor stands):
  1. ``orwell_cast_authoring._bounded_stream`` wraps every authoring/genesis stream in a tight,
     dedicated wall-clock ceiling (``_AUTHORING_STREAM_WALL_CLOCK_S``), independent of the per-chunk
     read timeout.
  2. ``tool_implementations.do_create_character`` wraps the WHOLE inline genesis kick in a second,
     structural backstop (``_GENESIS_WALL_CLOCK_BACKSTOP_S``) via ``asyncio.wait_for`` so even a
     worst-case multi-retry pileup across the genesis waves can never approach the old multi-minute
     range.

These tests pin the BOUND, not real-provider behavior: every LLM call here is injected/stubbed.
Roles only — no names ingested as data.
"""
import asyncio
import time

from src import orwell_cast_authoring as A
from src import orwell_cast_genesis as G


def _run(coro):
    # FE convention: drive on the EXISTING session loop (never asyncio.run, which closes the loop).
    return asyncio.get_event_loop().run_until_complete(coro)


_ROSTER = [{"id": f"npc:{i}"} for i in range(1, 16)]


# ── constants pinned far below the narration-sized 300s ceiling (guards a future regression) ────────

def test_bounds_stay_far_below_the_narration_sized_300s_ceiling():
    assert 0 < A._AUTHORING_STREAM_WALL_CLOCK_S <= 60
    import src.tool_implementations as timpl
    assert 0 < timpl._GENESIS_WALL_CLOCK_BACKSTOP_S <= 120


# ── (1) `_bounded_stream` — the generic wrapper ──────────────────────────────────────────────────────

async def _hangs_forever():
    yield "data: " + '{"delta": "partial"}' + "\n\n"
    await asyncio.Event().wait()  # never set — simulates a stalled/trickling provider stream
    yield "unreachable"  # pragma: no cover


async def _finishes_fast():
    yield "data: one\n\n"
    yield "data: two\n\n"


def test_bounded_stream_raises_timeout_within_its_own_budget_not_the_full_hang():
    async def _drive():
        t0 = time.monotonic()
        got = []
        try:
            async for chunk in A._bounded_stream(_hangs_forever(), wall_clock_s=0.05):
                got.append(chunk)
        except asyncio.TimeoutError:
            return got, time.monotonic() - t0, True
        return got, time.monotonic() - t0, False

    got, elapsed, timed_out = _run(_drive())
    assert timed_out is True
    assert got == ["data: " + '{"delta": "partial"}' + "\n\n"]  # the real chunk before the stall
    assert elapsed < 2.0  # nowhere near the old unbounded/300s exposure


def test_bounded_stream_is_a_pure_passthrough_when_the_generator_finishes_inside_budget():
    async def _drive():
        out = []
        async for chunk in A._bounded_stream(_finishes_fast(), wall_clock_s=5.0):
            out.append(chunk)
        return out

    assert _run(_drive()) == ["data: one\n\n", "data: two\n\n"]


# ── (2) the authoring/genesis resolved fn actually applies the bound ────────────────────────────────

def test_resolved_authoring_fn_times_out_fast_instead_of_riding_the_300s_default(monkeypatch):
    """Wires the REAL `resolve_authoring_llm_fn` -> `_resolve_llm_fn` -> `_once` chain (the exact path
    genesis/deep-authoring call), with `llm_core.stream_llm_with_fallback` replaced by a stream that
    stalls forever after its first byte — the #1057 concurrent-burst shape. Shrinks the module's wall-
    clock constant for the duration of the test so it runs fast; the constant itself is pinned above."""
    import src.endpoint_resolver as er
    from src import llm_core as lc

    monkeypatch.setattr(er, "resolve_endpoint",
                         lambda prefix, owner=None: ("https://example.invalid/v1/chat/completions",
                                                      "stub-chat-model", {}))
    monkeypatch.setattr(er, "resolve_utility_fallback_candidates", lambda owner=None: [])
    monkeypatch.setattr(er, "_resolve_fallback_candidates", lambda key, owner=None: [])
    monkeypatch.setattr(A, "_AUTHORING_STREAM_WALL_CLOCK_S", 0.05)

    async def _stalled(candidates, messages, temperature=None, policy=None,
                        max_tokens=0, response_format=None, **kw):
        yield "data: " + '{"delta": "{"}' + "\n\n"  # a real byte lands, then the provider goes silent
        await asyncio.Event().wait()

    monkeypatch.setattr(lc, "stream_llm_with_fallback", _stalled)

    async def _drive():
        fn = await A.resolve_authoring_llm_fn("u-1713")
        assert fn is not None
        t0 = time.monotonic()
        try:
            await fn([{"role": "user", "content": "author this houseguest"}])
            return None, time.monotonic() - t0
        except Exception as e:  # noqa: BLE001 - matches every real caller's own except Exception
            return e, time.monotonic() - t0

    err, elapsed = _run(_drive())
    assert isinstance(err, asyncio.TimeoutError), err
    assert elapsed < 2.0  # bounded — the stub would otherwise hang this test forever


# ── (3) the top-level genesis backstop composition (mirrors do_create_character's new wrapper) ──────

def test_genesis_backstop_bounds_a_hung_run_genesis(monkeypatch):
    """Mirrors the exact composition added to `do_create_character`
    (``asyncio.wait_for(_genesis_kick.run_genesis(...), timeout=_GENESIS_WALL_CLOCK_BACKSTOP_S)``): even
    if EVERY per-call bound inside genesis were somehow bypassed, this second, structural belt still
    caps the whole inline grind so the player's turn can never hang anywhere near the old ~300s exposure."""
    G.reset_state("u-1713-backstop")

    async def _model(_owner):
        async def llm(_messages):
            await asyncio.Event().wait()  # every single call inside genesis stalls forever
        return llm

    async def write(proposal):  # pragma: no cover - never reached; genesis never gets a proposal
        return {"accepted": True, "committed": len(proposal["npcs"]), "violations": [], "varianceOk": True}

    monkeypatch.setattr(G, "_resolve_llm_fn", _model)

    async def _drive():
        t0 = time.monotonic()
        try:
            await asyncio.wait_for(
                G.run_genesis(_ROSTER, 1713, "u-1713-backstop", write=write),
                timeout=0.2,  # stand-in for _GENESIS_WALL_CLOCK_BACKSTOP_S, shrunk for the test
            )
            return None, time.monotonic() - t0
        except asyncio.TimeoutError as e:
            return e, time.monotonic() - t0
        finally:
            # Hygiene: `asyncio.shield` (by design — see run_genesis's own docstring) keeps the inner
            # grind running in the background after THIS awaiter's timeout, exactly like the real
            # do_create_character backstop. Cancel the leftover in-flight task so the test doesn't
            # leak a pending task into the closing loop.
            leftover = G._IN_FLIGHT.pop(("u-1713-backstop", 1713), None)
            if leftover is not None:
                leftover.cancel()
                try:
                    await leftover
                except (asyncio.CancelledError, Exception):
                    pass

    err, elapsed = _run(_drive())
    assert isinstance(err, asyncio.TimeoutError)
    assert elapsed < 2.0  # bounded, not the multi-minute exposure the backstop replaces
    G.reset_state("u-1713-backstop")
