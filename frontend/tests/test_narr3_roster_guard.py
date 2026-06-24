"""NARR-3 (#613): the invented-houseguest roster-validation backstop.

"EXACT names, never invent" was prompt-only with no structural enforcement — an invented houseguest
(the most immersion-shattering grounding break) was caught by NOTHING. This adds a post-turn re-ground
when the narration STAGES a houseguest name that is on neither the active nor the out-of-house roster.

The guard is high-precision (a false flag only costs one ignorable next-turn nudge, never lost prose):
it requires an in-scene staging verb/quote binding and excludes the BB game lexicon.
"""
import os
import sys

_FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _FRONTEND not in sys.path:
    sys.path.insert(0, _FRONTEND)

import asyncio  # noqa: E402

import routes.chat_helpers as chat_helpers  # noqa: E402


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


_KNOWN_FULL = {"marcus webb", "ana flores", "devon reyes"}
_KNOWN_FIRST = {"marcus", "ana", "devon"}


def test_invented_staged_name_is_flagged():
    who = chat_helpers._sentence_names_invented(
        "Harrison Cole leans against the counter and grins.", _KNOWN_FIRST, _KNOWN_FULL)
    assert who == "Harrison Cole"


def test_real_roster_name_is_not_flagged():
    # full-name match
    assert chat_helpers._sentence_names_invented(
        "Marcus Webb says he's voting with you.", _KNOWN_FIRST, _KNOWN_FULL) is None
    # first-name-only narration (a two-token run starting with a known first name)
    assert chat_helpers._sentence_names_invented(
        "Ana Garcia grins.", _KNOWN_FIRST, _KNOWN_FULL) is None  # 'ana' first token is known


def test_game_lexicon_is_not_flagged():
    for line in ["Big Brother calls everyone to the living room.",
                 "The Diary Room door swings open.",
                 "Power of Veto changes everything.",
                 "Head of Household is up for grabs."]:
        assert chat_helpers._sentence_names_invented(line, _KNOWN_FIRST, _KNOWN_FULL) is None, line


def test_bare_mention_of_invented_name_is_not_flagged():
    # No in-scene staging verb/quote → not flagged (conservatism — protects creative prose).
    assert chat_helpers._sentence_names_invented(
        "You wonder whatever happened to Jordan Pike from last season.",
        _KNOWN_FIRST, _KNOWN_FULL) is None


def test_post_turn_roster_check_stashes_reground(monkeypatch):
    user = "rhino"
    chat_helpers._DESYNC_REGROUND.pop(user, None)
    chat_helpers._LAST_BEAT_SIG[user] = {
        "phase": "social",
        "activeNames": ["Marcus Webb", "Ana Flores"],
        "evictedNames": ["Devon Reyes"],
    }
    narration = "Harrison Cole leans in close in the kitchen. 'We should work together,' he says."
    _run(chat_helpers.record_post_turn_roster_check(user, narration))
    directive = chat_helpers._DESYNC_REGROUND.get(user)
    assert directive and "Harrison Cole" in directive
    assert "never" in directive.lower()


def test_post_turn_roster_check_finale_skips(monkeypatch):
    user = "rhino-finale"
    chat_helpers._DESYNC_REGROUND.pop(user, None)
    chat_helpers._LAST_BEAT_SIG[user] = {
        "phase": "finale",
        "activeNames": ["Marcus Webb"],
        "evictedNames": ["Ana Flores"],
    }
    # In the finale, a juror name legitimately returns; even an odd name is not policed here.
    _run(chat_helpers.record_post_turn_roster_check(
        user, "Jordan Pike returns to cast a jury vote and says a few words."))
    assert user not in chat_helpers._DESYNC_REGROUND


def test_post_turn_roster_check_pregame_skips():
    user = "rhino-pregame"
    chat_helpers._DESYNC_REGROUND.pop(user, None)
    chat_helpers._LAST_BEAT_SIG.pop(user, None)  # no baseline (casting) → no roster to ground against
    _run(chat_helpers.record_post_turn_roster_check(user, "Harrison Cole sits down and grins at you."))
    assert user not in chat_helpers._DESYNC_REGROUND


def test_roster_check_is_wired_into_the_finishing_block():
    src = open(os.path.join(_FRONTEND, "src", "agent_loop.py"), encoding="utf-8").read()
    assert "record_post_turn_roster_check" in src
