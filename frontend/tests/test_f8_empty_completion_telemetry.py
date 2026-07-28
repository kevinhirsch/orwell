"""F8 (#1741) — `finishReason: None` / empty-completion events as a FIRST-CLASS telemetry class.

Context: a prompt-structure audit found 6/103 stream records in a live debug bundle finished with
`finishReason: None` (a vanished/empty generation — a dropped turn from the player's view). Two
things already existed before this file:

  * `llm_trace._derive_fail_class` already classifies a vanished completion as `failClass: "empty"`
    and flips the ring entry's `ok` to `False` (see `test_rc6_truthful_telemetry.py`).
  * `llm_core.py`'s non-stream `call` path (~:1804-1829) already retries an empty-`stop` completion
    like a failed attempt and raises a typed `empty_completion` 502 when retries are exhausted (see
    `test_nonstream_empty_completion_guard.py`) — AC #3 ("an empty-stop completion is retried") was
    already satisfied.

What was MISSING (this file's subject): the `#1599` health rollup counted an empty completion only
on the blunt `failed` axis — indistinguishable from a 4xx/5xx/timeout — so an operator could not see
"N of these were SPECIFICALLY vanished generations", and there was no burst alarm for it (only the
narration class fired, and only at threshold 1, lumped with every other failure shape). This pins:

  * the `llm` rollup bucket's new `emptyCompletions` / `lastEmptyCompletionAt` fields (mirrors the F7
    `semanticNoOps` pattern), counted from `failClass == "empty"` LLMIO ring entries;
  * the new `empty-completion-storm` RED alarm, firing at the shared storm threshold across ANY LLM
    call class (not just narration — a silent empty utility/enrichment call is just as real a dropped
    turn).

Roles only — every probe string here is generic, never cast material.
"""
import time

from src import log_rings

import routes.admin_health_routes as ahr


def _clear():
    for ring in (log_rings.OVERSEER, log_rings.LLMIO, log_rings.IO, log_rings.LIVE):
        ring.buf.clear()


def _push_llm(*, ok, finish, fail_class=None, cls="narration", user=None, ts=None):
    log_rings.LLMIO.push({
        "ts": ts if ts is not None else int(time.time() * 1000),
        "level": "INFO" if ok else "ERROR", "logger": "llm-io", "msg": "x",
        "kind": "llm", "callClass": cls, "finishReason": finish, "failClass": fail_class,
        "ok": ok, "user": user,
    })


def test_rollup_counts_empty_completions_separately_from_failed():
    _clear()
    # 3 vanished completions (failClass=empty, flipped to ok=False by llm_trace) + one clean one.
    for _ in range(3):
        _push_llm(ok=False, finish="stop", fail_class="empty")
    _push_llm(ok=True, finish="stop")
    rollup = ahr._compute_health_rollup()
    cls = rollup["llm"]["narration"]
    assert cls["emptyCompletions"] == 3
    assert cls["failed"] == 3, "an empty completion is STILL counted on the blunt failed axis too"
    assert cls["total"] == 4
    assert cls["lastEmptyCompletionAt"] is not None


def test_a_non_empty_failure_does_not_bump_empty_count():
    _clear()
    _push_llm(ok=False, finish=None, fail_class="5xx")
    _push_llm(ok=False, finish=None, fail_class="timeout")
    rollup = ahr._compute_health_rollup()
    cls = rollup["llm"]["narration"]
    assert cls["emptyCompletions"] == 0, "a 5xx/timeout is a real failure but not an EMPTY completion"
    assert cls["failed"] == 2


def test_empty_completion_storm_raises_red_alarm():
    _clear()
    for _ in range(ahr._STORM_THRESHOLD):
        _push_llm(ok=False, finish="stop", fail_class="empty")
    alarms = ahr._compute_alarms(ahr._compute_health_rollup())
    storm = [a for a in alarms if a["code"] == "empty-completion-storm"]
    assert storm, "a burst of vanished/empty completions must surface RED"
    assert storm[0]["severity"] == "red"
    assert storm[0]["count"] == ahr._STORM_THRESHOLD


def test_empty_completion_storm_spans_call_classes_not_just_narration():
    """A silent empty enrichment/utility completion is just as real a dropped turn as a narration
    one — the storm alarm must not be narration-only (unlike the pre-existing narration-failure
    alarm, which only ever looks at the `narration` class)."""
    _clear()
    for _ in range(ahr._STORM_THRESHOLD):
        _push_llm(ok=False, finish="stop", fail_class="empty", cls="background-authoring")
    alarms = ahr._compute_alarms(ahr._compute_health_rollup())
    storm = [a for a in alarms if a["code"] == "empty-completion-storm"]
    assert storm, "an empty-completion burst on a non-narration class must still alarm"
    assert "background-authoring" in storm[0]["detail"]


def test_single_empty_completion_below_threshold_does_not_storm_alarm():
    _clear()
    _push_llm(ok=False, finish="stop", fail_class="empty")
    alarms = ahr._compute_alarms(ahr._compute_health_rollup())
    assert not any(a["code"] == "empty-completion-storm" for a in alarms), (
        "an occasional empty completion (the retry guard already handles a single miss) must not "
        "be a storm — only a genuine burst (retries ALSO failing) should alarm"
    )
    # ... but the pre-existing narration-failure alarm still fires at threshold 1 for the
    # player-facing class, since an empty completion is still counted on the blunt failed axis.
    assert any(a["code"] == "narration-failure" for a in alarms)


