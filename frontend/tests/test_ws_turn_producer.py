"""WebSocket Phase-1 (ADR 0017 §3.5) — the `turn` content producer, driven through the REAL wiring.

`test_ws_beatseq_cas.py` proves the `turn` up-frame's CAS + start + ack using a FAKE factory. This
file proves the PRODUCER half the server-half PR deferred: the REAL `chat_routes.make_ws_turn_stream_factory`
— the SAME builder `setup_chat_routes` registers on ws_routes — reuses the HTTP chat pipeline
(`_prepare_chat_stream`) through a real `_WsChatRequest` shim, and its SSE output fans out over the
socket's `chat` channel as `event` frames (the reasoning split riding INSIDE the payload as `thinking`,
never a separate channel). Only the innermost narration source is substituted — the LLM boundary every
FE gate stubs; everything else (the factory, the shim, `_PreparedChatTurn`, `agent_runs`, the socket
adapter, the replay-then-tail splice) is the real code. Roles only; no names.
"""
import asyncio
import importlib
import json
import types

import pytest

from tests.support import ws_harness as H

ws_routes = importlib.import_module("routes.ws_routes")
chat_routes = importlib.import_module("routes.chat_routes")
ogs = importlib.import_module("src.orwell_game_session")
session_events = importlib.import_module("src.session_events")


