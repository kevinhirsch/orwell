"""Feature 0058 / L28b (FE half) — the producer-LLM authoring pipeline.

The orchestrator takes INJECTED llm + write functions, so the whole pipeline is testable without a
live model or engine. We pin: the producer prompt (player-independence), the tolerant JSON parser
(schema-only, type-coerced), and the orchestration (writes each NPC, skips the player, best-effort
per houseguest, only forwards engine-accepted fields).
"""
import asyncio
import json

from src import orwell_cast_authoring as A


def _run(coro):
    # The FE convention (test_lane6_turn_integrity): drive a coroutine on the EXISTING session loop.
    # NOT `async def` tests / asyncio.run() — those close the main-thread loop and break later tests
    # that use the deprecated asyncio.get_event_loop() (e.g. the transcript-surface suite).
    return asyncio.get_event_loop().run_until_complete(coro)


# ── the producer prompt ───────────────────────────────────────────────────────

def test_l28b_prompt_is_producer_framed_and_player_independent():
    msgs = A.build_authoring_messages({"id": "npc:1", "name": "Dana Reyes", "vocation": "welder"})
    assert msgs[0]["role"] == "system"
    assert "CASTING PRODUCER" in msgs[0]["content"]
    assert "JSON" in msgs[0]["content"]
    user = msgs[1]["content"]
    assert "Dana Reyes" in user
    # the public skeleton is passed through to build FROM
    assert "welder" in user


def test_l28b_prompt_grounds_the_hidden_life_in_the_specific_character():
    """P1 — NPC story coherence: the producer prompt must INSTRUCT the model to GROUND the
    secrets/true-goals/weakness in THIS houseguest's own occupation / archetype / age / backstory
    (the fix for generic, cast-repeating hidden material), while STILL carrying every grounding
    facet through the skeleton and STILL coupling to no player. The permanent grounding gate."""
    npc = {
        "id": "npc:5", "name": "Dana Reyes", "age": 34, "vocation": "pastry chef",
        "hometown": "Detroit, MI", "archetype": "villain", "demeanor": "deadpan and dry",
    }
    msgs = A.build_authoring_messages(npc)
    system = msgs[0]["content"].lower()
    user = msgs[1]["content"]

    # (a) the system prompt drives grounding the HIDDEN material in the individual's specifics.
    assert "ground" in system  # the explicit "GROUND EVERYTHING IN THIS SPECIFIC PERSON" instruction
    assert "occupation" in system
    assert "archetype" in system
    assert "age" in system
    # the secrets/goals/weakness are named as the things to ground
    assert "secret" in system and "weakness" in system

    # (b) every grounding facet is actually passed through to the model (build FROM this).
    for facet in ("pastry chef", "villain", "34", "Detroit, MI", "deadpan and dry"):
        assert facet in user, facet

    # (c) STILL no player coupling — the grounding change must not reintroduce a protagonist.
    import inspect
    assert list(inspect.signature(A.build_authoring_messages).parameters) == ["npc"]
    assert "player" not in user.lower() or "no protagonist" in user.lower()


def test_l28b_prompt_carries_no_player_coupling_and_no_protagonist():
    """ANTI-SYCOPHANCY (mandate #3): an NPC's STORYLINE is authored as if the player does not exist.
    The prompt must (a) take no player identity at all, and (b) instruct the model that the cast is a
    set of equals with no protagonist — secrets/goals/weakness must never revolve around a 'player'.
    This is the permanent gate against player-centric NPC storyline authoring."""
    import inspect
    # The function signature itself no longer accepts a player name (player-independent by construction).
    params = list(inspect.signature(A.build_authoring_messages).parameters)
    assert params == ["npc"], params

    # A distinctive player name could only appear in the messages if it were threaded in — it is not.
    player_name = "Zzqx The Player"
    msgs = A.build_authoring_messages({"id": "npc:1", "name": "Dana Reyes", "vocation": "welder"})
    blob = (msgs[0]["content"] + " " + msgs[1]["content"]).lower()
    assert player_name.lower() not in blob

    system = msgs[0]["content"].lower()
    # the storyline-independence instruction is present (no protagonist / own independent life)
    assert "independent" in system
    assert "protagonist" in system or "only a cast" in system
    # and the player's Day-1 read is NOT authored here (the engine owns the seeded floor)
    assert "dayoneperception" not in system.replace(" ", "")
    assert "dayOnePerception" not in A._HIDDEN_KEYS


# ── the parser ────────────────────────────────────────────────────────────────

_FULL = {
    "biography": "A blunt welder from Detroit who came up the hard way. Friends call her loyal to a fault.",
    "physicalCharacteristics": {
        "heightBuild": "stocky and powerful", "skinTone": "warm tan complexion", "hair": "a close-cropped fade",
        "facialFeatures": "a square jaw", "distinguishingMark": "a wrist tattoo", "ageLook": "settled, thirties",
        "style": "sturdy workwear",
    },
    "secrets": ["is in real financial trouble", "recognized another houseguest from before"],
    "trueGoals": ["reach the end quietly", "build one secret final two"],
    "weakness": "is too loyal once committed",
    "dayOnePerception": "reads the player as harmless but socially useful",
}


