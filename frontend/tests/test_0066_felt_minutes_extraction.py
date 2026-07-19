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
    # Non-positive / non-numeric / boolean / NON-FINITE proposals are ignored (the engine also clamps, but the
    # belt is defensive). `1e309` parses to +inf via json.loads (allow_nan default) — the crash case: `int(inf)`
    # would raise inside the record `try` and silently drop the scene's fold, so it must resolve to None, not raise.
    for bad in ('"feltMinutes":0', '"feltMinutes":-30', '"feltMinutes":true', '"feltMinutes":"a while"',
                '"feltMinutes":1e309', '"feltMinutes":-1e309'):
        ok, cap = _drive(monkeypatch, '{"withIds":["npc:3"],"kind":"strategy","content":"x",' + bad + '}')
        assert ok is True, bad
        assert cap["felt_minutes"] is None, bad


def test_fractional_felt_minutes_truncates_without_crashing(monkeypatch):
    # A finite fractional proposal is harmlessly truncated to an int (the engine clamps 15-240 regardless) —
    # never a crash, never dropped.
    ok, cap = _drive(monkeypatch, '{"withIds":["npc:3"],"kind":"bonding","content":"x","feltMinutes":90.7}')
    assert ok is True
    assert cap["felt_minutes"] == 90


def test_prompt_advertises_felt_minutes_and_belt_wiring_is_source_pinned():
    with open(al.__file__, encoding="utf-8") as f:
        body = f.read()
    # The extraction schema asks for it AND the belt forwards it (guards against a silent unwire).
    assert '"feltMinutes"' in body
    assert "felt_minutes=felt_minutes" in body


# --- The DIRECT tool path (orwell_engine.record_interaction), not the belt. -------------------------
# The narrator prompt now routinely has the MODEL call recordInteraction with `feltMinutes` directly
# (PR2 of 0066 Ext 6), so the direct forwarder needs the SAME finite+bounded guard as the belt — a
# non-finite proposal (`1e309` → +inf via json.loads) must fall back to "no duration", never forward
# and crash the engine call inside the best-effort record (which would silently drop the scene fold).

def _capture_direct(monkeypatch, felt):
    from src import orwell_engine as oe
    captured = {}

    async def fake_call(tool, req, user=None):
        captured["req"] = req
        return {"recorded": True}

    monkeypatch.setattr(oe, "_call", fake_call)
    _run(oe.record_interaction("a scene", with_ids=["npc:3"], kind="strategy", felt_minutes=felt))
    return captured["req"]


def test_direct_path_forwards_a_valid_felt_minutes(monkeypatch):
    req = _capture_direct(monkeypatch, 120)
    assert req["feltMinutes"] == 120


def test_direct_path_drops_non_finite_and_out_of_range(monkeypatch):
    # +inf (what `1e309` parses to), a bool, zero/negative, and an absurd magnitude all fall back to
    # "no duration" — the engine never sees a `feltMinutes` it can't clamp.
    for bad in (float("inf"), float("-inf"), float("nan"), 0, -30, True, 1_000_000, 10_000_000):
        req = _capture_direct(monkeypatch, bad)
        assert "feltMinutes" not in req, bad
