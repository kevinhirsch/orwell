"""Feature 0079 — the live overseer hook integration + the opt-in gate.

The reasoning-tier module (overseer.py) is unit-tested in test_0079_overseer.py and
test_0079_overseer_reasoning.py; this file covers the agent_loop.py WIRING — the opt-in gate
(default OFF) and a source-pin that the live turn loop builds Signals, runs the SPARSE gate, drives
the REASONING tier (LlmOverseer over the utility model) with a fail-soft deterministic fallback, and
LOGS the verdict. It diagnose-and-LOGs only — no lever is applied here (the inline guardrails are the
overseer's hands and already act during the turn). Name-agnostic — roles only.
"""

import os


def test_overseer_disabled_by_default(monkeypatch):
    from src import overseer
    monkeypatch.delenv("ORWELL_OVERSEER", raising=False)
    assert overseer.overseer_enabled() is False


def test_overseer_enabled_only_for_truthy_flag(monkeypatch):
    from src import overseer
    for truthy in ("1", "true", "TRUE", "yes", "on"):
        monkeypatch.setenv("ORWELL_OVERSEER", truthy)
        assert overseer.overseer_enabled() is True, truthy
    for falsey in ("0", "false", "no", "off", "", "  "):
        monkeypatch.setenv("ORWELL_OVERSEER", falsey)
        assert overseer.overseer_enabled() is False, repr(falsey)


def test_agent_loop_wires_the_reasoning_hook():
    src = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                            "src", "agent_loop.py"), encoding="utf-8").read()
    # the live turn loop gates on the flag, builds Signals, runs the SPARSE gate, drives the
    # REASONING tier (with the deterministic fallback), and logs the verdict
    assert "overseer_enabled()" in src
    assert "Signals(" in src and "should_assess(" in src
    assert "LlmOverseer" in src and "DeterministicOverseer" in src   # reasoning tier + fail-soft floor
    assert "_resolve_llm_fn" in src and "verdict_from_reply" in src  # the async model-drive path
    assert "record_overseer(" in src
    # the completed Signals carry the 0065 sync telemetry (desync + beatSeq before/after)
    _hook = src.split("overseer_enabled()")[1][:1600]
    assert "desync=" in _hook and "beat_seq_after=" in _hook
    # diagnose-and-LOG only: the verdict is recorded, never executed — no lever-application call
    assert ".execute(" not in src.split("overseer_enabled()")[1][:1200]


def test_shadow_hook_path_builds_a_verdict_and_logs():
    """Exercise the exact path the hook runs: a tripped symptom -> DeterministicOverseer verdict ->
    record_overseer lands a Vault-free entry. Module-level, so no full turn drive is needed."""
    from src import overseer, log_rings
    sig = overseer.Signals(engaged_scene=True, recorded_interaction=False, beat_seq_before=5)
    verdict = overseer.DeterministicOverseer().assess(sig)
    assert verdict is not None and verdict.lever == "propose-record"
    log_rings.record_overseer(verdict.level, verdict.kind, verdict.diagnosis,
                              lever=verdict.lever, beat_before=5, ok=True, user="role:player")
    _, lines = log_rings.OVERSEER.since(0)
    e = [l for l in lines if l["kind"] == "gap-repair"][-1]
    assert e["lever"] == "propose-record" and e["overseerLevel"] == "action"


def test_healthy_turn_signals_do_not_wake_the_overseer():
    """The sparse-trigger guarantee at the integration grain: an all-clear turn -> no verdict ->
    nothing logged (no wake, no line)."""
    from src import overseer
    healthy = overseer.Signals(
        in_advance_phase=False, play_quiet=False, engaged_scene=False,
        recorded_interaction=True, progression_tool_called=True,
    )
    assert overseer.should_assess(healthy) is False
    assert overseer.DeterministicOverseer().assess(healthy) is None
