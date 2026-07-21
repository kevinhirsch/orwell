"""T0-5 (#1771 F3) — the inline-planning / debugger-monologue reasoning-leak scrub.

Live playtest evidence: GLM-4.7 via some providers returns `reasoning_content` EMPTY every
round (reasoning_chars=0) and instead emits its planning trace INLINE as ordinary content, so
the thinking-channel split (`round_reasoning` / `_scrub_active`) never engages — there is no
reasoning delta to split off. Player-visible bubbles carried debugger monologues verbatim:
"I need to ground myself in the actual game state before I say anything else." and raw
engine-field jargon: "holder is null, players array is empty". `_scrub_game_leak` (the existing
operator-aside scrub) does not catch this class — its markers are tool NAMES and explicit
tool-process verbs, not generic reasoning/debugger language.

Per the T9 resiliency doctrine (owner ruling 2026-07-21) this is a PERMANENT defense-in-depth
layer — kept even after provider capability pinning (T0-4) restores a genuinely separated
reasoning channel for models that support it, which is why every trigger here is gated on
`reasoning_empty` and is a no-op when a real reasoning channel is present.

Roles only — proper nouns inside narration strings are throwaway tokens, never canonical data.
"""
from src.agent_loop import _scrub_inline_planning_leak


FRONTEND = __import__("os").path.dirname(__import__("os").path.dirname(__import__("os").path.abspath(__file__)))


def _read(*rel):
    import os
    with open(os.path.join(FRONTEND, *rel), encoding="utf-8") as f:
        return f.read()


# ── The two known playtest leak strings are scrubbed ──────────────────────────

def test_ground_myself_leak_dropped_at_bubble_start_when_reasoning_empty():
    leak = "I need to ground myself in the actual game state before I say anything else."
    out = _scrub_inline_planning_leak(leak, reasoning_empty=True, at_bubble_start=True)
    assert out.strip() == ""


def test_ground_myself_leak_dropped_but_following_narration_survives():
    # the leak is a LEADING clause, not the whole bubble — the narration that follows it must
    # survive untouched (mirrors scrubReasoningPreamble's "preamble only" contract).
    text = ("I need to ground myself in the actual game state before I say anything else. "
            "The room falls quiet as Delia sets down her mug.")
    out = _scrub_inline_planning_leak(text, reasoning_empty=True, at_bubble_start=True)
    assert "I need to ground myself" not in out
    assert "The room falls quiet as Delia sets down her mug." in out


def test_holder_null_players_array_jargon_dropped_anywhere_when_reasoning_empty():
    leak = ("The room settles into evening light. Wait, holder is null, players array is "
            "empty. Griffin leans against the counter.")
    out = _scrub_inline_planning_leak(leak, reasoning_empty=True, at_bubble_start=False)
    assert "holder is null" not in out
    assert "players array is empty" not in out
    # the real narration on either side survives byte-identical
    assert "The room settles into evening light." in out
    assert "Griffin leans against the counter." in out


def test_engine_jargon_dropped_even_as_the_leading_sentence():
    leak = "holder is null, players array is empty. You look up at the monitor overhead."
    out = _scrub_inline_planning_leak(leak, reasoning_empty=True, at_bubble_start=True)
    assert "holder is null" not in out
    assert "players array is empty" not in out
    assert "You look up at the monitor overhead." in out


# ── Legitimate in-fiction prose is NOT scrubbed ────────────────────────────────

def test_npc_saying_i_need_to_think_is_protected_by_the_quote_guard():
    # a quoted line is dialogue, never the model's own planning voice.
    dialogue = '"I need to think about this," Delia says quietly.'
    out = _scrub_inline_planning_leak(dialogue, reasoning_empty=True, at_bubble_start=True)
    assert out == dialogue


def test_ordinary_narration_untouched():
    prose = ("You walk into the kitchen. Delia is chopping vegetables in silence, "
             "the knife tapping a steady rhythm against the board.")
    out = _scrub_inline_planning_leak(prose, reasoning_empty=True, at_bubble_start=True)
    assert out == prose


def test_mid_paragraph_planning_shaped_sentence_not_at_bubble_start_is_left_alone():
    # the opener-shaped sentence is REAL only when it's genuinely the round's leading text —
    # `at_bubble_start=False` means real narration has already streamed this round, so a later
    # sentence sharing the opener's shape (a coincidence, or narration ABOUT a character
    # thinking) must not be misread as the model's own planning preamble.
    text = ("Griffin considers his options. I need to ground myself in the actual game state "
            "before continuing.")
    out = _scrub_inline_planning_leak(text, reasoning_empty=True, at_bubble_start=False)
    assert out == text


def test_engine_jargon_words_alone_do_not_trigger_without_the_debug_predicate():
    # "state"/"roster"/"players" are ordinary BB vocabulary — only paired with a code-ish
    # predicate ("is null"/"is empty"/"array is empty"/…) do they read as debugger jargon.
    prose = ("The house's state of mind shifted after the veto. The roster gathered in the "
             "living room, and the players traded uneasy glances.")
    out = _scrub_inline_planning_leak(prose, reasoning_empty=True, at_bubble_start=False)
    assert out == prose


# ── The gate: a no-op whenever the reasoning channel was NOT empty ────────────

def test_noop_when_reasoning_channel_had_content():
    # a model WITH a genuine separated reasoning channel is already covered by the existing
    # thinking-channel split — this defense-in-depth layer must never ALSO touch its content,
    # so it stays a true no-op (byte-identical) whenever `reasoning_empty` is False.
    leak = "I need to ground myself in the actual game state before I say anything else."
    assert _scrub_inline_planning_leak(leak, reasoning_empty=False, at_bubble_start=True) == leak
    jargon = "holder is null, players array is empty."
    assert _scrub_inline_planning_leak(jargon, reasoning_empty=False, at_bubble_start=False) == jargon


def test_empty_text_is_a_noop():
    assert _scrub_inline_planning_leak("", reasoning_empty=True, at_bubble_start=True) == ""
    assert _scrub_inline_planning_leak(None, reasoning_empty=True, at_bubble_start=True) is None


# ── The wiring: both streaming call sites thread the gate through ─────────────

def test_wired_at_both_scrub_game_leak_call_sites():
    src = _read("src", "agent_loop.py")
    assert src.count("_scrub_inline_planning_leak(") >= 2
    # both call sites must pass the reasoning-emptiness gate derived from THIS round's
    # reasoning accumulator, not a stale/global flag.
    assert "reasoning_empty=not round_reasoning.strip()" in src
    # the bubble-start tracker exists and is set once real narration actually flushes.
    assert "_round_visible_emitted" in src
