"""#1057 — the LLM deep-profile cast authoring was authoring only 3/15 houseguests at season start under
a REAL-LLM live-verify (deepseek/deepseek-v4-pro). The green suites couldn't see it because they stub the
provider; the live log proved two concurrency-driven losses the existing retries didn't cover:

  • the 15-call authoring burst runs CONCURRENT with premiere narration on the SAME endpoint, so the
    provider returns an EMPTY or TRUNCATED (clipped mid-object) visible body — neither is the #1002
    "full body, no JSON" prose case, so that retry never fired and the call fell straight to the floor;
  • concurrent per-NPC recordCastProfile write-backs collide on the orchestrator integrity checkpoint
    ("integrity checkpoint failed (degradation)"), dropping good profiles.

These pin the FE-side fix (the engine / deterministic floor are unchanged):
  • an EMPTY or TRUNCATED visible body is RETRIED (reasoning still OFF, the roomy output floor), distinct
    from the #1002 no-JSON reparse;
  • lower concurrency (2) eases the provider pressure;
  • the engine write-back is SERIALIZED (single-flight) and a transient `degradation` refusal is retried;
  • the per-season counter logs every distinct fallback reason (empty / truncated / degradation) so the
    NEXT live-verify can read exactly where any residual loss is.

Roles only (no names as data). Whether deepseek ACTUALLY stops truncating under the burst can only be
confirmed live — these prove the FE is now robust to the shapes the live-verify observed.
"""
import asyncio
import json

from src import orwell_cast_authoring as A


def _run(coro):
    # Pristine loop per call (no inherited half-drained state), leaving a fresh OPEN loop installed
    # afterward so later get_event_loop() consumers never meet a closed loop (unlike bare asyncio.run).
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()
        asyncio.set_event_loop(asyncio.new_event_loop())


class _LogSink:
    """Capture the module's loguru output deterministically (mirrors test_1002)."""

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

# A truncated/clipped object: the provider streamed the opening brace + a couple of fields, then the
# stream was cut by finish_reason "length" before the closing brace (the live truncation shape).
_TRUNCATED = '{"name": "Dana Reyes", "biography": "A blunt welder from Detroit who came up the hard'


# ── the body classifier (the load-bearing distinction) ──────────────────────────────────────────────

def test_classify_visible_body_distinguishes_empty_truncated_no_json_and_ok():
    assert A._classify_visible_body(json.dumps(_FULL)) == "ok"
    assert A._classify_visible_body("") == "empty"
    assert A._classify_visible_body("   \n\t ") == "empty"
    # an unclosed top-level '{' ⇒ truncated (object clipped mid-stream)
    assert A._classify_visible_body(_TRUNCATED) == "truncated"
    # a non-empty, brace-balanced body with no parseable object ⇒ the #1002 prose case
    assert A._classify_visible_body("Sure, let me think about this houseguest. They seem complex.") == "no_json"


def test_unbalanced_open_brace_is_string_aware():
    # a brace inside a string literal must NOT count as an unclosed object
    assert A._has_unbalanced_open_brace('{"bio": "grew up {downtown}"}') is False
    assert A._has_unbalanced_open_brace('{"bio": "grew up') is True  # truly clipped mid-string
    assert A._has_unbalanced_open_brace("no braces here") is False


# ── 1. EMPTY visible body → retried then succeeds ───────────────────────────────────────────────────

def test_empty_body_is_retried_then_authors():
    """The provider returns an EMPTY body first (burst truncation), then a clean object on the retry —
    the profile is authored (two calls, one write). The old code fell straight to the floor."""
    calls = {"n": 0}
    writes = []

    async def llm_fn(messages):
        calls["n"] += 1
        if calls["n"] == 1:
            return ""  # empty visible body
        return json.dumps(_FULL)

    async def write_fn(profile):
        writes.append(profile["houseguestId"])
        return {"accepted": True}

    n = _run(A.author_cast([{"id": "npc:1", "name": "A"}], llm_fn, write_fn))
    assert n == 1
    assert calls["n"] == 2, "the empty body must be retried"
    assert writes == ["npc:1"]


# ── 2. TRUNCATED visible body → retried then succeeds ───────────────────────────────────────────────

def test_truncated_body_is_retried_then_authors():
    """A clipped/unbalanced object first, a complete object on the retry ⇒ authored."""
    calls = {"n": 0}
    writes = []

    async def llm_fn(messages):
        calls["n"] += 1
        if calls["n"] == 1:
            return _TRUNCATED  # clipped mid-object
        return json.dumps(_FULL)

    async def write_fn(profile):
        writes.append(profile["houseguestId"])
        return {"accepted": True}

    n = _run(A.author_cast([{"id": "npc:1", "name": "A"}], llm_fn, write_fn))
    assert n == 1
    assert calls["n"] == 2, "the truncated body must be retried"
    assert writes == ["npc:1"]


