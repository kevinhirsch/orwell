"""An empty completion must be SURFACED as an error, not rendered as a blank bubble (fix D).

A provider that returns HTTP 200 then closes the stream with zero content deltas (a clean ``[DONE]``
with no text) is the "model said nothing" case. The fallback wrapper used to treat that as a
successful candidate — so the player saw an empty assistant turn and the configured fallback model was
never tried. The fix emits a typed ``event: error`` (``empty_completion``) just before the terminal so
the client renders it; a candidate that DID produce text must never get that spurious error.

Driven hermetically against the real ``_stream_llm_with_fallback_impl`` with a faked ``stream_llm``.
"""
import asyncio
import json


async def _collect(agen):
    out = []
    async for c in agen:
        out.append(c)
    return out


def _drive(coro):
    # Reuse the suite's shared event loop (matching tests/test_midstream_error.py). NEVER asyncio.run()
    # here — it creates AND closes a loop then unsets the current one, poisoning every later test that
    # uses get_event_loop() ("no current event loop in MainThread"). This pattern leaves it intact.
    return asyncio.get_event_loop().run_until_complete(coro)


def _empty_stream():
    async def _fake(url, model, messages, headers=None, **kw):
        # 200, no content, clean terminal — the empty-completion shape.
        yield "data: [DONE]\n\n"
    return _fake


def _text_stream(text="hello"):
    async def _fake(url, model, messages, headers=None, **kw):
        yield 'data: ' + json.dumps({"delta": text}) + '\n\n'
        yield "data: [DONE]\n\n"
    return _fake


def _error_stream(status=401):
    async def _fake(url, model, messages, headers=None, **kw):
        yield 'event: error\ndata: ' + json.dumps({"error": "rejected the API key", "status": status}) + '\n\n'
    return _fake


def _run(monkeypatch, fake, cands):
    from src import llm_core as lc
    monkeypatch.setattr(lc, "stream_llm", fake)
    return "".join(_drive(_collect(lc.stream_llm_with_fallback(cands, [{"role": "user", "content": "hi"}]))))


def test_empty_completion_is_surfaced(monkeypatch):
    out = _run(monkeypatch, _empty_stream(), [("http://x/v1/chat/completions", "the-model", {})])
    assert "event: error" in out, "an empty completion must emit an error chunk"
    assert "empty_completion" in out, "the error must be typed empty_completion"
    assert "data: [DONE]\n\n" in out, "the stream still terminates cleanly"


def test_real_reply_has_no_spurious_empty_error(monkeypatch):
    out = _run(monkeypatch, _text_stream("a real answer"), [("http://x/v1/chat/completions", "the-model", {})])
    assert "a real answer" in out
    assert "empty_completion" not in out, "a non-empty reply must never get the empty-completion error"


def test_real_provider_error_not_double_reported_as_empty(monkeypatch):
    # A genuine pre-content provider error (e.g. 401) on the sole/last candidate must surface ONCE —
    # not be followed by a spurious empty-completion error (the saw_error guard).
    out = _run(monkeypatch, _error_stream(401), [("http://x/v1/chat/completions", "the-model", {})])
    assert "rejected the API key" in out
    assert "empty_completion" not in out, "a surfaced provider error must not also report empty_completion"


def test_empty_primary_falls_over_to_a_working_fallback(monkeypatch):
    # Primary returns empty; the fallback candidate answers. The player gets the real reply (and the
    # fallback notice), never a blank turn.
    from src import llm_core as lc
    calls = {"n": 0}

    async def _fake(url, model, messages, headers=None, **kw):
        calls["n"] += 1
        if model == "empty-primary":
            yield "data: [DONE]\n\n"            # empty
        else:
            yield 'data: ' + json.dumps({"delta": "fallback answer"}) + '\n\n'
            yield "data: [DONE]\n\n"

    monkeypatch.setattr(lc, "stream_llm", _fake)
    cands = [("http://x", "empty-primary", {}), ("http://y", "good-fallback", {})]
    out = "".join(_drive(_collect(lc.stream_llm_with_fallback(cands, [{"role": "user", "content": "hi"}]))))
    assert "fallback answer" in out, "an empty primary must fail over to the working fallback"
    assert calls["n"] == 2, "both candidates were tried"
