"""RC6 / Lane C follow-up — the truthful-telemetry recorders are REACHED IN PRODUCTION.

The RC6 gates (test_rc6_truthful_telemetry.py) pin the recorders' behaviour by calling them
DIRECTLY. Adversarial verify then found the recorders had ZERO production callers — defined,
unit-tested, and dead: `record_runtime_failure` (enrichment_policy) and the dropped-fold path of
`note_stale_rejection` (orwell_sync_ledger) were never invoked from a real failure site, so the
live failures they were meant to make loud still failed SILENTLY.

These gates drive the ACTUAL production failure paths and assert the loud ledger + RED-eligible
health event reflect them — i.e. each recorder is genuinely reached:

  * search-provider outage  → orwell_zeitgeist._live_research_fn's live web-search loop
  * narrator HTTP 4xx       → agent_loop's mid-stream `data.error` handler on a narration turn
  * reasoning-channel misroute → orwell_cast_authoring.author_cast's empty-visible-body floor
  * dropped consequence fold → chat_helpers' deferred-fold overflow + non-stale drain drops
  * beat-continuity gate     → a legitimate cross-window advance does NOT false-positive

Roles only — every probe string is generic.
"""

import asyncio
import importlib
import json

import pytest

enrichment_policy = importlib.import_module("src.enrichment_policy")
log_rings = importlib.import_module("src.log_rings")
ledger = importlib.import_module("src.orwell_sync_ledger")


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _clear_rings():
    for ring in (log_rings.OVERSEER, log_rings.LLMIO, log_rings.IO, log_rings.LIVE):
        ring.buf.clear()


def _overseer_kinds_failed():
    _, lines = log_rings.OVERSEER.since(0, limit=100000)
    return {e.get("kind") for e in lines if e.get("ok") is False}


def _dropped_fold_events():
    _, lines = log_rings.OVERSEER.since(0, limit=100000)
    return [e for e in lines if e.get("kind") == "sync:dropped-fold" and e.get("ok") is False]


@pytest.fixture
def _clean_ledger():
    enrichment_policy.clear_failures()
    _clear_rings()
    yield
    enrichment_policy.clear_failures()


# ══ S6c reached — search-provider outage via the live zeitgeist research loop ════════════════════


def test_search_provider_outage_reached_via_zeitgeist_run(_clean_ledger, monkeypatch):
    zeit = importlib.import_module("src.orwell_zeitgeist")
    # A live web-search provider that is DOWN — every query raises Connection refused.
    import src.search as _search

    def _boom(query, max_pages=2):
        raise ConnectionError("[Errno 111] Connection refused")

    monkeypatch.setattr(_search, "comprehensive_web_search", _boom, raising=False)
    monkeypatch.setattr("src.settings.get_setting", lambda k, d=None: "searxng")

    research_fn = _run(zeit._live_research_fn("probe-user"))
    out = _run(research_fn())
    assert out == ""  # the outage yields no research text — the lane falls to model-framed synthesis

    rows = enrichment_policy.failures("probe-user")
    assert rows, "a live search-provider outage must land in the admin-visible failure ledger"
    assert rows[-1]["callClass"] == "search-provider"
    # Recorded ONCE per run, not once per query (a down provider fails every query in the set).
    assert sum(1 for r in rows if r["callClass"] == "search-provider") == 1
    assert "enrichment:search-provider" in _overseer_kinds_failed()


# ══ S6c reached — narrator HTTP 4xx via the agent loop's mid-stream error handler ════════════════


