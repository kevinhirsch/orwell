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


def _system_text(game_mode) -> str:
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


def test_casting_turn_substitutes_the_casting_contract():
    # P3: a FRAMED pre-game (casting interview) turn substitutes too — the producer persona
    # must never stack on the generic assistant preamble + rulebook.
    text = _system_text(game_mode="casting")
    assert "[GM-PROMPT-MARKER]" in text                       # the interview prompt leads
    assert "You are an AI assistant" not in text
    assert "A failed tool is not a stopping condition" not in text
    assert "Don't search for things you already know" not in text
    # the casting tool contract is present (and the live-game rules are not)
    assert "updateCasting" in text
    assert "createCharacter" in text
    assert "casting interview" in text
    assert "IF AN OUTCOME TOOL FAILS" not in text


def test_outcome_error_rule_forbids_invented_results():
    p = agent_loop.GAME_AGENT_PREAMBLE
    assert "do NOT narrate any result" in p
    assert "improvise a winner" in p
    assert "live feed glitched" in p


def test_outcome_error_rule_forbids_blind_retry_of_committing_tools():
    # E23: a timed-out advanceGame may have already committed engine-side — the contract
    # demands a gameStatus re-read before any re-issue, never an unconditional retry.
    p = agent_loop.GAME_AGENT_PREAMBLE
    assert "NEVER" in p and "blindly retry advanceGame or submitDecision" in p
    assert "double-advance" in p
    assert "re-read gameStatus" in p
    assert "may already be resolved" in p
    assert "try the call once more" not in p  # the old blind-retry instruction is gone


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
    # P3: substitution keys on FRAMED, not game_active — a live game gets the game contract,
    # a framed pre-game turn gets the casting contract, an unframed turn keeps the generic
    # preamble (and feed-down turns never masquerade as casting).
    src = _read("routes", "chat_routes.py")
    block = src[src.index("game_mode=("):]
    block = block[:400]
    assert '"game" if ctx.game_active' in block
    assert '"casting" if (ctx.framed and not ctx.feed_down)' in block


# --- 3. diegetic tool nodes -------------------------------------------------------------

def test_game_tools_have_production_beat_labels():
    # Single source of truth (./orwellToolBeats.js), shared by the live + reload paths so
    # they cannot drift — a tool labelled live but not on reload was leaking raw names + JSON.
    beats = _read("static", "js", "orwellToolBeats.js")
    assert "export const ORWELL_TOOL_BEATS" in beats
    for tool in ("advanceGame", "submitDecision", "runCompetition", "diaryRoom",
                 "makeDeal", "socialInitiatives", "recordInteraction", "finaleView",
                 "updateCasting", "getGameState"):
        assert f"'{tool}':" in beats, f"{tool} missing a diegetic beat label"
    # both render paths consume the shared map, neither redefines it
    chat = _read("static", "js", "chat.js")
    renderer = _read("static", "js", "chatRenderer.js")
    assert "from './orwellToolBeats.js'" in chat
    assert "from './orwellToolBeats.js'" in renderer
    assert "const _orwellToolBeats = {" not in chat   # the inline copy is gone


def test_game_tool_nodes_suppress_raw_payloads():
    js = _read("static", "js", "chat.js")
    # tool start: args suppressed; tool output: args + raw JSON output suppressed
    assert "if (_beat) cmd = ''" in js
    assert "if (_beatOut) { cmd = ''; outHtml = ''; }" in js
    # the rendered label is the beat, not the raw tool name
    assert "_beatOut || json.tool" in js


def test_game_build_never_labels_messages_with_the_model_name():
    # Immersion (visual audit): every AI message was labelled with the raw LLM model name
    # ("deepseek-v4-pro → …") — the narrator is the show, not a model. The game build uses a
    # diegetic sender on BOTH the live and reload paths.
    chat = _read("static", "js", "chat.js")
    assert "data-game-build" in chat and "label = 'Big Brother'" in chat
    renderer = _read("static", "js", "chatRenderer.js")
    assert renderer.count('isGameBuild() ? "Big Brother"') >= 2   # main reply + image bubble
    assert "(isGameBuild() && role === 'assistant') ? 'Big Brother'" in renderer  # the _roleText path


def test_game_build_suppresses_the_model_name_tooltip():
    # OBS-RENDER-1: the visible sender said "Big Brother", but the role header still carried a
    # hover TOOLTIP with the raw "alias -> dated-version" model string ("deepseek-v4-pro ->
    # deepseek-v4-pro-20260423"). The model machinery must be INVISIBLE in the game build —
    # including the tooltip — on BOTH the live stream and the history-reload path.
    chat = _read("static", "js", "chat.js")
    renderer = _read("static", "js", "chatRenderer.js")
    # live path: the central _setRoleModelLabel helper strips the tooltip in the game build
    assert "if (isGameBuild()) {\n      roleEl.removeAttribute('title');" in chat
    # reload path: both the continuation-round and the main-reply title sites gate on the build
    assert "if (!isGameBuild() && pair.requestedModel" in renderer   # reload continuation round
    assert "if (!isGameBuild() && !isSlash && !isCompacted" in renderer  # reload main reply


def test_game_build_uses_diegetic_sender_on_placeholder_and_continuation():
    # The model name also flashed as the SENDER on the initial placeholder bubble, on stream
    # resume/reconnect, and on continuation rounds — before the resolved-model label landed.
    # A single source (_senderLabel) keeps every placeholder diegetic in the game build.
    chat = _read("static", "js", "chat.js")
    assert "function _senderLabel(" in chat
    assert "isGameBuild() ? 'Big Brother'" in chat
    # the placeholder/resume/reconnect sites route their model label through _senderLabel
    assert chat.count("_senderLabel(") >= 4
    # the continuation-round streaming label is diegetic in the game build
    assert "newRole.textContent = isGameBuild() ? 'Big Brother'" in chat
    # a provider fallback stays diegetic too (no raw "(fallback)" model name reaches the player)
    assert "if (!isGameBuild()) {\n                        _rEl.textContent = _ansM + ' (fallback) ';" in chat


def test_reload_path_applies_production_beats():
    # The history-reload render (chatRenderer.js) was NOT applying the diegetic treatment
    # the live stream did — so re-opening a session leaked raw camelCase tool names and raw
    # engine JSON output on every reload (a Vault-Wall / refresh-persistence break).
    js = _read("static", "js", "chatRenderer.js")
    assert "import { ORWELL_TOOL_BEATS, isGameBuild } from './orwellToolBeats.js';" in js
    assert "const _gbBeat = isGameBuild();" in js
    assert "const _beat = _gbBeat ? ORWELL_TOOL_BEATS[ev.tool] : null;" in js
    # a production beat suppresses output, screenshot, diff, and raw args, and relabels the pill
    assert "if (!_beat && ev.output && ev.output.trim())" in js
    assert "_beat ? null : safeToolScreenshotSrc(ev.screenshot)" in js
    assert "if (!_beat && ev.diff && ev.diff.text)" in js
    assert "!_beat && ev.command" in js
    assert "esc(_beat || ev.tool)" in js
