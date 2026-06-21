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


def test_anthropic_max_tokens_fallback_bumped_off_the_truncating_4096():
    src = _read("src", "llm_core.py")
    # The Anthropic adapter REQUIRES a cap; the old 4096 fallback truncated reasoning models. A configured
    # preset still wins; the fallback is just the floor when none is set.
    assert "else 8192" in src, "the Anthropic max_tokens fallback must be raised off the truncating 4096"
    assert '"max_tokens": max_tokens if max_tokens and max_tokens > 0 else 4096' not in src, \
        "the old 4096 reasoning-truncating fallback must be gone"


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
