"""Persistent per-session SSE notification hub for cross-device sync.

Separate from `agent_runs` (which is per-run and ephemeral — it only exists while
a message is streaming). This hub lives as long as a device is *viewing* a
session: every device that opens a session subscribes here, and the server
broadcasts lightweight "session changed" events — a run started, a message was
added — so every other device viewing the same session reconciles in real time.

Payloads are tiny (ids/types, never message bodies). On an event, each device
fetches the authoritative state itself (reload history / attach to the live run),
so this channel can never leak or get the content wrong — it only says "something
changed, go look."

Durability scope: in-memory, per server process (like `agent_runs`). A dropped
SSE connection just removes that subscriber; the client reconnects.
"""
import asyncio
import json
import logging
import time
from collections import deque
from typing import AsyncGenerator, Deque, Dict, Optional, Set

logger = logging.getLogger(__name__)

# session_id -> set of subscriber queues (one per connected device/tab)
_SUBS: Dict[str, Set[asyncio.Queue]] = {}

# ADR 0012 §3.4b — the durable run-started invitation. `publish` is at-most-once
# (`if not subs: return`): a `run-started` fired in the gap between a window
# selecting the session and its SSE actually connecting (the sessionSync.js ~1500ms
# reconnect `tick`) is dropped silently, so an idle peer can miss the *invitation* to
# attach to the shared run. We keep a tiny per-session ring of the most recent events
# and REPLAY it on `subscribe()` after the `connected` hello — mirroring
# `agent_runs._Run.buffer`. So a window that connects just AFTER a run started still
# learns to attach to the (still-live) shared run. Bounded + Vault-free (id/seq/type
# only — never content); this is a reconnect catch-up, not a log.
# session_id -> deque of formatted SSE event strings (most recent last)
_RING: Dict[str, Deque[str]] = {}
_RING_MAX = 8

# Only replay the event TYPES that are an "attach / reconcile" invitation an idle peer
# could have missed. Anything else (heartbeats, future fire-and-forget pings) is not
# worth re-delivering and would only add reconnect noise.
_RING_REPLAY_EVENTS = ("run-started", "message-added")

# Send an SSE comment heartbeat this often so idle connections (and any proxy in
# front) stay open between real events.
_HEARTBEAT_S = 20


def _fmt(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def publish(session_id: str, event: str, data: Optional[dict] = None) -> None:
    """Fan one event out to every device currently viewing `session_id`."""
    if not session_id:
        return
    payload = _fmt(event, {"session": session_id, **(data or {})})
    # ADR 0012 §3.4b: append the invitation-class events to the per-session replay ring
    # BEFORE the live fan-out, so a window connecting in the publish→connect gap replays
    # it. Independent of whether anyone is currently subscribed (that is the whole point).
    if event in _RING_REPLAY_EVENTS:
        ring = _RING.get(session_id)
        if ring is None:
            ring = _RING[session_id] = deque(maxlen=_RING_MAX)
        ring.append(payload)
    subs = _SUBS.get(session_id)
    if not subs:
        return
    for q in list(subs):
        try:
            q.put_nowait(payload)
        except Exception:
            pass


async def subscribe(session_id: str) -> AsyncGenerator[str, None]:
    """SSE generator a device opens for the session it is viewing. Yields a
    `connected` hello, REPLAYS the recent-events ring (the §3.4b durable invitation),
    then live events, with periodic keepalive comments."""
    q: asyncio.Queue = asyncio.Queue(maxsize=256)
    _SUBS.setdefault(session_id, set()).add(q)
    try:
        yield _fmt("connected", {"session": session_id, "ts": time.time()})
        # Replay-on-connect: hand a late window the recent invitation events it may have
        # missed (run-started fired before this SSE connected). Snapshot the ring so a
        # concurrent publish can't mutate it mid-iteration. Idempotent on the client —
        # run-started → resumeStream (404 if the run already finished) and message-added →
        # a coalesced softReloadHistory both no-op when there's nothing to do.
        for ev in list(_RING.get(session_id, ())):
            yield ev
        while True:
            try:
                ev = await asyncio.wait_for(q.get(), timeout=_HEARTBEAT_S)
                yield ev
            except asyncio.TimeoutError:
                yield ": keepalive\n\n"  # SSE comment — ignored by clients, keeps the pipe warm
    finally:
        subs = _SUBS.get(session_id)
        if subs is not None:
            subs.discard(q)
            if not subs:
                _SUBS.pop(session_id, None)
                # No viewers left — drop the ring too so a stale invitation can't be
                # replayed to a window that reconnects much later (the run is long gone).
                _RING.pop(session_id, None)


def subscriber_count(session_id: str) -> int:
    return len(_SUBS.get(session_id, ()))


def _ring_snapshot(session_id: str) -> list:
    """Test/diagnostic accessor: the current replay-ring contents for a session."""
    return list(_RING.get(session_id, ()))
