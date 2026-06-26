"""#1002 — the LLM deep-profile cast authoring was silently no-op'ing (the whole cast fell back to the
thin deterministic floor). Strongest suspect: DeepSeek returns reasoning/prose instead of strict JSON,
so `_extract_json` finds nothing → `parse_authored_profile` returns None → `_author_one` returned 0
with NO log. These pin the fix:

  • the authoring call requests strict JSON (response_format) AND the system prompt demands a bare object;
  • a model that returns prose (no JSON) triggers ONE retry, then logs a DISTINCT "no JSON found" no-op
    (not a silent return);
  • a model that returns valid JSON authors the profile;
  • the per-season "authored N/total" counter logs (with the floor-fallback breakdown).

Roles only (no names as data). The injectable orchestrator makes the whole pipeline testable with a
stubbed model — but whether DeepSeek actually returns parseable JSON now can ONLY be confirmed live.
"""
import asyncio
import json

from src import orwell_cast_authoring as A


def _run(coro):
    # FE convention: drive on the existing loop (do NOT asyncio.run — it closes the main loop).
    return asyncio.get_event_loop().run_until_complete(coro)


class _LogSink:
    """Capture the module's loguru output deterministically (the full-suite stderr/caplog capture is
    unreliable for loguru — mirrors test_621_fepy_roundup). Falls back gracefully when the logger is the
    no-op stand-in (no `.add`), in which case the log assertions are skipped via `.available`."""

    def __init__(self, level="DEBUG"):
        self._level = level
        self._lines: list[str] = []
        self._id = None

    def __enter__(self):
        try:
            self._id = A.logger.add(lambda m: self._lines.append(str(m)), level=self._level)
        except Exception:
            self._id = None
        return self

    def __exit__(self, *a):
        if self._id is not None:
            try:
                A.logger.remove(self._id)
            except Exception:
                pass
        return False

    @property
    def available(self) -> bool:
        return self._id is not None

    @property
    def text(self) -> str:
        return "".join(self._lines)


_FULL = {
    "name": "Dana Reyes",
    "biography": "A blunt welder from Detroit who came up the hard way. Friends call her loyal to a fault.",
    "vocation": "welder",
    "physicalCharacteristics": {
        "heightBuild": "stocky and powerful", "skinTone": "warm tan complexion", "hair": "a close-cropped fade",
        "facialFeatures": "a square jaw", "distinguishingMark": "a wrist tattoo", "ageLook": "settled, thirties",
        "style": "sturdy workwear",
    },
    "secrets": ["is in real financial trouble", "recognized another houseguest from before"],
    "trueGoals": ["reach the end quietly", "build one secret final two"],
    "weakness": "is too loyal once committed",
}


# ── 1. the authoring call requests a JSON response_format + the strict-JSON prompt ──────────────────

def test_system_prompt_demands_a_single_raw_json_object():
    """The producer prompt reinforces (beyond 'JSON only') that the reply must be a single raw JSON
    object — no prose, no markdown, no fences — so even a provider that ignores response_format is
    pushed toward strict JSON."""
    msgs = A.build_authoring_messages({"id": "npc:1", "name": "Dana Reyes", "vocation": "welder"})
    system = msgs[0]["content"]
    low = system.lower()
    assert "single" in low and "raw json" in low
    assert "no prose" in low or "no markdown" in low
    assert "{" in system and "}" in system  # the explicit "first char '{' / last '}'" contract


def test_response_format_constant_is_a_json_object_request():
    assert A._RESPONSE_FORMAT == {"type": "json_object"}


def test_authoring_call_threads_response_format_onto_the_payload(monkeypatch):
    """The live `_fn` (resolved utility model) must put a JSON-mode `response_format` request onto the
    wire so a model that honours it can't leak prose/reasoning into the body. We capture the payload
    that reaches the OpenAI-style chat endpoint and assert response_format is present."""
    from src import llm_core as lc

    OR_URL = "https://openrouter.ai/api/v1/chat/completions"

    class _FakeResp:
        status_code = 200

        async def aiter_lines(self):
            for ln in ['data: {"choices":[{"delta":{"content":"{}"}}]}', "data: [DONE]"]:
                yield ln

        async def aread(self):
            return b""

    class _FakeStreamCM:
        def __init__(self, captured, payload):
            captured["payload"] = payload

        async def __aenter__(self):
            return _FakeResp()

        async def __aexit__(self, *a):
            return False

    class _FakeClient:
        def __init__(self, captured):
            self._captured = captured

        def stream(self, method, url, json=None, headers=None, timeout=None):
            return _FakeStreamCM(self._captured, json)

    captured: dict = {}
    monkeypatch.setattr(lc, "_get_http_client", lambda: _FakeClient(captured))
    monkeypatch.setattr(lc, "_is_host_dead", lambda u: False)
    monkeypatch.setattr(lc, "note_model_activity", lambda *a, **k: None)
    monkeypatch.setattr(lc, "_clear_host_dead", lambda *a, **k: None)

    # Resolve the live `_fn` against a real chat endpoint (stub the resolver internals).
    monkeypatch.setattr(A, "_resolve_llm_fn", A._resolve_llm_fn)  # use the real resolver

    import src.endpoint_resolver as er
    monkeypatch.setattr(er, "resolve_endpoint",
                        lambda prefix, owner=None: (OR_URL, "deepseek/deepseek-v4-pro", {}))
    monkeypatch.setattr(er, "resolve_utility_fallback_candidates", lambda owner=None: [])

    fn = _run(A._resolve_llm_fn("u"))
    assert fn is not None
    _run(fn([{"role": "user", "content": "author this houseguest"}]))

    payload = captured.get("payload") or {}
    assert payload.get("response_format") == {"type": "json_object"}, payload


