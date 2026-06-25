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
