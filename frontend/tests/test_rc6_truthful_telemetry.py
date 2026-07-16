"""RC6 / Lane C — truthful telemetry (#1599 items 2–3 made concrete).

The failure ledger itself was failing soft: a judge TimeoutError was logged ok:true (12001ms,
empty text); a recordInteraction stale-drop showed staleRejections:0 next to a beatSeq gap of 46;
a search-provider outage / narrator 4xx / reasoning misroute were recorded nowhere; and the
guard-judge alarm conflated 14 auto-corrected slips with 1 real guard-down. These gates pin the
fixes:

  S6a — llmIo.ok means USABLE CONTENT (not HTTP 200); a 200-but-empty / timeout ⇒ ok:false + a
        machine-readable failClass (timeout | empty | 4xx | 5xx | error).
  S6b — every StaleBeatError (incl. recordInteraction) is counted, and an unaccounted beatSeq gap
        emits a RED-eligible `sync:dropped-fold` health event (the A-S3 latent, made visible).
  S6c — the enrichment/runtime failure recorder captures search-provider-down / narrator HTTP 4xx /
        reasoning-channel misroute into the admin-visible failure ledger + alarm-eligible.
  S6d — the guard-judge alarm splits an auto-corrected faith slip from a true guard-down; only a
        guard-down is counted as guard-judge-failure.

Roles only — every string is a generic probe.
"""

import asyncio
import importlib
import json
import os

import pytest


def _run_async(coro):
    return asyncio.get_event_loop().run_until_complete(coro)

llm_trace = importlib.import_module("src.llm_trace")
log_rings = importlib.import_module("src.log_rings")
ledger = importlib.import_module("src.orwell_sync_ledger")
enrichment_policy = importlib.import_module("src.enrichment_policy")
ahr = importlib.import_module("routes.admin_health_routes")


def _clear_rings():
    for ring in (log_rings.OVERSEER, log_rings.LLMIO, log_rings.IO, log_rings.LIVE):
        ring.buf.clear()


# ══ S6a — llmIo.ok must mean USABLE CONTENT, not HTTP 200 ═══════════════════════════════════════


@pytest.fixture
def _trace_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setattr(llm_trace, "enabled", lambda: True)
    return tmp_path


def _last_record(tmp_path):
    return json.loads(open(llm_trace.trace_path()).read().splitlines()[-1])


def test_empty_completion_marked_failed_with_failclass_empty(_trace_dir, monkeypatch):
    # A caller passed ok=True but the completion is empty with finish_reason=stop, no tool call:
    # a vanished turn, NOT a success. It must flip to ok:false with failClass=empty.
    llm_trace.record_llm_call(
        kind="stream", model="m", messages=[{"role": "user", "content": "x"}],
        response={"text": "", "finishReason": "stop"}, ok=True, duration_ms=800)
    rec = _last_record(_trace_dir)
    assert rec["ok"] is False, "a 200-but-empty completion is not a success"
    assert rec["failClass"] == "empty"


def test_slow_empty_completion_is_classed_timeout(_trace_dir):
    # The judge's TimeoutError case: ok:true logged with a 12001ms duration + empty text. A slow
    # empty completion reads as a timeout, not a fast empty.
    llm_trace.record_llm_call(
        kind="call", model="m", messages=[{"role": "user", "content": "x"}],
        response={"text": ""}, ok=True, duration_ms=12001)
    rec = _last_record(_trace_dir)
    assert rec["ok"] is False
    assert rec["failClass"] == "timeout"


def test_http_400_error_is_classed_4xx(_trace_dir):
    llm_trace.record_llm_call(
        kind="stream", model="m", messages=[{"role": "user", "content": "x"}],
        response={"text": "", "error": {"status": 400, "message": "Provider returned error"}},
        ok=False, duration_ms=50)
    rec = _last_record(_trace_dir)
    assert rec["ok"] is False and rec["failClass"] == "4xx"


