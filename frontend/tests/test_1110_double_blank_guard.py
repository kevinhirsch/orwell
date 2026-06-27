"""#1110 — the DOUBLE-BLANK guard: two empty visible rounds must never leave an empty bubble.

The model produced reasoning/planning-only content (0 visible chars after the live-game scrub) on
BOTH round 1 AND the blank-turn guard's single re-prompt round. The existing blank-turn guard only
re-prompts ONCE (`_turn_narrate_nudges < 1`), so when the re-prompt ALSO comes back empty the turn
would end on a wholly EMPTY player bubble. The double-blank guard catches that second failure and
emits a minimal in-character continuation so the player always has something to act on — and never
leaks reasoning/machinery into the public bubble (the channel split stays intact).

This drives the REAL `stream_agent_loop` over the live-game scrub path with a fake LLM stream that
returns ONLY machinery-aside content (which the scrub strips to empty) on every round. We assert the
player bubble (reply deltas, `json.thinking` falsy) is NON-empty AND carries no machinery/leak text.

Roles only — no houseguest names.
"""
import asyncio
import json
import os

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


def _drive_double_blank(monkeypatch, round_payloads):
    """Drive the REAL stream_agent_loop (game build on, live game ⇒ scrub path). `round_payloads`
    is a list of per-round reply texts (non-thinking deltas) — round N gets payload[min(N, last)].
    Returns the concatenated EMITTED reply text the player's bubble receives (thinking deltas
    excluded)."""
    from src import agent_loop as al

    monkeypatch.setenv("ORWELL_GAME_BUILD", "1")
    monkeypatch.setattr(al, "get_setting", lambda key, default=None: default)
    import src.tool_index as ti
    monkeypatch.setattr(ti, "get_tool_index", lambda: None)

    _round = {"n": 0}

    async def fake_stream(candidates, messages, **kwargs):
        i = min(_round["n"], len(round_payloads) - 1)
        text = round_payloads[i]
        _round["n"] += 1
        # emit the round's reply text as ordinary (non-thinking) deltas, then finish cleanly
        yield 'data: ' + json.dumps({"delta": text}) + '\n\n'
        yield 'data: ' + json.dumps({"type": "finish", "reason": "stop"}) + '\n\n'
        yield "data: [DONE]\n\n"

    monkeypatch.setattr(al, "stream_llm_with_fallback", fake_stream)

    emitted = []

    async def drive():
        gen = al.stream_agent_loop(
            "https://api.openai.com/v1/chat/completions",
            "deepseek/deepseek-v4-pro",
            [{"role": "system", "content": "You are Big Brother, the narrator."},
             {"role": "user", "content": "Take a slow lap around the house."}],
            max_rounds=4,
            game_mode="game",   # live game ⇒ scrub path + the blank-turn / double-blank guards
            owner=None,         # ⇒ engine-dependent belts fail-open; we test the guard only
        )
        async for chunk in gen:
            if not chunk.startswith("data: ") or chunk.startswith("data: [DONE]"):
                continue
            try:
                ev = json.loads(chunk[6:])
            except Exception:
                continue
            if isinstance(ev, dict) and "delta" in ev and not ev.get("thinking"):
                emitted.append(ev["delta"])

    asyncio.get_event_loop().run_until_complete(drive())
    return "".join(emitted)


# A round whose ENTIRE visible content is a machinery/operator aside — the live-game scrub strips it
# to empty, so `_emitted_visible` stays False (exactly the planning-only round that caused #1110).
_MACHINERY_ONLY = "Let me record this interaction and advance the game to the nominations phase."


def test_double_blank_round_does_not_leave_an_empty_bubble(monkeypatch):
    # round 1 scrubs to empty → blank-turn guard re-prompts → the re-prompt round ALSO scrubs to
    # empty → the double-blank guard must emit a minimal in-character continuation.
    emitted = _drive_double_blank(monkeypatch, [_MACHINERY_ONLY, _MACHINERY_ONLY])
    assert emitted.strip(), (
        "two empty visible rounds left the player a wholly EMPTY bubble — the #1110 double-blank "
        "guard did not emit a continuation."
    )


def test_double_blank_continuation_leaks_no_machinery_or_reasoning(monkeypatch):
    # The continuation must be plain in-character scene-cue prose — no engine/tool/machinery words,
    # no leaked planning. (Channel split + Vault Wall stay intact.)
    emitted = _drive_double_blank(monkeypatch, [_MACHINERY_ONLY, _MACHINERY_ONLY])
    lowered = emitted.lower()
    for banned in ("record this interaction", "advance the game", "advancegame",
                   "recordinteraction", "the engine", "let me record"):
        assert banned not in lowered, f"the double-blank continuation leaked machinery: {banned!r}"


def test_a_single_blank_then_real_narration_does_not_trigger_the_guard(monkeypatch):
    # round 1 scrubs to empty (blank-turn guard re-prompts), but the re-prompt round narrates a real
    # scene — the double-blank guard must NOT fire, and the player sees ONLY the real narration (not
    # the fallback continuation stacked on top).
    real = "The kitchen settles as you walk in and a houseguest looks up to catch your eye."
    emitted = _drive_double_blank(monkeypatch, [_MACHINERY_ONLY, real])
    assert real in emitted
    assert "what do you want to do?" not in emitted.lower(), (
        "the double-blank continuation stacked on top of a real re-prompt narration"
    )


def test_double_blank_guard_is_wired_in_the_live_game_branch():
    # Source-pin the guard so a refactor can't silently drop it: it sits as the `elif` after the
    # single-re-prompt blank-turn guard, inside the live-game finishing branch.
    src = _read("src", "agent_loop.py")
    assert "DOUBLE-BLANK guard" in src
    assert "_turn_narrate_nudges < 1" in src  # the single re-prompt guard it follows
    # the continuation is emitted as a non-thinking reply delta and marks the turn visible
    guard = src[src.index("DOUBLE-BLANK guard"):]
    guard = guard[:guard.index("elif game_mode == \"casting\":")]
    assert "_emitted_visible = True" in guard
    assert '{"delta": _blank_fallback}' in guard