@pytest.fixture(autouse=True)
def _ws_env(tmp_path, monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    monkeypatch.setattr(ogs, "GAME_SESSION_PATH", tmp_path / "orwell_game_session.json")
    monkeypatch.setattr(ws_routes, "_is_live", lambda sid: True)
    # In production the shim resolves the ALREADY-imported `app` (cheap, cached). In this unit test the
    # app is not booted, so short-circuit the lazy import to a Vault-free stub — the auth_manager
    # privilege gates simply no-op (AUTH_ENABLED=false), which is exactly the single-tenant path.
    monkeypatch.setattr(chat_routes, "_resolve_fastapi_app",
                        lambda: types.SimpleNamespace(state=types.SimpleNamespace(auth_manager=None)))

    async def _state(user):
        return {"started": True, "beatSeq": 5}
    monkeypatch.setattr(ws_routes, "_engine_state", _state)
    H.reset_runs()
    # `_handle_turn` fires `session_events.publish(..., "run-started")` — clear its process-global
    # subscriber/ring state (incl. any armed ring-eviction task from a prior test's now-closed loop;
    # issue #1339) so it never bleeds across tests/files.
    session_events._SUBS.clear()
    session_events._RING.clear()
    session_events.cancel_all_ring_evictions()
    yield
    H.reset_runs()
    session_events._SUBS.clear()
    session_events._RING.clear()
    session_events.cancel_all_ring_evictions()
    ws_routes.set_turn_stream_factory(None)


def _register_real_factory(prepare):
    """Register the REAL production factory built over a `_prepare_chat_stream` stand-in. `prepare` IS
    the LLM boundary (the only substituted piece); the factory, shim, and forwarding are real code."""
    ws_routes.set_turn_stream_factory(chat_routes.make_ws_turn_stream_factory(prepare))


async def _turn_then_mirror(ws, canon, d):
    """The real send flow: relay a `turn`, then subscribe the `chat` channel and collect the run's
    `event` frames (replay-then-tail over the buffered run). Returns the chat event payloads."""
    ws.client_send({"t": "turn", "ch": "chat", "cid": "c_turn", "d": d})
    ack = await ws.recv_where(lambda f: f.get("t") == "ack" and f.get("cid") == "c_turn")
    assert ack["d"]["accepted"] is True
    ws.client_send({"t": "subscribe", "ch": "chat", "cid": "c_sub", "d": {"fromSeq": 0}})
    await ws.recv_where(lambda f: f.get("t") == "ack" and f.get("cid") == "c_sub" and f.get("ch") == "chat")
    frames = await ws.collect_until(
        lambda f: f.get("t") == "event" and f.get("ch") == "chat" and f.get("d", {}).get("done"),
        timeout=2.0)
    return [f for f in frames if f.get("t") == "event" and f.get("ch") == "chat"]


# ── the factory builds the shim + form correctly and forwards the producer's SSE as event frames ────

def test_turn_streams_the_same_sse_the_http_pipeline_produces(run):
    seen = {}

    async def _prepare(request):
        # The factory built a REAL request shim from the `turn` frame's `d`. Assert the mapping, then
        # return a REAL _PreparedChatTurn whose producer echoes the message as narration deltas.
        assert isinstance(request, chat_routes._WsChatRequest)
        form = await request.form()
        seen["form"] = form
        seen["user"] = request.state.current_user
        msg = form["message"]

        async def _safe_stream():
            yield H.sse_delta(f"He glances at {msg}", thinking=False)
            yield H.sse_delta("(scheming)", thinking=True)   # reasoning rides INSIDE via the flag
            yield H.sse_message_saved("m_1", 41)
            yield H.sse_done()

        return chat_routes._PreparedChatTurn(_safe_stream, form["session"], object(), False)

    _register_real_factory(_prepare)

    async def main():
        canon = H.seed_live_game(None, "live-canon")
        ws = H.new_ws(); t = H.spawn(ws)
        await H.hello(ws, canon)
        events = await _turn_then_mirror(ws, canon, {
            "message": "the door", "clientMsgId": "tmp_9", "mode": "agent", "expectedBeatSeq": 5})
        # The form the factory built from `d` — the session is the resolved canonical id (converged).
        assert seen["form"]["session"] == canon
        assert seen["form"]["message"] == "the door"
        assert seen["form"]["client_msg_id"] == "tmp_9"
        assert seen["form"]["mode"] == "agent"
        # The producer's SSE flows out as `chat` `event` frames, seq = buffer index, contiguous.
        assert [e["seq"] for e in events] == list(range(len(events)))   # 0,1,2,… buffer indices
        # reply delta (thinking falsy) and reasoning delta (thinking truthy) both ride the chat channel
        assert events[0]["d"] == {"delta": "He glances at the door", "thinking": False}
        assert events[1]["d"] == {"delta": "(scheming)", "thinking": True}
        assert events[2]["d"]["type"] == "message_saved"
        assert events[-1]["d"] == {"done": True}
        await H.stop(ws, t)
        await H.aclose_runs()

    run(main())


# ── an early `_sse_error_response` (pre-stream guard) is forwarded verbatim over the socket ──────────

def test_turn_forwards_a_pre_stream_sse_error_response(run):
    async def _prepare(request):
        # The real pipeline returns an `_sse_error_response` StreamingResponse for a pre-stream guard
        # (e.g. no model selected). The factory must forward its body, not swallow it.
        return chat_routes._sse_error_response("No model selected for this chat.", status=400)

    _register_real_factory(_prepare)

    async def main():
        canon = H.seed_live_game(None, "live-canon")
        ws = H.new_ws(); t = H.spawn(ws)
        await H.hello(ws, canon)
        events = await _turn_then_mirror(ws, canon, {"message": "hi", "expectedBeatSeq": 5})
        # the SSE error line is surfaced as an event payload (client renders the reason), then done
        assert any(e["d"].get("event") == "error" and "No model selected" in e["d"].get("error", "")
                   for e in events)
        assert events[-1]["d"] == {"done": True}
        await H.stop(ws, t)
        await H.aclose_runs()

    run(main())


# ── a prep exception (e.g. HTTPException from a privilege gate) surfaces as error+DONE, not a drop ───

def test_turn_surfaces_a_prep_exception_as_clean_error(run):
    from fastapi import HTTPException

    async def _prepare(request):
        raise HTTPException(status_code=429, detail="Daily message cap reached.")

    _register_real_factory(_prepare)

    async def main():
        canon = H.seed_live_game(None, "live-canon")
        ws = H.new_ws(); t = H.spawn(ws)
        await H.hello(ws, canon)
        events = await _turn_then_mirror(ws, canon, {"message": "hi", "expectedBeatSeq": 5})
        assert any("Daily message cap reached." in (e["d"].get("error") or "") and e["d"].get("status") == 429
                   for e in events)
        assert events[-1]["d"] == {"done": True}     # terminal, never a bare drop
        await H.stop(ws, t)
        await H.aclose_runs()

    run(main())


# ── attachments round-trip into the form as a JSON string (only when non-empty) ─────────────────────

def test_attachments_map_into_the_form_only_when_present(run):
    seen = {}

    async def _prepare(request):
        seen["form"] = await request.form()

        async def _safe_stream():
            yield H.sse_done()
        return chat_routes._PreparedChatTurn(_safe_stream, "live-canon", object(), False)

    _register_real_factory(_prepare)

    async def _wait_seen():
        for _ in range(200):
            if "form" in seen:
                return
            await asyncio.sleep(0.005)
        raise AssertionError("producer prep never ran")

    async def main():
        canon = H.seed_live_game(None, "live-canon")
        ws = H.new_ws(); t = H.spawn(ws)
        await H.hello(ws, canon)
        # empty attachments ⇒ the key is omitted (so `_has_atts` stays falsy, matching the HTTP default)
        ws.client_send({"t": "turn", "ch": "chat", "cid": "c1",
                        "d": {"message": "a", "attachments": [], "expectedBeatSeq": 5}})
        await ws.recv_where(lambda f: f.get("t") == "ack" and f.get("cid") == "c1")
        await _wait_seen()
        assert "attachments" not in seen["form"]
        await H.aclose_runs()

        # non-empty attachments ⇒ a JSON-string list (the exact shape the HTTP form carries)
        H.reset_runs()
        seen.clear()
        ws.client_send({"t": "turn", "ch": "chat", "cid": "c2",
                        "d": {"message": "b", "attachments": ["att_1", "att_2"], "expectedBeatSeq": 5}})
        await ws.recv_where(lambda f: f.get("t") == "ack" and f.get("cid") == "c2")
        await _wait_seen()
        assert json.loads(seen["form"]["attachments"]) == ["att_1", "att_2"]
        await H.stop(ws, t)
        await H.aclose_runs()

    run(main())
