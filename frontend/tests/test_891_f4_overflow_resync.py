"""#891 finding F4 — an OVERFLOWING SSE subscriber is recovered, not silently dropped into a gap.

Before F4, `session_events.publish` fanned each event to every subscriber's bounded (maxsize=256)
`asyncio.Queue` with `q.put_nowait(payload)` inside a bare `except Exception: pass`. When a
slow/stuck consumer's queue filled, `put_nowait` raised `asyncio.QueueFull` and the payload was
SILENTLY DROPPED. Because every event carries a monotonic per-session `busSeq` (F3), a dropped event
left that client a PERMANENT HOLE in its busSeq stream with no signal to recover.

F4 recovers the overflowing subscriber: best-effort drain to reclaim room, then enqueue ONE `resync`
sentinel (a normal event through `_fmt`/`_next_seq`, so it keeps a monotonic busSeq) telling the
client "you fell behind — reload from history." The client half (sessionSync.js) detects a busSeq
HOLE or the `resync` sentinel and reconciles through the EXISTING coalesced softReloadHistory seam.

This is server-push plumbing (no LLM call) — golden-neutral, and it does NOT touch the chat stream
loop. Roles only; no names (CLAUDE.md). Server behavior is exercised against the REAL `session_events`
bus with a deliberately tiny subscriber queue; the client gap-detection is source-pinned (the F3
sibling gate pins the same way — the FE JS behavior is proven live in the two-window harness).
"""
import asyncio
import importlib
import json
import os

import pytest

session_events = importlib.import_module("src.session_events")

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


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


def _drain(q):
    """Everything currently sitting in a subscriber queue (order preserved)."""
    out = []
    while not q.empty():
        out.append(q.get_nowait())
    return out


def _events_of(raw_list, name):
    """The parsed `data` dicts of every SSE frame of type `name` in a drained queue."""
    out = []
    for ev in raw_list:
        if ev.startswith(f"event: {name}\n"):
            line = next((l for l in ev.split("\n") if l.startswith("data: ")), None)
            if line:
                out.append(json.loads(line[len("data: "):]))
    return out


@pytest.fixture(autouse=True)
def _clean_bus():
    # session_events is process-global; isolate each test's subscriber/ring/counter state.
    session_events._SUBS.clear()
    session_events._RING.clear()
    session_events._SEQ.clear()
    yield
    session_events._SUBS.clear()
    session_events._RING.clear()
    session_events._SEQ.clear()


# ── SERVER: an overflowing subscriber gets a resync sentinel, not a silent gap ───────────────────

def test_overflowing_subscriber_gets_a_resync_sentinel():
    """The F4 core: publishing to a subscriber whose bounded queue is FULL must recover it with a
    `resync` sentinel instead of silently dropping the payload into a permanent busSeq gap."""
    async def main():
        sid = "f4-overflow"
        q = asyncio.Queue(maxsize=1)
        session_events._SUBS[sid] = {q}
        q.put_nowait("event: filler\ndata: {}\n\n")   # fill it so the next publish overflows
        assert q.full()
        session_events.publish(sid, "game-updated")   # can't fit → F4 must recover the subscriber
        return _drain(q)

    drained = _run(main())
    resyncs = _events_of(drained, "resync")
    assert resyncs, (
        "an overflowing subscriber must receive a `resync` sentinel (reload-from-history signal), "
        "not a silent permanent busSeq gap"
    )


def test_resync_sentinel_is_a_well_formed_versioned_event():
    """The sentinel is an ordinary event: it carries the session id and a numeric monotonic `busSeq`
    (via `_fmt`/`_next_seq`) so its ordering into the queue stays monotonic and the client can advance
    its high-water mark past the drop."""
    async def main():
        sid = "f4-shape"
        q = asyncio.Queue(maxsize=1)
        session_events._SUBS[sid] = {q}
        q.put_nowait("event: filler\ndata: {}\n\n")
        session_events.publish(sid, "game-updated")
        return _drain(q)

    drained = _run(main())
    resyncs = _events_of(drained, "resync")
    assert resyncs, "a resync sentinel is enqueued on overflow"
    r = resyncs[-1]
    assert r.get("session") == "f4-shape", "the sentinel carries its session id"
    assert isinstance(r.get("busSeq"), int), "the sentinel carries a numeric busSeq (monotonic ordering)"


def test_resync_drain_reclaims_room_so_the_sentinel_fits():
    """The recovery drains the stale (now-superseded) payloads to reclaim room, so the sentinel
    actually lands even on a queue that was completely full of prior pings."""
    async def main():
        sid = "f4-drain"
        q = asyncio.Queue(maxsize=4)
        session_events._SUBS[sid] = {q}
        for i in range(4):
            q.put_nowait(f"event: filler\ndata: {{\"i\": {i}}}\n\n")
        assert q.full()
        session_events.publish(sid, "game-updated")
        return _drain(q)

    drained = _run(main())
    assert _events_of(drained, "resync"), "a full queue is drained enough for the resync sentinel to fit"