def test_persistently_empty_logs_the_distinct_empty_no_op():
    """An empty body on EVERY attempt: bounded retries (1 + _EMPTY_TRUNCATED_RETRIES calls), authors
    nothing, and logs the DISTINCT 'empty' no-op — never silently nor mis-classified as no-JSON."""
    calls = {"n": 0}

    async def llm_fn(messages):
        calls["n"] += 1
        return ""

    async def write_fn(profile):  # pragma: no cover - must never be called
        raise AssertionError("must not write when nothing parsed")

    with _LogSink() as sink:
        n = _run(A.author_cast([{"id": "npc:1", "name": "A"}], llm_fn, write_fn))

    assert n == 0
    assert calls["n"] == 1 + A._EMPTY_TRUNCATED_RETRIES, "expected bounded empty/truncated retries"
    if sink.available:
        text = sink.text.lower()
        assert "empty model reply" in text
        assert "no json found" not in text


def test_persistently_truncated_logs_the_distinct_truncated_no_op():
    calls = {"n": 0}

    async def llm_fn(messages):
        calls["n"] += 1
        return _TRUNCATED

    async def write_fn(profile):  # pragma: no cover
        raise AssertionError("must not write when nothing parsed")

    with _LogSink() as sink:
        n = _run(A.author_cast([{"id": "npc:1", "name": "A"}], llm_fn, write_fn))

    assert n == 0
    assert calls["n"] == 1 + A._EMPTY_TRUNCATED_RETRIES
    if sink.available:
        text = sink.text.lower()
        assert "truncated model reply" in text
        assert "no json found" not in text


# ── 3. write-back `degradation` refusal → retried & serialized, then succeeds ───────────────────────

def test_writeback_degradation_is_retried_then_accepts():
    """A transient `degradation` (orchestrator integrity-checkpoint collision) refusal is retried — the
    write-back is idempotent — and the second commit lands. The profile is authored, not dropped."""
    writes = {"n": 0}

    async def llm_fn(messages):
        return json.dumps(_FULL)

    async def write_fn(profile):
        writes["n"] += 1
        if writes["n"] == 1:
            return {"accepted": False, "reason": "integrity checkpoint failed (degradation)"}
        return {"accepted": True}

    n = _run(A.author_cast([{"id": "npc:1", "name": "A"}], llm_fn, write_fn))
    assert n == 1
    assert writes["n"] == 2, "the degradation refusal must be retried"


def test_persistent_degradation_logs_the_distinct_degradation_no_op():
    """A `degradation` on every commit attempt: authors nothing and logs the DISTINCT degradation no-op
    (the seeded floor stands). The per-season counter shows '1 degradation'."""
    async def llm_fn(messages):
        return json.dumps(_FULL)

    async def write_fn(profile):
        return {"accepted": False, "reason": "integrity checkpoint failed (degradation)"}

    with _LogSink() as sink:
        n = _run(A.author_cast([{"id": "npc:1", "name": "A"}], llm_fn, write_fn))

    assert n == 0
    if sink.available:
        text = sink.text.lower()
        assert "degrad" in text
        assert "1 degradation" in sink.text  # the counter breakdown


def test_raised_turn_refused_is_retried_then_accepts():
    """#1067: the engine maps `turn refused — integrity checkpoint failed (degradation)` to an HTTP 409,
    which the FE client surfaces as a RAISED exception (not a dict result). It must be classified +
    retried like a dict-degradation, and the idempotent retry lands."""
    writes = {"n": 0}

    async def llm_fn(messages):
        return json.dumps(_FULL)

    async def write_fn(profile):
        writes["n"] += 1
        if writes["n"] == 1:
            raise RuntimeError("turn refused — integrity checkpoint failed (degradation); state unchanged")
        return {"accepted": True}

    n = _run(A.author_cast([{"id": "npc:1", "name": "A"}], llm_fn, write_fn))
    assert n == 1
    assert writes["n"] == 2, "the RAISED degradation refusal must be retried"


def test_persistent_raised_turn_refused_is_counted_as_degradation():
    """#1067: a `turn refused (degradation)` RAISED on every attempt authors nothing AND is tallied as a
    degradation in the breakdown counter — the live-verify bug was that this raised-409 path reported
    '0 degradation' even though every lost NPC was a degradation refusal (it returned a bare None)."""
    async def llm_fn(messages):
        return json.dumps(_FULL)

    async def write_fn(profile):
        raise RuntimeError("turn refused — integrity checkpoint failed (degradation); state unchanged")

    with _LogSink() as sink:
        n = _run(A.author_cast([{"id": "npc:1", "name": "A"}], llm_fn, write_fn))

    assert n == 0
    if sink.available:
        assert "1 degradation" in sink.text  # the raised refusal is now counted, not reported as 0


