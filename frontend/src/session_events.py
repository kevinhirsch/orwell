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
from typing import AsyncGenerator, Dict, Optional, Set

logger = logging.getLogger(__name__)

# session_id -> set of subscriber queues (one per connected device/tab)
_SUBS: Dict[str, Set[asyncio.Queue]] = {}

# Send an SSE comment heartbeat this often so idle connections (and any proxy in
# front) stay open between real events.
_HEARTBEAT_S = 20


def _fmt(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def publish(session_id: str, event: str, data: Optional[dict] = None) -> None:
    """Fan one event out to every device currently viewing `session_id`."""
    if not session_id:
        return
    subs = _SUBS.get(session_id)
    if not subs:
        return
    payload = _fmt(event, {"session": session_id, **(data or {})})
    for q in list(subs):
        try:
            q.put_nowait(payload)
        except Exception:
            pass


async def subscribe(session_id: str) -> AsyncGenerator[str, None]:
    """SSE generator a device opens for the session it is viewing. Yields a
    `connected` hello, then live events, with periodic keepalive comments."""
    q: asyncio.Queue = asyncio.Queue(maxsize=256)
    _SUBS.setdefault(session_id, set()).add(q)
    try:
        yield _fmt("connected", {"session": session_id, "ts": time.time()})
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


def subscriber_count(session_id: str) -> int:
    return len(_SUBS.get(session_id, ()))
