"""Phase 3 of "the player can play offense" — the FE dead-wire fix for `formAlliance`/`joinAlliance`
(flagged by #1193 alongside the confide/exposeSecret/tradeSecret dead wire it already fixed).

Both tools (feature 0107) are FULLY BUILT, wired engine tools (src/surfaces/tools/registry.ts ->
src/adapters/mcp/McpServer.ts -> src/adapters/engine/GameSessionAdapter.ts, tests/unit/alliances0107.test.ts
+ alliancesNpc0107b.test.ts) and were already advertised in the model-facing function schema
(tool_schemas.py) and allow-listed for the game build (GAME_TOOL_KEEP, agent_tools.py) — even the
chat-side machinery (the `orwell:gamechanged` trigger list in chat.js, the tool-beat labels in
orwellToolBeats.js, the sync-ledger tracked-tool list in chat_helpers.py) already knew about them.
But `tool_execution.py`'s dispatcher had NO `elif` branch for either tool name — every model-driven
call fell through to the generic "Unknown tool type" fallback. This is the SAME dead-wire shape
`test_0093_0099_secret_verbs_onramp.py` already caught and fixed for confide/exposeSecret/tradeSecret;
this file is the parallel fix + gate for formAlliance/joinAlliance: `orwell_engine.form_alliance`/
`join_alliance` wrappers, `do_form_alliance`/`do_join_alliance` (tool_implementations.py), and the
missing `elif` dispatch branches, mirroring the working `confide` path end to end.

Name-agnostic — roster ids are synthetic (npc:N); any display names are arbitrary placeholders
(testing rule: roles only, no real/canonical cast).

SYNC tests only (pytest-asyncio AUTO mode) — drive coroutines via run_until_complete.
"""

import asyncio
import importlib
import json

al = importlib.import_module("src.agent_loop")  # noqa: F401 — imported first only to avoid a
# tool_schemas/agent_tools circular-import ordering issue (see the sibling
# test_0093_0099_secret_verbs_onramp.py for the pattern).
orwell_engine = importlib.import_module("src.orwell_engine")
tool_impl = importlib.import_module("src.tool_implementations")
tool_schemas = importlib.import_module("src.tool_schemas")
tool_execution = importlib.import_module("src.tool_execution")
agent_tools = importlib.import_module("src.agent_tools")


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _find_schema(name: str) -> dict:
    for t in tool_schemas.FUNCTION_TOOL_SCHEMAS:
        if t.get("function", {}).get("name") == name:
            return t["function"]
    raise AssertionError(f"{name} not found in FUNCTION_TOOL_SCHEMAS")


# ============================================================================================
# 1. Model-facing schema + game-build allowlist — both were ALREADY present (pins the fact so a
#    future refactor can't silently drop one without a test noticing).
# ============================================================================================

def test_form_alliance_and_join_alliance_are_in_the_model_facing_schema():
    for name in ("formAlliance", "joinAlliance"):
        fn = _find_schema(name)
        assert fn["name"] == name


def test_form_alliance_and_join_alliance_are_game_tool_keep():
    assert "formAlliance" in agent_tools.GAME_TOOL_KEEP
    assert "joinAlliance" in agent_tools.GAME_TOOL_KEEP


def test_form_alliance_schema_matches_the_engine_signature():
    fn = _find_schema("formAlliance")
    props = fn["parameters"]["properties"]
    assert set(props.keys()) >= {"name", "members"}
    assert props["name"]["type"] == "string"
    assert props["members"]["type"] == "array"
    assert set(fn["parameters"]["required"]) == {"name", "members"}


def test_join_alliance_schema_matches_the_engine_signature():
    fn = _find_schema("joinAlliance")
    props = fn["parameters"]["properties"]
    assert set(props.keys()) >= {"allianceId"}
    assert props["allianceId"]["type"] == "string"
    assert fn["parameters"]["required"] == ["allianceId"]


# ============================================================================================
# 2. tool_execution.py dispatch — formAlliance/joinAlliance were advertised but UNREACHABLE
#    (fell through to "Unknown tool type"). This is the fix, not just discoverability.
# ============================================================================================

class _FakeBlock:
    def __init__(self, tool_type, content):
        self.tool_type = tool_type
        self.content = content


def test_form_alliance_dispatches_to_the_engine_not_unknown_tool(monkeypatch):
    seen = {}

    async def fake_form(name, members, expected_beat_seq=None, user=None):
        seen.update(name=name, members=members, user=user)
        return {"id": "alliance:1", "name": name, "members": [{"id": "npc:3", "name": "Three"}], "youAreFounder": True}

    monkeypatch.setattr(orwell_engine, "form_alliance", fake_form)
    desc, result = _run(tool_execution.execute_tool_block(
        _FakeBlock("formAlliance", json.dumps({"name": "The Nucleus", "members": ["npc:3", "npc:7"]})),
        owner="owner"))
    assert desc == "formAlliance"
    assert result["exit_code"] == 0
    assert json.loads(result["output"])["name"] == "The Nucleus"
    assert seen == {"name": "The Nucleus", "members": ["npc:3", "npc:7"], "user": "owner"}


