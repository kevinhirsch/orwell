"""DSML stream-leak fix.

In live finale play, raw deepseek tool-call markup leaked into the player-visible STREAM:
`<｜DSML｜tool_calls>` / `</｜DSML｜invoke>` / `</｜DSML｜tool_calls>`. DeepSeek emits tool
calls as TEXT when it can't produce structured tool_calls; the server normalizes DSML in
tool_parsing (_normalize_dsml / strip_tool_blocks) AFTER the round, but the streaming deltas
already showed the raw markup. The fix adds a stream-time opener predicate so the agent loop
halts visible content the moment a tool-call / DSML opener appears — the post-round parser still
extracts the actual call, the player just never sees the raw markup.
"""

import importlib

# Establish the normal import order (agent_tools <-> tool_parsing have a load-order coupling).
import src.agent_tools  # noqa: F401
tp = importlib.import_module("src.tool_parsing")


# ── the stream-time opener predicate ────────────────────────────────────── #

def test_predicate_detects_dsml_pipe_opener_mid_narration():
    # The exact leak: DSML markup beginning after some narration.
    assert tp.starts_tool_call_markup("...narration <｜DSML｜tool_calls>") is True
    # Index points at the opener, not the narration.
    idx = tp.tool_call_opener_index("...narration <｜DSML｜tool_calls>")
    assert idx == len("...narration ")


def test_predicate_detects_dsml_invoke_opener_at_start():
    assert tp.starts_tool_call_markup('<｜DSML｜invoke name="recordInteraction">') is True
    assert tp.tool_call_opener_index('<｜DSML｜invoke name="recordInteraction">') == 0


def test_predicate_detects_ascii_pipe_dsml_variant():
    # deepseek also emits ascii-pipe variants.
    assert tp.starts_tool_call_markup("text <|DSML|tool_calls>") is True


def test_predicate_detects_standard_openers():
    assert tp.starts_tool_call_markup("done <invoke name=\"bash\">") is True
    assert tp.starts_tool_call_markup("ok <tool_call>") is True
    assert tp.starts_tool_call_markup("ok <function_call>") is True
    assert tp.starts_tool_call_markup("[TOOL_CALL] {tool => 'bash'}") is True


def test_predicate_false_for_ordinary_narration():
    assert tp.starts_tool_call_markup(
        "The houseguests gather in the living room. Chandler smiles at Selena.") is False
    # Prose with bare < / > comparisons must NOT trip it (no pipe / no tool tag).
    assert tp.starts_tool_call_markup("She muttered that 3 < 5 and x > 2 in the math comp.") is False
    assert tp.starts_tool_call_markup("") is False
    assert tp.tool_call_opener_index("plain narration, no markup") == -1


# ── the post-round stripper still removes the exact leaked block ─────────── #

def test_strip_tool_blocks_removes_the_exact_leaked_block():
    blk = "text <｜DSML｜tool_calls>\n</｜DSML｜invoke>\n</｜DSML｜tool_calls>"
    assert tp.strip_tool_blocks(blk) == "text"


def test_normalize_dsml_round_trips_to_standard_invoke():
    raw = '<｜DSML｜tool_calls><｜DSML｜invoke name="advanceGame"></｜DSML｜invoke></｜DSML｜tool_calls>'
    norm = tp._normalize_dsml(raw)
    assert "<tool_call>" in norm and "<invoke name=" in norm
    assert "DSML" not in norm


# ── stream-time gating simulation: a truncating buffer halts at the opener ─ #

def test_stream_gate_truncates_at_opener_and_stops_emitting():
    """Model the agent loop's visible-stream gate: accumulate raw deltas into round_response,
    emit only up to the first tool-call opener, then stop emitting. The opener regex is the
    same one the loop imports (tool_call_opener_index)."""
    deltas = [
        "Selena leans in and whispers her plan. ",
        "The room goes quiet. ",
        "<｜DSML｜tool_calls>",                 # opener arrives mid-stream
        '<｜DSML｜invoke name="recordInteraction">',
        "</｜DSML｜tool_calls>",
    ]
    round_response = ""
    emitted = ""
    emitted_len = 0
    halted = False
    for d in deltas:
        round_response += d
        if halted:
            continue
        op = tp.tool_call_opener_index(round_response)
        if op >= 0:
            halted = True
            emitted += round_response[emitted_len:op]
        else:
            emitted += round_response[emitted_len:]
            emitted_len = len(round_response)
    # The player saw only the narration, never the raw DSML markup.
    assert emitted == "Selena leans in and whispers her plan. The room goes quiet. "
    assert "DSML" not in emitted
    # ...yet the raw response (for the post-round parser) still holds the full markup.
    assert "DSML" in round_response


# ── source-pin: the loop imports + uses the gate on both visible paths ──── #

def test_agent_loop_uses_the_opener_gate():
    import os
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(base, "src", "agent_loop.py"), encoding="utf-8") as fh:
        src = fh.read()
    assert "tool_call_opener_index" in src
    # Guard exists on the scrub path AND the non-scrub path.
    assert "_visible_halted" in src
    assert src.count("tool_call_opener_index(round_response)") >= 2
