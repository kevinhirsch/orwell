"""Casting-interview agentic-loop fix (2026-06-21 prod bug).

The loop never terminated because the forced-finalize terminal is gated on the engine's
`finalizable` flag (needs name + backstory + motivation + a persona/strategy answer), but the
failure mode is a model that captures only `playerName` → `ready=True, finalizable=False`. The old
ladder then nudged the model that casting was COMPLETE and to call createCharacter — which the
engine refuses (`createRefused: casting-incomplete`) — so it looped re-acknowledging the name.

The fix splits the `ready` branch on `finalizable`:
  • ready AND finalizable  → the existing nudge→force ladder (force createCharacter once rungs exhaust);
  • ready AND NOT finalizable → a TRUTHFUL substance ladder that drives the interview forward (ask the
    missing coverage, record it with updateCasting) and NEVER finalizes/forces — plus an unconditional
    attempt cap so even that can't loop forever.
Plus Fix B: the force's success check now parses the engine result out of the serialized `output`.

Behavioral tests drive the REAL stream_agent_loop in casting mode with a model that NEVER finalizes
(mirrors test_fs4d_truncation.py). Roles only — `playerName` is the non-name token "P".
"""
import asyncio
import json

from src import agent_loop as al


# ── pure constants / nudge content (robust, no drive) ────────────────────────────

def test_casting_substance_ladder_constants_present():
    assert isinstance(al._CASTING_SUBSTANCE_LEVEL, dict)
    assert isinstance(al._CASTING_MAX_ATTEMPTS, int) and al._CASTING_MAX_ATTEMPTS > 0


def test_substance_nudge_tells_the_truth_record_not_finalize():
    n = al._casting_substance_nudge("their backstory", ["backstory", "motivation"])
    # it must steer the model to RECORD the missing substance, explicitly NOT to finalize
    assert "updateCasting" in n
    assert "Do NOT call createCharacter" in n
    # and it names the engine's own next ask
    assert "their backstory" in n


def test_substance_nudge_falls_back_when_no_explicit_next():
    n = al._casting_substance_nudge("", [])
    assert "Do NOT call createCharacter" in n
    assert "updateCasting" in n


# ── behavioral: drive the real loop with a model that never finalizes ────────────

def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _drive_casting(monkeypatch, *, casting_view, last_user="just chatting", max_rounds=4,
                   model_finalizes=False):
    """Drive the REAL stream_agent_loop in casting mode. Returns (events, force_calls,
    substance_calls). `casting_view` is the engine's pre-game casting status dict."""
    monkeypatch.delenv("ORWELL_GAME_BUILD", raising=False)
    monkeypatch.setattr(al, "get_setting", lambda key, default=None: default)
    import src.tool_index as ti
    monkeypatch.setattr(ti, "get_tool_index", lambda: None)
    # the casting branch only fires on a lull — force it
    monkeypatch.setattr(al, "_player_turn_is_lull", lambda messages: True)

    # engine casting state the fallback reads
    import src.orwell_engine as oe
    async def fake_state(user=None):
        return {"started": False, "moment": "character-creation", "casting": casting_view}
    monkeypatch.setattr(oe, "get_game_state", fake_state)

    # spy the forced finalize
    force_calls = []
    import src.tool_implementations as timpl
    async def force_spy(content, owner=None):
        force_calls.append((content, owner))
        # mimic do_create_character: engine view serialized inside `output`
        return {"output": json.dumps({"started": True}), "exit_code": 0}
    monkeypatch.setattr(timpl, "do_create_character", force_spy)

    # spy the substance nudge (wrap the real fn so behavior is unchanged)
    substance_calls = []
    _real_sub = al._casting_substance_nudge
    def sub_spy(next_ask, missing):
        substance_calls.append((next_ask, list(missing or [])))
        return _real_sub(next_ask, missing)
    monkeypatch.setattr(al, "_casting_substance_nudge", sub_spy)

    # a model that ONLY narrates (never a createCharacter tool call) — the loop in the trace
    async def fake_stream(candidates, messages, **kwargs):
        if model_finalizes:
            yield 'data: ' + json.dumps({"type": "tool_calls", "calls": [
                {"id": "c1", "name": "createCharacter", "arguments": "{}"}]}) + '\n\n'
        else:
            yield 'data: {"delta": "\\"P.\\" *She lets it hang a beat, studying you.*"}\n\n'
        yield "data: [DONE]\n\n"
    monkeypatch.setattr(al, "stream_llm_with_fallback", fake_stream)

    events = []

    async def drive():
        gen = al.stream_agent_loop(
            "https://openrouter.ai/api/v1/chat/completions", "deepseek/deepseek-v4-pro",
            [{"role": "system", "content": "You are the casting producer."},
             {"role": "user", "content": last_user}],
            owner="P", game_mode="casting", max_rounds=max_rounds)
        async for chunk in gen:
            if chunk.startswith("data: ") and not chunk.startswith("data: [DONE]"):
                try:
                    events.append(json.loads(chunk[6:]))
                except Exception:
                    pass

    # reset the per-user ladder state between runs
    al._CASTING_STALL_LEVEL.pop("P", None)
    al._CASTING_SUBSTANCE_LEVEL.pop("P", None)
    _run(drive())
    return events, force_calls, substance_calls


_FINALIZABLE = {"ready": True, "finalizable": True,
                "known": {"playerName": "P", "backstory": "x", "motivation": "y",
                          "personaArchetype": "z"},
                "missing": [], "next": None}
_NAME_ONLY = {"ready": True, "finalizable": False,
              "known": {"playerName": "P"},
              "missing": ["backstory", "motivation"], "next": "their life outside the house"}


def test_force_finalize_fires_when_finalizable_and_model_never_calls_it(monkeypatch):
    # explicit readiness forces on a finalizable intake without the full rung escalation.
    _events, force_calls, substance_calls = _drive_casting(
        monkeypatch, casting_view=_FINALIZABLE, last_user="I'm ready, put me in the house")
    assert force_calls, ("once casting is engine-finalizable and the player signalled readiness, the "
                         "FE must force createCharacter when the model won't.")
    assert not substance_calls, "a finalizable intake must NOT take the substance ladder"


def test_no_force_and_substance_nudge_when_not_finalizable(monkeypatch):
    # The exact prod condition: name-only (ready, NOT finalizable). NEVER force; steer the interview.
    _events, force_calls, substance_calls = _drive_casting(
        monkeypatch, casting_view=_NAME_ONLY, last_user="I'm ready", max_rounds=3)
    assert not force_calls, ("a name-only (ready, NOT finalizable) intake must NEVER force "
                             "createCharacter — that loops on a refusal / mints a floater.")
    assert substance_calls, "it must steer toward the missing interview substance instead"
    # the nudge names the engine's missing coverage
    assert any("backstory" in (miss or []) for _next, miss in substance_calls)


def test_substance_ladder_is_bounded_by_the_cap(monkeypatch):
    # Even the truthful nudge must not re-fire forever; the cap stops it. With max_rounds far above
    # the cap, the number of substance nudges is bounded by _CASTING_MAX_ATTEMPTS (never unbounded).
    _events, force_calls, substance_calls = _drive_casting(
        monkeypatch, casting_view=_NAME_ONLY, last_user="ok", max_rounds=al._CASTING_MAX_ATTEMPTS + 5)
    assert not force_calls
    assert len(substance_calls) <= al._CASTING_MAX_ATTEMPTS, (
        "the substance ladder must be bounded by the unconditional attempt cap, never loop forever")
