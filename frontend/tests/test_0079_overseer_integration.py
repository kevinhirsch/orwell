"""Feature 0079 — increment 4: the live shadow-hook integration + the opt-in env gate.

The reasoning-tier module (overseer.py) is unit-tested in test_0079_overseer.py; this file
covers the agent_loop.py wiring — the ORWELL_OVERSEER flag (default OFF) and a source-pin that
the shadow hook is wired into the live turn loop (build Signals -> DeterministicOverseer ->
record_overseer), diagnose-and-LOG only (no lever is applied; the existing guardrails still act).
Name-agnostic — roles only.
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


def test_agent_loop_wires_the_shadow_hook():
    src = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                            "src", "agent_loop.py"), encoding="utf-8").read()
    # the live turn loop gates on the flag, builds Signals, runs the overseer, and logs the verdict
    assert "overseer_enabled()" in src
    assert "DeterministicOverseer" in src and "Signals(" in src
    assert "record_overseer(" in src
    # SHADOW mode: the verdict is recorded, never executed — no lever-application call exists
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
