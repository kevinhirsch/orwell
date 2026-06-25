"""Regression: a send to /api/chat_stream must NEVER silently drop the turn.

The owner's bug ("I send a message and it goes into nothing — no message, no
response, it just goes away"). Root cause: the streaming chat endpoint's pre-stream
model/endpoint guards raised a BARE ``HTTPException`` (a non-200 with a plain body)
*after* the ``[doc-inject]`` log but *before* the user message was persisted. A
streaming client opens an SSE reader and reliably renders ``event: error`` chunks,
but the non-200 branch is the brittle one — the failure could read as "nothing came
back", and the optimistic user bubble had no server record to reconcile against.

Fix: every pre-stream guard that decides this turn can't reach an LLM now returns
through ``_sse_error_response`` — HTTP 200 + a single streamed ``event: error`` then
``[DONE]`` — exactly like an upstream model failure mid-stream (the dead-endpoint
path already worked this way). So a bad/empty/removed model surfaces a VISIBLE reason
in the transcript instead of a silent drop.

These are behavior tests on the helper + source pins on the wiring (the full live
stack is non-deterministic in CI; the wiring is what regresses).
"""
import asyncio
import json
import os
import re

from routes import chat_routes

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHAT_ROUTES_SRC = open(
    os.path.join(FRONTEND, "routes", "chat_routes.py"), encoding="utf-8"
).read()


def _drain(resp):
    async def _c():
        return [chunk async for chunk in resp.body_iterator]
    return asyncio.get_event_loop().run_until_complete(_c())


# ── the helper: a one-shot, well-formed SSE error stream ─────────────────────


def test_sse_error_response_is_a_200_event_error_stream():
    resp = chat_routes._sse_error_response("no model", status=400)
    assert resp.media_type == "text/event-stream"      # NOT a bare non-200 JSON body
    chunks = _drain(resp)
    body = "".join(chunks)
    # the client's SSE-error branch keys on this exact prefix
    assert "event: error" in body
    assert "no model" in body
    # carries the status for the client to label the error
    m = re.search(r'"status"\s*:\s*(\d+)', body)
    assert m and int(m.group(1)) == 400
    # terminates cleanly so the reader closes (no hang / no "still streaming")
    assert any(c.strip() == "data: [DONE]" for c in chunks)


def test_sse_error_response_defaults_to_400():
    body = "".join(_drain(chat_routes._sse_error_response("boom")))
    assert '"status": 400' in body


# ── the wiring: the pre-stream model/endpoint guards stream, never bare-raise ─


def _stream_endpoint_src():
    """Body of the streaming `chat_stream` handler only (NOT the non-streaming
    `/api/chat`, whose JSON 400s the client parses fine and which is not the bug)."""
    start = CHAT_ROUTES_SRC.index("async def chat_stream(")
    end = CHAT_ROUTES_SRC.index("async def chat_events(", start)
    return CHAT_ROUTES_SRC[start:end]


def test_streaming_endpoint_routes_model_guards_through_sse_error():
    src = _stream_endpoint_src()
    # The orphaned-endpoint and no-model guards must hand back the SSE-error stream,
    # not `raise HTTPException(...)` (the silent-drop-prone branch on a streaming client).
    assert "return _sse_error_response(" in src
    # Neither model/endpoint guard still bare-raises inside the streaming handler.
    assert 'raise HTTPException(400, "Selected model endpoint was removed' not in src
    assert "Selected model endpoint was removed" in src  # still guarded, just streamed now
    # the no-model guard is streamed, not raised
    assert "No model selected for this chat" in src
    _no_model_idx = src.index("No model selected for this chat")
    _window = src[_no_model_idx - 160:_no_model_idx]
    assert "_sse_error_response" in _window, "no-model guard must stream, not raise"


def test_doc_inject_log_is_immediately_before_the_streaming_guards():
    # The owner's only log line is `[doc-inject]`; the guards that decide the turn run
    # right after it. Pin that ordering so a future refactor can't move a silent
    # bare-raise back in front of the streamed-error guards.
    assert "[doc-inject] chat_mode=" in CHAT_ROUTES_SRC
    _doc_idx = CHAT_ROUTES_SRC.index("[doc-inject] chat_mode=")
    _after = CHAT_ROUTES_SRC[_doc_idx:_doc_idx + 2000]
    assert "_sse_error_response" in _after