def _drive_agent_loop_midstream_400(monkeypatch, *, game_mode, owner="P"):
    """Drive the REAL stream_agent_loop where the narrator stream emits a mid-stream provider 400
    (the in-band `data: {error, status}` shape — the exact path the narrator-http recorder wires)."""
    from src import agent_loop as al
    import src.tool_index as ti
    import src.orwell_engine as oe
    import src.tool_implementations as timpl

    monkeypatch.delenv("ORWELL_GAME_BUILD", raising=False)
    monkeypatch.setattr(al, "get_setting", lambda key, default=None: default)
    monkeypatch.setattr(ti, "get_tool_index", lambda: None)
    monkeypatch.setattr(al, "_player_turn_is_lull", lambda messages: True)

    async def fake_state(user=None):
        return {"started": False, "moment": "character-creation",
                "casting": {"ready": True, "finalizable": True,
                            "known": {"playerName": "P", "backstory": "x", "motivation": "y",
                                      "personaArchetype": "z"},
                            "missing": [], "next": None}}
    monkeypatch.setattr(oe, "get_game_state", fake_state)

    async def _empty_extract(*a, **k):
        return ""
    monkeypatch.setattr("src.llm_core.llm_call_async", _empty_extract)

    async def _noop_update(fields, user=None):
        return {}
    monkeypatch.setattr(oe, "update_casting", _noop_update)

    async def _force_spy(content, owner=None):
        return {"output": json.dumps({"started": True}), "exit_code": 0}
    monkeypatch.setattr(timpl, "do_create_character", _force_spy)

    async def fake_stream(candidates, messages, **kwargs):
        yield 'data: ' + json.dumps({
            "error": "OpenRouter returned HTTP 400: Provider returned error",
            "status": 400, "mid_stream": True}) + '\n\n'
        yield "data: [DONE]\n\n"
    monkeypatch.setattr(al, "stream_llm_with_fallback", fake_stream)

    al._CASTING_STALL_LEVEL.pop(owner, None)
    al._CASTING_SUBSTANCE_LEVEL.pop(owner, None)

    async def drive():
        gen = al.stream_agent_loop(
            "https://openrouter.ai/api/v1/chat/completions", "deepseek/deepseek-v4-pro",
            [{"role": "system", "content": "You are the casting producer."},
             {"role": "user", "content": "lock it in"}],
            owner=owner, game_mode=game_mode, max_rounds=2)
        async for _chunk in gen:
            pass
    _run(drive())


def test_narrator_http_reached_via_agent_loop(_clean_ledger, monkeypatch):
    _drive_agent_loop_midstream_400(monkeypatch, game_mode="casting", owner="P")
    rows = enrichment_policy.failures("P")
    classes = {r["callClass"] for r in rows}
    assert "narrator-http" in classes, (
        "a mid-stream narrator provider 400 that ended the round with no reply must reach the "
        "runtime failure ledger (it was previously swallowed to a typed error SSE + ERROR log only)")
    assert "enrichment:narrator-http" in _overseer_kinds_failed()


def test_narrator_http_not_recorded_off_game_turns(_clean_ledger, monkeypatch):
    # A plain workspace (non-game) turn's provider error is NOT an enrichment-surface fault — the
    # recorder is game/casting-scoped so a general chat 400 never pollutes the enrichment ledger.
    _drive_agent_loop_midstream_400(monkeypatch, game_mode=False, owner="P")
    classes = {r["callClass"] for r in enrichment_policy.failures("P")}
    assert "narrator-http" not in classes


# ══ S6c reached — reasoning-channel misroute via cast authoring's empty-visible-body floor ═══════


def test_reasoning_misroute_reached_via_author_cast(_clean_ledger, monkeypatch):
    ca = importlib.import_module("src.orwell_cast_authoring")

    async def _empty_llm(_messages):
        return ""  # the model routed everything to the reasoning channel — empty visible body

    async def _write(_profile):
        return {"accepted": True}

    cast = [{"id": "player"}, {"id": "npc:1"}, {"id": "npc:2"}]
    written = _run(ca.author_cast(cast, _empty_llm, _write, user="probe-user"))
    assert written == 0, "an empty visible body authors nothing — the seeded floor stands"

    rows = enrichment_policy.failures("probe-user")
    classes = {r["callClass"] for r in rows}
    assert "reasoning-misroute" in classes, (
        "an empty visible body after the retry ladder is the reasoning-channel misroute and must "
        "reach the runtime failure ledger as its own alarm-eligible class")
    assert "enrichment:reasoning-misroute" in _overseer_kinds_failed()


def test_authoring_call_exception_is_not_a_reasoning_misroute(_clean_ledger):
    # RC6 review (finding 3): `_call_with_retries` returned an empty-string sentinel on BOTH a genuine
    # empty-visible completion AND a raised timeout/HTTP/network error. A RAISED provider call is NOT a
    # reasoning-channel misroute — it must record the truthful provider-call class, never `reasoning-misroute`.
    ca = importlib.import_module("src.orwell_cast_authoring")

    async def _raising_llm(_messages):
        raise TimeoutError("upstream provider timed out")  # the call never returned a completion body

    async def _write(_profile):
        return {"accepted": True}

    cast = [{"id": "player"}, {"id": "npc:1"}, {"id": "npc:2"}]
    written = _run(ca.author_cast(cast, _raising_llm, _write, user="probe-user"))
    assert written == 0, "a raised provider call authors nothing — the seeded floor stands"

    classes = {r["callClass"] for r in enrichment_policy.failures("probe-user")}
    assert "cast-authoring-call" in classes, (
        "a raised authoring provider call (timeout/HTTP/network) must record its OWN provider-call class")
    assert "reasoning-misroute" not in classes, (
        "the exception path must NOT be mislabeled a reasoning-channel misroute (that is empty-body only)")