def test_http_502_error_is_classed_5xx(_trace_dir):
    llm_trace.record_llm_call(
        kind="stream", model="m", messages=[{"role": "user", "content": "x"}],
        response={"text": "", "error": {"message": "OpenRouter returned HTTP 502"}},
        ok=False, duration_ms=50)
    rec = _last_record(_trace_dir)
    assert rec["failClass"] == "5xx"


def test_explicit_timeout_failclass_wins(_trace_dir):
    llm_trace.record_llm_call(
        kind="call", model="m", messages=[{"role": "user", "content": "x"}],
        response={"error": {"message": "boom"}}, ok=False, duration_ms=9000, fail_class="timeout")
    rec = _last_record(_trace_dir)
    assert rec["failClass"] == "timeout"


def test_usable_text_stays_ok_no_failclass(_trace_dir):
    llm_trace.record_llm_call(
        kind="stream", model="m", messages=[{"role": "user", "content": "x"}],
        response={"text": "the house stirs"}, ok=True, duration_ms=40)
    rec = _last_record(_trace_dir)
    assert rec["ok"] is True and rec["failClass"] is None


def test_tool_call_only_with_empty_text_stays_ok(_trace_dir):
    # An empty text body is legitimate when the turn is a tool call — must NOT be marked failed.
    llm_trace.record_llm_call(
        kind="stream", model="m", messages=[{"role": "user", "content": "x"}],
        response={"text": "", "toolCalls": [{"name": "advanceGame"}]}, ok=True, duration_ms=40)
    rec = _last_record(_trace_dir)
    assert rec["ok"] is True and rec["failClass"] is None


def test_length_cutoff_stays_ok(_trace_dir):
    # A length cutoff keeps whatever partial text it has; even empty-ish it is not the empty-stop bug.
    llm_trace.record_llm_call(
        kind="stream", model="m", messages=[{"role": "user", "content": "x"}],
        response={"text": "", "finishReason": "length"}, ok=True, duration_ms=40)
    rec = _last_record(_trace_dir)
    assert rec["failClass"] is None and rec["ok"] is True


def test_failclass_shows_in_ring_summary(_trace_dir):
    llm_trace.record_llm_call(
        kind="call", model="m7", messages=[{"role": "user", "content": "x"}],
        response={"text": ""}, ok=True, duration_ms=12001)
    _, lines = log_rings.LLMIO.since(0)
    last = [entry for entry in lines if "m7" in entry["msg"]][-1]
    assert "fail=timeout" in last["msg"]
    assert last["failClass"] == "timeout" and last["ok"] is False


# ══ S6b — count ALL StaleBeatErrors + a beat-continuity dropped-fold check ══════════════════════


@pytest.fixture
def _tmp_ledger(tmp_path, monkeypatch):
    monkeypatch.setattr(ledger, "LEDGER_PATH", tmp_path / "orwell_sync_ledger.json")
    ledger._PENDING_STALE.clear()
    ledger._LAST_BEAT_AFTER.clear()
    _clear_rings()
    yield
    ledger._PENDING_STALE.clear()
    ledger._LAST_BEAT_AFTER.clear()


def _dropped_fold_events():
    _, lines = log_rings.OVERSEER.since(0, limit=100000)
    return [e for e in lines if e.get("kind") == "sync:dropped-fold" and e.get("ok") is False]


def test_recordInteraction_stale_rejection_is_counted(_tmp_ledger):
    # A recordInteraction stale-drop used to show staleRejections:0. note_stale_rejection buffers it
    # and record_turn drains it into the turn's staleRejections.
    ledger.note_stale_rejection("player")
    ledger.record_turn("player", session="s", turn_id="t1", beat_seq_before=5, beat_seq_after=5)
    e = ledger.get_recent("player")[-1]
    assert e["staleRejections"] == 1, "the recordInteraction stale rejection must be counted"


