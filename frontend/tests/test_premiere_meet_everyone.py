"""PREMIERE meet-everyone (#380) — the `premiereIntros` / `markHouseguestMet` levers are agent-callable.

The engine guarantees all 15 NPCs are met before the first HOH (an engine-side tracker surfaced
into the premiere moment prompt). For the producer to actually DRIVE that flow, the two premiere
tools must be fully wired through the FE (schema + keep-set + dispatch + the engine client). These
tests pin that wiring and the wrappers' behavior — Vault-free public reads only.
"""

import importlib
import json

orwell_engine = importlib.import_module("src.orwell_engine")
tool_impl = importlib.import_module("src.tool_implementations")
tool_exec = importlib.import_module("src.tool_execution")
agent_tools = importlib.import_module("src.agent_tools")
tool_schemas = importlib.import_module("src.tool_schemas")


def _run(coro):
    import asyncio
    return asyncio.get_event_loop().run_until_complete(coro)


def _schema_names():
    return {
        t["function"]["name"]
        for t in tool_schemas.FUNCTION_TOOL_SCHEMAS
        if isinstance(t, dict) and t.get("type") == "function"
    }


def test_premiere_tools_are_fully_wired():
    for name in ("premiereIntros", "markHouseguestMet"):
        assert name in _schema_names(), name
        assert name in tool_schemas.ORWELL_GAME_TOOLS, name
        assert name in agent_tools.TOOL_TAGS, name
        assert name in agent_tools.GAME_TOOL_KEEP, name


def test_premiere_intros_passthrough(monkeypatch):
    async def fake(user=None):
        return {
            "complete": False,
            "metCount": 1,
            "total": 16,
            "remaining": [{"houseguest": {"id": "npc:2", "name": "X"}, "met": False, "archetype": "underdog"}],
            "met": [],
        }

    monkeypatch.setattr(orwell_engine, "premiere_intros", fake)
    res = _run(tool_impl.do_premiere_intros("", owner="p"))
    assert res.get("exit_code") == 0
    assert "npc:2" in res["output"] and "underdog" in res["output"]


def test_premiere_intros_handles_no_premiere(monkeypatch):
    async def fake(user=None):
        return None

    monkeypatch.setattr(orwell_engine, "premiere_intros", fake)
    res = _run(tool_impl.do_premiere_intros("", owner="p"))
    assert res.get("exit_code") == 0  # graceful, never an error outside the premiere


def test_mark_houseguest_met_forwards_the_id(monkeypatch):
    seen = {}

    async def fake(hg_id, user=None):
        seen["id"] = hg_id
        return {"complete": False, "metCount": 2, "total": 16, "remaining": [], "met": []}

    monkeypatch.setattr(orwell_engine, "mark_houseguest_met", fake)
    res = _run(tool_impl.do_mark_houseguest_met(json.dumps({"id": "npc:3"}), owner="p"))
    assert res.get("exit_code") == 0
    assert seen["id"] == "npc:3"


def test_mark_houseguest_met_requires_an_id(monkeypatch):
    called = []

    async def fake(hg_id, user=None):
        called.append(hg_id)
        return {}

    monkeypatch.setattr(orwell_engine, "mark_houseguest_met", fake)
    res = _run(tool_impl.do_mark_houseguest_met("", owner="p"))
    assert res.get("exit_code") == 1 and not called


# ── the premiere auto-mark belt must run for an ANONYMOUS (owner=None) session ──
# Real-LLM regression (2026-06-21): the model under-calls markHouseguestMet and the belt that
# compensates early-returned on `not owner`. The anonymous / localhost-bypass / single-tenant
# deploy has owner=None (engine maps it to the one "default" sandbox), so the belt never ran and
# the player was soft-locked at premiere (metCount stayed 1/16 while ~13 intros were narrated).

agent_loop = importlib.import_module("src.agent_loop")


def test_premiere_belt_marks_for_anonymous_owner(monkeypatch):
    marked = []

    async def fake_intros(user=None):
        return {
            "complete": False, "metCount": 1, "total": 16, "met": [],
            "remaining": [
                {"houseguest": {"id": "npc:2", "name": "Denver Collins"}, "met": False},
                {"houseguest": {"id": "npc:3", "name": "Monica Snyder"}, "met": False},
                {"houseguest": {"id": "npc:4", "name": "Cesar Holt"}, "met": False},
            ],
        }

    async def fake_mark(hg_id, user=None):
        marked.append(hg_id)
        return {"complete": False, "metCount": 1 + len(marked), "total": 16, "remaining": [], "met": []}

    monkeypatch.setattr(orwell_engine, "premiere_intros", fake_intros)
    monkeypatch.setattr(orwell_engine, "mark_houseguest_met", fake_mark)
    narration = "Let's start with Denver Collins over here, then Monica Snyder waves from the kitchen."
    # owner=None is the anonymous/single-tenant path — the belt MUST still mark the named intros.
    n = _run(agent_loop._auto_mark_premiere_intros(narration, None))
    assert n == 2, f"belt must mark the two narrated intros even with owner=None (got {n})"
    assert set(marked) == {"npc:2", "npc:3"}, marked  # Cesar Holt wasn't named → not marked


def test_premiere_belt_noops_without_narration(monkeypatch):
    # The only real no-op is a missing narration (never a None owner).
    called = []

    async def fake_intros(user=None):
        called.append(True)
        return {"remaining": []}

    monkeypatch.setattr(orwell_engine, "premiere_intros", fake_intros)
    assert _run(agent_loop._auto_mark_premiere_intros("", None)) == 0
    assert _run(agent_loop._auto_mark_premiere_intros(None, "p")) == 0
    assert not called  # early-returns before even fetching intros
