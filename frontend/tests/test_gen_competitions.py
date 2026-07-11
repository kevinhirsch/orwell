"""Feature #1400 (FE lane) — generative competition design: the model DRESSES the engine's fixed roll.

The FE reads the staging view (the engine's ALREADY-FIXED winner + drop order), authors a theme +
per-round fiction, and writes it back — where the engine RE-VALIDATES against the fixed drop order and
REJECTS any mismatch (the 0042 floor then stands). Per the write-back pattern the orchestrator takes
INJECTED deps (staging/llm/write), so the whole lane is testable with no live model or engine. HARD
rule: roles only — no cast names.
"""
import asyncio

from src import orwell_gen_competitions as G


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


# A resolved staged HOH: the winner outlasts three losers, in a FIXED drop order. Roles only, no names.
_STAGING = {
    "comp": "hoh-competition", "type": "endurance", "week": 2, "format": "endurance",
    "participants": [
        {"id": "player", "name": "the winner"},
        {"id": "hg-1", "name": "first out"},
        {"id": "hg-2", "name": "second out"},
        {"id": "hg-3", "name": "runner up"},
    ],
    "winner": {"id": "player", "name": "the winner"},
    "dropOrder": [
        {"id": "hg-1", "name": "first out"},
        {"id": "hg-2", "name": "second out"},
        {"id": "hg-3", "name": "runner up"},
    ],
    "library": {"name": "Hold the Wall", "premise": "grip a ledge over the yard", "beats": [], "winReads": "attrition"},
}

_GOOD_JSON = (
    '{"theme":"The Gauntlet of Whispers","premise":"Houseguests balance on a deck of secrets.",'
    '"winReads":"pure nerve","drops":{"first out":"loses their grip first",'
    '"second out":"slips on a lie","runner up":"falls at the final gust"}}'
)


# ── the synthesis prompt ─────────────────────────────────────────────────────────

def test_synthesis_prompt_fixes_the_order_and_demands_json():
    msgs = G._synthesis_messages(_STAGING)
    system = msgs[0]["content"]
    user = msgs[1]["content"]
    # The outcome is decided; the model must NOT reorder/rename and must return strict JSON.
    assert "ALREADY DECIDED" in system
    assert "do NOT reorder" in system.lower() or "do not reorder" in system.lower()
    assert "JSON" in system
    # The user turn hands the model the fixed drop order (earliest first) + the winner.
    assert "first out" in user and "second out" in user and "runner up" in user
    assert "the winner" in user
    # The ordered list is numbered in drop order.
    assert user.index("first out") < user.index("second out") < user.index("runner up")


# ── build_fiction: parse + map to the FIXED drop order ───────────────────────────

def test_build_fiction_maps_lines_to_the_fixed_drop_order_by_id():
    out = G.build_fiction(_STAGING, _GOOD_JSON)
    assert out is not None
    assert out["comp"] == "hoh-competition" and out["week"] == 2
    assert out["theme"] == "The Gauntlet of Whispers"
    # Every elimination keys to the ENGINE's id, in the fixed order — the safety property the engine re-checks.
    assert [e["id"] for e in out["eliminations"]] == ["hg-1", "hg-2", "hg-3"]
    assert out["eliminations"][0]["fiction"] == "loses their grip first"
    assert out["winReads"] == "pure nerve"


def test_build_fiction_matches_names_case_insensitively():
    text = (
        '{"theme":"t","premise":"p","drops":{"FIRST OUT":"a","Second Out":"b","runner up":"c"}}'
    )
    out = G.build_fiction(_STAGING, text)
    assert out is not None
    assert [e["fiction"] for e in out["eliminations"]] == ["a", "b", "c"]


def test_build_fiction_returns_none_on_incomplete_coverage():
    # A drop with no line ⇒ do not attempt a partial (doomed) write-back; the 0042 floor stands.
    text = '{"theme":"t","premise":"p","drops":{"first out":"a","second out":"b"}}'
    assert G.build_fiction(_STAGING, text) is None


def test_build_fiction_returns_none_without_theme_or_premise():
    assert G.build_fiction(_STAGING, '{"premise":"p","drops":{"first out":"a"}}') is None
    assert G.build_fiction(_STAGING, '{"theme":"t","drops":{"first out":"a"}}') is None


def test_build_fiction_returns_none_on_junk():
    assert G.build_fiction(_STAGING, "the model rambled, no json") is None
    assert G.build_fiction(_STAGING, "") is None


def test_build_fiction_clamps_overlong_text():
    long_line = "x" * 5000
    text = (
        '{"theme":"' + ("T" * 5000) + '","premise":"p",'
        '"drops":{"first out":"' + long_line + '","second out":"b","runner up":"c"}}'
    )
    out = G.build_fiction(_STAGING, text)
    assert out is not None
    assert len(out["theme"]) <= G._MAX_THEME
    assert len(out["eliminations"][0]["fiction"]) <= G._MAX_LINE


# ── author_competition orchestration (injected fakes) ────────────────────────────

def _fakes(llm_text, staging=_STAGING):
    written = {}

    async def staging_fn():
        return staging

    async def llm_fn(messages):
        written["called_llm"] = True
        return llm_text

    async def write_fn(fiction):
        written["fiction"] = fiction
        return {"accepted": True}

    return staging_fn, llm_fn, write_fn, written


def test_author_writes_back_the_built_fiction():
    staging_fn, llm_fn, write_fn, written = _fakes(_GOOD_JSON)
    res = _run(G.author_competition(staging_fn, llm_fn, write_fn))
    assert res == {"accepted": True}
    assert [e["id"] for e in written["fiction"]["eliminations"]] == ["hg-1", "hg-2", "hg-3"]


def test_author_skips_write_when_the_model_yields_no_usable_fiction():
    staging_fn, llm_fn, write_fn, written = _fakes("no json here")
    res = _run(G.author_competition(staging_fn, llm_fn, write_fn))
    assert res == {"accepted": False, "reason": "no-fiction"}
    assert "fiction" not in written  # nothing written ⇒ the deterministic 0042 floor stands


def test_author_is_a_noop_when_no_competition_is_staging():
    # staging_fn returns None (generation off, or no comp resolved) ⇒ no model is ever called, no write.
    called = {"llm": False}

    async def staging_fn():
        return None

    async def llm_fn(messages):
        called["llm"] = True
        return _GOOD_JSON

    async def write_fn(fiction):
        called["write"] = True
        return {"accepted": True}

    res = _run(G.author_competition(staging_fn, llm_fn, write_fn))
    assert res == {"accepted": False, "reason": "no-staging"}
    assert called["llm"] is False


def test_author_is_graceful_when_the_model_fails():
    async def staging_fn():
        return _STAGING

    async def llm_fn(messages):
        raise RuntimeError("model down")

    wrote = {"n": 0}

    async def write_fn(fiction):
        wrote["n"] += 1
        return {"accepted": True}

    res = _run(G.author_competition(staging_fn, llm_fn, write_fn))
    assert res == {"accepted": False, "reason": "llm-failed"}
    assert wrote["n"] == 0  # nothing written ⇒ the floor stands


def test_author_relays_an_engine_rejection_without_raising():
    # The engine rejected the fiction (e.g. a drop-order mismatch a buggy build produced) — relay it.
    async def staging_fn():
        return _STAGING

    async def llm_fn(messages):
        return _GOOD_JSON

    async def write_fn(fiction):
        return {"accepted": False, "reason": "drop-order-mismatch"}

    res = _run(G.author_competition(staging_fn, llm_fn, write_fn))
    assert res == {"accepted": False, "reason": "drop-order-mismatch"}
