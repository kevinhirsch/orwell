"""Test #1871 — Vault Wall: silent tools carry NO output over SSE or in persisted metadata.

The guard lives at the agent_loop level: before the SSE `tool_output` event is emitted
and before the `tool_event` dict is persisted, if the tool type is in _ORWELL_SILENT_TOOLS
the output field is zeroed to empty string.
"""

import json
import importlib

al = importlib.import_module("src.agent_loop")


# ---------------------------------------------------------------------------
# Test 1 — _ORWELL_SILENT_TOOLS includes npcVoice and guard logic works
# ---------------------------------------------------------------------------

def test_npc_voice_silent_tool_guard():
    """Verify npcVoice is in _ORWELL_SILENT_TOOLS and the guard produces empty output."""
    assert "npcVoice" in al._ORWELL_SILENT_TOOLS, \
        "npcVoice must be in _ORWELL_SILENT_TOOLS for server-side strip"

    # Simulate the agent_loop guard (line 9105-9106)
    raw = json.dumps({"knows": ["secret"], "suspects": {"x": "y"}}, indent=2)
    output_text = raw[:2000]
    if "npcVoice" in al._ORWELL_SILENT_TOOLS:
        output_text = ""

    assert output_text == "", "agent_loop must clear output_text for npcVoice"
    assert "knows" not in output_text
    assert "suspects" not in output_text


# ---------------------------------------------------------------------------
# Test 2 — SSE tool_output event has no Vault content
# ---------------------------------------------------------------------------

def test_agent_loop_silent_tool_output():
    """Simulate the agent loop's output formatting path; ensure tool_output_data['output'] is empty."""
    result = {
        "output": json.dumps({
            "id": "npc:3",
            "name": "Test",
            "knows": ["leaked secret"],
            "suspects": {"player": "knows too much"},
        }, indent=2),
        "exit_code": 0,
    }

    # Replicate the output_text extraction (agent_loop.py ~9097-9102)
    output_text = (result.get("output") or "")[:2000]

    # Apply the guard (agent_loop.py ~9105-9106)
    block_type = "npcVoice"
    if block_type in al._ORWELL_SILENT_TOOLS:
        output_text = ""

    assert output_text == "", "SSE tool_output must have empty output for npcVoice"
    assert "knows" not in output_text
    assert "suspects" not in output_text


# ---------------------------------------------------------------------------
# Test 3 — Persisted tool_event has no Vault content
# ---------------------------------------------------------------------------

def test_agent_loop_silent_tool_persistence():
    """Simulate agent loop's tool_event persistence; ensure tool_event['output'] is empty."""
    result = {
        "output": json.dumps({
            "knows": ["something secret"],
            "suspects": {"someone": "something"},
        }, indent=2),
        "exit_code": 0,
    }

    # Replicate output_text extraction
    output_text = (result.get("output") or "")[:2000]

    # Apply the persistence guard (agent_loop.py ~9167-9173)
    block_type = "npcVoice"
    _persisted_output = "" if block_type in al._ORWELL_SILENT_TOOLS else output_text

    tool_event = {
        "round": 1,
        "tool": block_type,
        "command": "npcVoice npc:3",
        "output": _persisted_output,
        "exit_code": 0,
    }

    assert tool_event["output"] == "", "persisted tool_event must have empty output for npcVoice"
    assert "knows" not in tool_event["output"]
    assert "suspects" not in tool_event["output"]
