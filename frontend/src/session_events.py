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
import threading
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

# F3 (#891) — a monotonic per-session BUS sequence stamped on every published event as `busSeq`. It
# is the "version" that makes the ring's replay-durability usable: a client that reconnects/was
# backgrounded replays the board pings it missed, and dedupes a ping it ALREADY applied by comparing
# busSeq (drop stale/duplicate). Because `publish` formats ONE payload and uses it for BOTH the ring
# and the live fan-out, the live copy and the later-replayed copy of a ping carry the IDENTICAL
# busSeq — exactly what the client keys dedupe on. Vault-free: a bus position, never game state.
# Process-local (like the ring) and torn down with the ring; a reset (restart / long-idle eviction)
# is covered by the panels' 20-30s poll floor, the same correctness floor the live push relies on.
# session_id -> last-issued busSeq
_SEQ: Dict[str, int] = {}
# Guards the counter's read-modify-write: a sync route runs in a threadpool, so two concurrent
# publishes must never mint a DUPLICATE busSeq (that would make the client drop a distinct ping as an
# 'already seen' replay). deque.append + the _SUBS list-copy are already atomic; only this is not.
_SEQ_LOCK = threading.Lock()


def _next_seq(session_id: str) -> int:
    """The next monotonic per-session bus sequence (F3 / #891)."""
    with _SEQ_LOCK:
        n = _SEQ.get(session_id, 0) + 1
        _SEQ[session_id] = n
        return n

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
        # A ring-evict task can outlive the loop it was armed on (e.g. a per-test `_run` loop that
        # closed with the 180s timer still pending). Cancelling such a cross-loop task calls into the
        # dead loop and raises ``RuntimeError: Event loop is closed`` — which, bubbling through
        # ``subscribe`` and the ws state/layout channels' ``except RuntimeError: return``, would
        # silently kill an otherwise-healthy channel (a real fe-unit teardown flake). Popping the
        # reference is what matters; the cancel is best-effort. In production the loop never closes,
        # so this except never fires.
        try:
            task.cancel()
        except RuntimeError:
            pass


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
            _SEQ.pop(session_id, None)  # F3: the bus counter shares the ring's lifecycle (bounded)
        _RING_EVICT_TASKS.pop(session_id, None)

    try:
        _RING_EVICT_TASKS[session_id] = asyncio.create_task(_evict())
    except RuntimeError:
        # No running loop (sync test teardown / shutdown) — fall back to the prior immediate behavior.
        _RING.pop(session_id, None)
        _SEQ.pop(session_id, None)

# Replay the event TYPES that are an "attach / reconcile" invitation an idle peer could have missed.
# `game-updated` is a HUD-refetch reconcile (F5 / 0064) and `layout-changed` is a per-device geometry
# mirror (F3 / #891) — BOTH are cross-device board pings that historically fanned out to LIVE
# subscribers only, so a reconnecting/backgrounded device missed them until its 20–30s poll. Ringing
# them makes them replay-durable: a device that connects AFTER the ping replays it on connect. The
# `busSeq` stamp (above) lets the client dedupe a ping it already applied, so the replay adds no
# reconnect noise (the old reason layout-changed was excluded). The ring is bounded (maxlen 8) and
# every replayed ping is idempotent — game-updated re-fetches the joiner's own Vault-free projection;
# layout-changed re-applies per-device geometry (the client scopes by deviceId + drops its own origin
# echo). No state body ever crosses. Heartbeats (`connected`/`keepalive`) are never published here.
_RING_REPLAY_EVENTS = ("run-started", "message-added", "game-updated", "layout-changed")

# Send an SSE comment heartbeat this often so idle connections (and any proxy in
# front) stay open between real events.
_HEARTBEAT_S = 20

# F4 (#891) — overflow recovery. A subscriber queue is bounded (`subscribe` mints maxsize=256). When a
# slow/stuck consumer's queue fills, `put_nowait` raises `asyncio.QueueFull`. Silently dropping the
# payload (the old bare `except: pass`) leaves that client a PERMANENT HOLE in its monotonic `busSeq`
# stream with no signal to recover. Instead we drop a bounded batch of the OLDEST (now-superseded)
# payloads to reclaim room and enqueue ONE `resync` sentinel — a full-reconcile signal. How many stale
# payloads to reclaim before enqueuing the sentinel (a full history reconcile supersedes them all).
_OVERFLOW_DRAIN = 32