def test_l28b_parser_extracts_the_full_schema_with_the_id():
    prof = A.parse_authored_profile(json.dumps(_FULL), "npc:7")
    assert prof["houseguestId"] == "npc:7"
    assert prof["biography"].startswith("A blunt welder")
    assert set(prof["physicalCharacteristics"].keys()) == set(A._PHYS_KEYS)
    assert prof["secrets"] == _FULL["secrets"]
    assert prof["trueGoals"] == _FULL["trueGoals"]
    assert prof["weakness"] == _FULL["weakness"]
    # ANTI-SYCOPHANCY: the parser NEVER forwards a player-coupled Day-1 read even if a model returns
    # one — the engine owns the seeded, balanced read. So `dayOnePerception` is dropped on the floor.
    assert "dayOnePerception" not in prof


def test_l28b_parser_tolerates_fenced_json_and_chatter():
    text = "Sure! Here's the bible:\n```json\n" + json.dumps(_FULL) + "\n```\nHope that helps."
    prof = A.parse_authored_profile(text, "npc:2")
    assert prof and prof["biography"].startswith("A blunt welder")


def test_l28b_parser_drops_a_partial_physical_facet_but_keeps_other_fields():
    partial = dict(_FULL)
    partial["physicalCharacteristics"] = {"hair": "long dark waves"}  # incomplete facet
    prof = A.parse_authored_profile(json.dumps(partial), "npc:3")
    # the facet is the text<->image source of truth — only written WHOLE, never half
    assert "physicalCharacteristics" not in prof
    # but the rest of the authored profile still lands
    assert prof["biography"] and prof["secrets"]


def test_l28b_parser_returns_none_on_garbage():
    assert A.parse_authored_profile("not json at all", "npc:1") is None
    assert A.parse_authored_profile(json.dumps({"unrelated": 1}), "npc:1") is None
    assert A.parse_authored_profile("", "npc:1") is None


# ── the orchestrator (injected fakes) ─────────────────────────────────────────

def test_l28b_author_cast_writes_each_npc_and_skips_the_player():
    cast = [
        {"id": "player", "name": "The Player"},
        {"id": "npc:1", "name": "A One"},
        {"id": "npc:2", "name": "B Two"},
    ]
    writes = []

    async def llm_fn(messages):
        return json.dumps(_FULL)

    async def write_fn(profile):
        writes.append(profile)
        return {"accepted": True, "publicFields": ["biography"], "hiddenFields": ["secrets"]}

    n = _run(A.author_cast(cast, llm_fn, write_fn))
    assert n == 2  # both NPCs, never the player
    assert [w["houseguestId"] for w in writes] == ["npc:1", "npc:2"]
    # the write-back carries the authored schema, never a stray key (and never the Day-1 read)
    for w in writes:
        assert set(w).issubset({"houseguestId", *A._PUBLIC_KEYS, *A._HIDDEN_KEYS})
        assert "dayOnePerception" not in w


def test_l28b_author_cast_is_best_effort_per_houseguest():
    cast = [{"id": "npc:1", "name": "A"}, {"id": "npc:2", "name": "B"}, {"id": "npc:3", "name": "C"}]
    writes = []

    async def llm_fn(messages):
        # the middle houseguest's model call blows up — the others must still author
        if "B" in messages[1]["content"]:
            raise RuntimeError("model timeout")
        return json.dumps(_FULL)

    async def write_fn(profile):
        writes.append(profile["houseguestId"])
        return {"accepted": True}

    n = _run(A.author_cast(cast, llm_fn, write_fn))
    assert n == 2
    assert writes == ["npc:1", "npc:3"]


def test_l28b_author_cast_does_not_count_a_refused_write():
    cast = [{"id": "npc:1", "name": "A"}]

    async def llm_fn(messages):
        return json.dumps(_FULL)

    async def write_fn(profile):
        return {"accepted": False, "reason": "mirrors the player"}  # the engine refused (the wall held)

    n = _run(A.author_cast(cast, llm_fn, write_fn))
    assert n == 0


def test_l28b_author_cast_skips_an_npc_the_model_could_not_author():
    cast = [{"id": "npc:1", "name": "A"}]

    async def llm_fn(messages):
        return "the model rambled and produced no JSON"

    async def write_fn(profile):  # pragma: no cover - must never be called
        raise AssertionError("must not write a profile that did not parse")

    n = _run(A.author_cast(cast, llm_fn, write_fn))
    assert n == 0


def test_l28b_engine_client_method_exists():
    # the FE engine client exposes the write-back seam the orchestrator forwards to
    from src import orwell_engine
    assert hasattr(orwell_engine, "record_cast_profile")
