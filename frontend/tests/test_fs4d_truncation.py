"""F-S4-D — a truncated reply (output cut off by the token cap) must be SURFACED, not silent.

A reasoning model (DeepSeek-V4, …) bills its hidden chain-of-thought against the SAME output budget
as the visible reply, so a heavy-thinking turn can hit the cap and stop the answer mid-sentence. The
stream just ended with no signal (F-S4-D): the streaming path never inspected `finish_reason`. The fix
makes truncation visible + recoverable, mirroring the existing round-cap `rounds_exhausted` affordance:

  llm_core   — capture the terminal `finish_reason`; emit a `{"type":"finish","reason":…}` event at [DONE].
  agent_loop — record the round's finish_reason; after the loop, emit `{"type":"truncated"}` iff the FINAL
               round ended on "length" (and rounds_exhausted didn't already fire — no double affordance).
  chat.js    — on `truncated`, show a quiet "cut off … Continue ▸" note (NOT in the GM body bubble).

The agent-loop behaviour is driven for real (fake LLM stream → real generator); the llm_core/chat.js
legs are source-pinned (the streaming hot path isn't hermetically unit-drivable end-to-end here).
"""
import asyncio
import json
import os

import pytest

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


# ── agent_loop behaviour: a length-finish FINAL round emits `truncated` ───────────

def _drive_agent_loop(monkeypatch, *, finish_reason: str) -> list:
    """Drive the REAL stream_agent_loop with a fake one-round LLM stream that ends on `finish_reason`.
    Returns the list of parsed SSE event dicts the generator yielded to the client."""
    from src import agent_loop as al

    monkeypatch.delenv("ORWELL_GAME_BUILD", raising=False)
    monkeypatch.setattr(al, "get_setting", lambda key, default=None: default)
    import src.tool_index as ti
    monkeypatch.setattr(ti, "get_tool_index", lambda: None)

    async def fake_stream(candidates, messages, **kwargs):
        # one round: a little visible content, then the terminal finish_reason, then DONE
        yield 'data: {"delta": "Big Brother watches as the houseguests gather in the living room and"}\n\n'
        yield 'data: ' + json.dumps({"type": "finish", "reason": finish_reason}) + '\n\n'
        yield "data: [DONE]\n\n"

    monkeypatch.setattr(al, "stream_llm_with_fallback", fake_stream)

    events: list = []

    async def drive():
        gen = al.stream_agent_loop(
            "https://api.openai.com/v1/chat/completions",  # API path
            "deepseek/deepseek-v4-pro",
            [{"role": "system", "content": "You are the narrator."},
             {"role": "user", "content": "Take a slow lap around the house."}],
            max_rounds=4,
        )
        async for chunk in gen:
            if chunk.startswith("data: ") and not chunk.startswith("data: [DONE]"):
                try:
                    events.append(json.loads(chunk[6:]))
                except Exception:
                    pass

    asyncio.get_event_loop().run_until_complete(drive())
    return events


def _types(events) -> list:
    return [e.get("type") for e in events if isinstance(e, dict)]


def test_agent_loop_emits_truncated_when_final_round_cut_off(monkeypatch):
    events = _drive_agent_loop(monkeypatch, finish_reason="length")
    assert "truncated" in _types(events), (
        "a final round that ended on finish_reason 'length' (token-cap cutoff) must emit a `truncated` "
        "event so the client can offer a Continue affordance (F-S4-D)."
    )
    # The internal `finish` event is CONSUMED, not forwarded (the UI signal is `truncated`).
    assert "finish" not in _types(events), "the raw `finish` event must not leak to the client."


def test_agent_loop_no_truncated_on_a_natural_stop(monkeypatch):
    events = _drive_agent_loop(monkeypatch, finish_reason="stop")
    assert "truncated" not in _types(events), (
        "a normal completion (finish_reason 'stop') must NOT emit `truncated` — only a real token-cap "
        "cutoff does."
    )


# ── llm_core: capture finish_reason + emit it at [DONE] ───────────────────────────

