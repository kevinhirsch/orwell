"""#891 finding F3 — cross-device board pings are REPLAY-DURABLE.

Before F3, `game-updated`/`layout-changed` fanned out to LIVE SSE subscribers only, so a device that
had reconnected or was backgrounded MISSED them until its 20-30s poll. F3 carries both in the
per-session SSE replay ring (`session_events._RING`) and stamps every event with a monotonic
per-session `busSeq` — so a device that connects AFTER a ping REPLAYS it on connect, and a device
that ALREADY applied a ping dedupes the replay by busSeq (drop stale ones) instead of double-applying.

This is server-push plumbing (no LLM call) — golden-neutral, and it does NOT touch the chat stream
loop. Roles only; no names (CLAUDE.md). Server behavior is exercised against the REAL `session_events`
bus; the client dedupe is source-pinned (the FE JS behavior is proven live in the two-window harness).
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


async def _drain_subscribe(sid, *, max_events=16, timeout=0.5):
    """Open a subscription, collect the connected hello + any ring replay, and stop once it goes
    quiet (so a late-connecting window's replayed pings are observable without hanging on keepalive)."""
    out = []
    agen = session_events.subscribe(sid)
    try:
        while len(out) < max_events:
            try:
                ev = await asyncio.wait_for(agen.__anext__(), timeout=timeout)
            except (asyncio.TimeoutError, StopAsyncIteration):
                break
            if ev.startswith(": keepalive"):
                break
            out.append(ev)
    finally:
        await agen.aclose()
    return out


def _events_of(raw_list, name):
    """The parsed `data` dicts of every SSE frame of type `name` in a drained subscription."""
    out = []
    for ev in raw_list:
        if ev.startswith(f"event: {name}\n"):
            line = next((l for l in ev.split("\n") if l.startswith("data: ")), None)
            if line:
                out.append(json.loads(line[len("data: "):]))
    return out


@pytest.fixture(autouse=True)
def _clean_bus():
    # session_events is process-global; isolate each test's ring/counter state.
    session_events._SUBS.clear()
    session_events._RING.clear()
    session_events._SEQ.clear()
    yield
    session_events._SUBS.clear()
    session_events._RING.clear()
    session_events._SEQ.clear()


# ── replay-durability: a device connecting AFTER the ping still gets it ──────────────────────────

def test_layout_changed_published_before_connect_is_replayed():
    """The F3 core: a `layout-changed` published while NOBODY is subscribed is REPLAYED on the next
    connect — so a reconnecting/backgrounded device catches the board ping it missed (before F3 it
    was fanned to live subscribers only and lost)."""
    async def main():
        sid = "f3-layout-late"
        session_events.publish(sid, "layout-changed",
                               {"windowId": "cast", "state": {"x": 1}, "deviceId": "d", "origin": "o"})
        return await _drain_subscribe(sid)

    out = _run(main())
    assert any("event: connected" in ev for ev in out), "the connected hello is always first"
    layouts = _events_of(out, "layout-changed")
    assert layouts, "a layout-changed published before connect must be REPLAYED on subscribe (F3)"
    assert layouts[0]["windowId"] == "cast", "the replayed descriptor is intact"


def test_game_updated_published_before_connect_is_replayed():
    """`game-updated` is likewise replay-durable (it was added to the ring for the F5 first-turn edge;
    F3 confirms + versions it) — a late device replays the HUD-refetch ping."""
    async def main():
        sid = "f3-game-late"
        session_events.publish(sid, "game-updated")
        return await _drain_subscribe(sid)

    out = _run(main())
    assert _events_of(out, "game-updated"), "a game-updated published before connect must be replayed"


# ── the busSeq version marker: present, monotonic, and STABLE across live vs replay ──────────────

def test_board_pings_carry_a_numeric_busseq():
    """Every board ping carries a numeric per-session `busSeq` (the dedupe/ordering marker). Vault-free
    — a bus position, never game state."""
    async def main():
        sid = "f3-busseq-present"
        session_events.publish(sid, "game-updated")
        session_events.publish(sid, "layout-changed", {"windowId": "w", "state": {"x": 2}})
        return await _drain_subscribe(sid)

    out = _run(main())
    g = _events_of(out, "game-updated")
    lay = _events_of(out, "layout-changed")
    assert g and isinstance(g[0].get("busSeq"), int), "game-updated carries a numeric busSeq"
    assert lay and isinstance(lay[0].get("busSeq"), int), "layout-changed carries a numeric busSeq"


def test_busseq_is_monotonic_per_session():
    """busSeq strictly increases per session across the shared stream of BOTH ping types — so a single
    client high-water mark orders them correctly."""
    async def main():
        sid = "f3-busseq-mono"
        session_events.publish(sid, "game-updated")
        session_events.publish(sid, "layout-changed", {"windowId": "w", "state": {}})
        session_events.publish(sid, "game-updated")
        return await _drain_subscribe(sid)

    out = _run(main())
    seqs = [d["busSeq"] for d in
            (_events_of(out, "game-updated") + _events_of(out, "layout-changed"))]
    # replay order is insertion order; the three busSeqs must be distinct and strictly increasing.
    ring_seqs = [json.loads(ev.split("data: ", 1)[1])["busSeq"]
                 for ev in out if ev.startswith("event:") and "connected" not in ev]
    assert ring_seqs == sorted(ring_seqs), "the ring replays in ascending busSeq order"
    assert len(set(ring_seqs)) == len(ring_seqs), "each publish mints a DISTINCT busSeq (no duplicates)"


def test_live_and_replayed_copies_carry_the_same_busseq():
    """The dedupe-key stability that makes the whole thing work: the busSeq a client sees LIVE and the
    busSeq of the SAME ping REPLAYED on a reconnect are IDENTICAL (one formatted payload feeds both the
    ring and the live fan-out). Without this, a client could never recognize a replay as 'already
    applied'."""
    async def main():
        sid = "f3-busseq-stable"
        # A live subscriber receives the ping live...
        live_agen = session_events.subscribe(sid)
        # drain the connected hello
        await asyncio.wait_for(live_agen.__anext__(), timeout=0.5)
        session_events.publish(sid, "game-updated")
        live_ev = await asyncio.wait_for(live_agen.__anext__(), timeout=0.5)
        await live_agen.aclose()  # ring survives the evict grace
        # ...then a reconnecting subscriber replays the SAME ping from the ring.
        replay = await _drain_subscribe(sid)
        return live_ev, replay

    live_ev, replay = _run(main())
    live_seq = json.loads(live_ev.split("data: ", 1)[1])["busSeq"]
    replay_seqs = [d["busSeq"] for d in _events_of(replay, "game-updated")]
    assert replay_seqs and replay_seqs[0] == live_seq, \
        "the live copy and the ring-replayed copy of one ping carry the IDENTICAL busSeq (dedupe key)"


def test_ring_is_bounded_to_max():
    """No unbounded growth: the ring is capped at _RING_MAX regardless of how many pings are published
    (bounded the same way chat events are)."""
    sid = "f3-ring-bound"
    for _ in range(session_events._RING_MAX + 5):
        session_events.publish(sid, "game-updated")
    snap = session_events._ring_snapshot(sid)
    assert len(snap) == session_events._RING_MAX, "the replay ring is bounded (no unbounded growth)"


def test_concurrent_publishes_never_duplicate_a_busseq():
    """The counter's read-modify-write is lock-guarded, so concurrent publishes (a sync route runs in a
    threadpool) can never mint a DUPLICATE busSeq — a duplicate would make the client drop a distinct
    ping as an 'already seen' replay."""
    import threading

    sid = "f3-busseq-concurrent"
    session_events._SEQ.pop(sid, None)
    seqs = []
    seqs_lock = threading.Lock()

    def worker():
        for _ in range(50):
            n = session_events._next_seq(sid)
            with seqs_lock:
                seqs.append(n)

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(seqs) == len(set(seqs)), "no busSeq is ever handed out twice under concurrency"
    assert sorted(seqs) == list(range(1, len(seqs) + 1)), "the sequence is gapless and monotonic"


# ── client: dedupe by busSeq, routed through the EXISTING seams (no new g15 dispatcher) ──────────

SYNC = _read("static", "js", "sessionSync.js")


def test_client_dedupes_board_pings_by_busseq():
    """sessionSync.js keeps a per-session busSeq high-water mark and drops a ping it already applied —
    so a ring-REPLAYED ping (reconnect/backgrounded catch-up) does not double-apply."""
    assert "var _lastBusSeq = {}" in SYNC, "a per-session busSeq high-water-mark map"
    assert "function _isFreshPing(id, data)" in SYNC, "the dedupe helper"
    assert "data.busSeq" in SYNC, "the dedupe reads the ping's busSeq"
    # unversioned pings are always applied (fail-open — never drop a ping with no busSeq).
    assert "if (typeof bs !== 'number' || !isFinite(bs)) return true;" in SYNC
    # the high-water mark drops a stale/duplicate replay.
    assert "if (typeof last === 'number' && bs <= last) return false;" in SYNC


def test_client_gates_both_ping_handlers_on_the_dedupe():
    """Both board-ping handlers are gated on the freshness check — game-updated AND layout-changed."""
    assert "if (type === 'game-updated') { if (_isFreshPing(id, data)) notifyGameUpdated(); return; }" in SYNC
    assert "if (type === 'layout-changed') { if (_isFreshPing(id, data)) dispatchLayoutChanged(data); return; }" in SYNC


def test_client_still_routes_game_updated_through_the_one_g15_dispatcher():
    """The dedupe only GATES the existing call — game-updated still reconciles through the ONE
    sanctioned g15 dispatcher (window.orwellGameChanged); it must NOT add an ad-hoc
    `new CustomEvent('orwell:gamechanged')` (that invariant lives in platform.js)."""
    assert "if (window.orwellGameChanged) window.orwellGameChanged('sync:game-updated')" in SYNC
    assert "new CustomEvent('orwell:gamechanged'" not in SYNC
    assert 'new CustomEvent("orwell:gamechanged"' not in SYNC
