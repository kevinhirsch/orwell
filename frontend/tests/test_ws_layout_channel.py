"""WebSocket Phase-1 (ADR 0017 §5) — the SOCKET layout leg, driven end-to-end through the REAL store.

`test_ws_layout_lww.py` covers the `orwell_layout` store unit (per-device keying, LWW, migration).
This file covers the WS SERVER wiring that `test_ws_layout_lww` does not: a `layout` up-frame persists
through the REAL `patch_layout` and fans the store's CANONICAL descriptor out over the REAL
`session_events` bus, and a `layout` subscribe forwards only `layout-changed` descriptors as `layout`
frames — never a spurious `state`/`hud` ping. No mocks of the store or the bus: only the LLM/engine is
irrelevant here (layout carries no game state). Roles only; no names (CLAUDE.md).
"""
import importlib

import pytest

from tests.support import ws_harness as H

ws_routes = importlib.import_module("routes.ws_routes")
ogs = importlib.import_module("src.orwell_game_session")
layout = importlib.import_module("src.orwell_layout")
session_events = importlib.import_module("src.session_events")


@pytest.fixture(autouse=True)
def _ws_env(tmp_path, monkeypatch):
    # Single-tenant so every socket resolves the `default` bucket; live canonical id; tmp stores so the
    # real data dir is never touched.
    monkeypatch.setenv("AUTH_ENABLED", "false")
    monkeypatch.setattr(ogs, "GAME_SESSION_PATH", tmp_path / "orwell_game_session.json")
    monkeypatch.setattr(layout, "LAYOUT_PATH", tmp_path / "orwell_layout.json")
    monkeypatch.setattr(ws_routes, "_is_live", lambda sid: True)

    async def _started(user):
        return {"started": True, "beatSeq": 7}
    monkeypatch.setattr(ws_routes, "_engine_state", _started)
    H.reset_runs()
    # session_events is process-global — clear its subscriber/ring state between tests.
    session_events._SUBS.clear()
    session_events._RING.clear()
    yield
    H.reset_runs()
    session_events._SUBS.clear()
    session_events._RING.clear()
    ws_routes.set_turn_stream_factory(None)


# ── the up-frame persists through the REAL store and publishes the CANONICAL descriptor ─────────────

def test_layout_up_frame_persists_per_device_and_publishes_canonical(run, monkeypatch):
    published = []
    real_publish = session_events.publish

    def _spy_publish(session_id, event, data=None):
        if event == "layout-changed":
            published.append((session_id, data))
        return real_publish(session_id, event, data)
    monkeypatch.setattr(session_events, "publish", _spy_publish)

    async def main():
        canon = H.seed_live_game(None, "live-canon")
        ws = H.new_ws(); t = H.spawn(ws)
        await H.hello(ws, canon)
        # A window moved on device "desktop", tab "tab-A". deviceId carries whitespace so we prove the
        # store's CANONICAL (trimmed) value is what gets published, never the raw client value.
        ws.client_send({"t": "layout", "ch": "layout",
                        "d": {"windowId": "hud-roster",
                              "state": {"x": 40, "y": 120, "w": 320, "open": True},
                              "deviceId": " desktop ", "origin": "tab-A"}})
        # Give the handler a beat to persist + publish.
        for _ in range(20):
            if published:
                break
            import asyncio as _a
            await _a.sleep(0.01)
        assert published, "layout up-frame did not publish a layout-changed edge"
        sid, desc = published[0]
        assert sid == canon
        # Persisted under the CANONICAL (trimmed) deviceId, geometry clamped to floats by the store.
        assert layout.get_layout(None, "desktop")["windows"]["hud-roster"] == {
            "x": 40.0, "y": 120.0, "w": 320.0, "open": True}
        # The published descriptor is the store's CANONICAL values (trimmed deviceId), not the raw
        # " desktop " the client sent — the exact bug the HTTP route fixed.
        assert desc["deviceId"] == "desktop"
        assert desc["windowId"] == "hud-roster"
        assert desc["origin"] == "tab-A"
        assert desc["state"]["x"] == 40.0
        assert "session" not in desc or desc.get("session")  # publish adds session; descriptor is clean
        await H.stop(ws, t)

    run(main())


