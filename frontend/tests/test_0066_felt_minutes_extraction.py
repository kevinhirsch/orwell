"""0066 Ext 6 (PR 2) — the auto-record belt proposes a scene DURATION (`feltMinutes`).

When the narration model narrates a player↔houseguest scene but never records it, the FE belt
(`_auto_record_scene`) extracts the recordable consequence AND now a `feltMinutes` estimate, and passes
it to `record_interaction` — so the engine's scene-based clock is paced by a MODEL-authored duration
instead of the deterministic per-exchange floor. A missing / invalid proposal falls back to None
(byte-identical to "no duration"). Roles only; no names.
"""
import asyncio
import json

import pytest

from src import agent_loop as al


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


_HOUSE = [{"id": "npc:3", "name": "A Houseguest"}, {"id": "npc:5", "name": "Another"}]


def _drive(monkeypatch, extraction_json: str):
    """Run _auto_record_scene with a stubbed extraction LLM + a capturing record_interaction."""
    captured = {}

    async def fake_llm(*a, **k):
        return extraction_json

    async def fake_record(content, with_ids=None, kind=None, consequence=None,
                          expected_beat_seq=None, idempotency_key=None, felt_minutes=None, user=None):
        captured["felt_minutes"] = felt_minutes
        captured["with_ids"] = with_ids
        return {"recorded": True, "beatSeq": 1}

    from src import llm_core, orwell_engine as oe
    from routes import chat_helpers
    chat_helpers._LAST_BEAT_SEQ["owner"] = 1
    monkeypatch.setattr(llm_core, "llm_call_async", fake_llm)  # the belt imports it from src.llm_core
    monkeypatch.setattr(oe, "record_interaction", fake_record)

    ok = _run(al._auto_record_scene(
        narration="They schemed in the backyard for a while.",
        last_user="Let's talk strategy with npc:3",
        house=_HOUSE, endpoint_url="http://x", model="m", headers={}, owner="owner"))
    return ok, captured


def test_belt_forwards_the_proposed_felt_minutes(monkeypatch):
    ok, cap = _drive(monkeypatch, '{"withIds":["npc:3"],"kind":"strategy","content":"a scheme","feltMinutes":120}')
    assert ok is True
    assert cap["with_ids"] == ["npc:3"]
    assert cap["felt_minutes"] == 120  # the model's proposed scene duration reaches record_interaction


def test_missing_felt_minutes_falls_back_to_none(monkeypatch):
    ok, cap = _drive(monkeypatch, '{"withIds":["npc:3"],"kind":"bonding","content":"a bond"}')
    assert ok is True
    assert cap["felt_minutes"] is None  # no proposal ⇒ None ⇒ the engine's deterministic increment


def test_invalid_felt_minutes_is_dropped_to_none(monkeypatch):
    # A non-positive / non-numeric / boolean proposal is ignored (the engine also clamps, but the belt is defensive).
    for bad in ('"feltMinutes":0', '"feltMinutes":-30', '"feltMinutes":true', '"feltMinutes":"a while"'):
        ok, cap = _drive(monkeypatch, '{"withIds":["npc:3"],"kind":"strategy","content":"x",' + bad + '}')
        assert ok is True, bad
        assert cap["felt_minutes"] is None, bad


def test_prompt_advertises_felt_minutes_and_belt_wiring_is_source_pinned():
    with open(al.__file__, encoding="utf-8") as f:
        body = f.read()
    # The extraction schema asks for it AND the belt forwards it (guards against a silent unwire).
    assert '"feltMinutes"' in body
    assert "felt_minutes=felt_minutes" in body
