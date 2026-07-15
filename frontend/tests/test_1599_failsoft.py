"""#1599 — no-silent-fail-soft: the shared recorder, the class-A site wiring, the per-class/-tool
health rollup (WI2), and the RED alarms (WI3).

Owner ruling (2026-07-14, issue #1599): NOTHING fails softly unless the owner grants it. Every
genuine failure (an exception / a guard that couldn't run / a refused write) must (1) show RED on
/admin/status — INCLUDING when auto-corrected, annotated `auto-corrected` vs `uncorrected`; (2) log
at WARN/ERROR; (3) never swallow a real error into the void. An expected-empty result is NOT a
failure and does not alarm.

Roles only — every string here is a generic probe, never cast material. Proves:
  (a) a swallowed real error now records a RED-eligible health event (the shared recorder + the
      wired class-A sites: overseer judge, enrichment);
  (b) N judge failures → a RED alarm in the /api/admin/health payload;
  (c) an auto-corrected belt/floor → RED-with-`auto-corrected` (a correction is not a cloak).
"""
import importlib

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

log_rings = importlib.import_module("src.log_rings")
overseer = importlib.import_module("src.overseer")
enrichment_policy = importlib.import_module("src.enrichment_policy")
ahr = importlib.import_module("routes.admin_health_routes")
orwell_engine = importlib.import_module("src.orwell_engine")


def _clear_rings():
    for ring in (log_rings.OVERSEER, log_rings.LLMIO, log_rings.IO, log_rings.LIVE):
        ring.buf.clear()


def _overseer_entries():
    _, lines = log_rings.OVERSEER.since(0, limit=100000)
    return lines


# ── the shared recorder ────────────────────────────────────────────────────────────────────

def test_record_soft_failure_writes_a_red_eligible_health_event():
    _clear_rings()
    log_rings.record_soft_failure("overseer:judge-call-failed", RuntimeError("boom"),
                                  corrected="deterministic-floor")
    entries = _overseer_entries()
    assert len(entries) == 1
    e = entries[0]
    assert e["ok"] is False                       # RED-eligible (record_overseer colours ok=False red)
    assert e["level"] == "ERROR"                   # display severity is RED
    assert e["kind"] == "overseer:judge-call-failed"
    assert "boom" in e["diagnosis"] and "RuntimeError" in e["diagnosis"]
    assert log_rings.SOFT_FAIL_AUTOCORRECTED in e["diagnosis"]  # "auto-corrected by deterministic-floor"
    assert e["lever"] == "deterministic-floor"


def test_record_soft_failure_uncorrected_is_still_red_and_annotated():
    _clear_rings()
    log_rings.record_soft_failure("faith:gate-error", ValueError("nope"))
    e = _overseer_entries()[0]
    assert e["ok"] is False
    assert log_rings.SOFT_FAIL_UNCORRECTED in e["diagnosis"]  # "uncorrected"
    assert e["lever"] is None


def test_record_soft_failure_never_raises_even_if_the_health_write_is_broken(monkeypatch):
    """Fail-safe: a broken telemetry write must never propagate out of the recorder (the WARN above
    already surfaced the diagnosis) — the reference-pattern contract."""
    def _boom(*a, **k):
        raise RuntimeError("overseer ring down")
    monkeypatch.setattr(log_rings, "record_overseer", _boom)
    # Must not raise.
    log_rings.record_soft_failure("overseer:hook-error", RuntimeError("x"))


# ── (a) the class-A sites now record instead of swallowing ──────────────────────────────────

def test_overseer_llm_judge_error_records_red(monkeypatch):
    """`LlmOverseer.assess` swallowing a genuine model-call error now records RED before the floor."""
    _clear_rings()

    def _raises(_prompt):
        raise RuntimeError("model 503")

    # A symptom that trips should_assess so the judge actually runs.
    sig = overseer.Signals(in_advance_phase=True, play_quiet=True, engaged_scene=False,
                           recorded_interaction=False, progression_tool_called=False)
    verdict = overseer.LlmOverseer(_raises).assess(sig)
    assert verdict is not None                      # still fail-soft to the deterministic floor
    kinds = [e["kind"] for e in _overseer_entries()]
    assert "overseer:judge-call-failed" in kinds
    down = [e for e in _overseer_entries() if e["kind"] == "overseer:judge-call-failed"][0]
    assert down["ok"] is False and down["lever"] == "deterministic-floor"


def test_overseer_deterministic_heuristic_error_records_red(monkeypatch):
    """`DeterministicOverseer.assess` self-erroring records RED before the benign hold verdict."""
    _clear_rings()
    monkeypatch.setattr(overseer, "_heuristic_verdict",
                        lambda s: (_ for _ in ()).throw(RuntimeError("heuristic boom")))
    sig = overseer.Signals(in_advance_phase=True, play_quiet=True, engaged_scene=False,
                           recorded_interaction=False, progression_tool_called=False)
    verdict = overseer.DeterministicOverseer().assess(sig)
    assert verdict is not None and verdict.lever == "hold"   # still fail-soft
    down = [e for e in _overseer_entries() if e["kind"] == "overseer:heuristic-error"]
    assert down and down[0]["ok"] is False and down[0]["lever"] == "hold"


def test_enrichment_record_failure_emits_a_red_health_event():
    """Every enrichment failure (not just no-model) now reaches RED — covers all 6 driver classes."""
    _clear_rings()
    enrichment_policy.clear_failures("probe-user")
    enrichment_policy.record_failure("probe-user", "cast-authoring", "LLM call failed",
                                     detail="503 from provider")
    red = [e for e in _overseer_entries()
           if e["kind"] == "enrichment:cast-authoring" and e["ok"] is False]
    assert red, "an enrichment failure must land a RED-eligible health event"
    assert "LLM call failed" in red[0]["diagnosis"]
    enrichment_policy.clear_failures("probe-user")