def test_layout_up_frame_ignores_unusable_payload(run, monkeypatch):
    published = []
    monkeypatch.setattr(session_events, "publish",
                        lambda sid, ev, data=None: published.append((sid, ev, data)))

    async def main():
        canon = H.seed_live_game(None, "live-canon")
        ws = H.new_ws(); t = H.spawn(ws)
        await H.hello(ws, canon)
        # empty windowId ⇒ store returns falsy ⇒ nothing persisted, nothing published
        ws.client_send({"t": "layout", "ch": "layout",
                        "d": {"windowId": "", "state": {"x": 1}, "deviceId": "desktop"}})
        import asyncio as _a
        await _a.sleep(0.05)
        assert not any(ev == "layout-changed" for _, ev, _ in published)
        assert layout.get_layout(None, "desktop")["windows"] == {}
        await H.stop(ws, t)

    run(main())


# ── the layout channel forwards layout-changed descriptors as `layout` frames ───────────────────────

def test_layout_channel_forwards_layout_changed_as_layout_frames(run):
    async def main():
        canon = H.seed_live_game(None, "live-canon")
        ws = H.new_ws(); t = H.spawn(ws)
        await H.hello(ws, canon)
        # Subscribe the layout channel — the ack resolves the subscription.
        ws.client_send({"t": "subscribe", "ch": "layout", "cid": "c_lay"})
        ack = await ws.recv_where(lambda f: f.get("t") == "ack" and f.get("cid") == "c_lay")
        assert ack["ch"] == "layout"
        # The layout channel sends its ack BEFORE it enters `session_events.subscribe`. Wait
        # DETERMINISTICALLY for the subscriber to register before publishing (never a fixed sleep) so
        # this exercises the LIVE forward path — not the ring replay. (layout-changed is ring-durable
        # as of F3 / #891, but the autouse fixture clears the ring per test, so a publish after the
        # subscriber registers reaches it live; racing ahead of registration would hang the recv.)
        import asyncio as _a
        for _ in range(200):
            if session_events.subscriber_count(canon) >= 1:
                break
            await _a.sleep(0.005)
        assert session_events.subscriber_count(canon) == 1, "layout channel never subscribed"
        # A peer (another tab/device) publishes a layout change onto the same session bus — the socket
        # must forward it as a `layout` frame carrying the descriptor (client does device/origin filter).
        session_events.publish(canon, "layout-changed",
                               {"windowId": "cast", "state": {"x": 9, "open": True},
                                "deviceId": "phone", "origin": "tab-Z"})
        frame = await ws.recv_where(lambda f: f.get("t") == "layout", timeout=5.0)
        assert frame["ch"] == "layout"
        assert frame["d"]["windowId"] == "cast"
        assert frame["d"]["deviceId"] == "phone"
        assert frame["d"]["origin"] == "tab-Z"
        assert frame["d"]["state"] == {"x": 9, "open": True}
        assert "session" not in frame["d"]  # the bus's bookkeeping key is stripped
        await H.stop(ws, t)

    run(main())


def test_layout_changed_does_not_leak_into_the_state_channel(run):
    """A layout move rides the same per-session bus but must NOT trigger a `state`/`hud` re-read edge —
    the state channel filters `layout-changed` out (§4/§5 separation)."""
    async def main():
        canon = H.seed_live_game(None, "live-canon")
        ws = H.new_ws(); t = H.spawn(ws)
        await H.hello(ws, canon)
        ws.client_send({"t": "subscribe", "ch": "state", "cid": "c_state"})
        # The state channel has no explicit subscribe-ack, so wait DETERMINISTICALLY until it has
        # registered on the session bus before publishing — a fixed sleep races a contended CI runner,
        # letting the publishes below fire before the subscriber exists (the recv then hangs to
        # timeout, the observed flake). Mirrors the sibling channel-cleanup test's readiness poll.
        import asyncio as _a
        for _ in range(200):
            if session_events.subscriber_count(canon) >= 1:
                break
            await _a.sleep(0.005)
        assert session_events.subscriber_count(canon) == 1, "state channel never subscribed"
        session_events.publish(canon, "layout-changed",
                               {"windowId": "cast", "state": {"x": 1}, "deviceId": "d", "origin": "o"})
        # A real game edge SHOULD produce a state frame — prove the channel is live and only filters
        # layout-changed (not everything).
        session_events.publish(canon, "game-updated")
        st = await ws.recv_where(lambda f: f.get("t") == "state", timeout=5.0)
        assert st["d"]["reason"] == "game-updated"     # the game edge, NOT "layout-changed"
        # And no state frame ever carried reason "layout-changed".
        assert all(not (f.get("t") == "state" and f.get("d", {}).get("reason") == "layout-changed")
                   for f in ws.sent)
        await H.stop(ws, t)

    run(main())