def test_fold_bearing_drop_emits_red_dropped_fold(_tmp_ledger):
    ledger.note_stale_rejection("player", dropped_fold=True, beat_gap=46)
    events = _dropped_fold_events()
    assert events, "a fold-bearing stale-drop must emit a RED-eligible dropped-fold event"
    assert "46" in events[-1]["diagnosis"]


def test_unaccounted_beat_gap_emits_red_dropped_fold(_tmp_ledger):
    # Turn 1 ends at beatSeqAfter=10; turn 2 begins at beatSeqBefore=56 (gap 46) having counted no
    # stale rejections — the board moved 46 beats invisibly. That is a dropped fold.
    ledger.record_turn("player", session="s", turn_id="t1", beat_seq_before=10, beat_seq_after=10)
    ledger.record_turn("player", session="s", turn_id="t2", beat_seq_before=56, beat_seq_after=57)
    events = _dropped_fold_events()
    assert events, "an unaccounted beatSeq gap must emit a RED-eligible dropped-fold event"
    assert "46" in events[-1]["diagnosis"]


def test_continuous_beats_do_not_emit_dropped_fold(_tmp_ledger):
    # Normal single-window play: each turn picks up where the last left off. No gap, no alarm.
    ledger.record_turn("player", session="s", turn_id="t1", beat_seq_before=10, beat_seq_after=12)
    ledger.record_turn("player", session="s", turn_id="t2", beat_seq_before=12, beat_seq_after=14)
    assert _dropped_fold_events() == []


def test_zero_beat_turns_never_raise_a_phantom_gap(_tmp_ledger):
    # Untracked 0/0 turns (the inert-spine posture) must not seed or trip a false gap.
    ledger.record_turn("player", session="s", turn_id="t1")
    ledger.record_turn("player", session="s", turn_id="t2", beat_seq_before=50, beat_seq_after=51)
    assert _dropped_fold_events() == []


def test_dropped_fold_alarm_fires_at_threshold_one():
    rollup = {"guards": {"sync:dropped-fold": {"failed": 1, "autoCorrected": 0}},
              "llm": {}, "tools": {}}
    alarms = ahr._compute_alarms(rollup)
    codes = {a["code"] for a in alarms}
    assert "dropped-fold" in codes
    dropped = [a for a in alarms if a["code"] == "dropped-fold"][0]
    assert dropped["severity"] == "red" and dropped["count"] == 1


# ══ S6c — provider / runtime failure recorder ══════════════════════════════════════════════════


@pytest.fixture
def _clean_failures():
    enrichment_policy.clear_failures()
    _clear_rings()
    yield
    enrichment_policy.clear_failures()


def test_search_provider_down_lands_in_failure_ledger(_clean_failures):
    enrichment_policy.record_runtime_failure(
        "probe-user", "search-provider", "SearXNG search failed: [Errno 111] Connection refused")
    rows = enrichment_policy.failures("probe-user")
    assert rows, "a search-provider outage must land in the admin-visible failure ledger"
    assert rows[-1]["callClass"] == "search-provider"
    assert "Connection refused" in rows[-1]["reason"]


def test_provider_failure_is_alarm_eligible():
    rollup = {"guards": {"enrichment:search-provider": {"failed": 1, "autoCorrected": 0}},
              "llm": {}, "tools": {}}
    alarms = ahr._compute_alarms(rollup)
    codes = {a["code"] for a in alarms}
    assert "provider-failure" in codes
    # It must NOT be miscounted as a write-back storm.
    assert "writeback-storm" not in codes


def test_narrator_http_and_reasoning_misroute_recorded(_clean_failures):
    enrichment_policy.record_runtime_failure(
        "u", "narrator-http", "OpenRouter returned HTTP 400: Provider returned error")
    enrichment_policy.record_runtime_failure(
        "u", "reasoning-misroute", "model routed the whole turn to the reasoning channel")
    rows = enrichment_policy.failures("u")
    classes = {r["callClass"] for r in rows}
    assert {"narrator-http", "reasoning-misroute"} <= classes
    # Each also emitted a RED-eligible overseer anomaly.
    _, lines = log_rings.OVERSEER.since(0, limit=100000)
    kinds = {e.get("kind") for e in lines if e.get("ok") is False}
    assert {"enrichment:narrator-http", "enrichment:reasoning-misroute"} <= kinds


