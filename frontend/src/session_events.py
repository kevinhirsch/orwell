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

# SYNC-RING-1 (#571): keep the ring after the LAST subscriber leaves for a short grace, rather than
# popping it immediately. For the dominant one-tab topology, a transient SSE drop empties `_SUBS[sid]`
# and used to take the ring with it — so a `run-started` published in the disconnect→reconnect gap was
# lost from both the (empty) fan-out AND the (now-gone) ring, making the native-EventSource reconnect
# replay empty exactly when there's a single viewer who just blipped. We mirror `agent_runs`'
# `_EVICT_GRACE_S`: arm a delayed teardown on the last disconnect, cancelled the instant a new
# subscriber re-attaches. Bounded + Vault-free (the ring holds id/seq/type only).
_RING_EVICT_GRACE_S = 180
# session_id -> the armed teardown task (so a re-subscribe can cancel it)
_RING_EVICT_TASKS: Dict[str, "asyncio.Task"] = {}


def _cancel_ring_evict(session_id: str) -> None:
    """Cancel any armed ring teardown for `session_id` (a new subscriber arrived)."""
    task = _RING_EVICT_TASKS.pop(session_id, None)
    if task is not None and not task.done():
        task.cancel()


def _schedule_ring_evict(session_id: str) -> None:
    """Arm a grace-period teardown of the replay ring after the LAST subscriber left (#571). The ring
    survives a transient one-tab reconnect; only a viewer who stays gone past the grace loses it. Re-arms
    idempotently; cancelled by `_cancel_ring_evict` on re-subscribe. Skips entirely if there's no event
    loop (e.g. a synchronous test teardown) so behavior degrades to the prior immediate-pop."""
    _cancel_ring_evict(session_id)

    async def _evict() -> None:
        try:
            await asyncio.sleep(_RING_EVICT_GRACE_S)
        except asyncio.CancelledError:
            return
        # Only tear down if STILL nobody is viewing (a re-subscribe both cancels this task and would
        # have repopulated _SUBS — this is belt-and-braces against a race).
        if not _SUBS.get(session_id):
            _RING.pop(session_id, None)
        _RING_EVICT_TASKS.pop(session_id, None)

    try:
        _RING_EVICT_TASKS[session_id] = asyncio.create_task(_evict())
    except RuntimeError:
        # No running loop (sync test teardown / shutdown) — fall back to the prior immediate behavior.
        _RING.pop(session_id, None)

# Only replay the event TYPES that are an "attach / reconcile" invitation an idle peer
# could have missed. Anything else (heartbeats, layout pings) is not worth re-delivering and
# would only add reconnect noise. `game-updated` IS a reconcile invitation (F5 / 0064): replaying
# the last HUD-refetch ping closes the FIRST-TURN edge — a window that opens DURING another window's
# first turn (which binds the canonical session mid-turn) would otherwise miss that turn's push and
# sit stale until its 20–30s poll. The ring is bounded (maxlen 8) and the replayed ping is idempotent
# (the joiner just re-fetches its own Vault-free projection; no state body crosses).
_RING_REPLAY_EVENTS = ("run-started", "message-added", "game-updated")

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
    # A viewer (re)attached — cancel any armed ring teardown so a transient one-tab reconnect keeps
    # its replay ring (#571).
    _cancel_ring_evict(session_id)
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
                # No viewers left — keep the ring for a short grace (#571) rather than dropping it
                # immediately, so a transient one-tab SSE blip can still replay an invitation
                # published in the disconnect→reconnect gap. A viewer that stays gone past the grace
                # loses the (by-then-stale) ring; a re-subscribe cancels the teardown.
                _schedule_ring_evict(session_id)


def subscriber_count(session_id: str) -> int:
    return len(_SUBS.get(session_id, ()))


def _ring_snapshot(session_id: str) -> list:
    """Test/diagnostic accessor: the current replay-ring contents for a session."""
    return list(_RING.get(session_id, ()))