def _fmt(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def _recover_overflowed_subscriber(session_id: str, q: "asyncio.Queue") -> None:
    """F4 (#891): a subscriber's queue is full — recover it instead of leaving a silent permanent gap.

    Best-effort drain a bounded batch of the oldest (now-superseded) payloads to reclaim room, then
    enqueue a single `resync` sentinel — an ordinary event carrying its own monotonic `busSeq` via the
    normal `_fmt`/`_next_seq` path, so ordering into this queue stays monotonic. The sentinel tells the
    client "you fell behind — reload from history," which supersedes every queued ping anyway. If even
    the sentinel won't fit after the drain, that is acceptable: the client's own busSeq gap-detection
    (sessionSync.js) is the backstop. Targeted at the ONE stuck queue (not the ring / other subscribers).
    """
    # Reclaim room for the sentinel. The queued payloads are stale — a full reconcile supersedes them.
    for _ in range(_OVERFLOW_DRAIN):
        try:
            q.get_nowait()
        except asyncio.QueueEmpty:
            break
    sentinel = _fmt("resync", {"session": session_id, "busSeq": _next_seq(session_id)})
    try:
        q.put_nowait(sentinel)
    except asyncio.QueueFull:
        pass  # still full after the drain — the client's busSeq gap-detection recovers it.


def publish(session_id: str, event: str, data: Optional[dict] = None) -> None:
    """Fan one event out to every device currently viewing `session_id`.

    Every event is stamped with a monotonic per-session `busSeq` (F3 / #891). The SAME formatted
    payload is appended to the replay ring AND fanned out live, so the ping a client receives live and
    the copy it later replays on reconnect carry the IDENTICAL busSeq — which is exactly what lets the
    client dedupe a replayed ping it already applied (drop stale ones) while still catching one it
    missed. `busSeq` wins over any caller-supplied key (it is placed last).
    """
    if not session_id:
        return
    data = dict(data or {})
    # #1087 parity for the SSE fallback (the first-message self-echo double): stamp the CURRENT run id
    # onto a `run-started` invitation. `session_events` is at-least-once — the sender receives its OWN
    # `run-started` echo (and the ring replays it on a late connect) while its foreground POST is still
    # rendering that very run; without a run identity the SSE client (sessionSync.js) could not tell its
    # own echo from a genuine PEER run, so it deferred a peer-resume of its OWN run and, at stream end,
    # re-attached to the just-finished run in the evict grace — painting a duplicate bubble the reconcile
    # then had to collapse (the visible "appears twice then dedupes" flicker on the first message). The WS
    # `state` edge already carries this id (ws_routes / #1087); this brings the SSE run-started to parity
    # so the client can recognize and skip its own run. The SAME formatted payload rides the live fan-out
    # AND the replay ring, so a live copy and a replayed copy carry the IDENTICAL runId. Lazy import avoids
    # any import-time coupling; best-effort (an older run already gone ⇒ no id ⇒ unchanged behavior).
    if event == "run-started" and "runId" not in data:
        try:
            from src import agent_runs as _agent_runs
            _rid = _agent_runs.run_id(session_id)
            if _rid:
                data["runId"] = _rid
        except Exception:
            pass
    payload = _fmt(event, {"session": session_id, **data, "busSeq": _next_seq(session_id)})
    # ADR 0012 §3.4b: append the ring-durable events to the per-session replay ring BEFORE the live
    # fan-out, so a window connecting in the publish→connect gap replays it. Independent of whether
    # anyone is currently subscribed (that is the whole point).
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
        except asyncio.QueueFull:
            # F4 (#891): this subscriber fell behind and its bounded queue is full. Don't silently drop
            # the payload into a permanent busSeq gap — recover the subscriber with a single `resync`
            # sentinel so its client reloads from history. Best-effort + isolated to this one queue;
            # must never break delivery to the other (healthy) subscribers.
            try:
                _recover_overflowed_subscriber(session_id, q)
            except Exception:
                pass
        except Exception:
            # Any other unexpected per-subscriber error is swallowed so the fan-out loop survives.
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