# ══ S6d — split an auto-corrected faith slip from a true guard-down ═════════════════════════════


def test_guard_alarm_counts_only_guard_downs_not_corrected_slips():
    # 14 detected-and-corrected faith SLIPS (the guard ran fine) + 1 real guard-DOWN (the judge
    # could not run). The old alarm conflated all 15; the split counts only the 1 guard-down.
    guards = {
        "faith:persona": {"failed": 14, "autoCorrected": 14},   # detected slips (guard ran)
        "faith:call-failed": {"failed": 1, "autoCorrected": 0},  # a true guard-down
    }
    alarms = ahr._compute_alarms({"guards": guards, "llm": {}, "tools": {}})
    guard = [a for a in alarms if a["code"] == "guard-judge-failure"]
    assert guard, "a real guard-down must still raise guard-judge-failure"
    assert guard[0]["count"] == 1, "only the true guard-down is counted, not the 14 corrected slips"


def test_only_corrected_slips_raise_no_guard_down_alarm():
    guards = {"faith:persona": {"failed": 5, "autoCorrected": 5}}
    alarms = ahr._compute_alarms({"guards": guards, "llm": {}, "tools": {}})
    codes = {a["code"] for a in alarms}
    assert "guard-judge-failure" not in codes, "corrected slips are not a guard-down"
    # They still surface RED under the auto-corrected alarm (a correction is not a cloak).
    assert "auto-corrected" in codes


def test_is_guard_down_classifier():
    assert ahr._is_guard_down_class("overseer:judge-call-failed")
    assert ahr._is_guard_down_class("faith:gate-error")
    assert ahr._is_guard_down_class("faith:call-failed")
    assert not ahr._is_guard_down_class("faith:persona")
    assert not ahr._is_guard_down_class("faith:leak")
    assert not ahr._is_guard_down_class("faith:omission")


# ══ RC6 review — a failure carries its TRUTHFUL machine-readable class (never a mislabel) ═════════

# Finding 1 — a search fault is `search-provider` ONLY when it is a confirmed transport/provider
# error; a local parsing/programming bug is `search-runtime` and must not raise a false provider alarm.
def test_search_transport_error_is_search_provider():
    zeit = importlib.import_module("src.orwell_zeitgeist")
    assert zeit._classify_search_error(ConnectionError("[Errno 111] Connection refused")) == "search-provider"
    assert zeit._classify_search_error(TimeoutError("read timed out")) == "search-provider"
    # A transport signature inside a generic exception still reads as a provider outage.
    assert zeit._classify_search_error(RuntimeError("SearXNG search failed: connection refused")) == "search-provider"


def test_search_local_bug_is_search_runtime_not_provider():
    zeit = importlib.import_module("src.orwell_zeitgeist")
    # A KeyError / ValueError / TypeError is a local parsing/programming bug — NOT a provider outage.
    assert zeit._classify_search_error(KeyError("results")) == "search-runtime"
    assert zeit._classify_search_error(ValueError("could not parse provider payload")) == "search-runtime"
    assert zeit._classify_search_error(TypeError("NoneType is not subscriptable")) == "search-runtime"


def test_zeitgeist_local_bug_records_search_runtime(_clean_failures, monkeypatch):
    zeit = importlib.import_module("src.orwell_zeitgeist")
    import src.search as _search

    def _bug(query, max_pages=2):
        raise ValueError("provider payload had no 'results' key")  # a local parse bug, not an outage

    monkeypatch.setattr(_search, "comprehensive_web_search", _bug, raising=False)
    monkeypatch.setattr("src.settings.get_setting", lambda k, d=None: "searxng")
    research_fn = _run_async(zeit._live_research_fn("probe-user"))
    _run_async(research_fn())
    rows = enrichment_policy.failures("probe-user")
    classes = [r["callClass"] for r in rows]
    assert "search-runtime" in classes, "a local search bug must record search-runtime"
    assert "search-provider" not in classes, "a local bug must NOT raise the false provider-outage class"


