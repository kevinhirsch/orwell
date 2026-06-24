"""Empty messages must never reach a provider (the OpenRouter/DeepSeek empty-message bug).

Diagnosed from a real debug bundle: a DeepSeek V4 Pro (reasoning model) casting session
where a turn routed its WHOLE output to the reasoning channel left the visible content
empty. That empty turn was persisted as `{"role":"assistant","content":""}` and then
replayed to the provider on every later turn — empty messages sent to the LLM.

`_sanitize_llm_messages` is the single chokepoint every provider request funnels through
(llm_call / _llm_call_async_impl / stream_llm), so the guarantee is enforced there: no
blank-content user/system/assistant message (with no tool_calls) may survive. Valid shapes
— a tool-call-only assistant (content=None + tool_calls), an empty tool RESULT (a valid
answer to a tool_call; dropping it would orphan the parent), and an image-only user turn
(non-empty multimodal list) — must be preserved.
"""

from src.llm_core import _sanitize_llm_messages, _is_blank_content


def _has_blank_text_message(messages) -> bool:
    """True if any non-tool message would be sent with empty/None text content."""
    for m in messages:
        if m.get("role") == "tool" or m.get("tool_calls"):
            continue
        c = m.get("content")
        if c is None or (isinstance(c, str) and not c.strip()):
            return True
    return False


def test_is_blank_content_classification():
    assert _is_blank_content(None) is True
    assert _is_blank_content("") is True
    assert _is_blank_content("   \n\t ") is True
    assert _is_blank_content([]) is True
    assert _is_blank_content("hi") is False
    assert _is_blank_content([{"type": "image_url", "image_url": {"url": "data:..."}}]) is False


def test_blank_assistant_turn_is_dropped_not_sent():
    """The reported bug: a reasoning model's empty-content assistant turn, persisted and
    replayed, must not reach the provider."""
    msgs = [
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "", "metadata": {"thinking": "reasoning only, no final"}},
        {"role": "user", "content": "are you there?"},
    ]
    out = _sanitize_llm_messages(msgs)
    assert not _has_blank_text_message(out)
    assert all(not (m["role"] == "assistant" and not (m.get("content") or "").strip()) for m in out)


def test_whitespace_and_empty_system_user_dropped():
    msgs = [
        {"role": "system", "content": "   "},
        {"role": "user", "content": "hello"},
        {"role": "assistant", "content": "\n\t  \n"},
        {"role": "system", "content": ""},
    ]
    out = _sanitize_llm_messages(msgs)
    assert not _has_blank_text_message(out)
    # the one real message survives
    assert any(m["role"] == "user" and m.get("content") == "hello" for m in out)


def test_valid_message_shapes_preserved():
    """Tool-call-only assistant, empty tool result, image-only user, and real prose all survive."""
    msgs = [
        {"role": "system", "content": "You are the producer."},
        {"role": "assistant", "content": None,
         "tool_calls": [{"id": "c1", "type": "function",
                         "function": {"name": "advanceGame", "arguments": "{}"}}]},
        {"role": "tool", "tool_call_id": "c1", "content": ""},  # empty result is valid
        {"role": "user", "content": [{"type": "image_url", "image_url": {"url": "data:..."}}]},
        {"role": "assistant", "content": "Real reply."},
    ]
    out = _sanitize_llm_messages(msgs)
    assert any(m["role"] == "system" and m["content"] == "You are the producer." for m in out)
    assert any(m["role"] == "assistant" and m.get("tool_calls") for m in out), "tool-call assistant dropped"
    assert any(m["role"] == "tool" for m in out), "empty tool result dropped — would orphan the tool_calls"
    assert any(isinstance(m.get("content"), list) for m in out), "image-only user dropped"
    assert any(m["role"] == "assistant" and m.get("content") == "Real reply." for m in out)


def test_no_empty_message_survives_a_realistic_casting_history():
    """A casting transcript with interleaved empty assistant turns (the bundle scenario):
    after sanitize, zero blank messages remain."""
    msgs = [
        {"role": "system", "content": "Casting interview framing."},
        {"role": "user", "content": "I'm ready."},
        {"role": "assistant", "content": ""},                      # empty (reasoning-only)
        {"role": "user", "content": "Hello?"},
        {"role": "assistant", "content": "Tell me about yourself."},
        {"role": "user", "content": "..."},
        {"role": "assistant", "content": "   "},                   # whitespace-only
        {"role": "user", "content": "Still here."},
    ]
    out = _sanitize_llm_messages(msgs)
    assert not _has_blank_text_message(out), out


# ── Root-cause guard: a blank assistant turn must not be PERSISTED (so it never replays) ──

import pytest
from core.session_manager import SessionManager
from core.models import ChatMessage, set_session_manager
import core.models as core_models
from routes.chat_helpers import save_assistant_response


@pytest.fixture
def sm():
    manager = SessionManager()
    prior = getattr(core_models, "_session_manager", None)
    set_session_manager(manager)
    yield manager
    set_session_manager(prior)


import uuid


def _mk_session(sm, sid=None):
    sid = sid or f"empty-msg-test-{uuid.uuid4().hex[:8]}"
    sm.create_session(sid, "n", "http://x", "m", owner="u")
    return sm.get_session(sid), sid


def test_whitespace_only_response_is_not_persisted(sm):
    """`full_response` can be truthy whitespace (agent loop '\\n\\n' separators) — the caller's
    `if full_response:` gate misses it. With no reasoning to keep, persist nothing."""
    sess, sid = _mk_session(sm)
    n_before = len(sess.history)
    saved = save_assistant_response(sess, sm, sid, "\n\n   \n", {})
    assert saved is None
    assert len(sess.history) == n_before, "a whitespace-only turn must not enter history"


def test_blank_reply_with_reasoning_is_kept_for_the_accordion(sm):
    """A reasoning-model turn with no visible reply but real reasoning is persisted with
    NORMALIZED-empty content (so the 'Thinking' accordion survives reload, ADR 0012) — the
    send-side chokepoint then drops it from later provider requests."""
    sess, sid = _mk_session(sm)
    save_assistant_response(sess, sm, sid, "", {}, reasoning="a long chain of thought")
    assert len(sess.history) == 1
    msg = sess.history[-1]
    assert msg.role == "assistant"
    assert msg.content == ""                       # normalized, no stray whitespace
    assert (msg.metadata or {}).get("thinking") == "a long chain of thought"
    # And it must not survive as an empty message to the provider:
    assert not _has_blank_text_message(_sanitize_llm_messages([m.to_dict() for m in sess.history]))


def test_real_reply_is_persisted_normally(sm):
    sess, sid = _mk_session(sm)
    saved = save_assistant_response(sess, sm, sid, "Welcome to the house.", {})
    assert len(sess.history) == 1
    assert sess.history[-1].content == "Welcome to the house."