# ── (b) N judge failures → a RED alarm ──────────────────────────────────────────────────────

def test_n_judge_failures_produce_a_guard_alarm_in_the_rollup():
    _clear_rings()
    for _ in range(3):
        log_rings.record_soft_failure("overseer:judge-call-failed", RuntimeError("t"),
                                      corrected="deterministic-floor")
    rollup = ahr._compute_health_rollup()
    assert rollup["guards"]["overseer:judge-call-failed"]["failed"] == 3
    alarms = ahr._compute_alarms(rollup)
    guard = [a for a in alarms if a["code"] == "guard-judge-failure"]
    assert guard, "a guard/judge failing at all must raise a RED alarm"
    assert guard[0]["severity"] == "red" and guard[0]["count"] == 3


@pytest.fixture
def _stubbed_engine(monkeypatch):
    async def fake_detail():
        return {"ok": True, "engineUrl": "http://127.0.0.1:8765"}

    async def fake_raw():
        return ({"ok": True, "uptimeSeconds": 1, "toolCalls": {"total": 0, "failed": 0},
                 "recentFailures": [], "embeddings": {"provider": "deterministic", "degraded": False}}, 3)

    async def no_sandbox(user=None):
        return None

    monkeypatch.setattr(orwell_engine, "engine_health_detail", fake_detail)
    monkeypatch.setattr(ahr, "_engine_raw_health", fake_raw)
    monkeypatch.setattr(orwell_engine, "sandbox_health", no_sandbox)
    monkeypatch.setattr(ahr, "_store_stats", lambda: {"sessions": 0, "messages": 0})
    monkeypatch.setattr(ahr, "_image_state", lambda user: {"available": False, "enabled": False})

    async def no_cast(user=None):
        return None
    monkeypatch.setattr(ahr, "_cast_authoring_state", no_cast)


def _health_app():
    app = FastAPI()
    app.include_router(ahr.setup_admin_health_routes())
    return app


def test_health_payload_surfaces_the_rollup_and_red_alarm(monkeypatch, _stubbed_engine):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    _clear_rings()
    for _ in range(3):
        log_rings.record_soft_failure("overseer:judge-call-failed", RuntimeError("t"),
                                      corrected="deterministic-floor")
    body = TestClient(_health_app(), raise_server_exceptions=False).get("/api/admin/health").json()
    assert "healthRollup" in body and "alarms" in body           # WI2 + WI3 on the payload
    codes = {a["code"] for a in body["alarms"]}
    assert "guard-judge-failure" in codes
    assert all(a["severity"] == "red" for a in body["alarms"])   # every alarm is RED
    # Vault-free: alarms carry only tokens/counts/flags, never narration/cast content.
    for a in body["alarms"]:
        assert set(a) >= {"code", "severity", "label", "count", "detail", "autoCorrected"}


# ── (c) an auto-corrected belt/floor → RED-with-`auto-corrected` ─────────────────────────────

def test_auto_corrected_soft_failure_is_red_with_autocorrected():
    _clear_rings()
    log_rings.record_soft_failure("overseer:judge-call-failed", RuntimeError("t"),
                                  corrected="auto-record-scene")
    rollup = ahr._compute_health_rollup()
    assert rollup["guards"]["overseer:judge-call-failed"]["autoCorrected"] == 1
    alarms = ahr._compute_alarms(rollup)
    # A correction is not a cloak: there is a RED alarm flagged auto-corrected.
    auto = [a for a in alarms if a["autoCorrected"]]
    assert auto, "an auto-corrected fault must still show RED, annotated auto-corrected"
    assert all(a["severity"] == "red" for a in auto)
    assert any(a["code"] == "auto-corrected" for a in alarms)


def test_belt_fire_totals_raise_the_auto_corrected_alarm():
    """The belt-fire telemetry (get_belt_totals) also surfaces RED-with-auto-corrected — every
    applied belt correction is a genuine (auto-corrected) fault, not silence."""
    alarms = ahr._compute_alarms({"guards": {}, "llm": {}, "tools": {}},
                                 belt_totals={"auto-record-scene": 2, "force-advance": 1})
    auto = [a for a in alarms if a["code"] == "auto-corrected"]
    assert auto and auto[0]["severity"] == "red" and auto[0]["autoCorrected"] is True
    assert auto[0]["count"] == 3


# ── the other WI3 alarm signals fire on their inputs ────────────────────────────────────────

def test_embeddings_degraded_and_integrity_and_storm_alarms():
    rollup = {"guards": {"enrichment:cast-authoring": {"failed": 2, "autoCorrected": 0}},
              "llm": {"narration": {"total": 4, "failed": 2, "failureRate": 0.5}},
              "tools": {"recordInteraction": {"total": 5, "failed": 2, "failureRate": 0.4}}}
    alarms = ahr._compute_alarms(
        rollup,
        embeddings={"provider": "fastembed", "degraded": True},
        sync_recent=[{"staleRejections": 2, "desyncDetected": True}],
        sandbox={"circuitOpen": True, "lastIntegrity": "fault",
                 "faults": [{"kind": "degradation"}, {"kind": "persist-failure"}]})
    codes = {a["code"] for a in alarms}
    assert {"narration-failure", "writeback-storm", "desync-burst",
            "embeddings-degraded", "integrity-fault"} <= codes
    assert all(a["severity"] == "red" for a in alarms)


# ── Class-B is left alone: an expected-empty result must NOT alarm ───────────────────────────

def test_no_failures_means_no_alarms():
    _clear_rings()
    alarms = ahr._compute_alarms(ahr._compute_health_rollup())
    assert alarms == []
