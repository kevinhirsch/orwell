# test_1865_vault_bundle_redaction
# Proves sealed call class content is redacted in LLMIO ring + hidden-content tool
# args/result are redacted in IO ring, and vault-unsealed mode shows full content.

import json
import os
import sys
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src import llm_trace
from src import log_rings


SENTINEL = "SENTINEL-1865-secret"


def _reset_rings():
    """Clear ring buffers for a clean test."""
    log_rings.LLMIO.buf.clear()
    log_rings.LLMIO.seq = 0
    log_rings.IO.buf.clear()
    log_rings.IO.seq = 0
    llm_trace.set_vault_unsealed(False)


# ---------- PATH A: sealed call classes in LLMIO ring ----------

def test_sealed_call_class_redacted_in_ring():
    """A sealed call_class record in the LLMIO ring must contain [REDACTED]
    when vault is not unsealed."""
    _reset_rings()
    llm_trace.set_vault_unsealed(False)
    msg = {"role": "user", "content": f"{SENTINEL}-this-is-secret"}
    resp = {"text": f"{SENTINEL}-the-response-is-also-secret", "finishReason": "stop"}
    llm_trace.record_llm_call(
        kind="test",
        model="test-model",
        messages=[msg],
        response=resp,
        ok=True,
        duration_ms=100,
        call_class="narration",
        user="test-user-1865",
    )
    ring = list(log_rings.LLMIO.buf)
    assert len(ring) > 0, "Expected at least one ring entry"
    entry = ring[-1]
    # The args and result should contain [REDACTED] — not the actual content
    args_txt = str(entry.get("args", ""))
    result_txt = str(entry.get("result", ""))
    assert "[REDACTED — sealed call class" in args_txt, (
        f"Expected redacted args, got: {args_txt[:200]}"
    )
    assert "[REDACTED — sealed call class" in result_txt, (
        f"Expected redacted result, got: {result_txt[:200]}"
    )
    assert SENTINEL not in args_txt, f"SENTINEL leaked in args: {args_txt}"
    assert SENTINEL not in result_txt, f"SENTINEL leaked in result: {result_txt}"


def test_unsealed_call_class_shows_full_content():
    """When vault IS unsealed, sealed call class content must be visible."""
    _reset_rings()
    llm_trace.set_vault_unsealed(True)
    msg = {"role": "user", "content": f"{SENTINEL}-visible-under-unseal"}
    resp = {"text": f"{SENTINEL}-response-visible", "finishReason": "stop"}
    llm_trace.record_llm_call(
        kind="test",
        model="test-model",
        messages=[msg],
        response=resp,
        ok=True,
        duration_ms=100,
        call_class="narration",
        user="test-user-1865",
    )
    ring = list(log_rings.LLMIO.buf)
    assert len(ring) > 0
    entry = ring[-1]
    args_txt = str(entry.get("args", ""))
    result_txt = str(entry.get("result", ""))
    assert "[REDACTED — sealed call class" not in args_txt, (
        f"Unexpected redaction when vault is unsealed: {args_txt[:200]}"
    )
    assert SENTINEL in args_txt or SENTINEL in result_txt, (
        "SENTINEL should be visible when vault is unsealed"
    )


def test_non_sealed_call_class_not_redacted():
    """A non-sealed call class should never be redacted."""
    _reset_rings()
    llm_trace.set_vault_unsealed(False)
    msg = {"role": "user", "content": f"{SENTINEL}-normal-content"}
    resp = {"text": "normal response", "finishReason": "stop"}
    llm_trace.record_llm_call(
        kind="test",
        model="test-model",
        messages=[msg],
        response=resp,
        ok=True,
        duration_ms=100,
        call_class="utility",
        user="test-user-1865",
    )
    ring = list(log_rings.LLMIO.buf)
    assert len(ring) > 0
    entry = ring[-1]
    args_txt = str(entry.get("args", ""))
    assert "[REDACTED" not in args_txt, (
        f"Non-sealed class should not be redacted: {args_txt[:200]}"
    )
    assert SENTINEL in args_txt, (
        "Non-sealed content with SENTINEL should be visible"
    )


# ---------- PATH B: hidden-content tools in IO ring ----------

def test_hidden_tool_args_redacted():
    """Hidden-content tool calls must have REDACTED args/result in the IO ring."""
    _reset_rings()
    log_rings.record_io(
        tool="npcVoice",
        args={"secret": SENTINEL, "npc": "hidden"},
        ok=True,
        duration_ms=50,
        payload={"result": SENTINEL, "knows": "secrets"},
        user="test-user-1865",
    )
    ring = list(log_rings.IO.buf)
    assert len(ring) > 0
    entry = ring[-1]
    assert str(entry.get("args", "")) == "***REDACTED***", (
        f"Hidden tool args should be REDACTED: {entry.get('args')}"
    )
    assert str(entry.get("result", "")) == "***REDACTED***", (
        f"Hidden tool result should be REDACTED: {entry.get('result')}"
    )
    # Tool name and timing should still be visible
    assert entry.get("tool") == "npcVoice"
    assert "HIDDEN CONTENT" in entry.get("msg", "")


def test_normal_tool_not_redacted():
    """Normal (non-hidden) tool calls should show normal content."""
    _reset_rings()
    log_rings.record_io(
        tool="advanceClock",
        args={"days": 1},
        ok=True,
        duration_ms=20,
        payload="ok",
        user="test-user-1865",
    )
    ring = list(log_rings.IO.buf)
    assert len(ring) > 0
    entry = ring[-1]
    assert entry.get("tool") == "advanceClock"
    assert "HIDDEN CONTENT" not in entry.get("msg", "")
    # Args should show actual content, not REDACTED
    assert "***REDACTED***" not in str(entry.get("args", ""))


def test_hidden_tool_knowledge_scope_redacted():
    """knowledgeScopeManifest is also a hidden-content tool."""
    _reset_rings()
    log_rings.record_io(
        tool="knowledgeScopeManifest",
        args={"scope": SENTINEL},
        ok=True,
        duration_ms=30,
        payload=SENTINEL,
    )
    ring = list(log_rings.IO.buf)
    assert len(ring) > 0
    entry = ring[-1]
    assert str(entry.get("args", "")) == "***REDACTED***"
    assert str(entry.get("result", "")) == "***REDACTED***"


def test_hidden_tool_get_offscreen_redacted():
    """getOffscreenSceneSkeletons is also a hidden-content tool."""
    _reset_rings()
    log_rings.record_io(
        tool="getOffscreenSceneSkeletons",
        args={"hidden_data": SENTINEL},
        ok=True,
        duration_ms=40,
        payload={"scenes": SENTINEL},
    )
    ring = list(log_rings.IO.buf)
    assert len(ring) > 0
    entry = ring[-1]
    assert str(entry.get("args", "")) == "***REDACTED***"
    assert str(entry.get("result", "")) == "***REDACTED***"


def test_hidden_tool_get_moment_prompt_redacted():
    """getMomentPrompt is also a hidden-content tool."""
    _reset_rings()
    log_rings.record_io(
        tool="getMomentPrompt",
        args={"prompt": SENTINEL},
        ok=False,
        duration_ms=500,
        payload={"error": "timeout"},
    )
    ring = list(log_rings.IO.buf)
    assert len(ring) > 0
    entry = ring[-1]
    # Even on failure, hidden tool args/result should be REDACTED
    assert str(entry.get("args", "")) == "***REDACTED***"
    assert str(entry.get("result", "")) == "***REDACTED***"
    # Failed status visible
    assert entry.get("ok") is False
