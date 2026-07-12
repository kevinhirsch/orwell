"""Batch C gate #6 (2026-07-11 narrator-prompt audit) — DEAD-MUTATOR gate.

Two FE-side lists name the game-mutating tools by string:
  • chat.js's `[...].includes(json.tool)` list — every tool whose result nudges the g15 freshness seam;
  • chat_helpers' `GAME_ENGINE_WRITE_TOOLS` — every tool whose call counts as a real WRITE (peer-push,
    the E22 "narrated but never recorded" guard).

A tool name in EITHER list that the FE cannot actually invoke is DEAD — it can never fire the seam it
is registered for. `turnIn` shipped exactly this way: listed in both, but with no FE surface, so its
mutation never nudged a peer window or counted as a write until it was wired. Nothing caught it.

This gate asserts every tool named in either list is FE-callable — i.e. the FE invokes it by that
exact name through `orwell_engine._call("X", …)` (the single invoke-by-name chokepoint) or exposes it
as a model tool schema. A dead entry fails here.
"""
import importlib
import os
import re

# Cycle-safe import order (mirror test_c13_lever_drift.py): orwell_engine → tool_implementations →
# agent_tools → tool_schemas, so the tool_schemas ⇄ agent_tools cycle resolves.
orwell_engine = importlib.import_module("src.orwell_engine")
importlib.import_module("src.tool_implementations")
importlib.import_module("src.agent_tools")
tool_schemas = importlib.import_module("src.tool_schemas")
chat_helpers = importlib.import_module("routes.chat_helpers")

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _fe_callable_tools() -> set[str]:
    """Every engine tool the FE can invoke by name: the `_call("X", …)` invoke-by-name chokepoint in
    orwell_engine.py (covers model-dispatched wrappers AND FE-driven write-backs), unioned with the
    model tool-schema names."""
    with open(os.path.join(FRONTEND, "src", "orwell_engine.py"), encoding="utf-8") as f:
        oe = f.read()
    call_names = set(re.findall(r'_call(?:_inner)?\(\s*"([A-Za-z_]+)"', oe))
    schema_names = {
        t["function"]["name"]
        for t in tool_schemas.FUNCTION_TOOL_SCHEMAS
        if isinstance(t, dict) and t.get("type") == "function"
    }
    return call_names | schema_names


def _chatjs_gamechanged_tools() -> set[str]:
    """The game-mutating tools the chat.js g15 seam refreshes on. Since #1412 (R1b) the seam consumes
    the shared manifest (`window.orwellIsMutatingTool`) instead of a hand-coded `.includes(json.tool)`
    array, so the authoritative set is `platform.js` `ORWELL_MUTATING_TOOLS` (pinned registry-equal by
    test_1412_mutating_manifest.py). This gate still proves every one of them is FE-callable."""
    with open(os.path.join(FRONTEND, "static", "js", "platform.js"), encoding="utf-8") as f:
        js = f.read()
    m = re.search(r"ORWELL_MUTATING_TOOLS\s*=\s*Object\.freeze\(\[(.*?)\]\)", js, re.S)
    assert m, "platform.js must export const ORWELL_MUTATING_TOOLS = Object.freeze([ ... ])"
    body = re.sub(r"//[^\n]*", "", m.group(1))  # strip // comments so words can't masquerade
    return set(re.findall(r"'([A-Za-z][A-Za-z0-9]*)'", body))


def test_chatjs_gamechanged_list_tools_are_all_fe_callable():
    listed = _chatjs_gamechanged_tools()
    assert listed, "found no chat.js `.includes(json.tool)` game-mutating list — parser/shape changed"
    # Sanity: it is the real mutating list (has the core progression tools).
    assert {"advanceGame", "submitDecision"} <= listed, f"unexpected chat.js list: {sorted(listed)}"
    callable_ = _fe_callable_tools()
    dead = sorted(t for t in listed if t not in callable_)
    assert not dead, (
        f"chat.js's gamechanged list names tools the FE cannot invoke: {dead} — they can never fire "
        "the g15 freshness seam they are registered for (this is how `turnIn` sat dead)"
    )


def test_chat_helpers_write_tool_set_is_all_fe_callable():
    write_tools = set(chat_helpers.GAME_ENGINE_WRITE_TOOLS)
    assert write_tools, "chat_helpers.GAME_ENGINE_WRITE_TOOLS is empty — shape changed"
    callable_ = _fe_callable_tools()
    dead = sorted(t for t in write_tools if t not in callable_)
    assert not dead, (
        f"chat_helpers.GAME_ENGINE_WRITE_TOOLS names tools the FE cannot invoke: {dead} — a listed "
        "'write' that can never actually be called counts no write and pushes to no peer window"
    )


def test_turnIn_is_no_longer_dead_in_either_list():
    # Regression pin for the exemplar: turnIn is in BOTH lists AND is now FE-callable.
    assert "turnIn" in _chatjs_gamechanged_tools()
    assert "turnIn" in set(chat_helpers.GAME_ENGINE_WRITE_TOOLS)
    assert "turnIn" in _fe_callable_tools()