def test_join_alliance_dispatches_to_the_engine_not_unknown_tool(monkeypatch):
    seen = {}

    async def fake_join(alliance_id, expected_beat_seq=None, user=None):
        seen.update(alliance_id=alliance_id, user=user)
        return {"id": alliance_id, "name": "The Six", "members": [], "youAreFounder": False}

    monkeypatch.setattr(orwell_engine, "join_alliance", fake_join)
    desc, result = _run(tool_execution.execute_tool_block(
        _FakeBlock("joinAlliance", json.dumps({"allianceId": "alliance:9"})), owner="owner"))
    assert desc == "joinAlliance"
    assert result["exit_code"] == 0
    assert json.loads(result["output"])["id"] == "alliance:9"
    assert seen == {"alliance_id": "alliance:9", "user": "owner"}


def test_form_alliance_requires_name_and_members(monkeypatch):
    desc, result = _run(tool_execution.execute_tool_block(
        _FakeBlock("formAlliance", json.dumps({"name": "Solo"})), owner="owner"))
    assert result["exit_code"] == 1
    assert "members" in result["error"]

    desc, result = _run(tool_execution.execute_tool_block(
        _FakeBlock("formAlliance", json.dumps({"members": ["npc:3"]})), owner="owner"))
    assert result["exit_code"] == 1
    assert "name" in result["error"]


def test_join_alliance_requires_an_alliance_id(monkeypatch):
    desc, result = _run(tool_execution.execute_tool_block(
        _FakeBlock("joinAlliance", json.dumps({})), owner="owner"))
    assert result["exit_code"] == 1
    assert "allianceId" in result["error"]


# ============================================================================================
# 3. orwell_engine.form_alliance/join_alliance — argument-building (byte-shape) tests
# ============================================================================================

def _capture_call(monkeypatch):
    seen = {}

    async def fake_call(name, args=None, user=None, timeout=None):
        seen["name"] = name
        seen["args"] = args
        seen["user"] = user
        return {"ok": True}

    monkeypatch.setattr(orwell_engine, "_call", fake_call)
    return seen


def test_form_alliance_forwards_name_and_members(monkeypatch):
    seen = _capture_call(monkeypatch)
    _run(orwell_engine.form_alliance("The Nucleus", ["npc:3", "npc:7"], user="owner"))
    assert seen["name"] == "formAlliance"
    assert seen["args"] == {"name": "The Nucleus", "members": ["npc:3", "npc:7"]}
    assert seen["user"] == "owner"


def test_form_alliance_threads_expected_beat_seq_only_when_provided(monkeypatch):
    seen = _capture_call(monkeypatch)
    _run(orwell_engine.form_alliance("The Nucleus", ["npc:3"], expected_beat_seq=5, user="owner"))
    assert seen["args"] == {"name": "The Nucleus", "members": ["npc:3"], "expectedBeatSeq": 5}


def test_join_alliance_forwards_alliance_id(monkeypatch):
    seen = _capture_call(monkeypatch)
    _run(orwell_engine.join_alliance("alliance:9", user="owner"))
    assert seen["name"] == "joinAlliance"
    assert seen["args"] == {"allianceId": "alliance:9"}


# ============================================================================================
# 4. do_form_alliance / do_join_alliance — the tool_implementations.py layer
# ============================================================================================

def test_do_form_alliance_forwards_name_and_members(monkeypatch):
    async def fake_form(name, members, expected_beat_seq=None, user=None):
        return {"name": name, "members": members}

    monkeypatch.setattr(orwell_engine, "form_alliance", fake_form)
    res = _run(tool_impl.do_form_alliance(
        json.dumps({"name": "The Nucleus", "members": ["npc:3", "npc:7"]}), owner="owner"))
    assert res["exit_code"] == 0
    out = json.loads(res["output"])
    assert out == {"name": "The Nucleus", "members": ["npc:3", "npc:7"]}


def test_do_form_alliance_missing_members_errors(monkeypatch):
    res = _run(tool_impl.do_form_alliance(json.dumps({"name": "Solo"}), owner="owner"))
    assert res["exit_code"] == 1


def test_do_form_alliance_empty_members_list_errors(monkeypatch):
    res = _run(tool_impl.do_form_alliance(json.dumps({"name": "Solo", "members": []}), owner="owner"))
    assert res["exit_code"] == 1


def test_do_join_alliance_forwards_alliance_id(monkeypatch):
    seen = {}

    async def fake_join(alliance_id, expected_beat_seq=None, user=None):
        seen["alliance_id"] = alliance_id
        return {"id": alliance_id}

    monkeypatch.setattr(orwell_engine, "join_alliance", fake_join)
    res = _run(tool_impl.do_join_alliance(json.dumps({"allianceId": "alliance:9"}), owner="owner"))
    assert res["exit_code"] == 0
    assert seen["alliance_id"] == "alliance:9"


def test_do_join_alliance_missing_id_errors(monkeypatch):
    res = _run(tool_impl.do_join_alliance(json.dumps({}), owner="owner"))
    assert res["exit_code"] == 1
