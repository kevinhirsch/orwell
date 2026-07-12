"""A4 (2026-07-03 final pre-ship audit) — raw chain-of-thought reasoning must never reach the public
bubble via the empty-body fallback.

`_empty_response_fallback` re-emits an empty turn's `reasoning_content` as the visible body so a model
that routes the answer into the reasoning channel (DeepSeek/Flash — FEPY-2) isn't left blank. That
logic is DeepSeek-shaped: on GLM-4.7 (ADR 0016, the current default narrator, a TRUE separate reasoning
channel) the reasoning is raw CoT, and re-emitting it leaked chain-of-thought into the player bubble —
bypassing BOTH the leak-scrub and the pre-emission outcome guard.

This suite pins the model-aware repair:
  • a separate-reasoning-channel model (GLM) does NOT re-emit its CoT — it falls to the in-character
    recovery line instead;
  • a DeepSeek-family model still re-emits (FEPY-2 preserved — the known answer-in-reasoning shape);
  • an UNKNOWN model does NOT re-emit (P2-16, prompt audit: the default flipped to the safe False —
    the comment's own "SAFE direction": a wrong True leaks raw CoT to the player, a wrong False only
    costs a retry); and
  • a re-emit on a GAME turn is routed through the same scrub + outcome guard (the callsite wiring).

Roles only — proper nouns inside strings exercise the code, never carry test intent.
"""

import json
import os

from src import agent_loop


def _frame(chunk):
    return json.loads(chunk[len("data: "):].strip())


# ── _reasoning_carries_answer: the model-awareness gate ─────────────────────── #

def test_glm_reasoning_does_not_carry_the_answer():
    for m in ("glm-4.7", "zai/glm-4.7", "GLM-4.6-Air"):
        assert agent_loop._reasoning_carries_answer(m) is False, m


def test_deepseek_reasoning_carries_the_answer():
    # FEPY-2 preserved: the DeepSeek family is POSITIVELY known to route an empty-body answer into
    # the reasoning channel (load-bearing for Flash).
    for m in ("deepseek-v4-pro", "deepseek-chat", "deepseek-v3", "deepseek/deepseek-v4-flash"):
        assert agent_loop._reasoning_carries_answer(m) is True, m


def test_unknown_model_reasoning_does_not_carry_the_answer():
    # P2-16 (prompt audit): a model matching NO marker used to default True — re-emitting what may
    # be raw chain-of-thought as the visible body. Flipped to the safe False: a wrong guess now
    # costs one retry (the in-character recovery), never a CoT leak.
    for m in ("gpt-4o", "mistral-large", "", None):
        assert agent_loop._reasoning_carries_answer(m) is False, m


def test_deepseek_true_reasoners_still_separate_channel():
    # The separate-channel markers WIN over the answer-channel family match: deepseek-r1 /
    # deepseek-reasoner are true reasoning models whose CoT must never be re-emitted.
    for m in ("deepseek-r1", "deepseek-reasoner"):
        assert agent_loop._reasoning_carries_answer(m) is False, m


def test_other_separate_channel_reasoners_do_not_carry_the_answer():
    for m in ("qwq-32b", "qwen3-235b-thinking", "some-reasoner-model", "minimax-m1"):
        assert agent_loop._reasoning_carries_answer(m) is False, m


# ── _empty_response_fallback: GLM must NOT re-emit raw reasoning ─────────────── #

def test_glm_empty_body_with_reasoning_does_not_leak_cot_in_game():
    """The exact A4 failure: GLM empty body + CoT reasoning must NOT surface the CoT — the player gets
    the in-character recovery line, and the turn signals a retry (not a reasoning re-emit)."""
    reasoning = "Let me think. The player wants to talk to the HOH. I should call recordInteraction."
    final, chunk, retry, from_reasoning = agent_loop._empty_response_fallback(
        "", reasoning, [], game_mode=True, model="glm-4.7")
    assert from_reasoning is False, "GLM CoT must NOT be treated as the answer"
    assert reasoning not in final, "raw chain-of-thought must never become the visible body"
    assert final == agent_loop._EMPTY_PRODUCER_LINE
    assert retry is True


def test_glm_empty_body_with_reasoning_workspace_also_no_leak():
    """Even on a non-game turn, GLM CoT is not the answer — it falls to the operator recovery, not a
    raw-CoT re-emit (the visible bubble never carries chain-of-thought)."""
    reasoning = "Thinking step by step about the file structure before answering."
    final, chunk, retry, from_reasoning = agent_loop._empty_response_fallback(
        "", reasoning, [], game_mode=False, model="glm-4.7")
    assert from_reasoning is False
    assert reasoning not in final
    assert "empty response" in final  # the operator recovery string


def test_deepseek_empty_body_reasoning_still_reemits():
    """FEPY-2 preserved: a DeepSeek-family empty body re-emits its answer-bearing reasoning."""
    final, chunk, retry, from_reasoning = agent_loop._empty_response_fallback(
        "", "The house votes tonight and it's tense.", [], game_mode=True, model="deepseek-v4-pro")
    assert from_reasoning is True
    assert final == "The house votes tonight and it's tense."


# ── source-pin: the callsite routes a re-emit through scrub + the Fix 1 guard ─ #

def test_callsite_scrubs_and_guards_reasoning_reemit_on_game_turns():
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(base, "src", "agent_loop.py"), encoding="utf-8") as fh:
        src = fh.read()
    idx = src.find("_fallback_retry, _from_reasoning = _empty_response_fallback(")
    assert idx != -1, "the callsite must unpack from_reasoning"
    window = src[idx:idx + 1400]
    assert "model=actual_model" in window                 # model-aware
    assert "if _from_reasoning and game_mode" in window    # the A4 scrub+guard branch
    assert "_scrub_game_leak(" in window                   # leak-scrub applied
    assert "_emit_guarded_scene(" in window                # routed through the Fix 1 scene/outcome guard
