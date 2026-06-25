"""BUG 2 (truncation): a long, clean narration reply must reach the player IN FULL — no tail-drop.

The owner saw a live-game narration bubble cut off mid-sentence ("…reading this week so") on a turn
that finished cleanly (finish_reason=stop, 0 tool calls). The live game runs the agent loop's SCRUB
path (`_scrub_active`), which streams the reply through `_split_complete_sentences` — emitting only
WHOLE sentences and buffering the trailing incomplete one in `_game_buf` — then flushes that tail at
round end. A regression in that peel/flush (or the per-sentence pre-emission guard) would silently
eat the last sentence(s), reading exactly like a mid-sentence cut.

This drives the REAL `stream_agent_loop` over a fake multi-chunk LLM stream (>1.5k chars, no
closed-set board claims so the pre-emission guard is a no-op, `owner=None` so it fail-opens) and
asserts the concatenated emitted reply deltas reconstruct the FULL input — INCLUDING a final
unterminated sentence. The whole point of #822's lesson: prove the stream change against the real
consumer, not a stub.
"""
import asyncio
import json
import os

import pytest

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _chunks_for(text: str, *, n: int = 40):
    """Slice `text` into ~n SSE reply deltas (json.thinking falsy) — a realistic multi-chunk stream."""
    step = max(1, len(text) // n)
    out = []
    for i in range(0, len(text), step):
        out.append('data: ' + json.dumps({"delta": text[i:i + step]}) + '\n\n')
    return out


def _drive_scrub_loop(monkeypatch, reply_text: str, *, finish_reason: str = "stop") -> str:
    """Drive the REAL stream_agent_loop with the SCRUB path active (game build on, live game),
    feeding `reply_text` as many reply deltas. Returns the concatenated EMITTED reply text (the
    `{"delta": …}` events with no `thinking` flag) — i.e. exactly what the player's bubble receives."""
    from src import agent_loop as al

    # Game build ON ⇒ `_scrub_active` true (the live-game streaming path). owner stays None so the
    # pre-emission outcome guard fail-opens (we test the peel/flush, not the closed-set guard).
    monkeypatch.setenv("ORWELL_GAME_BUILD", "1")
    monkeypatch.setattr(al, "get_setting", lambda key, default=None: default)
    import src.tool_index as ti
    monkeypatch.setattr(ti, "get_tool_index", lambda: None)

    async def fake_stream(candidates, messages, **kwargs):
        for c in _chunks_for(reply_text):
            yield c
        yield 'data: ' + json.dumps({"type": "finish", "reason": finish_reason}) + '\n\n'
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
            game_mode="game",   # live game ⇒ scrub path
            owner=None,         # ⇒ pre-emission guard is a no-op (fail-open)
        )
        async for chunk in gen:
            if not chunk.startswith("data: ") or chunk.startswith("data: [DONE]"):
                continue
            try:
                ev = json.loads(chunk[6:])
            except Exception:
                continue
            # The player bubble renders reply deltas (json.thinking falsy). Collect exactly those.
            if isinstance(ev, dict) and "delta" in ev and not ev.get("thinking"):
                emitted.append(ev["delta"])

    asyncio.get_event_loop().run_until_complete(drive())
    return "".join(emitted)


# A long, clean BB narration with several sentence boundaries (newlines + . ! ?) and a FINAL
# unterminated sentence (the tail most at risk of being eaten by the peel/flush). No closed-set
# board-outcome language, so the pre-emission guard never engages. >1.5k chars.
_LONG_REPLY = (
    "Ariana takes the single syllable you offered and turns it over like a coin she isn't sure is "
    "real. The kitchen is loud in the way that only a half-asleep house can be loud, everyone "
    "talking past each other about nothing. She leans against the counter and watches the kettle. "
    "You can tell she's deciding how much of herself to spend on this conversation.\n\n"
    "Across the room someone laughs too hard at a joke that wasn't funny, and the sound bounces off "
    "the glass and dies somewhere near the storage room door. Ariana doesn't flinch. She's good at "
    "letting the room move around her without letting it move her. That stillness is its own kind of "
    "strategy, and you suspect she knows it.\n\n"
    "She tells you, almost as an aside, that she slept badly and that the mattress on her side of "
    "the room has a spring that finds her spine no matter how she lies. It's small talk, but small "
    "talk is how she takes your temperature without seeming to. You answer in kind and watch her "
    "watch you do it. Two people being careful, pretending not to be.\n\n"
    "Somewhere down the hall a door opens and closes, and her eyes flick toward the sound and back. "
    "She doesn't say who she thinks it was. She files it away, the way she files everything away, "
    "and returns her attention to you with the unhurried patience of someone who has decided you are "
    "worth a few more minutes of the morning.\n\n"
    "When she finally speaks it's quiet, pitched just for you. She talks about the book she's been "
    "reading this week so"  # <-- deliberately unterminated final sentence (the at-risk tail)
)


def test_long_clean_narration_reaches_the_bubble_in_full(monkeypatch):
    emitted = _drive_scrub_loop(monkeypatch, _LONG_REPLY)
    # Sanity: the test corpus actually exercises the long-stream path.
    assert len(_LONG_REPLY) > 1400
    # The FULL reply must arrive — the scrub peel must not drop any complete sentence...
    assert emitted == _LONG_REPLY, (
        "the live-game scrub path dropped part of a clean narration reply (tail-drop / silent "
        f"truncation). emitted {len(emitted)} of {len(_LONG_REPLY)} chars; "
        f"tail seen: {emitted[-80:]!r}"
    )