# ── 2 & 3. a prose reply triggers ONE retry, then logs a DISTINCT "no JSON found" no-op ─────────────

def test_prose_reply_triggers_one_retry_then_logs_no_json_no_op():
    """A model that returns prose (no JSON) on BOTH the first call and the retry must: call the model
    exactly TWICE (one bounded retry), author nothing, and log the DISTINCT 'no JSON found' no-op —
    never a silent return."""
    calls = {"n": 0}

    async def llm_fn(messages):
        calls["n"] += 1
        return "Sure! Let me think about this houseguest... they seem complex and interesting."

    async def write_fn(profile):  # pragma: no cover - must never be called
        raise AssertionError("must not write when nothing parsed")

    with _LogSink() as sink:
        n = _run(A.author_cast([{"id": "npc:1", "name": "A"}], llm_fn, write_fn))

    assert n == 0
    assert calls["n"] == 2, "expected exactly one retry (two model calls total)"
    if sink.available:
        text = sink.text.lower()
        assert "no json found" in text, "the no-JSON no-op must be logged distinctly"
        # the DISTINCT cause: 'no JSON found' (not the below-floor message)
        assert "below the quality floor" not in text


def test_retry_recovers_when_the_second_reply_is_valid_json():
    """The one-shot retry actually recovers: prose first, valid JSON on the retry ⇒ the profile is
    authored (two calls, one write)."""
    calls = {"n": 0}
    writes = []

    async def llm_fn(messages):
        calls["n"] += 1
        if calls["n"] == 1:
            return "Here are my thoughts, no JSON yet."
        return json.dumps(_FULL)

    async def write_fn(profile):
        writes.append(profile["houseguestId"])
        return {"accepted": True}

    n = _run(A.author_cast([{"id": "npc:1", "name": "A"}], llm_fn, write_fn))
    assert n == 1
    assert calls["n"] == 2
    assert writes == ["npc:1"]


def test_below_floor_json_logs_the_distinct_below_floor_no_op():
    """JSON parsed but every field below the quality floor (so nothing usable to write) must log the
    DISTINCT 'below the quality floor' no-op — and must NOT retry (there WAS JSON)."""
    calls = {"n": 0}

    async def llm_fn(messages):
        calls["n"] += 1
        # valid JSON, but every field is degraded → parse_authored_profile yields None
        return json.dumps({"biography": "Short.", "secrets": ["x"], "weakness": "loyal"})

    async def write_fn(profile):  # pragma: no cover
        raise AssertionError("nothing usable should reach the write")

    with _LogSink() as sink:
        n = _run(A.author_cast([{"id": "npc:1", "name": "A"}], llm_fn, write_fn))

    assert n == 0
    assert calls["n"] == 1, "JSON was present — must NOT retry"
    if sink.available:
        text = sink.text.lower()
        assert "below the quality floor" in text
        assert "no json found" not in text


# ── valid JSON authors the profile (the happy path still works) ─────────────────────────────────────

def test_valid_json_authors_the_profile_with_no_retry():
    calls = {"n": 0}
    writes = []

    async def llm_fn(messages):
        calls["n"] += 1
        return json.dumps(_FULL)

    async def write_fn(profile):
        writes.append(profile["houseguestId"])
        return {"accepted": True}

    n = _run(A.author_cast([{"id": "npc:1", "name": "A"}], llm_fn, write_fn))
    assert n == 1
    assert calls["n"] == 1, "valid first reply must not retry"
    assert writes == ["npc:1"]


# ── 4. the per-season "authored N/total" counter ────────────────────────────────────────────────────

def test_per_season_counter_logs_authored_over_total_with_floor_breakdown():
    """The end-of-run diagnostic counter logs 'authored N/total houseguests' with the floor-fallback
    breakdown — the headline 'did the LLM enrich the cast or fall back to the floor?' line that makes a
    mass no-op diagnosable. Cast: 1 authored, 1 no-JSON (after retry), 1 below-floor, plus the player
    (skipped, never counted in total)."""
    async def llm_fn(messages):
        body = messages[1]["content"]
        if "GOOD" in body:
            return json.dumps(_FULL)
        if "BELOW" in body:
            return json.dumps({"biography": "Short.", "weakness": "x"})
        # PROSE houseguest: never any JSON (first call + retry)
        return "just rambling, no object here"

    async def write_fn(profile):
        return {"accepted": True}

    cast = [
        {"id": "player", "name": "P"},
        {"id": "npc:1", "name": "GOOD"},
        {"id": "npc:2", "name": "PROSE"},
        {"id": "npc:3", "name": "BELOW"},
    ]
    with _LogSink() as sink:
        n = _run(A.author_cast(cast, llm_fn, write_fn))

    assert n == 1
    if sink.available:
        text = sink.text
        # total counts the 3 NPCs (the player is skipped), authored = 1, floor fallback = 2
        assert "authored 1/3 houseguests" in text
        assert "floor fallback for 2" in text
        # the breakdown distinguishes the two no-op causes
        assert "1 no-JSON" in text
        assert "1 below-floor" in text
