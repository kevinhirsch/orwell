"""B64 / feature 0049 — the `whereabouts` lever is agent-callable and reaches the engine.

The prompt's lever manifest now advertises `whereabouts` (the Vault-free presence read:
the player's room, who is in it, who is one room over). The C13 drift test enforces the
schema/tag/keep wiring; these tests pin the wrapper's behavior.
"""

import importlib
import json

orwell_engine = importlib.import_module("src.orwell_engine")
tool_impl = importlib.import_module("src.tool_implementations")
agent_tools = importlib.import_module("src.agent_tools")
tool_schemas = importlib.import_module("src.tool_schemas")


def _run(coro):
    import asyncio
    return asyncio.get_event_loop().run_until_complete(coro)


def test_whereabouts_is_fully_wired():
    names = {
        t["function"]["name"]
        for t in tool_schemas.FUNCTION_TOOL_SCHEMAS
        if isinstance(t, dict) and t.get("type") == "function"
    }
    assert "whereabouts" in names
    assert "whereabouts" in tool_schemas.ORWELL_GAME_TOOLS
    assert "whereabouts" in agent_tools.TOOL_TAGS
    assert "whereabouts" in agent_tools.GAME_TOOL_KEEP


def test_whereabouts_passthrough(monkeypatch):
    async def fake(user=None):
        return {
            "room": "kitchen",
            "present": [{"id": "npc:2", "name": "X"}],
            "nearby": [{"room": "living-room", "present": []}],
        }

    monkeypatch.setattr(orwell_engine, "whereabouts", fake)
    res = _run(tool_impl.do_whereabouts("", owner="p"))
    assert res.get("exit_code") == 0
    out = json.loads(res["output"])
    assert out["room"] == "kitchen"
    assert out["nearby"][0]["room"] == "living-room"


def test_whereabouts_pregame_is_a_calm_no_game_answer(monkeypatch):
    async def fake(user=None):
        return None  # the engine returns null before a game starts

    monkeypatch.setattr(orwell_engine, "whereabouts", fake)
    res = _run(tool_impl.do_whereabouts("", owner="p"))
    assert res.get("exit_code") == 0
    assert "No game" in res["output"]