def test_no_failures_means_no_empty_alarm():
    _clear()
    alarms = ahr._compute_alarms(ahr._compute_health_rollup())
    assert not any(a["code"] == "empty-completion-storm" for a in alarms)


def test_tool_and_guard_buckets_never_carry_the_empty_completion_fields():
    """The empty-completion fields are LLM-only, mirroring the F7 semanticNoOps discipline — a
    tool/guard bucket must stay {total, failed, lastFailureAt} / {failed, autoCorrected,
    lastFailureAt} and never pick up the LLM-only keys."""
    _clear()
    log_rings.IO.push({
        "ts": None, "level": "INFO", "logger": "engine-io", "msg": "advanceGame ok",
        "tool": "advanceGame", "ok": True, "user": None,
    })
    _push_llm(ok=True, finish="stop")
    rollup = ahr._compute_health_rollup()
    tool = rollup["tools"]["advanceGame"]
    assert "emptyCompletions" not in tool and "lastEmptyCompletionAt" not in tool
    llm = rollup["llm"]["narration"]
    for k in ("total", "failed", "semanticNoOps", "lastFailureAt", "lastSemanticNoOpAt",
              "emptyCompletions", "lastEmptyCompletionAt"):
        assert k in llm


def test_cross_user_isolation_of_empty_completion_counts():
    """A vanished completion in user A's sandbox must never inflate user B's rollup/alarm — the
    same cross-user guarantee every other #1599 signal carries."""
    _clear()
    for _ in range(ahr._STORM_THRESHOLD):
        _push_llm(ok=False, finish="stop", fail_class="empty", user="alice")
    rollup_b = ahr._compute_health_rollup(user="bob")
    assert rollup_b.get("llm", {}) == {}
    alarms_b = ahr._compute_alarms(rollup_b)
    assert not any(a["code"] == "empty-completion-storm" for a in alarms_b)
    rollup_a = ahr._compute_health_rollup(user="alice")
    assert rollup_a["llm"]["narration"]["emptyCompletions"] == ahr._STORM_THRESHOLD


# ─────────────────────────────────────────────────────────────────────────────
# #1785 (T1-4 B1-B4) — MINIMUM-VIABLE-TURN GATE (_isBelowThresholdOrDanglingTurn)
# ─────────────────────────────────────────────────────────────────────────────


def _read(rel):
    import os
    with open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), rel), encoding="utf-8") as f:
        return f.read()


def test_below_threshold_predicate_exists():
    """The predicate must be exported from chatReconcile.js."""
    src = _read("static/js/chatReconcile.js")
    assert "export function _isBelowThresholdOrDanglingTurn(" in src,         "_isBelowThresholdOrDanglingTurn must be exported"


def test_below_threshold_predicate_checks_unclosed_bold():
    """Unclosed ** must be checked."""
    src = _read("static/js/chatReconcile.js")
    assert "% 2 !== 0" in src,         "must check for odd count of tokens"
    assert "doubleStar" in src or "\*\*" in src,         "must check for ** occurrences"


def test_below_threshold_predicate_checks_odd_backticks():
    """Odd count of unescaped backticks must be checked."""
    src = _read("static/js/chatReconcile.js")
    assert "% 2 !== 0" in src,         "must check for odd count"
    assert "backtick" in src.lower(),         "must check for backticks"


def test_below_threshold_predicate_checks_trailing_lone():
    """Trailing lone * or _ must be checked."""
    src = _read("static/js/chatReconcile.js")
    assert "[*_]" in src or "trailing" in src.lower(),         "must check for trailing lone */_"


def test_below_threshold_predicate_constant_exists():
    """The _MIN_VIABLE_TURN_CHARS constant must exist with the conservative default of 3."""
    src = _read("static/js/chatReconcile.js")
    assert "const _MIN_VIABLE_TURN_CHARS = 3" in src,         "_MIN_VIABLE_TURN_CHARS must equal 3"


def test_below_threshold_predicate_imported_in_chat_js():
    """_isBelowThresholdOrDanglingTurn must be imported in chat.js."""
    js = _read("static/js/chat.js")
    assert "_isBelowThresholdOrDanglingTurn" in js,         "_isBelowThresholdOrDanglingTurn must be referenced in chat.js"


def test_gate_and_retry_helper_exists():
    """The _gateAndRetryBelowThresholdTurn shared helper must exist in chat.js."""
    js = _read("static/js/chat.js")
    assert "function _gateAndRetryBelowThresholdTurn(" in js,         "_gateAndRetryBelowThresholdTurn helper must exist in chat.js"
    assert "_gateBelowThresholdFired" in js,         "one-shot latch _gateBelowThresholdFired must exist"
    # The retry call is a setTimeout with handleChatSubmit and hideUserBubble option
    idx = js.find("function _gateAndRetryBelowThresholdTurn")
    assert idx >= 0, "helper function not found"
    helper_src = js[idx:idx+1500]
    assert "handleChatSubmit" in helper_src, "the retry must call handleChatSubmit"
    assert "hideUserBubble" in helper_src, "the retry must be headless (hideUserBubble)"


# ─────────────────────────────────────────────────────────────────────────────
