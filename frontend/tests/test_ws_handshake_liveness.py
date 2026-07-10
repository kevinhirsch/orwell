"""WebSocket Phase-1 — case (b): the liveness handshake (the #1085/#1086 guard, socket-native).

A ``hello`` is resolved and validated BEFORE any channel is subscribable, and the resolution branch is
SERVER-derived (a forged ``framed``/``gameActive`` cannot flip it). A dead id yields ``ack{live:false}``
with no channel opened (and the stale binding is unbound); a non-owned id yields ``error{forbidden}`` +
close with no bind; a started game first-writer-binds and a racing peer adopts (protocol spec §2,
test-plan §4). Roles only; no names.
"""
import importlib

import pytest

from tests.support import ws_harness as H

ws_routes = importlib.import_module("routes.ws_routes")
ogs = importlib.import_module("src.orwell_game_session")


@pytest.fixture(autouse=True)
def _tmp_store(tmp_path, monkeypatch):
    monkeypatch.setattr(ogs, "GAME_SESSION_PATH", tmp_path / "orwell_game_session.json")
    H.reset_runs()
    yield
    H.reset_runs()


def _set_engine(monkeypatch, started: bool, beat_seq: int = 3):
    async def _state(user):
        return {"started": started, "beatSeq": beat_seq}
    monkeypatch.setattr(ws_routes, "_engine_state", _state)


# ── sub-case (i): dead canonical id → ack{live:false}, no channel, binding unbound ────────────────

def test_dead_canonical_id_acks_not_live_and_unbinds(run, monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    _set_engine(monkeypatch, started=True)
    # A canonical id is bound but its row was deleted → dead. The per-tab id is a DIFFERENT, non-live id.
    ogs.bind_game_session(None, "dead-canon")
    monkeypatch.setattr(ws_routes, "_is_live", lambda sid: False)  # nothing is live now

    async def main():
        ws = H.new_ws(); t = H.spawn(ws)
        ack = await H.hello(ws, "per-tab-fresh")
        assert ack["t"] == "ack"
        assert ack["d"]["live"] is False
        assert ack["d"]["canonicalId"] != "dead-canon"          # fell back to the per-tab id
        # the dead binding was UNBOUND as a side effect (resolve_live_game_session → clear)
        assert ogs.get_game_session(None) is None
        # no channel may open on a not-live socket: subscribe still resolves but reports no run…
        # …and a subscribe BEFORE a bind is refused not-bound (proven in the ordering test below).
        await H.stop(ws, t)

    run(main())


# ── sub-case (ii): non-owned session → error{forbidden} + close, no bind ──────────────────────────

def test_non_owned_session_is_forbidden_and_closes(run, monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "true")   # enable ownership checks (the REAL DB-backed guard)
    _set_engine(monkeypatch, started=True)
    monkeypatch.setattr(ws_routes, "_is_live", lambda sid: True)
    # User A owns a persisted session row; the socket authenticates as user B (real _ws_owns checks it).
    from core.database import SessionLocal, Session as DBSession
    db = SessionLocal()
    try:
        if db.query(DBSession.id).filter(DBSession.id == "sidA").first() is None:
            db.add(DBSession(id="sidA", name="n", endpoint_url="http://x", model="m", owner="A"))
            db.commit()
    finally:
        db.close()
    monkeypatch.setattr(ws_routes, "_ws_current_user", lambda ws: "B")

    async def main():
        ws = H.new_ws(); t = H.spawn(ws)
        ws.client_send({"t": "hello", "cid": "c_00", "d": {"perTabId": "sidA"}})
        reply = await ws.recv_where(lambda f: f.get("t") in ("ack", "error"))
        assert reply["t"] == "error"
        assert reply["cid"] == "c_00"           # the cid echoes the refused hello (§1.2)
        assert reply["d"]["code"] == "forbidden"
        # the socket then closes (no ack, no channel, no bind for B)
        assert ogs.get_game_session("B") is None
        assert ws.closed is True
        await H.stop(ws, t)

    run(main())


# ── sub-case (iii): the forge guard — a client-claimed framed/gameActive is IGNORED ───────────────

def test_forged_started_flag_cannot_flip_the_branch(run, monkeypatch):
    """A hello whose payload CLAIMS a started game (extra framed/gameActive) for a user whose season is
    NOT started must resolve the casting/per-tab branch — the branch is server-derived (§2.2)."""
    monkeypatch.setenv("AUTH_ENABLED", "false")
    _set_engine(monkeypatch, started=False)     # SERVER says: no started season
    monkeypatch.setattr(ws_routes, "_is_live", lambda sid: True)
    # even if a canonical id is bound, casting must stay per-tab
    ogs.bind_game_session(None, "canonical-A")

    async def main():
        ws = H.new_ws(); t = H.spawn(ws)
        # forged flags the client is not supposed to send
        ws.client_send({"t": "hello", "cid": "c_00",
                        "d": {"perTabId": "per-tab-B", "framed": True, "gameActive": True}})
        ack = await ws.recv_where(lambda f: f.get("t") in ("ack", "error"))
        assert ack["t"] == "ack"
        assert ack["d"]["canonicalId"] == "per-tab-B"   # per-tab, NOT the bound canonical id
        assert ack["d"]["adopted"] is False
        await H.stop(ws, t)

    run(main())


# ── sub-case (iv): first-writer-wins adopt ────────────────────────────────────────────────────────

def test_first_writer_wins_and_second_adopts(run, monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    _set_engine(monkeypatch, started=True)
    monkeypatch.setattr(ws_routes, "_is_live", lambda sid: True)  # both per-tab ids are live rows

    async def main():
        ws1 = H.new_ws(); t1 = H.spawn(ws1)
        ack1 = await H.hello(ws1, "per-tab-1", cid="c_1")
        assert ack1["d"]["adopted"] is False
        canon = ack1["d"]["canonicalId"]
        assert canon == "per-tab-1"

        ws2 = H.new_ws(); t2 = H.spawn(ws2)
        ack2 = await H.hello(ws2, "per-tab-2", cid="c_2")
        assert ack2["d"]["canonicalId"] == canon    # adopted the already-bound id
        assert ack2["d"]["adopted"] is True

        await H.stop(ws1, t1)
        await H.stop(ws2, t2)

    run(main())


# ── ordering: no subscribe before a successful ack ────────────────────────────────────────────────

def test_subscribe_before_hello_is_not_bound(run, monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    _set_engine(monkeypatch, started=True)
    monkeypatch.setattr(ws_routes, "_is_live", lambda sid: True)

    async def main():
        ws = H.new_ws(); t = H.spawn(ws)
        # a subscribe sent BEFORE hello → error{not-bound}, no event frame
        ws.client_send({"t": "subscribe", "ch": "chat", "cid": "c_s", "d": {"fromSeq": 0}})
        reply = await ws.recv_where(lambda f: f.get("t") in ("error", "event", "ack"))
        assert reply["t"] == "error"
        assert reply["d"]["code"] == "not-bound"
        assert reply["cid"] == "c_s"
        await H.stop(ws, t)

    run(main())
