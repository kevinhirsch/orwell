"""Queue C13 — close the lever drift: every prompt-advertised lever is agent-callable.

The bug class: the engine's game-master prompt names levers ("• diaryRoom — ...") that the
front-end never exposed, so a prompt-obedient model got "Unknown function call" mid-scene —
the in-chat Diary Room was narrated-but-never-recorded, NPC-initiated scenes were dead, and
deals (0039) couldn't be struck. The DRIFT TEST here parses the prompt's lever manifest and
fails if any named lever is missing from the FE surface — so prompt and front-end can never
silently diverge again.
"""

import importlib
import json
import os
import re

import pytest

orwell_engine = importlib.import_module("src.orwell_engine")
# tool_implementations first: it pulls the agent_tools/tool_schemas chain in a
# cycle-safe order (tool_schemas imports agent_tools at module level).
tool_impl = importlib.import_module("src.tool_implementations")
agent_tools = importlib.import_module("src.agent_tools")
tool_schemas = importlib.import_module("src.tool_schemas")

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(FRONTEND)


def _prompt_levers() -> set[str]:
    """Parse '  • leverName — ...' bullets out of BASE_GAME_MASTER_PROMPT (TS source)."""
    with open(os.path.join(REPO, "src", "engine", "momentPrompts.ts"), encoding="utf-8") as f:
        ts = f.read()
    start = ts.index("BASE_GAME_MASTER_PROMPT")
    end = ts.index('].join("\\n")', start)
    block = ts[start:end]
    levers: set[str] = set()
    for m in re.finditer(r"•\s+([A-Za-z]+(?:\s*/\s*[A-Za-z]+)*)\s+—", block):
        for name in re.split(r"\s*/\s*", m.group(1)):
            levers.add(name.strip())
    return levers


def _fe_schema_names() -> set[str]:
    return {
        t["function"]["name"]
        for t in tool_schemas.FUNCTION_TOOL_SCHEMAS
        if isinstance(t, dict) and t.get("type") == "function"
    }


# --- THE drift test ------------------------------------------------------------------

def test_every_prompt_advertised_lever_is_agent_callable():
    levers = _prompt_levers()
    assert levers, "failed to parse any levers from the prompt — parser or prompt changed shape"
    schemas = _fe_schema_names()
    missing = sorted(
        lever for lever in levers
        if lever not in schemas
        or lever not in tool_schemas.ORWELL_GAME_TOOLS
        or lever not in agent_tools.TOOL_TAGS
        or lever not in agent_tools.GAME_TOOL_KEEP
    )
    assert not missing, (
        f"prompt advertises levers the agent cannot call: {missing} — "
        "add schema + ORWELL_GAME_TOOLS + TOOL_TAGS + GAME_TOOL_KEEP (+ dispatch), "
        "or remove the lever from BASE_GAME_MASTER_PROMPT"
    )


def test_drifted_levers_now_present():
    # The three this item wired; pin them explicitly so a revert is loud.
    for lever in ("socialInitiatives", "diaryRoom", "makeDeal"):
        assert lever in _fe_schema_names(), lever
        assert lever in tool_schemas.ORWELL_GAME_TOOLS, lever
        assert lever not in agent_tools.game_build_disabled_additions([]), lever


def test_prompt_no_longer_advertises_resolveCompetition():
    # B37 made runCompetition the single advertised competition authority.
    assert "resolveCompetition" not in _prompt_levers()


# --- the wrappers actually reach the engine ------------------------------------------

def _run(coro):
    import asyncio
    return asyncio.get_event_loop().run_until_complete(coro)


def test_diary_room_turn_records_an_entry(monkeypatch):
    seen = {}

    async def fake(entry, user=None):
        seen["entry"] = entry
        return {"recorded": True}

    monkeypatch.setattr(orwell_engine, "diary_room", fake)
    res = _run(tool_impl.do_diary_room(json.dumps({"entry": "I trust no one this week."}), owner="p"))
    assert res.get("exit_code") == 0
    assert seen["entry"] == "I trust no one this week."


def test_diary_room_requires_an_entry(monkeypatch):
    called = []

    async def fake(entry, user=None):
        called.append(entry)
        return {"recorded": True}

    monkeypatch.setattr(orwell_engine, "diary_room", fake)
    res = _run(tool_impl.do_diary_room("", owner="p"))
    assert res.get("exit_code") == 1 and not called


