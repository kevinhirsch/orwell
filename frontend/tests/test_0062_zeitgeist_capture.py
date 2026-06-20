"""Feature 0062 (FE lane) — the move-in zeitgeist capture: web_search → recordWorldSnapshot.

The capture replaces the engine's deterministic fallback ONCE per season with a real-world snapshot.
Per §9/§10 the orchestrator takes INJECTED deps (research/llm/write), so the whole lane is testable
with no live search, model, or engine. Flavor only — nothing here ever touches a game outcome.
"""
import asyncio
from datetime import datetime, timezone

from src import orwell_zeitgeist as Z


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


# ── parse_zeitgeist: tolerant JSON extraction ────────────────────────────────────

def test_parse_extracts_slices_from_json_with_surrounding_prose():
    text = (
        'Here is the zeitgeist:\n{"screen": ["a hit film", "a streaming show"], '
        '"music": ["a chart-topping song"], "sports": ["a championship"], '
        '"news": ["a headline"], "internet": ["a viral phrase"], "mood": "restless and online"} '
        "\nHope that helps!"
    )
    out = Z.parse_zeitgeist(text)
    assert out["screen"] == ["a hit film", "a streaming show"]
    assert out["music"] == ["a chart-topping song"]
    assert out["mood"] == "restless and online"


def test_parse_coerces_a_bare_string_slice_to_a_list_and_caps_items():
    text = '{"screen": "one film", "music": ["a", "b", "c", "d", "e"], "internet": []}'
    out = Z.parse_zeitgeist(text)
    assert out["screen"] == ["one film"]
    assert out["music"] == ["a", "b", "c"]  # capped to _MAX_ITEMS (3)
    assert "internet" not in out          # empty slice dropped


def test_parse_drops_unknown_keys_and_blank_items():
    text = '{"screen": ["  ", "real one"], "weather": ["sunny"], "mood": "  hopeful "}'
    out = Z.parse_zeitgeist(text)
    assert out["screen"] == ["real one"]
    assert "weather" not in out
    assert out["mood"] == "hopeful"


def test_parse_returns_empty_on_junk_or_mood_only():
    assert Z.parse_zeitgeist("no json here") == {}
    assert Z.parse_zeitgeist("") == {}
    # mood alone is too thin to replace the deterministic fallback.
    assert Z.parse_zeitgeist('{"mood": "tense"}') == {}


# ── captured_dates: the ~7-day move-in lag ───────────────────────────────────────

def test_captured_dates_apply_the_move_in_lag():
    now = datetime(2026, 6, 20, 12, 0, tzinfo=timezone.utc)
    label, at = Z.captured_dates(now)
    assert label == "June 13, 2026"     # 7 days before
    assert at == now.isoformat()        # provenance is the real capture time


# ── the synthesis prompt ─────────────────────────────────────────────────────────

def test_synthesis_prompt_frames_the_frozen_date_and_demands_json():
    msgs = Z._synthesis_messages("June 13, 2026", "## research\nstuff")
    system = msgs[0]["content"]
    assert "FROZEN as of June 13, 2026" in system
    assert "JSON" in system
    for key in ("screen", "music", "sports", "news", "internet", "mood"):
        assert key in system
    assert "stuff" in msgs[1]["content"]  # the research grounds the user turn


def test_synthesis_prompt_notes_when_no_search_was_available():
    msgs = Z._synthesis_messages("June 13, 2026", "")
    assert "No live search" in msgs[1]["content"]


# ── capture_zeitgeist orchestration (injected fakes) ─────────────────────────────

def _fakes(llm_text, research_text="## r\nlive results"):
    written = {}

    async def research_fn():
        return research_text

    async def llm_fn(messages):
        written["prompt_saw_research"] = research_text and research_text in messages[1]["content"]
        return llm_text

    async def write_fn(snapshot):
        written["snapshot"] = snapshot
        return {"accepted": True, "source": "web_search"}

    return research_fn, llm_fn, write_fn, written


_GOOD_JSON = '{"screen": ["a film"], "music": ["a song"], "sports": ["a final"], "news": ["a headline"], "internet": ["a meme"], "mood": "buzzy"}'


def test_capture_writes_back_the_synthesized_snapshot():
    research_fn, llm_fn, write_fn, written = _fakes(_GOOD_JSON)
    res = _run(Z.capture_zeitgeist(research_fn, llm_fn, write_fn,
                                   captured_for="June 13, 2026", captured_at="2026-06-20T12:00:00+00:00"))
    assert res == {"accepted": True, "source": "web_search"}
    snap = written["snapshot"]
    assert snap["capturedFor"] == "June 13, 2026"
    assert snap["capturedAt"] == "2026-06-20T12:00:00+00:00"
    assert snap["slices"]["screen"] == ["a film"]
    assert snap["slices"]["mood"] == "buzzy"
    assert written["prompt_saw_research"]  # the live research grounded the synthesis


def test_capture_falls_back_to_model_framed_when_search_unavailable():
    # research_fn returns "" (search disabled) → still synthesizes + writes (the §8 model-framed tier).
    research_fn, llm_fn, write_fn, written = _fakes(_GOOD_JSON, research_text="")
    res = _run(Z.capture_zeitgeist(research_fn, llm_fn, write_fn,
                                   captured_for="June 13, 2026", captured_at="x"))
    assert res["accepted"] is True
    assert "snapshot" in written


def test_capture_skips_write_when_synthesis_yields_no_slices():
    research_fn, llm_fn, write_fn, written = _fakes("the model rambled, no json")
    res = _run(Z.capture_zeitgeist(research_fn, llm_fn, write_fn, captured_for="d", captured_at="t"))
    assert res["accepted"] is False and res["reason"] == "no-slices"
    assert "snapshot" not in written  # nothing written ⇒ the deterministic fallback stands


def test_capture_is_graceful_when_the_model_fails():
    async def research_fn():
        return ""

    async def llm_fn(messages):
        raise RuntimeError("model down")

    calls = []

    async def write_fn(snapshot):
        calls.append(snapshot)
        return {"accepted": True}

    res = _run(Z.capture_zeitgeist(research_fn, llm_fn, write_fn, captured_for="d", captured_at="t"))
    assert res["accepted"] is False and res["reason"] == "llm-failed"
    assert calls == []  # never wrote ⇒ the fallback stands


def test_capture_is_graceful_when_research_raises():
    async def research_fn():
        raise RuntimeError("searx down")

    async def llm_fn(messages):
        return _GOOD_JSON

    async def write_fn(snapshot):
        return {"accepted": True, "source": "web_search"}

    # A research failure must NOT abort the capture — it falls through to model-framed synthesis.
    res = _run(Z.capture_zeitgeist(research_fn, llm_fn, write_fn, captured_for="d", captured_at="t"))
    assert res["accepted"] is True
