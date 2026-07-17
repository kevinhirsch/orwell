"""N9 half 1 (2026-07-16 live-playthrough forensics) — memory extraction routes onto the cheap
UTILITY model tier, not the session's expensive narration model.

Live evidence: #1620 routed the FE `_auto_*` error-correction belts (pure JSON extraction) onto
the utility tier via `agent_loop._resolve_belt_endpoint` (`resolve_endpoint("utility", ...)`
called WITHOUT fallback args, so the empty-`ep_id` short-circuit in
`endpoint_resolver.resolve_endpoint` can't hand back a fallback before trying the configured/
default utility model) — but the PLATFORM memory extractor (`services/memory/memory_extractor.py`,
dispatched from `routes/chat_helpers.py::run_post_response_tasks`) was missed: it resolved via
`resolve_task_endpoint(sess.endpoint_url, sess.model, sess.headers, owner=owner)`, i.e. the "task"
tier WITH the session's narration params as fallback — `resolve_endpoint`'s early
`if not ep_id and fallback_url and fallback_model: return fallback_url, ...` branch fires before
ever trying the utility tier whenever `task_endpoint_id` is unset (the shipped default), so
extraction silently ran on the narrator (13 live calls at temp 0.1, mt=500).

This file pins the fix: `run_post_response_tasks`'s memory-extraction dispatch now tries
`resolve_endpoint("utility", owner=owner)` FIRST (bare, no fallback args — the whole point), and
only falls through to the old task-tier/session-model resolution on a genuine miss (utility tier
unresolved), so extraction never silently stops firing.

Roles only — probe strings/ids, never cast material.
"""
import asyncio
import importlib

import pytest

chat_helpers = importlib.import_module("routes.chat_helpers")

_UTILITY_URL = "https://openrouter.ai/api/v1/chat/completions"
_UTILITY_MODEL = "qwen/qwen3.6-flash"
_NARRATOR_URL = "https://narrator.example/v1/chat/completions"
_NARRATOR_MODEL = "z-ai/glm-4.7"


class _FakeSession:
    def __init__(self, owner="u-n9"):
        self.id = "sess-n9"
        self.owner = owner
        self.endpoint_url = _NARRATOR_URL
        self.model = _NARRATOR_MODEL
        self.headers = {}
        self.history = [0, 1, 2, 3]  # len % 4 == 0 and >= 4 ⇒ _should_extract fires
        # A real (non-placeholder) name so the auto-name background task is never scheduled —
        # keeps this test scoped to the memory-extraction dispatch only.
        self.name = "a stable, already-named session"


def _drive(sess, uprefs, *, owner="u-n9"):
    async def _go():
        chat_helpers.run_post_response_tasks(
            sess, None, sess.id, "hello", "hi there", None, uprefs,
            None, None, None, owner=owner,
        )
        # Let the fire-and-forget asyncio.create_task(extract_and_store(...)) actually run.
        await asyncio.sleep(0)
        await asyncio.sleep(0)

    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(_go())
    finally:
        loop.close()


def test_memory_extraction_prefers_the_utility_tier_over_narration_model(monkeypatch):
    captured = {}

    async def _fake_extract_and_store(session, memory_manager, memory_vector, url, model, headers):
        captured["url"], captured["model"], captured["headers"] = url, model, headers

    monkeypatch.setattr(
        "services.memory.memory_extractor.extract_and_store", _fake_extract_and_store)

    def _fake_resolve_endpoint(prefix, *args, **kwargs):
        assert prefix == "utility", f"expected the utility tier, got {prefix!r}"
        # The routing fix's whole point: NO fallback args, so resolve_endpoint can't
        # short-circuit past the configured/default utility model.
        assert not args and "fallback_url" not in kwargs and "fallback_model" not in kwargs
        assert kwargs.get("owner") == "u-n9"
        return _UTILITY_URL, _UTILITY_MODEL, {}

    monkeypatch.setattr("src.endpoint_resolver.resolve_endpoint", _fake_resolve_endpoint)

    def _resolve_task_endpoint_must_not_fire(*a, **k):
        raise AssertionError(
            "resolve_task_endpoint (the narration-model fallback) must not fire when the "
            "utility tier resolves cleanly")

    monkeypatch.setattr(
        "src.task_endpoint.resolve_task_endpoint", _resolve_task_endpoint_must_not_fire)

    _drive(_FakeSession(), {"auto_memory": True})

    assert captured["url"] == _UTILITY_URL
    assert captured["model"] == _UTILITY_MODEL
    assert captured["model"] != _NARRATOR_MODEL


def test_memory_extraction_falls_back_to_task_tier_when_utility_unresolved(monkeypatch):
    """The correction must never be DROPPED — a genuine utility-tier miss still fires the belt,
    via the old task-tier (session-model) resolution, exactly as before this fix."""
    captured = {}

    async def _fake_extract_and_store(session, memory_manager, memory_vector, url, model, headers):
        captured["url"], captured["model"] = url, model

    monkeypatch.setattr(
        "services.memory.memory_extractor.extract_and_store", _fake_extract_and_store)

    monkeypatch.setattr(
        "src.endpoint_resolver.resolve_endpoint",
        lambda prefix, *a, **k: (None, None, None))

    def _fake_resolve_task_endpoint(fallback_url=None, fallback_model=None,
                                     fallback_headers=None, owner=None):
        return fallback_url, fallback_model, fallback_headers

    monkeypatch.setattr("src.task_endpoint.resolve_task_endpoint", _fake_resolve_task_endpoint)

    _drive(_FakeSession(), {"auto_memory": True})

    assert captured["url"] == _NARRATOR_URL
    assert captured["model"] == _NARRATOR_MODEL


def test_memory_extraction_skipped_when_auto_memory_off(monkeypatch):
    called = {"n": 0}

    async def _fake_extract_and_store(*a, **k):
        called["n"] += 1

    monkeypatch.setattr(
        "services.memory.memory_extractor.extract_and_store", _fake_extract_and_store)
    monkeypatch.setattr(
        "src.endpoint_resolver.resolve_endpoint",
        lambda *a, **k: (_UTILITY_URL, _UTILITY_MODEL, {}))

    _drive(_FakeSession(), {"auto_memory": False})

    assert called["n"] == 0
