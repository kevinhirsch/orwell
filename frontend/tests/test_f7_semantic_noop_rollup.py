"""F7 — the health `llm` rollup surfaces SEMANTIC no-ops, not just HTTP failures.

An HTTP-ok LLM call whose output was semantically dropped (a reasoning-channel length-cut that left
no usable body, the doubled-JSON identity parse that applied nothing) used to be counted as a clean
success — the rollup reported 0 failures while a stream of completions applied nothing. This pins the
new `semanticNoOps` signal on the `llm` bucket + the `semantic-noop-storm` RED alarm.
"""
from src import log_rings

import routes.admin_health_routes as ahr


def _clear():
    for ring in (log_rings.OVERSEER, log_rings.LLMIO, log_rings.IO, log_rings.LIVE):
        ring.buf.clear()


def _push_llm(*, ok, finish, cls="background-authoring", user=None):
    log_rings.LLMIO.push({
        "ts": None, "level": "INFO" if ok else "ERROR", "logger": "llm-io", "msg": "x",
        "kind": "llm", "callClass": cls, "finishReason": finish, "ok": ok, "user": user,
    })


def test_semantic_noop_entry_detection():
    assert ahr._entry_semantic_noop({"ok": True, "finishReason": "length"}) is True
    assert ahr._entry_semantic_noop({"ok": True, "finishReason": "stop"}) is False
    # an already-failed call is counted on the failed axis, not double-counted as semantic
    assert ahr._entry_semantic_noop({"ok": False, "finishReason": "length"}) is False


def test_rollup_counts_ok_but_dropped_completions():
    _clear()
    # 4 HTTP-ok completions, all truncated by the output cap (applied nothing): failed axis stays 0.
    for _ in range(4):
        _push_llm(ok=True, finish="length")
    _push_llm(ok=True, finish="stop")  # a clean one
    rollup = ahr._compute_health_rollup()
    cls = rollup["llm"]["background-authoring"]
    assert cls["failed"] == 0, "the ok/failed axis is blind to these — that was the bug"
    assert cls["semanticNoOps"] == 4, "the semantic no-op is surfaced separately"
    assert cls["total"] == 5


def test_semantic_noop_storm_raises_red_alarm():
    _clear()
    for _ in range(4):
        _push_llm(ok=True, finish="length")
    alarms = ahr._compute_alarms(ahr._compute_health_rollup())
    storm = [a for a in alarms if a["code"] == "semantic-noop-storm"]
    assert storm, "a burst of ok-but-dropped completions must surface RED"
    assert storm[0]["severity"] == "red"
    assert storm[0]["count"] == 4


def test_occasional_truncation_below_threshold_does_not_alarm():
    _clear()
    _push_llm(ok=True, finish="length")  # a single truncation
    alarms = ahr._compute_alarms(ahr._compute_health_rollup())
    assert not any(a["code"] == "semantic-noop-storm" for a in alarms)