def test_llm_core_captures_finish_reason_and_emits_finish_event():
    src = _read("src", "llm_core.py")
    assert '_finish_reason = None' in src, "the stream parser must track the terminal finish_reason"
    assert '"finish_reason"' in src and '_finish_reason = _fr' in src, \
        "it must read finish_reason off the streamed choices"
    assert '"type": "finish", "reason": _finish_reason' in src, \
        "it must emit a `finish` event carrying the terminal reason at [DONE]"


def test_anthropic_max_tokens_fallback_is_model_aware_off_the_truncating_4096():
    # ADR 0010 #2: the Anthropic adapter REQUIRES a cap; the old 4096 fallback truncated reasoning models.
    # The fallback is now MODEL-AWARE (`_model_max_output_tokens`) rather than a single hardcoded 8192 —
    # a configured preset/per-class cap still wins; the helper is the floor when none is set.
    import importlib
    lc = importlib.import_module("src.llm_core")
    src = _read("src", "llm_core.py")
    assert "else _model_max_output_tokens(model)" in src, \
        "the Anthropic max_tokens fallback must size per model, not a hardcoded literal"
    assert '"max_tokens": max_tokens if max_tokens and max_tokens > 0 else 4096' not in src, \
        "the old 4096 reasoning-truncating fallback must be gone"
    # The hardcoded 8192 stopgap constant must be folded into the model-aware helper, not left as a
    # bare literal in the builder's fallback expression.
    assert "else 8192" not in src, "the hardcoded 8192 stopgap literal must be removed from the builder"
    # The helper sizes a known reasoning model generously (>= the old 8192 floor) and never below it,
    # and falls back to the conservative 8192 floor for an unknown model (no 400 risk).
    assert lc._model_max_output_tokens("claude-opus-4-8") >= 8192
    assert lc._model_max_output_tokens("claude-sonnet-4-6") >= 8192
    assert lc._model_max_output_tokens("some-unknown-model") == 8192
    # A Haiku-3.5-class model stays at its hard 8192 cap (the larger "claude-…-4" floors must not match it).
    assert lc._model_max_output_tokens("claude-3-5-haiku-20241022") == 8192


# ── chat.js: render `truncated` as a quiet Continue note, not the GM body ─────────

def test_chat_js_handles_truncated_with_a_continue_affordance():
    src = _read("static", "js", "chat.js")
    assert "json.type === 'truncated'" in src, "chat.js must handle the `truncated` stream event"
    # Reuses the rounds_exhausted Continue pattern: a quiet note appended to the chat-history container
    # (NOT the GM message body, which is re-rendered at finalize), with a Continue button.
    block = src.split("json.type === 'truncated'", 1)[1][:1400]
    assert "response-truncated" in block, "the note must be a distinct class so it can be de-duped"
    assert "cut off" in block.lower(), "the label must tell the player the reply was cut off"
    assert "continue-btn" in block and "Continue ▸" in block, "it must offer a Continue button"
    assert "getElementById('chat-history')" in block, \
        "the note appends to the history container, never the GM body bubble (re-rendered at finalize)"


# ── ADR 0010 #4: chat mode (no agent loop) surfaces the same `truncated` Continue affordance ──

def test_chat_mode_emits_truncated_on_a_length_finish():
    # The chat-mode path streams via stream_llm_with_fallback directly (no agent loop), so it must
    # inspect the `finish` event itself and emit `{"type":"truncated"}` at [DONE] when the reply was cut
    # off by the output cap — the chat.js handler is mode-agnostic and already renders it.
    src = _read("routes", "chat_routes.py")
    # The chat-mode branch captures the terminal finish_reason from the stream's `finish` event...
    assert 'data.get("type") == "finish"' in src, \
        "chat mode must read the stream's `finish` event to learn the terminal reason"
    assert "_chat_finish_reason" in src, "chat mode must track the terminal finish_reason"
    # ...and emits a `truncated` event when it was a token-cap cutoff (suppressed in Compare).
    assert '_chat_finish_reason == "length"' in src and '"type": "truncated"' in src, \
        "chat mode must emit a `truncated` event on a length-finish so the Continue affordance shows"
