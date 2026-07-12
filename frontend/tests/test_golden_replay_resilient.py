"""golden REPLAY resilience — the whole-run retry that absorbs the CI-load "no new assistant
message persisted" crash WITHOUT masking a real (deterministic) failure.

Companion to test_golden_driver_read_retry.py (which pins the in-turn read/stream resilience);
this pins the run-level retry in golden_path_replay._replay_run. The golden replay is
digest-deterministic, so a mid-walk crash is a heavy advanceGame turn's reply lagging the stream
under gh-runner contention — a transient infra give-up, not a determinism bug. A real staling MISS
or a genuine engine stall raises the SAME crash on EVERY attempt, so it still fails after the
budget; only the intermittent load crash is absorbed. These pin both halves — no engine/FE booted.
"""
from __future__ import annotations

import pytest

import scripts.golden_path_replay as gr


class _Driver:
    """Stand-in for the GoldenDriver that run_once returns on success."""


def test_replay_run_absorbs_a_transient_crash_then_succeeds(monkeypatch):
    calls = {"n": 0}
    ok = _Driver()

    def flaky(**kw):
        calls["n"] += 1
        if calls["n"] < 3:  # two transient crashes, then it lands
            raise RuntimeError('no new assistant message persisted for turn "Let\'s keep…"')
        return ok

    monkeypatch.setattr(gr, "run_once", flaky)
    monkeypatch.setattr(gr.time, "sleep", lambda *_a, **_k: None)  # no real backoff wait
    assert gr._replay_run(0, fixture="f", model="m", utility_model="m") is ok
    assert calls["n"] == 3  # retried past both transient crashes rather than failing the gate


def test_replay_run_uses_fresh_ports_per_attempt(monkeypatch):
    seen = []

    def record_ports(**kw):
        seen.append((kw["engine_port"], kw["fe_port"]))
        if len(seen) < 3:
            raise RuntimeError("no new assistant message persisted")
        return _Driver()

    monkeypatch.setattr(gr, "run_once", record_ports)
    monkeypatch.setattr(gr.time, "sleep", lambda *_a, **_k: None)
    gr._replay_run(0, fixture="f", model="m", utility_model="m")
    assert len(set(seen)) == len(seen)  # each attempt used a DISTINCT (engine, fe) port pair


def test_replay_run_does_not_retry_a_non_transient_error(monkeypatch):
    calls = {"n": 0}

    def hang(**kw):
        calls["n"] += 1
        raise RuntimeError("streamed for over 960s without closing — a genuine server hang")

    monkeypatch.setattr(gr, "run_once", hang)
    with pytest.raises(RuntimeError, match="without closing"):
        gr._replay_run(0, fixture="f", model="m", utility_model="m")
    assert calls["n"] == 1  # a genuine hang surfaces immediately — NEVER retried/masked


def test_replay_run_surfaces_a_persistent_transient_after_the_budget(monkeypatch):
    # A REAL staling miss raises the SAME 'no new assistant' crash on EVERY attempt (the request
    # key is deterministically absent), so the retry must still FAIL after exhausting the budget.
    # This is the non-masking guarantee: only an INTERMITTENT crash is absorbed.
    calls = {"n": 0}

    def always(**kw):
        calls["n"] += 1
        raise RuntimeError("no new assistant message persisted")

    monkeypatch.setattr(gr, "run_once", always)
    monkeypatch.setattr(gr.time, "sleep", lambda *_a, **_k: None)
    with pytest.raises(RuntimeError, match="no new assistant"):
        gr._replay_run(0, fixture="f", model="m", utility_model="m")
    assert calls["n"] == 1 + gr._RUN_RETRIES  # bounded — never an infinite loop


def test_replay_run_zero_cost_on_the_happy_path(monkeypatch):
    calls = {"n": 0}

    def once(**kw):
        calls["n"] += 1
        return _Driver()

    monkeypatch.setattr(gr, "run_once", once)
    gr._replay_run(0, fixture="f", model="m", utility_model="m")
    assert calls["n"] == 1  # a healthy run calls run_once exactly once — no added latency