def test_writeback_is_serialized_single_flight():
    """The write-back lock serializes commits: never two recordCastProfile commits in flight at once,
    even with several NPCs authored concurrently (the live-verify's collision source)."""
    state = {"in_flight": 0, "max_in_flight": 0}

    async def llm_fn(messages):
        return json.dumps(_FULL)

    async def write_fn(profile):
        state["in_flight"] += 1
        state["max_in_flight"] = max(state["max_in_flight"], state["in_flight"])
        await asyncio.sleep(0.01)  # hold the commit open so a collision would show
        state["in_flight"] -= 1
        return {"accepted": True}

    cast = [{"id": f"npc:{i}", "name": chr(65 + i)} for i in range(6)]
    n = _run(A.author_cast(cast, llm_fn, write_fn, concurrency=6))
    assert n == 6
    assert state["max_in_flight"] == 1, "write-backs must be serialized (single-flight)"


# ── 4. the per-season counter carries the full fallback-reason breakdown ────────────────────────────

def test_counter_logs_every_distinct_fallback_reason():
    """One NPC of each failure shape + one authored: the headline counter shows the FULL breakdown so a
    live-verify can read exactly where the loss is (empty / truncated / degradation / no-JSON / below)."""
    async def llm_fn(messages):
        body = messages[1]["content"]
        if "GOOD" in body:
            return json.dumps(_FULL)
        if "EMPTY" in body:
            return ""
        if "TRUNC" in body:
            return _TRUNCATED
        if "BELOW" in body:
            return json.dumps({"biography": "Short.", "weakness": "x"})
        if "DEGRADE" in body:
            return json.dumps(_FULL)  # authored fine, but the write-back will refuse
        # PROSE: a full body, never any JSON
        return "just rambling about this houseguest, no object here at all."

    async def write_fn(profile):
        # The DEGRADE houseguest's commit always refuses as a transient degradation.
        if "Detroit" in (profile.get("biography") or "") and profile.get("houseguestId") == "npc:degrade":
            return {"accepted": False, "reason": "integrity checkpoint failed (degradation)"}
        return {"accepted": True}

    cast = [
        {"id": "player", "name": "P"},
        {"id": "npc:1", "name": "GOOD"},
        {"id": "npc:2", "name": "EMPTY"},
        {"id": "npc:3", "name": "TRUNC"},
        {"id": "npc:4", "name": "PROSE"},
        {"id": "npc:5", "name": "BELOW"},
        {"id": "npc:degrade", "name": "DEGRADE"},
    ]
    with _LogSink() as sink:
        n = _run(A.author_cast(cast, llm_fn, write_fn))

    assert n == 1, "only the GOOD houseguest authors (DEGRADE refuses, the rest fall to the floor)"
    if sink.available:
        text = sink.text
        # total counts the 6 NPCs (the player is skipped); authored = 1, floor fallback = 5
        assert "authored 1/6 houseguests" in text
        assert "floor fallback for 5" in text
        # every distinct cause is visible in the breakdown
        assert "1 no-JSON" in text
        assert "1 empty" in text
        assert "1 truncated" in text
        assert "1 degradation" in text
        assert "1 below-floor" in text


# ── the chosen concurrency value (documented + lowered for the burst) ───────────────────────────────

def test_concurrency_lowered_to_ease_the_burst():
    """#1057: concurrency lowered 3 → 2 so the authoring burst stops tripping provider truncation. (A
    pin so a future bump is a deliberate, reviewed change, not an accident.)"""
    assert A._AUTHOR_CONCURRENCY == 2
    assert A._EMPTY_TRUNCATED_RETRIES >= 1


# ── back-compat: the #1002 prose reparse path is untouched ──────────────────────────────────────────

def test_prose_reply_still_triggers_the_no_json_reparse_then_logs_no_json():
    """The #1002 'full body, no JSON' prose path is unchanged: exactly ONE strict-JSON reparse, then the
    distinct 'no JSON found' no-op (NOT the new empty/truncated retries — a full prose body is neither)."""
    calls = {"n": 0}

    async def llm_fn(messages):
        calls["n"] += 1
        return "Sure! This houseguest seems complex and interesting, lots to unpack here."

    async def write_fn(profile):  # pragma: no cover
        raise AssertionError("must not write when nothing parsed")

    with _LogSink() as sink:
        n = _run(A.author_cast([{"id": "npc:1", "name": "A"}], llm_fn, write_fn))

    assert n == 0
    assert calls["n"] == 2, "prose body ⇒ exactly one reparse retry (no empty/truncated retries)"
    if sink.available:
        text = sink.text.lower()
        assert "no json found" in text
        assert "empty model reply" not in text
        assert "truncated model reply" not in text