def test_unterminated_final_sentence_is_flushed_not_eaten(monkeypatch):
    # The owner's exact symptom: the reply ended mid-sentence ("…reading this week so"). The trailing
    # incomplete sentence lives in `_game_buf` and MUST be flushed at round end, not discarded.
    emitted = _drive_scrub_loop(monkeypatch, _LONG_REPLY)
    assert emitted.rstrip().endswith("reading this week so"), (
        "the trailing UNTERMINATED sentence was eaten — `_game_buf` was not flushed at round end "
        f"(emitted tail: {emitted[-80:]!r})"
    )


def test_short_unterminated_reply_still_fully_emitted(monkeypatch):
    # A whole short reply that never reaches a sentence terminator must still emit in full (the entire
    # thing sits in `_game_buf` until the end-of-round flush).
    short = "Ariana just looks at you for a long moment and says nothing at all only she"
    emitted = _drive_scrub_loop(monkeypatch, short)
    assert emitted == short, f"a terminator-less short reply was dropped: {emitted!r}"


# ── BUG 2 root cause (2026-06-25 live RCA): the over-broad START scrub ──────────────────────────
# Caught LIVE against real OpenRouter/DeepSeek-V4-Pro: the casting GM wrote a clean 855-char reply
# ending with the in-character host line "I'll get the rest out of you another way." The server-side
# `_GAME_LEAK_START_RE` deleted that whole sentence (BUG2-len: raw_reply=855 -> emitted_visible=813,
# a 42-char drop), because the OLD pattern matched a BARE first-person modal at sentence start
# ("I'll", "I'd", "I can", "Let me", "Now, I") and stopped — with NO requirement that a tool-PROCESS
# verb follow. So legitimate first-person GM/NPC narration was silently truncated, which the player
# reads as a mid-sentence cut. The fix requires an operator verb after the opener.
#
# A long in-character reply whose sentences OPEN with first-person modals but carry NO tool-process
# verb must reach the bubble IN FULL. >1.5k chars; no closed-set board claims (guard is a no-op).
_LONG_FIRST_PERSON_REPLY = (
    "Big Brother leans back in the chair and lets the silence stretch until you fill it. "
    "\"I'll be honest with you,\" he says, \"the wall behind me is bare for a reason.\"\n\n"
    "I'll get the rest out of you another way. I can already tell you're the kind who plays "
    "their cards close, and I'd respect that more if it weren't going to get you evicted in week "
    "two. Let me show you how this works, since you clearly haven't done your homework.\n\n"
    "Now, I'll walk you through the house one room at a time. First, I'll point you toward the "
    "kitchen, where the alliances get cooked alongside the eggs. I can promise you that's where "
    "half your game gets decided, and I'd bet you haven't thought about that at all.\n\n"
    "\"I'll tell you a secret,\" he adds, lowering his voice as if the cameras weren't already "
    "catching every word. \"I can see who's going to crack before they can. I'd put money on it.\" "
    "Let me give you one piece of advice before the doors open: trust no one, and especially not "
    "the ones who tell you to trust them.\n\n"
    "I'll be watching you the whole way. I can make this season unforgettable, but only if you "
    "give me something to work with. I'd hate to waste a good villain edit on someone who folds. "
    "Let me be clear about the stakes here so there's no confusion later when it all goes sideways.\n\n"
    "I can already picture the eviction night where you realize, far too late, who had your number "
    "the entire time. I'd light a candle for that version of you, but production frowns on open "
    "flames near the memory wall. Now, I'll let you in on one more thing before the music starts: "
    "the people who survive in here are the ones who can hold two truths at once and never blink.\n\n"
    "So let me ask you, one last time, before I send you in there to the wolves and the cameras "
    "and the long sleepless nights"  # <-- deliberately unterminated tail
)


def test_in_character_first_person_lines_are_not_scrubbed(monkeypatch):
    # Every sentence here opens with a first-person modal ("I'll", "I can", "I'd", "Let me",
    # "Now, I'll", "First, I'll") but NONE narrate a tool/engine process — they are in-character GM
    # dialogue/narration. The full reply must reach the player.
    emitted = _drive_scrub_loop(monkeypatch, _LONG_FIRST_PERSON_REPLY)
    assert len(_LONG_FIRST_PERSON_REPLY) > 1400
    assert emitted == _LONG_FIRST_PERSON_REPLY, (
        "the live-game scrub deleted an in-character first-person line (the BUG 2 over-broad START "
        f"scrub). emitted {len(emitted)} of {len(_LONG_FIRST_PERSON_REPLY)} chars; "
        f"tail seen: {emitted[-80:]!r}"
    )


def test_exact_live_captured_line_survives_scrub():
    # The exact 42-char sentence the LIVE BUG2-len drop deleted. A focused unit check on the helper
    # so a future regex change can't silently re-introduce the over-broad START scrub.
    from src.agent_loop import _scrub_game_leak
    line = " I'll get the rest out of you another way."
    assert _scrub_game_leak(line) == line, (
        f"the in-character host line was scrubbed as an operator aside: {_scrub_game_leak(line)!r}"
    )
    # And the leak it was confused with MUST still be stripped (no regression on the real contract).
    assert _scrub_game_leak("I'll record this and advance the game.").strip() == ""
    assert _scrub_game_leak("Now, I'll present the binding choice.").strip() == ""
