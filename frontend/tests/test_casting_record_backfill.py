"""Casting auto-record back-fill: the model under-calls updateCasting, so the FE records the player's
casting answers itself — the 0055 twin for the casting interview.

Found in a live drive (audit 2026-06-21): across a full casting interview deepseek-v4-pro never called
updateCasting, so the player's name/backstory/motivation never reached the engine, casting never became
`ready`, the finalize fallback could not engage, and the interview DEADLOCKED (the producer kept re-asking
for a name the player had already given). Every other under-call-prone seam (recordInteraction / makeDeal /
moveTo / markHouseguestMet) had an error-correction belt; casting did not. This adds it.
"""

import asyncio
import importlib

al = importlib.import_module("src.agent_loop")
orwell_engine = importlib.import_module("src.orwell_engine")
llm_core = importlib.import_module("src.llm_core")


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _wire(monkeypatch, extraction_json, recorded):
    async def fake_llm(*a, **k):
        return extraction_json

    async def fake_update_casting(fields=None, user=None):
        recorded.append({"fields": fields, "user": user})
        return {"known": fields, "missing": [], "ready": True}

    monkeypatch.setattr(llm_core, "llm_call_async", fake_llm)
    monkeypatch.setattr(orwell_engine, "update_casting", fake_update_casting)


def test_casting_answers_are_backfilled(monkeypatch):
    rec = []
    _wire(monkeypatch, '{"fields":{"playerName":"Devon Hale","backstory":"a paramedic out of Tucson",'
                       '"motivation":"to prove I stay calm under pressure"}}', rec)
    out = _run(al._auto_record_casting(
        "Hey — I'm Devon Hale, a paramedic out of Tucson. I want to prove I stay calm under pressure.",
        "What do I put on the casting form?", "url", "m", {}, "owner"))
    assert out is True
    assert len(rec) == 1 and rec[0]["user"] == "owner"
    assert rec[0]["fields"]["playerName"] == "Devon Hale"
    assert "backstory" in rec[0]["fields"] and "motivation" in rec[0]["fields"]


def test_bare_name_is_recorded(monkeypatch):
    # The producer's whole ask is "One word. That's all I need." — a bare name MUST land.
    rec = []
    _wire(monkeypatch, '{"fields":{"playerName":"Devon Hale"}}', rec)
    out = _run(al._auto_record_casting("Devon Hale.", "Name. What's your name?", "url", "m", {}, "owner"))
    assert out is True and rec[0]["fields"] == {"playerName": "Devon Hale"}


def test_nothing_recordable_is_a_noop(monkeypatch):
    rec = []
    _wire(monkeypatch, '{"fields":{}}', rec)
    out = _run(al._auto_record_casting("Wait, how long does this game even last?",
                                       "Ask me anything.", "url", "m", {}, "owner"))
    assert out is False and rec == [], "a question / chit-chat must record nothing"


def test_empty_player_message_is_a_noop(monkeypatch):
    rec = []
    called = {"llm": False}

    async def fake_llm(*a, **k):
        called["llm"] = True
        return '{"fields":{"playerName":"x"}}'

    async def fake_update_casting(fields=None, user=None):
        rec.append(fields)
        return {}

    monkeypatch.setattr(llm_core, "llm_call_async", fake_llm)
    monkeypatch.setattr(orwell_engine, "update_casting", fake_update_casting)
    out = _run(al._auto_record_casting("   ", "narration", "url", "m", {}, "owner"))
    assert out is False and rec == [] and called["llm"] is False, "no message ⇒ no extraction call"


def test_unrecognized_fields_are_filtered(monkeypatch):
    # Only the allowed casting fields are forwarded — a stray key the model invents is dropped.
    rec = []
    _wire(monkeypatch, '{"fields":{"playerName":"Devon Hale","evilField":"DROP ME","castPhoto":"uploaded"}}', rec)
    out = _run(al._auto_record_casting("I'm Devon.", "name?", "url", "m", {}, "owner"))
    assert out is True
    assert set(rec[0]["fields"]) <= set(al._CASTING_RECORD_FIELDS)
    assert "evilField" not in rec[0]["fields"] and "castPhoto" not in rec[0]["fields"]


def test_extraction_hiccup_is_fail_closed(monkeypatch):
    rec = []

    async def boom(*a, **k):
        raise RuntimeError("llm down")

    async def fake_update_casting(fields=None, user=None):
        rec.append(fields)
        return {}

    monkeypatch.setattr(llm_core, "llm_call_async", boom)
    monkeypatch.setattr(orwell_engine, "update_casting", fake_update_casting)
    out = _run(al._auto_record_casting("I'm Devon Hale.", "name?", "url", "m", {}, "owner"))
    assert out is False and rec == []


def test_unparseable_reply_is_a_noop(monkeypatch):
    rec = []
    _wire(monkeypatch, "I think the player's name is Devon but here's my reasoning with no JSON at all", rec)
    out = _run(al._auto_record_casting("I'm Devon Hale.", "name?", "url", "m", {}, "owner"))
    assert out is False and rec == []


def test_belt_is_wired_into_the_casting_branch():
    import os
    src = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                            "src", "agent_loop.py"), encoding="utf-8").read()
    assert "async def _auto_record_casting" in src
    # keyed off a guaranteed "fields" wrapper via the shared balanced-brace parser
    assert '_last_json_object_with_key(raw, "fields")' in src
    assert "_oe.update_casting(clean, user=owner)" in src
    # wired in the casting branch, gated on the model NOT having called updateCasting + an engaged turn
    assert '_cast_recorded_this_turn = "updateCasting" in {' in src
    assert "if not _cast_recorded_this_turn and _emitted_visible and owner is not None:" in src
    assert "await _auto_record_casting(" in src
    # it runs BEFORE the finalize fallback so that path sees the freshly-recorded state this turn
    assert src.index("await _auto_record_casting(") < src.index("Casting finalize fallback (the game won't START)")
