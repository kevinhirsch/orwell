"""Feature 0050 — the casting interview (producer-led character creation).

Front-end half: (1) pre-game, under the game build, the chat turn is framed with the
engine's casting-interview moment prompt (the conversation IS character creation —
ADR 0003); (2) the createCharacter tool surface carries the interview deepeners through
to the engine; (3) the FE schema's canonical casting sheet cannot drift from the
engine's ARCHETYPES table (the bug class C13 closed, applied to creation).
"""

import asyncio
import importlib
import os
import re

orwell_engine = importlib.import_module("src.orwell_engine")
# tool_implementations first: it pulls the agent_tools/tool_schemas chain in a
# cycle-safe order (tool_schemas imports agent_tools at module level) — see test_c13.
tool_impl = importlib.import_module("src.tool_implementations")
agent_tools = importlib.import_module("src.agent_tools")
tool_schemas = importlib.import_module("src.tool_schemas")
chat_helpers = importlib.import_module("routes.chat_helpers")

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(FRONTEND)


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


# --- 1. pre-game framing: the chat is the interview ----------------------------------

def _pre_game(monkeypatch):
    chat_helpers._GAME_WAS_ACTIVE.clear()

    async def fake_state(user=None):
        return {"started": False, "moment": "character-creation"}

    async def fake_mp(moment=None, user=None):
        return {"systemPrompt": "CASTING-INTERVIEW-PROMPT"}

    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)
    monkeypatch.setattr(orwell_engine, "get_moment_prompt", fake_mp)


def test_pre_game_turn_is_framed_as_the_interview_under_the_game_build(monkeypatch):
    _pre_game(monkeypatch)
    monkeypatch.delenv("ORWELL_GAME_BUILD", raising=False)  # game build defaults ON
    preface = [{"role": "system", "content": "base"}]
    ea, ga, fd = _run(chat_helpers.apply_game_framing(preface, "p"))
    assert (ea, ga, fd) == (True, False, False)
    assert preface[0]["content"].startswith("CASTING-INTERVIEW-PROMPT")


def test_pre_game_turn_stays_plain_when_the_game_build_is_off(monkeypatch):
    _pre_game(monkeypatch)
    monkeypatch.setenv("ORWELL_GAME_BUILD", "0")  # full debug workspace: normal chat
    preface = [{"role": "system", "content": "base"}]
    ea, ga, fd = _run(chat_helpers.apply_game_framing(preface, "p"))
    assert (ea, ga, fd) == (True, False, False)
    assert preface == [{"role": "system", "content": "base"}]


def test_started_game_framing_is_unchanged(monkeypatch):
    chat_helpers._GAME_WAS_ACTIVE.clear()

    async def fake_state(user=None):
        return {"started": True, "moment": "social"}

    async def fake_mp(moment=None, user=None):
        return {"systemPrompt": "GM-PROMPT"}

    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)
    monkeypatch.setattr(orwell_engine, "get_moment_prompt", fake_mp)
    preface = [{"role": "system", "content": "base"}]
    ea, ga, fd = _run(chat_helpers.apply_game_framing(preface, "p"))
    assert (ea, ga, fd) == (True, True, False)
    assert preface[0]["content"].startswith("GM-PROMPT")


# --- 2. the deepeners flow through the tool surface -----------------------------------

DEEPENERS = {
    "personaArchetype": "the quiet one who sees everything",
    "personaStrategyStyle": "smile first, strike later",
    "backstory": "a small-town story",
    "motivation": "to be underestimated all the way to the end",
    "privateStrategy": "let the loud ones take each other out",
    "interviewNotes": ["reads rooms", "hates losing at cards"],
}


def test_create_character_client_sends_the_interview_deepeners(monkeypatch):
    sent = {}

    async def fake_call(tool, args, user=None):
        sent.update(args)
        return {}

    monkeypatch.setattr(orwell_engine, "_call", fake_call)
    _run(orwell_engine.create_character(
        "P", archetype="mastermind", strategy_style="strategic",
        persona_archetype=DEEPENERS["personaArchetype"],
        persona_strategy_style=DEEPENERS["personaStrategyStyle"],
        backstory=DEEPENERS["backstory"], motivation=DEEPENERS["motivation"],
        private_strategy=DEEPENERS["privateStrategy"],
        interview_notes=DEEPENERS["interviewNotes"], user="u",
    ))
    for key, value in DEEPENERS.items():
        assert sent[key] == value, key


def test_do_create_character_forwards_the_deepeners(monkeypatch):
    received = {}

    async def fake_create(player_name, **kwargs):
        received["playerName"] = player_name
        received.update(kwargs)
        return {"started": True}

    monkeypatch.setattr(orwell_engine, "create_character", fake_create)
    import json
    res = _run(tool_impl.do_create_character(json.dumps({
        "playerName": "P", "archetype": "mastermind", **DEEPENERS,
    }), owner="u"))
    assert res["exit_code"] == 0
    assert received["persona_archetype"] == DEEPENERS["personaArchetype"]
    assert received["backstory"] == DEEPENERS["backstory"]
    assert received["motivation"] == DEEPENERS["motivation"]
    assert received["private_strategy"] == DEEPENERS["privateStrategy"]
    assert received["interview_notes"] == DEEPENERS["interviewNotes"]


# --- 3. the casting sheet cannot drift -------------------------------------------------

def _engine_casting_sheet() -> tuple[set, set]:
    """Parse the canonical archetypes + styles from the engine's single source of truth."""
    with open(os.path.join(REPO, "src", "engine", "characterFactory.ts"), encoding="utf-8") as f:
        ts = f.read()
    start = ts.index("export const ARCHETYPES")
    end = ts.index("];", start)
    block = ts[start:end]
    archetypes = set(re.findall(r'archetype:\s*"([a-z-]+)"', block))
    styles = set()
    for styles_m in re.finditer(r"styles:\s*\[([^\]]*)\]", block):
        styles.update(re.findall(r'"([a-z-]+)"', styles_m.group(1)))
    return archetypes, styles


def _create_character_schema() -> dict:
    for t in tool_schemas.FUNCTION_TOOL_SCHEMAS:
        if isinstance(t, dict) and t.get("function", {}).get("name") == "createCharacter":
            return t["function"]
    raise AssertionError("createCharacter schema missing")


def test_schema_archetype_enum_matches_the_engine():
    archetypes, _ = _engine_casting_sheet()
    assert archetypes, "failed to parse the engine's ARCHETYPES — parser or table changed shape"
    schema = _create_character_schema()
    enum = set(schema["parameters"]["properties"]["archetype"]["enum"])
    assert enum == archetypes


def test_schema_strategy_style_enum_matches_the_engine():
    _, styles = _engine_casting_sheet()
    assert styles, "failed to parse the engine's strategy styles"
    schema = _create_character_schema()
    enum = set(schema["parameters"]["properties"]["strategyStyle"]["enum"])
    assert enum == styles


def test_schema_carries_every_interview_deepener():
    props = _create_character_schema()["parameters"]["properties"]
    for field in ("personaArchetype", "personaStrategyStyle", "backstory",
                  "motivation", "privateStrategy", "interviewNotes"):
        assert field in props, field
