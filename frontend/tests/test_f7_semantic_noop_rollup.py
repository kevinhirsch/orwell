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


def _push_llm(*, ok, finish, cls="background-authoring", user=None, result=None):
    entry = {
        "ts": None, "level": "INFO" if ok else "ERROR", "logger": "llm-io", "msg": "x",
        "kind": "llm", "callClass": cls, "finishReason": finish, "ok": ok, "user": user,
    }
    if result is not None:
        entry["result"] = result
    log_rings.LLMIO.push(entry)


def test_semantic_noop_entry_detection():
    # length + NO usable body (empty/absent result) ⇒ a semantic no-op
    assert ahr._entry_semantic_noop({"ok": True, "finishReason": "length"}) is True
    assert ahr._entry_semantic_noop({"ok": True, "finishReason": "length", "result": ""}) is True
    assert ahr._entry_semantic_noop({"ok": True, "finishReason": "length", "result": "   "}) is True
    # length BUT the completion still carried usable text/output ⇒ NOT a no-op (it applied something)
    assert ahr._entry_semantic_noop(
        {"ok": True, "finishReason": "length", "result": "some usable text"}) is False
    assert ahr._entry_semantic_noop({"ok": True, "finishReason": "stop"}) is False
    # an already-failed call is counted on the failed axis, not double-counted as semantic
    assert ahr._entry_semantic_noop({"ok": False, "finishReason": "length"}) is False


def test_rollup_counts_ok_but_dropped_completions():
    _clear()
    # 4 HTTP-ok completions, all truncated by the output cap AND empty-bodied (applied nothing):
    # failed axis stays 0.
    for _ in range(4):
        _push_llm(ok=True, finish="length")
    _push_llm(ok=True, finish="stop")  # a clean one
    rollup = ahr._compute_health_rollup()
    cls = rollup["llm"]["background-authoring"]
    assert cls["failed"] == 0, "the ok/failed axis is blind to these — that was the bug"
    assert cls["semanticNoOps"] == 4, "the semantic no-op is surfaced separately"
    assert cls["total"] == 5


def test_length_capped_but_usable_completion_is_not_a_noop():
    _clear()
    # 4 completions truncated by the cap but carrying usable body: NOT no-ops, no false storm.
    for _ in range(4):
        _push_llm(ok=True, finish="length", result="a real, usable reply body")
    rollup = ahr._compute_health_rollup()
    cls = rollup["llm"]["background-authoring"]
    assert cls["semanticNoOps"] == 0, "capped-but-usable completions applied something — not no-ops"
    assert cls["failed"] == 0
    assert cls["total"] == 4
    alarms = ahr._compute_alarms(rollup)
    assert not any(a["code"] == "semantic-noop-storm" for a in alarms), \
        "ordinary capped-but-usable completions must NOT trip the storm alarm"


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


def test_tool_bucket_has_no_llm_only_fields():
    """Finding 1: `_bump` seeds `semanticNoOps`/`lastSemanticNoOpAt` ONLY for the LLM rollup — TOOL
    (and guard) buckets stay `{total, failed, lastFailureAt}` and never carry the LLM-only fields."""
    _clear()
    log_rings.IO.push({
        "ts": None, "level": "INFO", "logger": "engine-io", "msg": "advanceGame ok",
        "tool": "advanceGame", "ok": True, "user": None,
    })
    _push_llm(ok=True, finish="stop")  # so the llm bucket exists too
    rollup = ahr._compute_health_rollup()
    tool = rollup["tools"]["advanceGame"]
    assert set(tool.keys()) == {"total", "failed", "lastFailureAt", "failureRate"}, \
        "tool buckets must not carry LLM-only semanticNoOps/lastSemanticNoOpAt"
    # the LLM bucket keeps all five keys ALWAYS (even with zero semantic no-ops)
    llm = rollup["llm"]["background-authoring"]
    for k in ("total", "failed", "semanticNoOps", "lastFailureAt", "lastSemanticNoOpAt"):
        assert k in llm
