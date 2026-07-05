"""B11 — engine-down / error copy must be in-persona (I9).

Three raw-fallback sites in `frontend/static/js/chat.js` could reach the player rendered AS the
narrator (or, for the step-limit note, as visible machinery text mid-turn) in the game build:

  1. CA-1 / FLOW-1 (Blocker) — `_NO_SESSION_NOTE`: clicking the engine-down holding card's own
     "Go in anyway" affordance and then sending a message with no session ever materializing
     rendered a raw vendored-chatbot message ("Use `/help`...", "the model picker", "the `+`
     button") via `addMessage('assistant', ...)` — i.e. attributed to the narrator persona itself.
  2. The FEPY-1 (#621) typed mid-stream `error` SSE (`agent_loop.py`: a bare
     `data: {"error": ...}` frame, no `event: error`, no `status`) fell all the way through
     chat.js's SSE dispatcher to the catch-all `else if (json.error)` branch, which appended a
     raw `[Error: <upstream message>]` string directly into the CURRENT round's `.body` — the
     narrator's own message — regardless of game build. (The sibling `_nextIsError || json.status
     >= 400` branch, covered by `test_872_chat_error_diegetic.py`, already gated correctly; this
     catch-all did not.)
  3. MICRO-3 (Major) — the `rounds_exhausted` note said "Reached the N-step limit — not finished."
     with a button titled "Continue the task", naming the agent loop's tool-call budget directly.

All three now gate on `isGameBuild()` and reuse the ONE canonical `_ENGINE_INTERRUPT_LINE`
constant (or, for the step-limit note, a sibling in-fiction phrase) — never a raw string, never a
new one-off string. The non-game workspace build is unchanged (source-pinned: no DOM/browser
runtime is exercised, matching this suite's existing chat.js pinning tests, e.g.
`test_872_chat_error_diegetic.py`, `test_1015_1017_1033_agent_loop_fixes.py`).
"""
import os
import re


def _read(*parts):
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(root, *parts), encoding="utf-8") as f:
        return f.read()


def _chat():
    return _read("static", "js", "chat.js")


def _engine_interrupt_line(chat):
    m = re.search(r"const _ENGINE_INTERRUPT_LINE\s*=\s*([\"'])(.*?)\1\s*;", chat, re.S)
    assert m, "could not find the _ENGINE_INTERRUPT_LINE constant definition"
    return m.group(2)


def _assert_no_machinery(text, extra_forbidden=()):
    for forbidden in ("Error", "HTTP", "status", "/help", "model picker", "chat session",
                       "+ button", "step limit", "endpoint") + tuple(extra_forbidden):
        assert forbidden not in text, f"leaks machinery word {forbidden!r}: {text!r}"


# ── The single canonical constant exists exactly once (no scattered new strings) ────────────── #

def test_engine_interrupt_line_defined_exactly_once():
    chat = _chat()
    assert chat.count("const _ENGINE_INTERRUPT_LINE =") == 1
    diegetic = _engine_interrupt_line(chat)
    _assert_no_machinery(diegetic)
    assert diegetic.strip(), "the canonical line must not be empty"


# ── Site 1 (CA-1 / FLOW-1, Blocker): _NO_SESSION_NOTE ───────────────────────────────────────── #

def test_no_session_note_is_diegetic_in_game_build():
    chat = _chat()
    m = re.search(
        r"const _NO_SESSION_NOTE = isGameBuild\(\)\s*\n\s*\?\s*(\w+)\s*\n\s*:\s*\(", chat)
    assert m, "could not find the game-build branch of _NO_SESSION_NOTE"
    assert m.group(1) == "_ENGINE_INTERRUPT_LINE", (
        "the game-build _NO_SESSION_NOTE must reuse the ONE canonical diegetic constant")


def test_no_session_note_non_game_build_keeps_the_real_guidance():
    chat = _chat()
    # the workspace (non-game) branch keeps the actionable /help guidance verbatim
    assert "Use `/help` to see all available commands" in chat
    assert "Open the model picker in the chat box and pick a model" in chat


# ── Site 2: the FEPY-1 catch-all `else if (json.error)` body-bubble leak ────────────────────── #

def test_json_error_fallback_is_diegetic_in_game_build_not_raw_bracket_error():
    chat = _chat()
    idx = chat.index("} else if (json.error) {")
    window = chat[idx:idx + 1800]
    assert "const errText = isGameBuild() ? _ENGINE_INTERRUPT_LINE : `[Error: ${json.error}]`;" in window, (
        "the json.error catch-all must gate on isGameBuild() and reuse the canonical constant, "
        "not unconditionally render a raw `[Error: ...]` string into the round's .body")
    # it still lands in THIS round's own body (same treatment as the sibling branch) — never a
    # separate un-attributed toast that would silently drop the recourse
    assert "roundHolder.querySelector('.body').appendChild(errDiv);" in window


def test_json_error_fallback_non_game_build_keeps_the_raw_diagnostic():
    chat = _chat()
    idx = chat.index("} else if (json.error) {")
    window = chat[idx:idx + 1800]
    assert ": `[Error: ${json.error}]`;" in window, (
        "the non-game workspace build must keep the raw upstream error for debuggability")


# ── Site 3 (MICRO-3): the rounds_exhausted step-limit note ──────────────────────────────────── #

def test_rounds_exhausted_step_limit_copy_gated_in_game_build():
    chat = _chat()
    idx = chat.index("json.type === 'rounds_exhausted'")
    window = chat[idx:idx + 2200]
    m = re.search(
        r"label\.textContent = isGameBuild\(\)\s*\n\s*\?\s*([\"'])(.*?)\1\s*\n\s*:\s*`Reached the",
        window, re.S)
    assert m, "could not find the gated rounds_exhausted label"
    game_build_label = m.group(2)
    _assert_no_machinery(game_build_label, extra_forbidden=("task",))
    # the button also drops workspace-y language in the game build
    assert 'contBtn.title = isGameBuild() ? \'Keep the scene going\' : \'Continue the task\';' in window
    assert "contBtn.textContent = isGameBuild() ? 'Keep going ▸' : 'Continue ▸';" in window


def test_rounds_exhausted_non_game_build_keeps_the_step_limit_diagnostic():
    chat = _chat()
    idx = chat.index("json.type === 'rounds_exhausted'")
    window = chat[idx:idx + 2200]
    assert "`Reached the ${json.rounds || ''}-step limit — not finished.`" in window
    assert "'Continue the task'" in window


# ── The truncated-response note (F-S4-D) was already diegetic-adjacent — must stay untouched ── #

def test_truncated_note_unchanged_no_regression():
    chat = _chat()
    assert "'The response was cut off before it finished.'" in chat
    assert "'Continue the response'" in chat