def test_social_initiatives_passthrough(monkeypatch):
    async def fake(user=None):
        return {"initiatives": [{"houseguest": {"id": "npc:3", "name": "X"}, "pretext": "wants a word"}]}

    monkeypatch.setattr(orwell_engine, "social_initiatives", fake)
    res = _run(tool_impl.do_social_initiatives("", owner="p"))
    assert res.get("exit_code") == 0 and "npc:3" in res["output"]


def test_make_deal_forwards_and_validates(monkeypatch):
    seen = {}

    async def fake(with_id, kind, terms, user=None):
        seen.update({"with": with_id, "kind": kind, "terms": terms})
        return {"deal": {"kind": kind}}

    monkeypatch.setattr(orwell_engine, "make_deal", fake)
    ok = _run(tool_impl.do_make_deal(json.dumps({"with": "npc:2", "kind": "final-two", "terms": "to the end"}), owner="p"))
    assert ok.get("exit_code") == 0
    assert seen == {"with": "npc:2", "kind": "final-two", "terms": "to the end"}
    bad = _run(tool_impl.do_make_deal(json.dumps({"with": "npc:2", "kind": "coronation", "terms": "x"}), owner="p"))
    assert bad.get("exit_code") == 1


def test_w6_every_keep_set_tool_has_a_diegetic_beat_label():
    """D5/W6: a keep-set tool with no _orwellToolBeats entry renders its raw
    camelCase name in the transcript — the C14/C19 immersion bleed. The drift
    test iterates the REAL keep-set so a new tool can't ship unlabeled."""
    import re
    from pathlib import Path
    fe = Path(__file__).resolve().parents[1]
    # The map now lives in the single-source module ./orwellToolBeats.js (shared by the
    # live + reload render paths). Iterate it so a new keep-set tool can't ship unlabeled.
    beats = (fe / "static" / "js" / "orwellToolBeats.js").read_text(encoding="utf-8")
    m = re.search(r"ORWELL_TOOL_BEATS = \{(.*?)\};", beats, re.S)
    assert m, "ORWELL_TOOL_BEATS map missing from orwellToolBeats.js"
    labeled = set(re.findall(r"'([A-Za-z_]+)':", m.group(1)))
    from src.agent_tools import GAME_TOOL_KEEP
    missing = sorted(set(GAME_TOOL_KEEP) - labeled)
    assert not missing, f"keep-set tools with no diegetic beat label (D5/W6): {missing}"


# --- #1385: turnIn — the ADR 0006 bedtime lever — is now agent-callable ---------------

def test_turn_in_is_agent_callable():
    # #1385: turnIn (the player's bedtime lever + the 0102 daily-recap trigger) was engine-wired but
    # had NO FE surface, so the model could never call it — the sleep-economy player half was dead.
    # Pin all four FE surfaces the drift gate checks so a revert is loud.
    assert "turnIn" in _fe_schema_names()
    assert "turnIn" in tool_schemas.ORWELL_GAME_TOOLS
    assert "turnIn" in agent_tools.TOOL_TAGS
    assert "turnIn" in agent_tools.GAME_TOOL_KEEP


def test_turn_in_forwards_and_surfaces_daily_recap(monkeypatch):
    # Boundary test: the FE only SURFACES turnIn — the ENGINE owns the night-roll AND the hidden rest
    # penalty (the FE never authors the sleep effect). Prove the wrapper reaches the engine and returns
    # the AdvanceView (incl. the Vault-free dailyRecap 0102) verbatim so the narrator can voice it.
    seen = {}

    # #1385 guard: turnIn is a mutating progression, so do_turn_in threads the 0065 sync-spine fields
    # (expected_beat_seq CAS + at-most-once idempotency_key) — the mock must accept them like the engine tool.
    async def fake(expected_beat_seq=None, idempotency_key=None, user=None):
        seen["called"] = True
        return {"event": None, "dailyRecap": {"day": 1, "highlights": ["a quiet day"], "surfaced": []}}

    monkeypatch.setattr(orwell_engine, "turn_in", fake)
    res = _run(tool_impl.do_turn_in("", owner="p"))
    assert res.get("exit_code") == 0 and seen.get("called")
    assert "dailyRecap" in res["output"] and "a quiet day" in res["output"]
