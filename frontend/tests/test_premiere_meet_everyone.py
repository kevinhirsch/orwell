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

    async def fake(hg_id, user=None, via=None):
        seen["id"] = hg_id
        seen["via"] = via
        return {"complete": False, "metCount": 2, "total": 16, "remaining": [], "met": []}

    monkeypatch.setattr(orwell_engine, "mark_houseguest_met", fake)
    res = _run(tool_impl.do_mark_houseguest_met(json.dumps({"id": "npc:3"}), owner="p"))
    assert res.get("exit_code") == 0
    assert seen["id"] == "npc:3"
    # #1318 — a MODEL-driven markHouseguestMet (the tool the LLM called itself) is a genuine read: the
    # FE forwards NO `via`, so the engine defaults it to "player" (a hot read). Only the regex belt tags
    # via="belt". This is what keeps the model's real narrated introductions counting toward first power.
    assert seen["via"] is None


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

    async def fake_mark(hg_id, user=None, via=None):
        marked.append((hg_id, via))
        return {"complete": False, "metCount": 1 + len(marked), "total": 16, "remaining": [], "met": []}

    monkeypatch.setattr(orwell_engine, "premiere_intros", fake_intros)
    monkeypatch.setattr(orwell_engine, "mark_houseguest_met", fake_mark)
    narration = "Let's start with Denver Collins over here, then Monica Snyder waves from the kitchen."
    # owner=None is the anonymous/single-tenant path — the belt MUST still mark the named intros.
    n = _run(agent_loop._auto_mark_premiere_intros(narration, None))
    assert n == 2, f"belt must mark the two narrated intros even with owner=None (got {n})"
    # Cesar Holt wasn't named → not marked. #1318 — the belt tags EVERY mark via="belt" so a mere
    # name-drop fills the meet-list (anti-soft-lock) without unlocking the first-power gate.
    assert {hg for hg, _ in marked} == {"npc:2", "npc:3"}, marked
    assert all(via == "belt" for _, via in marked), marked


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


# ── #1318 — the belt is a name-belt, NOT a hot read: it must tag via="belt" so the first HOH does not
#    fire the moment two names are heard, while its anti-soft-lock job (the meet-list keeps shrinking)
#    stays fully intact. ──


def test_premiere_belt_tags_every_mark_as_belt_source(monkeypatch):
    """The belt marks EVERY name-matched intro with via="belt". A belt mark fills the meet-list (so the
    premiere can still reach `complete`) but is NOT a genuine player-formed read, so the engine excludes
    it from the asymmetric first-power gate — the #1318 fix for the HOH firing off bare name-drops."""
    calls = []

    async def fake_intros(user=None):
        return {
            "complete": False, "metCount": 1, "total": 16, "met": [],
            "remaining": [
                {"houseguest": {"id": "npc:5", "name": "Ada Reyes"}, "met": False},
                {"houseguest": {"id": "npc:6", "name": "Bo Tran"}, "met": False},
            ],
        }

    async def fake_mark(hg_id, user=None, via=None):
        calls.append((hg_id, via))
        return {"complete": False, "metCount": 1 + len(calls), "total": 16, "remaining": [], "met": []}

    monkeypatch.setattr(orwell_engine, "premiere_intros", fake_intros)
    monkeypatch.setattr(orwell_engine, "mark_houseguest_met", fake_mark)
    narration = "Ada Reyes laughs by the couch while Bo Tran hauls a suitcase upstairs."
    n = _run(agent_loop._auto_mark_premiere_intros(narration, "p"))
    assert n == 2, n
    # Anti-soft-lock intact (both named intros register) AND every one carries the belt source tag.
    assert {hg for hg, _ in calls} == {"npc:5", "npc:6"}, calls
    assert [via for _, via in calls] == ["belt", "belt"], calls


def test_premiere_belt_soft_lock_protection_still_marks_all_named(monkeypatch):
    """The belt's original job is preserved: when the model narrates intros but under-calls the tool, the
    belt marks every still-to-meet houseguest it can name-match, so the meet-list keeps shrinking and the
    premiere never soft-locks. via="belt" changes only the power gate, never this coverage."""
    marked = []

    async def fake_intros(user=None):
        return {
            "complete": False, "metCount": 1, "total": 16, "met": [],
            "remaining": [
                {"houseguest": {"id": "npc:7", "name": "Cara Lo"}, "met": False},
                {"houseguest": {"id": "npc:8", "name": "Dev Okafor"}, "met": False},
                {"houseguest": {"id": "npc:9", "name": "Eve Marsh"}, "met": False},
            ],
        }

    async def fake_mark(hg_id, user=None, via=None):
        marked.append(hg_id)
        return {"complete": False, "metCount": 1 + len(marked), "total": 16, "remaining": [], "met": []}

    monkeypatch.setattr(orwell_engine, "premiere_intros", fake_intros)
    monkeypatch.setattr(orwell_engine, "mark_houseguest_met", fake_mark)
    # All three named in the narration → all three register (none left stranded on the meet-list).
    narration = "Cara Lo, Dev Okafor, and Eve Marsh all crowd into the kitchen to say hello."
    n = _run(agent_loop._auto_mark_premiere_intros(narration, "p"))
    assert n == 3, n
    assert set(marked) == {"npc:7", "npc:8", "npc:9"}, marked


def test_engine_client_mark_houseguest_met_omits_via_by_default_and_sends_belt_when_asked(monkeypatch):
    """The `orwell_engine.mark_houseguest_met` wrapper omits `via` unless explicitly asked (so the engine
    defaults a model-driven call to a genuine "player" read) and forwards via="belt" for the belt."""
    sent = []

    async def fake_call(tool, args, user=None):
        sent.append((tool, dict(args)))
        return {}

    monkeypatch.setattr(orwell_engine, "_call", fake_call)
    _run(orwell_engine.mark_houseguest_met("npc:1", user="p"))
    _run(orwell_engine.mark_houseguest_met("npc:2", user="p", via="belt"))
    assert sent[0] == ("markHouseguestMet", {"id": "npc:1"})           # no via ⇒ engine default (player)
    assert sent[1] == ("markHouseguestMet", {"id": "npc:2", "via": "belt"})
