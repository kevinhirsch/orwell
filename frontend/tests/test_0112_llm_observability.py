"""Feature 0112 — LLM-call observability (Vault-free trace tagging + opt-in forwarding).

The Definition of Done from ``docs/features/0112-llm-call-observability.md`` §Test strategy,
one test per item:

  1. Vault-free record       — the serialized record + request metadata carry no Vault key.
  2. Byte-identical when off — observability disabled ⇒ no request metadata, the no-op sink.
  3. Fail-soft               — a throwing/timing-out sink never fails or delays the turn.
  4. Correlation             — the record's beatSeq/phase equal the values threaded for the turn.
  5. Privacy mode + sampling — metrics-only omits content; full includes it; sampling is
                               deterministic by session; 0.0 emits nothing, 1.0 emits everything.
  6. Boundary                — the trace path imports no Vault store / vector index / soul provider.
  7. Divergence smoke        — a crafted record's model-vs-engine divergence is detectable from
                               its own fields (the F16 reach).

HARD: roles only, no names. Trace fields are engine ids + closed-set/projection facts only.

Async note: the coroutine-driving ``run`` fixture (conftest) is used instead of ``async def test``
— an ``asyncio``-auto test poisons the suite's shared event loop for later ``get_event_loop``
consumers (the established convention across the FE LLM tests).
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from src import llm_trace
from src import trace_sink
from src.token_policy import CALL_CLASSES


# ── settings harness (read per-request; patch the single get_setting seam) ──────────


def _patch_settings(monkeypatch, **overrides):
    """Patch ``src.settings.get_setting`` (the seam every observability resolver reads through)."""
    def fake_get_setting(key, default=None):
        return overrides.get(key, default)
    monkeypatch.setattr("src.settings.get_setting", fake_get_setting)


class _Capturing(trace_sink.TraceSink):
    def __init__(self):
        self.records = []

    async def emit(self, record):
        self.records.append(record)


# ── 1. Vault-free record across every call class ────────────────────────────────────


_VAULT_KEYS = ("soul", "trust", "threat", "affinity", "hidden", "target",
               "relationship", "grudge", "scheme", "confession")


def _obj_keys(obj):
    out = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            out.append(k)
            out.extend(_obj_keys(v))
    elif isinstance(obj, list):
        for v in obj:
            out.extend(_obj_keys(v))
    return out


def _assert_no_vault_key(obj):
    blob = json.dumps(obj)
    # KEYS only — a value may legitimately mention an English word; the guarantee is that no
    # object KEY is a Vault/soul field (the record builder never reads the hidden layer).
    assert llm_trace.record_is_vault_free(obj), f"record carries a Vault key: {blob}"
    for k in _obj_keys(obj):
        kl = k.lower()
        assert not any(vk in kl for vk in _VAULT_KEYS), f"Vault key present: {k}"


def test_trace_record_is_vault_free_across_every_call_class():
    for call_class in CALL_CLASSES:
        record = llm_trace.build_trace_record(
            user="user-1", session="sess-abc", call_class=call_class, model="a-model",
            beat_seq=42, phase="veto-competition", moment="veto-ceremony",
            usage={"input_tokens": 100, "output_tokens": 20, "reasoning_tokens": 5,
                   "cached_tokens": 10, "cost": 0.001, "provider": "openrouter"},
            applied_max_tokens=4096, finish_reason="stop", tool_call_seen=True,
            latency_ms=1234, status="ok", privacy_mode="metrics-only")
        # The record carries ONLY closed-set/projection facts.
        assert set(record.keys()) == {
            "ts", "user", "session", "call_class", "model", "beatSeq", "phase", "moment",
            "input_tokens", "cached_tokens", "output_tokens", "reasoning_tokens",
            "applied_max_tokens", "cost", "finish_reason", "tool_call_seen", "latency_ms", "status",
        }
        _assert_no_vault_key(record)
        # correlation + ledger facts survive
        assert record["beatSeq"] == 42
        assert record["phase"] == "veto-competition"
        assert record["call_class"] == call_class
        assert record["applied_max_tokens"] == 4096
        assert record["tool_call_seen"] is True


def test_full_mode_content_is_still_key_vault_free():
    # Even a completion whose PROSE mentions a hidden-layer word carries no Vault KEY.
    record = llm_trace.build_trace_record(
        session="s", model="m",
        usage={"input_tokens": 1, "output_tokens": 1},
        privacy_mode="full",
        prompt="the nominee weighs their options",
        completion="a houseguest speaks of trust and threat and a scheme")
    assert "prompt" in record and "completion" in record
    _assert_no_vault_key(record)


def test_request_metadata_is_vault_free():
    md = llm_trace.request_metadata(session="s", beat_seq=7, phase="nominations",
                                    call_class="narration")
    assert set(md.keys()) == {"orwell_session", "beatSeq", "phase", "call_class"}
    _assert_no_vault_key(md)


# ── 2. Byte-identical (no metadata) when observability is absent ────────────────────


def test_metadata_absent_when_disabled(monkeypatch):
    _patch_settings(monkeypatch, observability_enabled=False)
    assert llm_trace.maybe_request_metadata(session="s", call_class="narration") is None


def test_metadata_present_when_enabled(monkeypatch):
    _patch_settings(monkeypatch, observability_enabled=True)
    md = llm_trace.maybe_request_metadata(session="s", call_class="narration")
    assert md is not None
    assert md["orwell_session"] == "s"
    assert md["call_class"] == "narration"


def test_sink_is_noop_by_default(monkeypatch):
    _patch_settings(monkeypatch, observability_enabled=False)
    sink = trace_sink.resolve_trace_sink()
    assert isinstance(sink, trace_sink.NoopTraceSink)


def test_sink_is_noop_when_enabled_but_no_endpoint(monkeypatch):
    _patch_settings(monkeypatch, observability_enabled=True, observability_endpoint="")
    sink = trace_sink.resolve_trace_sink()
    assert isinstance(sink, trace_sink.NoopTraceSink)


def test_sink_is_otlp_when_enabled_with_endpoint(monkeypatch):
    _patch_settings(monkeypatch, observability_enabled=True,
                    observability_endpoint="https://sink.example/ingest")
    sink = trace_sink.resolve_trace_sink()
    assert isinstance(sink, trace_sink.OtlpTraceSink)
    assert sink.endpoint == "https://sink.example/ingest"


def test_disabled_emit_ships_nothing(run, monkeypatch):
    _patch_settings(monkeypatch, observability_enabled=False)
    cap = _Capturing()
    monkeypatch.setattr("src.trace_sink.resolve_trace_sink", lambda settings=None: cap)
    run(llm_trace.emit_trace(session="s", model="m", usage={"output_tokens": 1}))
    assert cap.records == []  # disabled ⇒ nothing built or shipped


# ── 3. A failing sink never harms the turn ──────────────────────────────────────────


def test_failing_sink_never_raises(run, monkeypatch):
    _patch_settings(monkeypatch, observability_enabled=True, observability_sampling=1.0,
                    observability_privacy_mode="metrics-only")

    class _Boom(trace_sink.TraceSink):
        async def emit(self, record):
            raise RuntimeError("sink is down")

    monkeypatch.setattr("src.trace_sink.resolve_trace_sink", lambda settings=None: _Boom())
    # Must complete normally — no exception propagates.
    result = run(llm_trace.emit_trace(session="s", model="m", usage={"output_tokens": 1}))
    assert result is None


def test_timing_out_sink_never_breaks_the_turn(run, monkeypatch):
    _patch_settings(monkeypatch, observability_enabled=True, observability_sampling=1.0)

    class _Hang(trace_sink.TraceSink):
        async def emit(self, record):
            raise asyncio.TimeoutError()

    monkeypatch.setattr("src.trace_sink.resolve_trace_sink", lambda settings=None: _Hang())
    assert run(llm_trace.emit_trace(session="s", model="m")) is None


# ── 4. Correlation to the engine beat (ties to 0065) ────────────────────────────────


def test_emitted_record_correlates_beatseq_and_phase(run, monkeypatch):
    _patch_settings(monkeypatch, observability_enabled=True, observability_sampling=1.0,
                    observability_privacy_mode="metrics-only")
    cap = _Capturing()
    monkeypatch.setattr("src.trace_sink.resolve_trace_sink", lambda settings=None: cap)
    run(llm_trace.emit_trace(
        session="sess-1", model="m", beat_seq=99, phase="nominations",
        usage={"input_tokens": 5, "output_tokens": 2}))
    assert len(cap.records) == 1
    rec = cap.records[0]
    assert rec["beatSeq"] == 99
    assert rec["phase"] == "nominations"
    assert rec["session"] == "sess-1"


def test_correlation_keys_pulled_from_context(run, monkeypatch):
    _patch_settings(monkeypatch, observability_enabled=True, observability_sampling=1.0)
    cap = _Capturing()
    monkeypatch.setattr("src.trace_sink.resolve_trace_sink", lambda settings=None: cap)
    token = llm_trace.set_observability_context(
        session="ctx-sess", beat_seq=7, phase="veto-ceremony", call_class="narration")
    try:
        # No explicit beat_seq/phase — they must come from the per-turn context.
        run(llm_trace.emit_trace(model="m", usage={"output_tokens": 1}))
    finally:
        llm_trace.reset_observability_context(token)
    assert len(cap.records) == 1
    rec = cap.records[0]
    assert rec["beatSeq"] == 7
    assert rec["phase"] == "veto-ceremony"
    assert rec["call_class"] == "narration"


# ── 5. Privacy mode gates content; sampling is deterministic by session ─────────────


def test_metrics_only_omits_content(run, monkeypatch):
    _patch_settings(monkeypatch, observability_enabled=True, observability_sampling=1.0,
                    observability_privacy_mode="metrics-only")
    cap = _Capturing()
    monkeypatch.setattr("src.trace_sink.resolve_trace_sink", lambda settings=None: cap)
    run(llm_trace.emit_trace(session="s", model="m", usage={"output_tokens": 1},
                             prompt="secret prompt", completion="secret completion"))
    rec = cap.records[0]
    assert "prompt" not in rec
    assert "completion" not in rec
    assert rec["output_tokens"] == 1  # metrics still flow


def test_full_mode_includes_content(run, monkeypatch):
    _patch_settings(monkeypatch, observability_enabled=True, observability_sampling=1.0,
                    observability_privacy_mode="full")
    cap = _Capturing()
    monkeypatch.setattr("src.trace_sink.resolve_trace_sink", lambda settings=None: cap)
    run(llm_trace.emit_trace(session="s", model="m", usage={"output_tokens": 1},
                             prompt="the prompt", completion="the completion"))
    rec = cap.records[0]
    assert rec["prompt"] == "the prompt"
    assert rec["completion"] == "the completion"


def test_full_mode_defaults_off():
    # The default privacy mode strips content — full is an explicit opt-in.
    rec = llm_trace.build_trace_record(session="s", model="m", usage={"output_tokens": 1},
                                       prompt="p", completion="c", privacy_mode=None)
    assert "prompt" not in rec and "completion" not in rec


def test_sampling_deterministic_by_session():
    # Rate 0.0 emits nothing; 1.0 emits everything; a mid rate is a deterministic fn of the id.
    assert llm_trace.session_sampled("any", 1.0) is True
    assert llm_trace.session_sampled("any", 0.0) is False
    a = llm_trace.session_sampled("sess-xyz", 0.5)
    b = llm_trace.session_sampled("sess-xyz", 0.5)
    assert a == b  # same session ⇒ same decision, always
    # different sessions are independently, deterministically decided; rate 0.5 splits the space
    decisions = {s: llm_trace.session_sampled(s, 0.5) for s in (f"s{i}" for i in range(50))}
    assert any(decisions.values()) and not all(decisions.values())


def test_sampling_zero_emits_nothing(run, monkeypatch):
    _patch_settings(monkeypatch, observability_enabled=True, observability_sampling=0.0)
    cap = _Capturing()
    monkeypatch.setattr("src.trace_sink.resolve_trace_sink", lambda settings=None: cap)
    run(llm_trace.emit_trace(session="s", model="m", usage={"output_tokens": 1}))
    assert cap.records == []


# ── 6. Boundary — the trace path imports no Vault store / vector index / soul provider ─


def test_trace_path_imports_no_vault_symbols():
    root = Path(__file__).resolve().parents[1] / "src"
    forbidden = ("VaultStore", "VectorIndex", "SoulProvider", "vault_store", "soul_provider")
    for name in ("llm_trace.py", "trace_sink.py"):
        text = (root / name).read_text(encoding="utf-8")
        for line in text.splitlines():
            stripped = line.strip()
            if stripped.startswith(("import ", "from ")):
                for sym in forbidden:
                    assert sym not in stripped, f"{name} imports a Vault symbol: {stripped}"


def test_observability_modules_expose_no_web_surface():
    # 0112 scenario: no player/admin surface exposes trace data or the sink config as game content.
    root = Path(__file__).resolve().parents[1] / "src"
    for name in ("llm_trace.py", "trace_sink.py"):
        text = (root / name).read_text(encoding="utf-8")
        assert "APIRouter" not in text, f"{name} must not register a web route"


# ── 7. Divergence smoke — expressible from the record alone (the F16 reach) ──────────


def test_divergence_detectable_from_record_fields():
    # A completion asserting an eviction while the engine phase is NOT an eviction phase.
    diverging = llm_trace.build_trace_record(
        session="s", model="m", phase="veto-competition",
        usage={"output_tokens": 1}, privacy_mode="full",
        completion="By a vote of 6 to 2, a houseguest has been evicted from the house.")
    assert llm_trace.record_shows_divergence(diverging) is True


def test_no_divergence_when_phase_matches():
    aligned = llm_trace.build_trace_record(
        session="s", model="m", phase="eviction",
        usage={"output_tokens": 1}, privacy_mode="full",
        completion="A houseguest has been evicted from the house.")
    assert llm_trace.record_shows_divergence(aligned) is False


def test_no_divergence_without_eviction_claim():
    plain = llm_trace.build_trace_record(
        session="s", model="m", phase="social",
        usage={"output_tokens": 1}, privacy_mode="full",
        completion="Two houseguests chat quietly in the kitchen.")
    assert llm_trace.record_shows_divergence(plain) is False
