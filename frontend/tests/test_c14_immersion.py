"""Queue C14 — game turns always act; the immersion bleed is closed.

Three guards:
  1. PREAMBLE SUBSTITUTION (audit N3/N5/N7): a game-framed turn gets the minimal game
     tool contract INSTEAD of the generic assistant preamble + rulebook — "You are an AI
     assistant" never co-occurs with the game-master prompt, and the rules that actively
     fought the game (improvise-after-failure, don't-search-what-you-know) are gone.
  2. TOOL-LESS PATHS REFUSE TO GAME-MASTER (audit F3): the sync /api/chat endpoint 409s
     on a game turn; a can_use_agent=False user keeps the agent path with the tool set
     collapsed to the game keep-set.
  3. DIEGETIC TOOL NODES (audit F6): engine tools render as production beats — label +
     status, never raw camelCase names or JSON payloads in the transcript.
"""

import importlib
import os

agent_loop = importlib.import_module("src.agent_loop")

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*rel):
    with open(os.path.join(FRONTEND, *rel), encoding="utf-8") as f:
        return f.read()


GM_PROMPT = "You are Big Brother: the host. [GM-PROMPT-MARKER]"


def _system_text(game_mode: bool) -> str:
    messages, _schemas = agent_loop._build_system_prompt(
        [{"role": "system", "content": GM_PROMPT},
         {"role": "user", "content": "hi"}],
        model="m", active_document=None, mcp_mgr=None,
        disabled_tools=set(), game_mode=game_mode,
    )
    return "\n\n".join(m["content"] for m in messages if m.get("role") == "system")


# --- 1. preamble substitution ---------------------------------------------------------

def test_game_turn_substitutes_the_preamble():
    text = _system_text(game_mode=True)
    assert "[GM-PROMPT-MARKER]" in text                       # the GM prompt leads
    assert "You are an AI assistant" not in text              # F6's contradiction gone
    assert "A failed tool is not a stopping condition" not in text   # N5's improvise rule gone
    assert "Don't search for things you already know" not in text    # N7's contradiction gone
    # the game tool contract is present
    assert "IF AN OUTCOME TOOL FAILS" in text
    assert "never state week, phase, HOH, nominees, or veto from recollection" in text
    assert "ONLY through submitDecision" in text
    assert "ask_user" in text                                  # F4: pending options as buttons


def test_non_game_turn_keeps_the_generic_preamble():
    text = _system_text(game_mode=False)
    assert "You are an AI assistant" in text
    assert "IF AN OUTCOME TOOL FAILS" not in text


def test_outcome_error_rule_forbids_invented_results():
    p = agent_loop.GAME_AGENT_PREAMBLE
    assert "do NOT narrate any result" in p
    assert "improvise a winner" in p
    assert "live feed glitched" in p


# --- 2. tool-less paths ----------------------------------------------------------------

def test_sync_chat_declines_to_game_master():
    src = _read("routes", "chat_routes.py")
    assert "game turns must use the streaming chat" in src
    # the guard fires on ctx.game_active in the SYNC route (409), before any LLM call
    assert src.index("game turns must use the streaming chat") < src.index("Research injection")


def test_privilege_flip_keeps_the_agent_for_game_turns():
    src = _read("routes", "chat_routes.py")
    block = src[src.index('if not _privs.get("can_use_agent", True)'):]
    block = block[:600]
    assert "ctx.game_active" in block
    assert "game_build_disabled_additions" in block


def test_agent_loop_receives_game_mode():
    src = _read("routes", "chat_routes.py")
    assert "game_mode=ctx.game_active" in src


# --- 3. diegetic tool nodes -------------------------------------------------------------

def test_game_tools_have_production_beat_labels():
    js = _read("static", "js", "chat.js")
    assert "_orwellToolBeats" in js
    for tool in ("advanceGame", "submitDecision", "runCompetition", "diaryRoom",
                 "makeDeal", "socialInitiatives", "recordInteraction", "finaleView"):
        assert f"'{tool}':" in js, f"{tool} missing a diegetic beat label"


def test_game_tool_nodes_suppress_raw_payloads():
    js = _read("static", "js", "chat.js")
    # tool start: args suppressed; tool output: args + raw JSON output suppressed
    assert "if (_beat) cmd = ''" in js
    assert "if (_beatOut) { cmd = ''; outHtml = ''; }" in js
    # the rendered label is the beat, not the raw tool name
    assert "_beatOut || json.tool" in js