# ══ S6b reached — a dropped consequence fold via the deferred-fold drop sites ════════════════════


@pytest.fixture
def _fresh_stale(monkeypatch, tmp_path):
    monkeypatch.setattr(ledger, "LEDGER_PATH", tmp_path / "orwell_sync_ledger.json")
    ledger._PENDING_STALE.clear()
    ledger._LAST_BEAT_AFTER.clear()
    _clear_rings()
    yield
    ledger._PENDING_STALE.clear()
    ledger._LAST_BEAT_AFTER.clear()


def test_deferred_fold_overflow_drop_reached(_fresh_stale):
    ch = importlib.import_module("routes.chat_helpers")
    ch._DEFERRED_FOLDS.pop(ch._beat_seq_key("P"), None)

    async def _fn(*a, **k):
        return {}

    # Fill the bounded queue, then push one more to force an overflow drop of the OLDEST fold.
    for _ in range(ch._DEFERRED_FOLDS_MAX + 1):
        ch._defer_fold("P", _fn, (), {}, desc="recordInteraction")

    events = _dropped_fold_events()
    assert events, "a deferred-fold queue overflow silently dropped a fold — it must now surface RED"
    # And the drop is now COUNTED (it used to show staleRejections:0): the buffer drains into the turn.
    ledger.record_turn("P", session="s", turn_id="t1", beat_seq_before=5, beat_seq_after=5)
    entry = ledger.get_recent("P")[-1]
    assert entry["staleRejections"] >= 1, "the dropped fold must be counted into staleRejections"
    ch._DEFERRED_FOLDS.pop(ch._beat_seq_key("P"), None)


def test_deferred_fold_nonstale_drain_drop_reached(_fresh_stale):
    ch = importlib.import_module("routes.chat_helpers")
    ch._DEFERRED_FOLDS.pop(ch._beat_seq_key("P"), None)

    async def _raises(*a, **k):
        raise RuntimeError("permanent non-stale failure")

    ch._defer_fold("P", _raises, (), {}, desc="recordInteraction")
    _run(ch._drain_deferred_folds("P"))

    events = _dropped_fold_events()
    assert events, "a deferred fold that dies on a non-stale error is lost for good — it must surface RED"
    ch._DEFERRED_FOLDS.pop(ch._beat_seq_key("P"), None)


# ══ S6b reached — the beat-continuity gate no longer false-positives on a cross-window advance ═══


def test_cross_window_advance_does_not_emit_false_dropped_fold(_fresh_stale):
    # Turn 1 ends at beatSeqAfter=10; turn 2 begins at beatSeqBefore=56 (gap 46) — but the FE
    # RECONCILED a concurrent multi-window advance this turn (desyncDetected=True). That is a normal
    # cross-window move, NOT a dropped fold on this session, so no RED event may fire.
    ledger.record_turn("P", session="s", turn_id="t1", beat_seq_before=10, beat_seq_after=10)
    ledger.record_turn("P", session="s", turn_id="t2", beat_seq_before=56, beat_seq_after=57,
                       desync_detected=True)
    assert _dropped_fold_events() == [], (
        "a reconciled cross-window advance (desyncDetected) must not raise a false dropped-fold")


def test_unaccounted_gap_without_reconcile_still_fires(_fresh_stale):
    # The genuine A-S3 latent: the board moved between turns with NO stale count AND NO desync
    # reconcile — a truly invisible drop on this session's own turn. It must still surface RED.
    ledger.record_turn("P", session="s", turn_id="t1", beat_seq_before=10, beat_seq_after=10)
    ledger.record_turn("P", session="s", turn_id="t2", beat_seq_before=56, beat_seq_after=57)
    events = _dropped_fold_events()
    assert events, "an unaccounted, unreconciled beatSeq gap must still surface RED"
    assert "46" in events[-1]["diagnosis"]
