"""F1 (concurrent-session consistency — the causal-inversion fix), server half.

The live channel (`agent_runs` run buffer, fanned over the WS `chat` channel and SSE resume) carries
ONLY the assistant reply; the prompting USER turn is not broadcast on it. So an observer/mirror window
whose only live signal is `run-started` → resume mounts the reply holder BEFORE the user bubble exists
— the reply can render before its cause (the causal inversion).

The fix seeds the detached run buffer with the persisted user message as its FIRST event (`seq 0`),
BEFORE any assistant delta, so replay-then-tail delivers cause-before-effect ATOMICALLY to every
subscriber (both transports). These are the DETERMINISTIC, browser-free halves of that seam:

  * `agent_runs.start(..., lead_event=...)` seeds buffer index 0 and replay yields it first; None is
    byte-identical to the prior empty-buffer behavior.
  * `_build_lead_user_event` renders the persisted user row into the Vault-free
    `{type:"user_message", id, seq, content, clientMsgId}` SSE event.

Roles only — the probe text is a generic player line, never a cast name.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys

import pytest

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if FRONTEND not in sys.path:
    sys.path.insert(0, FRONTEND)

from src import agent_runs  # noqa: E402  (path set above)


# ── agent_runs.start(lead_event=...) — the buffer seed ─────────────────────────────────

def _cleanup_run(session_id: str) -> None:
    """Cancel the terminal run's grace-eviction timer and drop it, so `asyncio.run` doesn't close the
    loop with a pending 180s evict task (the benign 'Task was destroyed but it is pending' noise)."""
    run = agent_runs._RUNS.pop(session_id, None)
    if run is not None:
        agent_runs._safe_cancel(run.evict_task)
        agent_runs._safe_cancel(run.task)


def test_lead_event_leads_the_buffer_and_replays_first():
    """The seeded user-message event occupies buffer index 0 and replay-then-tail yields it BEFORE
    the first assistant delta — cause strictly precedes effect for every subscriber."""
    lead = ('data: ' + json.dumps({
        "type": "user_message", "id": "u1", "seq": 0, "content": "I take a lap through the house.",
        "clientMsgId": "c1", "role": "user",
    }) + '\n\n')

    async def scenario():
        async def gen():
            yield 'data: {"delta": "The house is quiet."}\n\n'
            yield 'data: {"type": "message_saved", "id": "m1", "seq": 1}\n\n'
            yield 'data: [DONE]\n\n'
        # queue=True is the game-turn (framed) policy — the path F1 seeds; the seed is independent of it.
        agent_runs.start("f1-seed", gen(), queue=True, lead_event=lead)
        out = [ev async for ev in agent_runs.subscribe("f1-seed")]
        _cleanup_run("f1-seed")
        return out

    events = asyncio.run(scenario())
    assert events, "subscribe yielded nothing"
    assert events[0] == lead, "the user-message event must be the FIRST buffered/replayed event"
    delta_idx = next(i for i, e in enumerate(events) if '"delta"' in e)
    assert 0 < delta_idx, "the assistant delta must come AFTER the user-message event (cause before effect)"
    # The seed is additive — the assistant turn still completes (message_saved + [DONE] both present).
    assert any('"message_saved"' in e for e in events)
    assert any('[DONE]' in e for e in events)


def test_no_lead_event_is_byte_identical_backcompat():
    """`lead_event=None` (the default; every non-framed / plain-chat turn) seeds NOTHING — the buffer
    starts empty exactly as before, so the first replayed event is the assistant's."""
    async def scenario():
        async def gen():
            yield 'data: {"delta": "x"}\n\n'
            yield 'data: [DONE]\n\n'
        agent_runs.start("f1-none", gen())
        out = [ev async for ev in agent_runs.subscribe("f1-none")]
        _cleanup_run("f1-none")
        return out

    events = asyncio.run(scenario())
    assert events, "subscribe yielded nothing"
    assert events[0] == 'data: {"delta": "x"}\n\n', "no seed ⇒ the assistant delta is first (back-compat)"
    assert not any('"user_message"' in e for e in events), "no user-message event may appear without a seed"


# ── _build_lead_user_event — the persisted-user-row → SSE-event builder ─────────────────

class _FakeMsg:
    def __init__(self, role, content, metadata=None):
        self.role = role
        self.content = content
        self.metadata = metadata or {}


class _FakeSess:
    def __init__(self, history):
        self.history = history


def _build():
    try:
        from routes.chat_routes import _build_lead_user_event
    except Exception as e:  # pragma: no cover - environment guard
        pytest.skip(f"routes.chat_routes not importable in this environment: {e}")
    return _build_lead_user_event


def test_build_lead_user_event_shape_is_vault_free_and_carries_the_keys():
    """The builder emits a Vault-free `user_message` SSE event carrying the authoritative {id, seq}
    and the round-tripped optimistic clientMsgId — the player's OWN words, nothing secret."""
    build = _build()
    sess = _FakeSess([
        _FakeMsg("assistant", "earlier reply", {"_db_id": "m0", "_seq": 2}),
        _FakeMsg("user", "I find whoever seems switched-on and talk game.",
                 {"_db_id": "u9", "_seq": 3, "client_msg_id": "cid-9"}),
    ])
    ev = build(sess, "I find whoever seems switched-on and talk game.", "cid-9")
    assert ev and ev.startswith("data: ") and ev.endswith("\n\n")
    payload = json.loads(ev[len("data: "):].strip())
    assert payload["type"] == "user_message"
    assert payload["role"] == "user"
    assert payload["id"] == "u9"
    assert payload["seq"] == 3
    assert payload["clientMsgId"] == "cid-9"
    assert payload["content"] == "I find whoever seems switched-on and talk game."
    # Vault-free by construction — only these keys cross.
    assert set(payload.keys()) == {"type", "id", "seq", "content", "clientMsgId", "role"}


def test_build_lead_user_event_prefers_persisted_text_for_attachment_only_send():
    """An attachment-only send arrives with an empty `message`; the builder falls back to the persisted
    user text when it is a plain string (multimodal list content is left to the settle reconcile)."""
    build = _build()
    sess = _FakeSess([
        _FakeMsg("user", "the persisted words", {"_db_id": "u1", "_seq": 0, "client_msg_id": "c0"}),
    ])
    ev = build(sess, "", "c0")
    payload = json.loads(ev[len("data: "):].strip())
    assert payload["content"] == "the persisted words"


def test_build_lead_user_event_none_when_no_user_row():
    """No user row to seed ⇒ None (⇒ no seed, byte-identical prior behavior)."""
    build = _build()
    sess = _FakeSess([_FakeMsg("assistant", "only a reply", {})])
    assert build(sess, "anything", "c") is None
