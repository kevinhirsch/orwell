"""Detached agent-run manager.

Keeps an agent/chat stream running server-side after the SSE client disconnects
(tab close, navigate away, refresh). The streaming generator is drained by a
background asyncio task into a per-session replay buffer; SSE clients SUBSCRIBE
to that buffer (replay everything so far, then live). Closing the SSE only drops
the subscriber — the drain task keeps going.

The wrapped generator already persists the assistant message to the session on
completion, so reopening the session shows the finished result even if nobody
was connected when it finished. Reconnecting mid-run replays the buffer + streams
live (pick up where it is).

Durability scope: in-memory, survives as long as the server process runs (tab
close / navigation / refresh). It does NOT survive a server restart.
"""
import asyncio
import json
import logging
from typing import AsyncGenerator, Dict, Optional

logger = logging.getLogger(__name__)


class _Run:
    __slots__ = ("buffer", "subscribers", "status", "task", "evict_task")

    def __init__(self) -> None:
        self.buffer: list = []          # ordered SSE event strings (replay log)
        self.subscribers: set = set()   # one asyncio.Queue per connected client
        self.status: str = "running"    # running | done | error | stopped
        self.task: Optional[asyncio.Task] = None
        self.evict_task: Optional[asyncio.Task] = None


_RUNS: Dict[str, _Run] = {}

# How long a FINISHED run (and its full replay buffer) is retained after the
# last subscriber disconnects, so a reconnect within the window can still
# replay the result. After this, the run is evicted to bound memory — without
# it, every session that ever streamed kept its entire event log forever.
_EVICT_GRACE_S = 180


def _publish(run: _Run, ev: str) -> None:
    """Append one SSE event and fan it out to every live subscriber."""
    run.buffer.append(ev)
    seq = len(run.buffer) - 1
    for q in list(run.subscribers):
        try:
            q.put_nowait((seq, ev))
        except Exception:
            pass


def _schedule_evict(session_id: str) -> None:
    """(Re)arm a grace-period eviction for a terminal run with no subscribers.
    Identity-checked so a run that gets replaced/reused is never evicted by a
    stale timer."""
    run = _RUNS.get(session_id)
    if run is None:
        return
    if run.evict_task and not run.evict_task.done():
        run.evict_task.cancel()

    async def _evict(run_ref: _Run) -> None:
        try:
            await asyncio.sleep(_EVICT_GRACE_S)
        except asyncio.CancelledError:
            return
        cur = _RUNS.get(session_id)
        if cur is run_ref and cur.status != "running" and not cur.subscribers:
            _RUNS.pop(session_id, None)

    run.evict_task = asyncio.create_task(_evict(run))


def is_active(session_id: str) -> bool:
    r = _RUNS.get(session_id)
    return bool(r and r.status == "running")


def has_run(session_id: str) -> bool:
    """True if a run EXISTS for this session — running OR terminal-but-still-buffered (within the
    evict grace). Distinct from is_active (running only): the Messenger-mirror late-attach
    (ADR 0012) needs a peer to RESUME and REPLAY a run that JUST finished — a short turn often
    completes before a peer's `run-started`→resume chain arrives, so gating resume on `is_active`
    404s the very window that should be mirroring it. `subscribe()` replays the buffer then ends for
    a finished run, so resuming an existing-but-terminal run is safe and idempotent (reconcile-by-id)."""
    return _RUNS.get(session_id) is not None


def head_seq(session_id: str) -> int:
    """The current buffer head index (the last replayable `seq`), or -1 when the run has no buffered
    event yet / does not exist. This is the SAME index `_publish` binds each event to
    (``seq = len(buffer) - 1``) — the WebSocket `chat` subscribe (WS Phase-1, §3.1) reports it as the
    `ack`'s `headSeq` so the client knows the exact ``[fromSeq..headSeq]`` window the replay covers
    before the live tail begins. Read once, right before subscribe; a live append after is fine — the
    replay-then-tail contract stays contiguous regardless (headSeq is advisory)."""
    run = _RUNS.get(session_id)
    if run is None:
        return -1
    return len(run.buffer) - 1


def get_status(session_id: str) -> Optional[str]:
    r = _RUNS.get(session_id)
    return r.status if r else None