def test_cancelled_channel_task_cleanup_runs_before_ws_session_returns(run):
    """Greptile P1 on #1338 — the teardown race for the CHANNEL task set. ``ws_session``'s ``finally``
    cancels the state/layout channel tasks; it must also AWAIT them so each one's
    ``session_events.subscribe()`` ``finally`` (which discards its subscriber queue) runs IN-LOOP,
    not be left pending as the loop closes (the same 'live channel task left behind' race the hb_task
    fix closed). Proof: right after ``stop()`` returns — with NO further ``await`` to let a stray
    cancelled task catch up — the session has zero lingering ``session_events`` subscribers."""
    async def main():
        import asyncio as _a
        canon = H.seed_live_game(None, "live-canon")
        ws = H.new_ws(); t = H.spawn(ws)
        await H.hello(ws, canon)
        ws.client_send({"t": "subscribe", "ch": "state", "cid": "c_state"})
        # Wait until the state channel task has actually registered as a session_events subscriber.
        for _ in range(100):
            if session_events.subscriber_count(canon) >= 1:
                break
            await _a.sleep(0.005)
        assert session_events.subscriber_count(canon) == 1, "state channel never subscribed"
        await H.stop(ws, t)
        # The handler returned; its finally awaited the channel task, so subscribe()'s finally already
        # ran and discarded the subscriber. If the channel task were merely cancelled (not awaited),
        # its finally would still be pending here and the count would read 1 — the greptile regression.
        assert t.done()
        assert session_events.subscriber_count(canon) == 0, \
            "cancelled channel task's subscribe() cleanup did not run before ws_session returned"

    run(main())


def test_ring_evict_timer_is_drained_in_loop_by_stop(run):
    """#1339 residual — the ``session_events`` ring-evict timer. When ``ws_session``'s teardown runs
    the state channel's ``subscribe()`` ``finally`` as the session's LAST subscriber, it arms a 180s
    ``_schedule_ring_evict`` task on the CURRENT (per-test) loop. The harness ``stop()`` must cancel
    AND await that timer in-loop; otherwise it survives to the ``_run`` loop close as
    "Task was destroyed but it is pending!" and lingers cross-loop in the process-global
    ``_RING_EVICT_TASKS`` (the CI teardown noise this issue tracked). Proof: right after ``stop()``
    returns — no further ``await`` — the registry is empty, and the ring itself is KEPT (cancel
    mirrors a re-subscribe; it never pops the replay ring)."""
    async def main():
        import asyncio as _a
        canon = H.seed_live_game(None, "live-canon")
        ws = H.new_ws()
        t = H.spawn(ws)
        await H.hello(ws, canon)
        ws.client_send({"t": "subscribe", "ch": "state", "cid": "c_state"})
        for _ in range(100):
            if session_events.subscriber_count(canon) >= 1:
                break
            await _a.sleep(0.005)
        assert session_events.subscriber_count(canon) == 1, "state channel never subscribed"
        # Seed a replayable invitation so the ring exists when the evict timer is armed.
        session_events.publish(canon, "game-updated")
        await H.stop(ws, t)
        assert t.done()
        # The last subscriber left during stop(), so the evict timer WAS armed — and stop() drained it.
        assert session_events._RING_EVICT_TASKS == {}, \
            "stop() left an armed ring-evict timer to be destroyed pending at loop close"
        # Draining cancels the timer without popping the ring (re-subscribe semantics).
        assert session_events._ring_snapshot(canon), "the drain must keep the replay ring intact"

    run(main())
