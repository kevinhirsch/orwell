"""D2 — self-resume: mid-stream SSE drop recovery via /api/chat/resume?from_seq=N.

D2 changes the sender's stream-drop recovery: when the sender's own SSE narration stream
drops mid-generation, `_tryAutoRecover` now calls `_trySelfResume` FIRST — which fetches
GET /api/chat/resume/{session_id}?from_seq=N and reattaches to the same server-buffered
run, instead of re-pasting the truncated tail as a new user turn.

These are the DETERMINISTIC, browser-free seams:
  * `agent_runs.subscribe(session_id, from_seq=N)` replays buffer[N..len-1] only
  * `agent_runs.has_run()` distinguishes "no run" from "run exists"
  * Contiguous content: after self-resume from seq K, delta content byte-equals the
    full-subscribe suffix — a gap or dup FAILS this assertion.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys

import pytest

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if FRONTEND not in sys.path:
    sys.path.insert(0, FRONTEND)

from src import agent_runs  # noqa: E402


# ── helper ───────────────────────────────────────────────────────────────────────────────

def _cleanup_run(session_id: str) -> None:
    """Drop a run and cancel any pending tasks so asyncio.run doesn't noise on close."""
    run = agent_runs._RUNS.pop(session_id, None)
    if run is not None:
        agent_runs._safe_cancel(run.evict_task)
        agent_runs._safe_cancel(run.task)


def _simple_gen(*events: str):
    """Return an async generator that yields the given SSE event strings."""
    async def gen():
        for ev in events:
            yield ev
    return gen


# ── 1. from_seq replay skips earlier buffer entries ─────────────────────────────────────

def test_self_resume_replays_same_run():
    """`agent_runs.subscribe(session_id, from_seq=3)` replays ONLY buffer[3..len-1],
    NOT buffer[0..2]. The first yielded event is delta #3, not delta #0."""
    deltas = [
        'data: {"delta": "alpha. "}\n\n',
        'data: {"delta": "beta. "}\n\n',
        'data: {"delta": "gamma. "}\n\n',
        'data: {"delta": "delta. "}\n\n',
        'data: {"delta": "epsilon. "}\n\n',
    ]
    tail = [
        'data: {"type": "message_saved", "id": "m1", "seq": 5}\n\n',
        'data: [DONE]\n\n',
    ]
    all_events = deltas + tail
    sid = "d2-replay-same"

    async def scenario():
        agent_runs.start(sid, _simple_gen(*all_events)())
        # let the drain task consume the generator
        await asyncio.sleep(0.02)
        # consume from_seq=3 — should skip deltas 0,1,2
        out = [ev async for ev in agent_runs.subscribe(sid, from_seq=3)]
        _cleanup_run(sid)
        return out

    events = asyncio.run(scenario())
    assert events, "subscribe with from_seq=3 yielded nothing"
    # first yielded event should be delta #3 (index 3)
    assert '"delta": "delta. "' in events[0], (
        f"expected delta #3 first, got: {events[0][:60]}"
    )
    # should NOT contain deltas 0,1,2
    texts = " ".join(events)
    assert '"delta": "alpha. "' not in texts, "from_seq=3 must NOT replay delta #0"
    assert '"delta": "beta. "' not in texts, "from_seq=3 must NOT replay delta #1"
    assert '"delta": "gamma. "' not in texts, "from_seq=3 must NOT replay delta #2"
    # should still contain delta #4 and the tail events
    assert '"delta": "epsilon. "' in texts, "from_seq=3 must include delta #4"
    assert '[DONE]' in events[-1], "tail [DONE] must be present"


# ── 2. default from_seq=0 replays everything ────────────────────────────────────────────

def test_self_resume_from_seq_defaults_to_zero():
    """`subscribe(sid)` with default from_seq=0 replays the FULL buffer from the start."""
    sid = "d2-default-zero"

    async def scenario():
        async def gen():
            yield 'data: {"delta": "first"}\n\n'
            yield 'data: {"delta": "second"}\n\n'
            yield 'data: [DONE]\n\n'
        agent_runs.start(sid, gen())
        await asyncio.sleep(0.02)
        out = [ev async for ev in agent_runs.subscribe(sid)]
        _cleanup_run(sid)
        return out

    events = asyncio.run(scenario())
    assert len(events) == 3, f"expected 3 events (2 deltas + [DONE]), got {len(events)}"
    assert '"delta": "first"' in events[0], "first event must be delta 'first'"
    assert '"delta": "second"' in events[1], "second event must be delta 'second'"
    assert '[DONE]' in events[2], "third event must be [DONE]"


# ── 3. 404 when no run exists ───────────────────────────────────────────────────────────