async def _drain(session_id: str, agen: AsyncGenerator[str, None],
                 prev_task: Optional[asyncio.Task] = None) -> None:
    """Pull every event from the wrapped generator into the run buffer, fanning
    each out to live subscribers. Runs to completion regardless of subscribers."""
    run = _RUNS.get(session_id)
    if run is None:
        return
    # If this run replaced an in-flight one (rapid double-send), wait for that
    # one to fully finish first. Its CancelledError handler calls aclose(), which
    # persists its partial response — letting it complete before we start writing
    # keeps the two runs' session saves sequential instead of interleaved.
    if prev_task is not None and not prev_task.done():
        try:
            await asyncio.wait({prev_task})
        except asyncio.CancelledError:
            raise            # our own cancellation — propagate
        except Exception:
            pass
    try:
        async for ev in agen:
            _publish(run, ev)
        if run.status == "running":
            run.status = "done"
    except asyncio.CancelledError:
        run.status = "stopped"
        # Let the wrapped generator's own CancelledError handler run (it saves
        # the partial response to the session).
        try:
            await agen.aclose()
        except Exception:
            pass
    except Exception as e:
        logger.error("[agent-run] %s failed: %s", session_id, e, exc_info=True)
        run.status = "error"
        _publish(
            run,
            "event: error\n"
            f"data: {json.dumps({'error': 'Agent run failed before completion.', 'status': 500})}\n\n",
        )
        _publish(run, "data: [DONE]\n\n")
    finally:
        # Wake every subscriber with the end sentinel so their SSE closes.
        for q in list(run.subscribers):
            try:
                q.put_nowait((None, None))
            except Exception:
                pass
        # Run is terminal — arm the grace timer so it (and its buffer) is
        # eventually freed even if nobody ever reconnects. subscribe() cancels
        # this on connect and re-arms on disconnect.
        _schedule_evict(session_id)


def start(session_id: str, agen: AsyncGenerator[str, None], *, queue: bool = False) -> _Run:
    """Start a detached run draining `agen` for a session.

    Default (plain chat): if a run is already in flight for this session (a rapid double-send), it is
    CANCELLED first and the new run replaces it.

    `queue=True` (feature 0064 Part C — the Messenger model for GAME turns): the in-flight run is NOT
    cancelled — the new run CHAINS after it (it awaits the current run's natural completion via the
    same `prev_task` wait, then drains). So a second device's game turn never STOMPS the one in
    flight; turns serialize, and there is never more than one reasoning chain at a time. The new run
    streams to its own subscribers only once the prior one ends. (Plain chats keep cancel-on-double-
    send — only the game path opts into queuing.)
    """
    prev = _RUNS.get(session_id)
    prev_task: Optional[asyncio.Task] = None
    if prev:
        if prev.task and not prev.task.done():
            if not queue:
                prev.task.cancel()  # plain chat: replace the in-flight run (the historical behavior)
            prev_task = prev.task    # new run awaits this — a CANCELLED stomp OR a queued natural finish
        if prev.evict_task and not prev.evict_task.done():
            prev.evict_task.cancel()
    run = _Run()
    _RUNS[session_id] = run
    run.task = asyncio.create_task(_drain(session_id, agen, prev_task))
    return run


async def subscribe(session_id: str, from_seq: int = 0) -> AsyncGenerator[str, None]:
    """Replay the run's buffer from `from_seq`, then stream live until it ends.
    Safe to call repeatedly (reconnect) and from multiple clients at once.

    `from_seq` (WS Phase-1 §3.2 preferred path — back-compat: default 0 ⇒ byte-identical to the
    historical replay-from-0 → live-tail behavior every SSE subscriber uses today). A late/reconnecting
    client that already rendered through buffer index N passes `from_seq = N + 1` so the server replays
    ONLY `buffer[from_seq..len)` — the "give me everything after what I have" cursor — then live-tails,
    with no gap and no dup at the splice. It works because `next_seq` starts at `from_seq`: replay yields
    the buffered tail from there, and the live drain's de-dup (`if seq >= next_seq`) + sentinel flush are
    unchanged, so the yielded events stay contiguous buffer indices `from_seq, from_seq+1, …` regardless
    of when the drop happened. A `from_seq` past the current head simply replays nothing and live-tails
    from there (the caller is expected to clamp to the buffer; a negative value is floored to 0)."""
    run = _RUNS.get(session_id)
    if run is None:
        return
    q: asyncio.Queue = asyncio.Queue()
    run.subscribers.add(q)            # register BEFORE replaying so nothing is missed
    # A live subscriber is connected — don't let a pending grace timer evict
    # the run out from under it mid-replay.
    if run.evict_task and not run.evict_task.done():
        run.evict_task.cancel()
    try:
        next_seq = from_seq if from_seq > 0 else 0
        while next_seq < len(run.buffer):
            yield run.buffer[next_seq]
            next_seq += 1
        if run.status != "running":
            return
        while True:
            seq, ev = await q.get()
            if seq is None:            # end sentinel
                while next_seq < len(run.buffer):   # flush any tail the sentinel raced
                    yield run.buffer[next_seq]
                    next_seq += 1
                break
            if seq >= next_seq:        # skip events already replayed from the buffer
                yield ev
                next_seq = seq + 1
    finally:
        run.subscribers.discard(q)
        # Last subscriber gone on a finished run — (re)arm eviction so the
        # buffer doesn't linger indefinitely.
        if not run.subscribers and run.status != "running":
            _schedule_evict(session_id)


def stop(session_id: str) -> bool:
    """Cancel an in-flight run (the wrapped generator saves its partial)."""
    run = _RUNS.get(session_id)
    if run and run.task and not run.task.done():
        run.task.cancel()
        return True
    return False
