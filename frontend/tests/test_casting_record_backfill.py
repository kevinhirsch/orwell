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


def test_casting_tool_manifest_is_trimmed_to_the_minimal_contract():
    """Root cause of the deadlock: casting was pinned the FULL game tool set, so the model could spam
    the live-season tools (runCompetition/advanceGame/submitDecision/renderScene/…) round after round
    and never settle into a tool-less 'done' round — which is the only place the post-round casting
    error-correction runs. Pre-game the producer only records, reads casting status, and starts."""
    from src.tool_schemas import ORWELL_GAME_TOOLS, ORWELL_CASTING_TOOLS
    assert ORWELL_CASTING_TOOLS <= ORWELL_GAME_TOOLS, "casting tools must be a subset of the game tools"
    # the essentials the producer genuinely needs pre-game
    for need in ("createCharacter", "updateCasting", "getGameState"):
        assert need in ORWELL_CASTING_TOOLS, f"casting needs {need}"
    # the live-season tools must NOT be offered during casting (there is no season yet)
    for live in ("runCompetition", "advanceGame", "submitDecision", "renderScene", "socialRead",
                 "diaryRoom", "makeDeal", "moveTo", "requestSelfEviction"):
        assert live not in ORWELL_CASTING_TOOLS, f"{live} is a live-season tool — not for casting"

    import os
    routes = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                               "routes", "chat_routes.py"), encoding="utf-8").read()
    # the casting turn (framed, pre-game, feed up) pins the casting set; live pins the full set
    assert "ORWELL_CASTING_TOOLS" in routes
    assert "if (ctx.framed and not ctx.game_active and not ctx.feed_down)" in routes
    assert "else ORWELL_GAME_TOOLS" in routes


def test_belt_is_wired_into_the_casting_branch():
    import os
    src = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                            "src", "agent_loop.py"), encoding="utf-8").read()
    assert "async def _auto_record_casting" in src
    # keyed off a guaranteed "fields" wrapper via the shared balanced-brace parser
    assert '_last_json_object_with_key(raw, "fields")' in src
    assert "_oe.update_casting(clean, user=owner)" in src
    # GATED ON THE MISSING NAME, not on whether updateCasting fired — so it catches BOTH "recorded
    # nothing" and "recorded other fields but missed the name" (the partial-record deadlock).
    assert '_name_on_file = bool((_casting or {}).get("known", {}).get("playerName"))' in src
    assert "if _cs is not None and not _name_on_file and owner is not None:" in src
    assert "await _auto_record_casting(" in src
    # it runs BEFORE the finalize fallback so that path sees the freshly-recorded name this turn
    assert src.index("await _auto_record_casting(") < src.index("Casting finalize fallback (the game won't START)")
    # the casting state is fetched ONCE and shared (the finalize fallback no longer re-fetches)
    assert src.count('_oec.get_game_state(owner)') >= 1
    assert "casting-finalize state fetch failed" not in src, "the finalize block must reuse the shared fetch"


def test_casting_turn_end_safety_net_runs_regardless_of_tool_less_round():
    """The in-loop casting error-correction lives in `if not tool_blocks:`, so it only runs on a
    tool-less round. When the model calls a casting tool every round it never settles into one, so the
    belt + finalize never ran and the interview deadlocked (observed live). A turn-end net runs ONCE
    after the round loop — regardless of how it exited — to record the missing name and, if that makes
    the interview finalizable and the player asked, finalize."""
    import os
    src = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                            "src", "agent_loop.py"), encoding="utf-8").read()
    assert "CASTING turn-end safety net" in src
    assert 'if game_mode == "casting" and owner and _emitted_visible:' in src
    # it sits AFTER the round loop (post-loop), alongside the live-turn desync checkpoint
    net = src.index("CASTING turn-end safety net")
    assert net > src.index("for round_num in range(1, max_rounds + 1):")
    assert net < src.index("BEAT-SIGNATURE CHECKPOINT"), "the net runs at turn-end, before the live desync check"
    # it records the missing name then force-finalizes only when finalizable + the player asked
    assert "await _auto_record_casting(_last_user_e," in src
    assert '_LULL_READY_RE.search(_last_user_e or "")' in src
    assert "turn-end FORCED createCharacter (casting net)" in src