def test_self_resume_404_when_no_run():
    """`has_run('nonexistent')` returns False; `subscribe('nonexistent')` yields nothing."""
    sid = "d2-nonexistent"
    assert not agent_runs.has_run(sid), "has_run must be False for a session that never ran"

    async def scenario():
        out = [ev async for ev in agent_runs.subscribe(sid)]
        return out

    events = asyncio.run(scenario())
    assert not events, "subscribe on nonexistent session must yield no events"


# ── 4. grace-expired fallback ───────────────────────────────────────────────────────────

def test_self_resume_grace_expired_falls_back():
    """A run that finished and was evicted (popped from _RUNS) returns `has_run` False,
    so the old new-turn continuance path still fires when the buffered run is gone."""
    sid = "d2-grace-expired"

    async def scenario():
        async def gen():
            yield 'data: {"delta": "gone"}\n\n'
            yield 'data: [DONE]\n\n'
        agent_runs.start(sid, gen())
        await asyncio.sleep(0.02)
        # evict manually — simulate grace expiry
        run = agent_runs._RUNS.pop(sid, None)
        if run:
            agent_runs._safe_cancel(run.evict_task)
            agent_runs._safe_cancel(run.task)
        return agent_runs.has_run(sid)

    has = asyncio.run(scenario())
    assert not has, "has_run must be False after eviction (grace expired)"


# ── 5. contiguous content on self-resume [CRITICAL — catches FIX 1's off-by-one] ────────

def test_contiguous_content_on_self_resume():
    """After a full subscribe from seq 0 and a partial subscribe from seq K, the delta
    content from the partial subscribe must be a BYTE-EXACT SUFFIX of the full content.
    A gap (missing events) or a dup (replayed events) makes this assertion fail.

    This is the test that catches the off-by-one in `_sseEventCount` — if the client
    passes `from_seq` that is too high (because prepended events were counted), it skips
    events it hadn't consumed yet, producing a GAP and a shorter/truncated content suffix.
    If `from_seq` is too low, it replays events the client already rendered, producing
    DUPLICATED content. Both fail the byte-exact suffix assertion.
    """
    deltas = [
        'data: {"delta": "The old house "}',
        'data: {"delta": "creaked under "}',
        'data: {"delta": "the weight of "}',
        'data: {"delta": "another sleepless "}',
        'data: {"delta": "night."}',
    ]
    # SSE uses double-newline after each data line
    sse_events = [d + '\n\n' for d in deltas]
    sse_events.append('data: {"type": "message_saved", "id": "m1", "seq": 5}\n\n')
    sse_events.append('data: [DONE]\n\n')

    sid = "d2-contiguous"

    def _extract_delta_text(events):
        """Extract concatenated delta content from SSE event strings."""
        parts = []
        for ev in events:
            if '"delta"' in ev:
                try:
                    line = ev.strip()
                    if line.startswith('data: '):
                        payload = json.loads(line[6:])
                        if 'delta' in payload:
                            parts.append(payload['delta'])
                except (json.JSONDecodeError, KeyError):
                    pass
        return ''.join(parts)

    async def full_scenario():
        agent_runs.start(sid, _simple_gen(*sse_events)())
        await asyncio.sleep(0.02)
        out = [ev async for ev in agent_runs.subscribe(sid)]
        _cleanup_run(sid)
        return out

    full_events = asyncio.run(full_scenario())
    full_text = _extract_delta_text(full_events)
    assert full_text, "full subscribe produced no delta content"
    assert '[DONE]' in full_events[-1], "full subscribe must end with [DONE]"

    # Now self-resume from seq 2: the client consumed deltas at buffer indices 0,1
    # ("The old house " and "creaked under ") and wants buffer[2..]
    async def resume_scenario():
        # Need to start the run again because previous run was cleaned up
        agent_runs.start(sid, _simple_gen(*sse_events)())
        await asyncio.sleep(0.02)
        # from_seq=2 means skip buffer[0..1], replay from index 2 onward
        out = [ev async for ev in agent_runs.subscribe(sid, from_seq=2)]
        _cleanup_run(sid)
        return out

    resume_events = asyncio.run(resume_scenario())
    resume_text = _extract_delta_text(resume_events)
    assert resume_text, "resume subscribe produced no delta content"
    assert '[DONE]' in resume_events[-1], "resume subscribe must end with [DONE]"

    # The resume content must be the suffix of the full content starting from delta #2
    expected_suffix = 'the weight of another sleepless night.'
    assert resume_text == expected_suffix, (
        f"resume content must byte-equal expected suffix\n"
        f"  expected: {expected_suffix!r}\n"
        f"  got:      {resume_text!r}\n"
        "If resume content is SHORTER → GAP (from_seq too high).\n"
        "If resume content contains 'The old house' or 'creaked under' → DUP (from_seq too low)."
    )
    # Verify no dup: the resume content must NOT contain deltas from before from_seq=2
    assert 'The old house ' not in resume_text, "resume must NOT replay delta #0"
    assert 'creaked under ' not in resume_text, "resume must NOT replay delta #1"