# ── SERVER: healthy subscribers are unaffected (isolation + no spurious resync) ──────────────────

def test_healthy_subscriber_gets_the_payload_not_a_resync():
    """Regression guard: a subscriber with room receives the NORMAL payload and is never handed a
    spurious resync — F4 only fires on genuine overflow."""
    async def main():
        sid = "f4-healthy"
        q = asyncio.Queue(maxsize=8)
        session_events._SUBS[sid] = {q}
        session_events.publish(sid, "game-updated")
        return _drain(q)

    drained = _run(main())
    assert _events_of(drained, "game-updated"), "a healthy subscriber receives the real payload"
    assert not _events_of(drained, "resync"), "no spurious resync when the queue has room"


def test_overflow_is_isolated_to_the_stuck_subscriber():
    """One overflowing subscriber must not disrupt delivery to the healthy peers on the same session:
    the healthy queue gets the real payload; only the stuck one gets the resync."""
    async def main():
        sid = "f4-isolation"
        stuck = asyncio.Queue(maxsize=1)
        healthy = asyncio.Queue(maxsize=8)
        stuck.put_nowait("event: filler\ndata: {}\n\n")   # only this one is full
        session_events._SUBS[sid] = {stuck, healthy}
        session_events.publish(sid, "game-updated")
        return _drain(stuck), _drain(healthy)

    stuck_drained, healthy_drained = _run(main())
    assert _events_of(stuck_drained, "resync"), "the stuck subscriber is recovered with a resync"
    assert _events_of(healthy_drained, "game-updated"), "the healthy subscriber still gets the payload"
    assert not _events_of(healthy_drained, "resync"), "the healthy subscriber is NOT handed a resync"


# ── CLIENT: gap-detection + resync handling reuse the EXISTING reconcile seam ─────────────────────

SYNC = _read("static", "js", "sessionSync.js")


def test_client_detects_a_busseq_hole():
    """sessionSync.js gains a busSeq gap detector: an event whose busSeq jumps past the high-water
    mark + 1 means we missed one (a dropped/overflowed event)."""
    assert "function _busGap(id, data)" in SYNC, "the gap-detection helper"
    assert "return typeof last === 'number' && bs > last + 1;" in SYNC, "a hole = busSeq > last + 1"
    # fail-open: an unversioned event can't reveal a gap.
    assert "if (typeof bs !== 'number' || !isFinite(bs)) return false;" in SYNC


def test_client_handles_the_resync_sentinel():
    """The client subscribes to the new `resync` sentinel and treats it as a fell-behind signal."""
    assert "es.addEventListener('resync'" in SYNC, "the client wires a resync listener"
    assert "type === 'resync'" in SYNC, "handle() treats resync as a fell-behind signal"
    # the sentinel carries no board/chat payload of its own — return after reconciling.
    assert "if (type === 'resync') return;" in SYNC


def test_client_reconciles_through_the_existing_seam_not_a_new_one():
    """The recovery reuses the EXISTING coalesced reconcile seam (scheduleReconcile → softReloadHistory)
    — the same mechanism message-added uses — and must NOT invent a new reload path or an ad-hoc g15
    dispatcher (that invariant lives in platform.js)."""
    assert "if (id && (type === 'resync' || _busGap(id, data))) { scheduleReconcile(id); }" in SYNC, \
        "a resync OR a busSeq hole triggers the existing coalesced reconcile"
    # keeps the stream contiguous for events the board-ping dedupe doesn't track (no re-detect loop).
    assert "function _noteBusSeq(id, data)" in SYNC
    assert "if (id && !_isBoardPing) { _noteBusSeq(id, data); }" in SYNC
    # no new g15 dispatcher smuggled in.
    assert "new CustomEvent('orwell:gamechanged'" not in SYNC
    assert 'new CustomEvent("orwell:gamechanged"' not in SYNC


def test_client_gap_detection_does_not_double_reload_on_the_contiguous_case():
    """Fail-safe framing pinned: the F3 board-ping dedupe helper is UNCHANGED (contiguous pings still
    dedupe by busSeq and don't reload), so the F4 gap path only fires on an actual hole / the sentinel."""
    assert "function _isFreshPing(id, data)" in SYNC, "the F3 dedupe helper is preserved"
    assert "if (typeof last === 'number' && bs <= last) return false;" in SYNC, "F3 dedupe intact"
