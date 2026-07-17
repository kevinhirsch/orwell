"""N9 half 2 / BB F16 (2026-07-16 live-playthrough forensics) — memory extraction must never
harvest IN-CHARACTER Orwell game roleplay as durable USER biography.

Live evidence: a redteam scene inside the Orwell game (in-character Big Brother dialogue) was
extracted as "User is highly competitive." / "User is confrontational." — durable USER facts
sourced from a character's in-fiction words, not the human's real biography. ADR 0003 ("the
conversation IS the game") means a session bound as the owner's canonical game session
(`src.orwell_game_session.get_game_session`) is in-fiction material by construction; reliably
telling in-character dialogue from OOC asides from inside a general extraction prompt is not a
safe bar, so the minimal-correct fix is to skip extraction ENTIRELY for the bound game session —
mirroring the pre-existing golden-path quiesce in the same function ("a skipped extraction is the
documented no-op path").

This file pins: the canonical game session is skipped (no LLM call, nothing stored), an ordinary
non-game chat session is UNAFFECTED (extraction still runs), and a session that merely SHARES an
owner with a bound game session but isn't itself the bound session id is also unaffected.

Roles only — probe strings, never cast material.
"""
import asyncio
import importlib
import json

import pytest

memory_extractor = importlib.import_module("services.memory.memory_extractor")
ogs = importlib.import_module("src.orwell_game_session")

_URL = "https://openrouter.ai/api/v1/chat/completions"
_MODEL = "qwen/qwen3.6-flash"


@pytest.fixture(autouse=True)
def _tmp_store(tmp_path, monkeypatch):
    """Redirect the canonical-game-session store to a throwaway path (same seam
    tests/test_0064_canonical_session.py uses) so this test never touches the real data dir."""
    monkeypatch.setattr(ogs, "GAME_SESSION_PATH", tmp_path / "orwell_game_session.json")


class _Msg:
    def __init__(self, role, content):
        self.role = role
        self.content = content


class _FakeSession:
    def __init__(self, session_id, owner):
        self.id = session_id
        self.owner = owner
        self._history = [
            _Msg("user", "I told him straight to his face I'd never trust him again."),
            _Msg("assistant", "The room goes quiet as the houseguest stares you down."),
        ]

    def get_context_messages(self):
        return [{"role": m.role, "content": m.content} for m in self._history]


class _FakeMemoryManager:
    def __init__(self):
        self.saved = []
        self.entries_added = []

    def load_all(self):
        return []

    def find_duplicates(self, text, existing):
        return False

    def add_entry(self, text, source="auto", category="fact", owner=None):
        entry = {"id": f"e{len(self.entries_added)}", "text": text, "category": category, "owner": owner}
        self.entries_added.append(entry)
        return entry

    def save(self, entries):
        self.saved = list(entries)


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def _stub_llm(monkeypatch, calls):
    async def _fake_llm_call_async(*a, **k):
        calls.append((a, k))
        return json.dumps([{"text": "User is highly competitive.", "category": "fact"}])

    monkeypatch.setattr(memory_extractor, "llm_call_async", _fake_llm_call_async, raising=False)
    # extract_and_store imports llm_call_async locally (`from src.llm_core import llm_call_async`)
    # — patch the SOURCE so that local import binds the fake.
    llm_core = importlib.import_module("src.llm_core")
    monkeypatch.setattr(llm_core, "llm_call_async", _fake_llm_call_async)


def test_canonical_game_session_extraction_is_skipped_entirely(monkeypatch):
    owner = "u-n9-game"
    ogs.bind_game_session(owner, "sess-game-1")

    calls = []
    _stub_llm(monkeypatch, calls)
    mm = _FakeMemoryManager()
    sess = _FakeSession("sess-game-1", owner)

    _run(memory_extractor.extract_and_store(sess, mm, None, _URL, _MODEL, {}))

    assert calls == [], "the bound game session must never reach the LLM extraction call"
    assert mm.entries_added == [], "nothing may be stored from in-character game roleplay"


def test_ordinary_non_game_session_still_extracts(monkeypatch):
    owner = "u-n9-plain"
    # No game session bound for this owner at all.
    calls = []
    _stub_llm(monkeypatch, calls)
    mm = _FakeMemoryManager()
    sess = _FakeSession("sess-plain-1", owner)

    _run(memory_extractor.extract_and_store(sess, mm, None, _URL, _MODEL, {}))

    assert len(calls) == 1, "an ordinary chat session must still be extracted"
    assert mm.entries_added, "a real fact from ordinary chat must still be stored"


def test_ordinary_extraction_carries_utility_call_class_timeout_and_owner(monkeypatch):
    """N9 half 1: the primary extraction call must be LEDGERED (call_class="utility-extraction",
    user=owner) and bounded by the new dedicated timeout — it was previously unledgered and
    unbounded."""
    owner = "u-n9-ledger"
    calls = []
    _stub_llm(monkeypatch, calls)
    mm = _FakeMemoryManager()
    sess = _FakeSession("sess-ledger-1", owner)

    _run(memory_extractor.extract_and_store(sess, mm, None, _URL, _MODEL, {}))

    assert len(calls) == 1
    _args, kwargs = calls[0]
    assert kwargs.get("call_class") == "utility-extraction"
    assert kwargs.get("user") == owner
    assert isinstance(kwargs.get("timeout"), int) and kwargs["timeout"] > 0


def test_a_different_session_for_a_game_owner_still_extracts(monkeypatch):
    """Binding one session as the canonical game session must not blanket-suppress extraction
    for every OTHER session that owner has — only the bound session id itself is in-fiction."""
    owner = "u-n9-mixed"
    ogs.bind_game_session(owner, "sess-game-2")

    calls = []
    _stub_llm(monkeypatch, calls)
    mm = _FakeMemoryManager()
    sess = _FakeSession("sess-not-the-game", owner)

    _run(memory_extractor.extract_and_store(sess, mm, None, _URL, _MODEL, {}))

    assert len(calls) == 1
    assert mm.entries_added


def test_lookup_failure_fails_closed_and_skips_extraction(monkeypatch):
    """CodeRabbit #1681: if the canonical-session lookup RAISES, extraction must fail CLOSED
    (skip) — proceeding could persist in-character game dialogue as durable user biography,
    the exact privacy condition the guard exists to prevent (ADR 0003)."""
    owner = "u-n9-lookup-fail"

    def _boom(_owner):
        raise RuntimeError("store unavailable")

    monkeypatch.setattr(ogs, "get_game_session", _boom)

    calls = []
    _stub_llm(monkeypatch, calls)
    mm = _FakeMemoryManager()
    sess = _FakeSession("sess-any", owner)

    _run(memory_extractor.extract_and_store(sess, mm, None, _URL, _MODEL, {}))

    assert calls == [], "extraction must be skipped when the canonical lookup fails"
    assert not mm.entries_added, "nothing may be stored on a failed canonical lookup"