# Finding 2 — a narrator error is `narrator-http` ONLY with an actual HTTP status; a timeout /
# connection failure is `narrator-timeout`, any other non-HTTP stream fault `narrator-runtime`.
def test_narrator_error_classifier():
    al = importlib.import_module("src.agent_loop")
    # explicit HTTP status on the frame
    assert al._classify_narrator_stream_error("Provider returned error", {"status": 400}) == "narrator-http"
    # HTTP status embedded in the message
    assert al._classify_narrator_stream_error("OpenRouter returned HTTP 502") == "narrator-http"
    # timeout / connection failure carries NO http status
    assert al._classify_narrator_stream_error("upstream connection timed out") == "narrator-timeout"
    assert al._classify_narrator_stream_error("[Errno 111] Connection refused") == "narrator-timeout"
    # anything else non-HTTP
    assert al._classify_narrator_stream_error("stream decoder produced garbage") == "narrator-runtime"


# Finding 4 — note_stale_rejection threads a caller-supplied cause into the dropped-fold forensic
# (the hardcoded stale-409 cause was misleading at the non-stale drop sites); default stays back-compat.
def test_dropped_fold_cause_is_threaded(_tmp_ledger):
    ledger.note_stale_rejection("player", dropped_fold=True,
                                cause="deferred-fold queue overflow (retry capacity outrun)")
    events = _dropped_fold_events()
    assert events and "queue overflow" in events[-1]["diagnosis"]
    assert "stale-beat 409" not in events[-1]["diagnosis"], "the misleading default must be overridden"


def test_dropped_fold_default_cause_back_compat(_tmp_ledger):
    ledger.note_stale_rejection("player", dropped_fold=True)
    events = _dropped_fold_events()
    assert events and "stale-beat 409" in events[-1]["diagnosis"]


# Finding 5 — a durable-write failure must NOT lose the drained belts/stale nor corrupt the baseline.
def test_write_failure_restores_drained_counts_and_baseline(_tmp_ledger, monkeypatch):
    ledger.note_stale_rejection("player")           # buffer 1 stale
    ledger.note_belt_fire("player", "trust-belt")   # buffer 1 belt

    _orig_write = ledger.atomic_write_json

    def _boom(*a, **k):
        raise OSError("disk full")

    monkeypatch.setattr(ledger, "atomic_write_json", _boom)
    ledger.record_turn("player", session="s", turn_id="t1", beat_seq_before=5, beat_seq_after=6)
    # The write failed and was swallowed — but the drained counts went BACK into the buffers, and the
    # baseline was NOT advanced (a failed turn must not corrupt the next turn's gap comparison).
    assert ledger._PENDING_STALE.get("player") == 1, "a failed write must restore the drained stale count"
    assert ledger._PENDING_BELTS.get("player", {}).get("trust-belt") == 1, "and the drained belts"
    assert ledger._LAST_BEAT_AFTER.get("player") is None, "a failed write must not advance the beat baseline"

    # Now the write succeeds — the restored counts fold into THIS turn instead of vanishing. Restore
    # ONLY `atomic_write_json` (NOT monkeypatch.undo(), which would also drop `_tmp_ledger`'s
    # LEDGER_PATH override and send this second write to the DEFAULT ledger).
    monkeypatch.setattr(ledger, "atomic_write_json", _orig_write)
    ledger.record_turn("player", session="s", turn_id="t2", beat_seq_before=6, beat_seq_after=7)
    entry = ledger.get_recent("player")[-1]
    assert entry["staleRejections"] == 1, "the restored stale count must survive to the next turn"
    assert entry["beltsFired"].get("trust-belt") == 1, "the restored belt must survive too"
