"""Orwell #872 (item A) — chat.js must never render a raw HTTP status to the player.

A 400/5xx surfaced on the chat stream used to print the raw status ("Error 400" / "OpenRouter
returned HTTP 400…") into the GM body bubble, where it reads as a literal Big Brother / producer
message. In the game build the live error render must be DIEGETIC; outside the game build the
informative error is kept (debuggability). Source-pinned (the JS branch is exercised live).

B11 (2026-07-05) consolidated the inline diegetic string this test used to pin into the shared
`_ENGINE_INTERRUPT_LINE` module constant (reused by every raw-fallback fix in that wave — see
`test_b11_error_copy_in_persona.py`) — the ternary now references the constant by name instead of
repeating the literal, so this test resolves the constant's own definition to check its content.
"""
import os
import re


def _read(*parts):
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(root, *parts), encoding="utf-8") as f:
        return f.read()


def _engine_interrupt_line(chat):
    m = re.search(
        r"const _ENGINE_INTERRUPT_LINE\s*=\s*([\"'])(.*?)\1\s*;", chat, re.S)
    assert m, "could not find the _ENGINE_INTERRUPT_LINE constant definition"
    return m.group(2)


def test_stream_error_is_diegetic_in_the_game_build():
    chat = _read("static", "js", "chat.js")
    # the raw provider message is captured but NOT rendered verbatim in the game build
    assert "const rawErrMsg = json.text || json.error?.message" in chat, (
        "the raw error must be captured into rawErrMsg for logging / non-game render")
    # the rendered message is chosen by build: diegetic line in the game build, raw otherwise
    assert "const errMsg = isGameBuild()" in chat
    m = re.search(r"const errMsg = isGameBuild\(\)\s*\?\s*(\w+)\s*\n\s*:\s*rawErrMsg;", chat)
    assert m, "could not find the game-build diegetic error line's ternary"
    assert m.group(1) == "_ENGINE_INTERRUPT_LINE", (
        "the game-build error line must reuse the ONE canonical diegetic constant, not a new string")
    # the canonical line itself is in-fiction (no HTTP/status/Error words)
    diegetic = _engine_interrupt_line(chat)
    for forbidden in ("Error", "HTTP", "400", "500", "status", "OpenRouter"):
        assert forbidden not in diegetic, (
            f"the diegetic error line leaks machinery word {forbidden!r}: {diegetic!r}")
    # and it is what gets typed into the body
    assert "typewriterInto(roundHolder.querySelector('.body'), errMsg);" in chat
    # the raw status is only ever console-logged, never the rendered text in the game build
    assert "console.error('Stream error:', rawErrMsg);" in chat


def test_non_game_build_keeps_the_informative_error():
    chat = _read("static", "js", "chat.js")
    # the false branch of the ternary keeps rawErrMsg so a misconfigured assistant build is debuggable
    assert ": rawErrMsg;" in chat
