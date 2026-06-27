"""Audit 2026-06-18 — the LIVE-game operator-aside scrub.

A pro play-through caught the narration model leaking its PLANNING into the player-visible
channel: "The player, Sam, has finished his conversation. I should record this interaction. Then
I should advance the game to the nominations ceremony... The advanceGame call will move us to the
nominations phase." That is third-person player reference + tool-process narration the prompt
forbids (and re-forbids) but the model emits as content anyway. In game mode the FE strips such
sentences before they reach the player — HIGH-PRECISION, so ordinary in-character prose is never
touched. These pin the helper's behaviour (the streaming wiring is exercised in the play harness).
"""
from src.agent_loop import _scrub_game_leak, _split_complete_sentences


def test_strips_the_exact_leak_from_the_playthrough():
    leak = (
        "The player, Sam, has finished his conversation with Griffin. "
        "I should record this interaction. Then I should advance the game to the nominations "
        "ceremony. But first, let me think about what needs to happen: I need to record the "
        "interaction, then advance the game. The advanceGame call will move us to the nominations "
        "phase. You leave Griffin to his HoH ritual and head back downstairs."
    )
    out = _scrub_game_leak(leak)
    # every operator-aside / tool-process marker is gone
    for banned in ("advanceGame", "record this interaction", "advance the game",
                   "The player, Sam", "I should", "I need to", "let me think"):
        assert banned not in out, banned
    # the real narration survives
    assert "You leave Griffin to his HoH ritual and head back downstairs." in out


def test_strips_the_meta_confusion_leak():
    # the veto-flow desync made the model leak confused meta-reasoning about engine state
    leak = (
        "Actually wait, let me re-read. But the engine is asking for comp-intent. It seems like "
        "the veto hasn't been run yet in the engine's timeline - we jumped ahead narratively. "
        "I need to present this as the engine's pending decision. But I should present it as the "
        "binding choice buttons, not assume. Griffin steps forward and takes the medallion."
    )
    out = _scrub_game_leak(leak)
    for banned in ("the engine", "comp-intent", "pending decision", "binding choice",
                   "let me re-read", "jumped ahead", "narratively"):
        assert banned not in out, banned
    assert "Griffin steps forward and takes the medallion." in out


def test_quoted_npc_dialogue_is_protected():
    # a leading quote means the sentence is NPC speech, not an operator aside — keep it
    s = 'You walk in. "I should go," Delia says. The room settles.'
    assert _scrub_game_leak(s) == s


def test_leaves_in_character_narration_untouched():
    # first-person in-character thoughts that are NOT tool-process must survive verbatim
    legit = (
        'You push through the back door into the kitchen. Delia glances up. '
        '"Gym is not exactly the social hub," she says. You lean against the mirrors. '
        "The handshake lingers — firm, professional. I will remember this moment, you think."
    )
    assert _scrub_game_leak(legit) == legit


def test_tool_names_and_third_person_player_are_dropped():
    assert _scrub_game_leak("Let me call whereabouts to see the room.") .strip() == ""
    assert _scrub_game_leak("The player is hiding something.").strip() == ""
    assert "submitDecision" not in _scrub_game_leak("Now I'll submitDecision for the vote.")


def test_sentence_buffer_only_releases_complete_sentences():
    # a half-streamed sentence is held back (so we never judge a fragment)
    complete, rem = _split_complete_sentences("You walk in. Delia looks up and sa")
    assert complete == "You walk in."
    assert rem == " Delia looks up and sa"
    # nothing complete yet → all buffered
    assert _split_complete_sentences("I should rec")[0] == ""


# ── The fourth-wall "front end" meta-leak (audit 2026-06-26) ──────────────────
# A live casting interview had the in-character host MIRROR the player's OOC software complaint
# INTO the fiction: "Whatever the front end ate, I've got you now", "the front end's having a
# day", "before the front end eats it too". The application the player runs us on must never be
# referenced in the player-visible body. Invariant (behavioral, not a fixed string): after the
# scrub, no player-visible body contains the app-self meta vocabulary.

def test_front_end_meta_leak_is_stripped_from_the_body():
    leak = (
        "Whatever the front end ate, I've got you now. "
        "The front end's having a day. Let's get you on the wall before the front end eats it too. "
        "You settle into the casting chair and the producer leans in."
    )
    out = _scrub_game_leak(leak)
    # the app-self meta vocabulary is gone (case-insensitive, hyphen or space)
    lowered = out.lower()
    for banned in ("front end", "front-end", "the app", "website"):
        assert banned not in lowered, banned
    # the real in-character narration survives
    assert "You settle into the casting chair and the producer leans in." in out


def test_app_and_site_meta_complaints_are_stripped():
    assert "the app" not in _scrub_game_leak("The app froze on you, but production has it handled.").lower()
    assert "this site" not in _scrub_game_leak("This site lagged for a second there.").lower()
    assert "this website" not in _scrub_game_leak("This website is glitching, hang tight.").lower()


def test_scrub_stays_high_precision_around_ordinary_words():
    # "app" / "front" / "site" inside ordinary in-character prose must NOT be touched — only the
    # narrow phrases ("the app", "front end", "this app/website/site") are leaks.
    legit = (
        "You approach the front door of the house. "
        "The applause from the live audience swells. "
        "She fronts confidence she clearly doesn't feel. "
        "The campsite story he told earlier still hangs in the air."
    )
    assert _scrub_game_leak(legit) == legit


# ── #1109(b): a legit clause joined to a machinery aside by a SEMICOLON must survive ──
# The scrub split on [.!?\n] only, so a machinery clause riding AFTER a semicolon dropped the
# WHOLE sentence — including the legitimate leading clause before the ";". Splitting on ";" too
# keeps the leading clause and drops only the offending one.

def test_semicolon_joined_machinery_aside_keeps_the_leading_clause():
    leak = "You can shade, spin, or play a character; the engine will take it from there."
    out = _scrub_game_leak(leak)
    # the legit leading clause survives (it is NOT a machinery aside)
    assert "You can shade, spin, or play a character" in out
    # the machinery clause is gone
    assert "the engine" not in out.lower()


def test_semicolon_clause_split_does_not_over_scrub_ordinary_prose():
    # an ordinary semicolon-joined sentence with no machinery clause re-joins byte-identical
    legit = ("The lights dim over the living room; the houseguests trade nervous glances. "
             "Who do you trust?")
    assert _scrub_game_leak(legit) == legit


def test_semicolon_aside_in_the_leading_clause_keeps_the_trailing_clause():
    # the machinery clause can also be FIRST — the legit trailing clause must still survive
    leak = "I'll advance the game; you head back to the kitchen as the house wakes up."
    out = _scrub_game_leak(leak)
    assert "advance the game" not in out.lower()
    assert "you head back to the kitchen as the house wakes up." in out
