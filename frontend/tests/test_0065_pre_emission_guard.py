"""Feature 0065 Part C — the PRE-EMISSION outcome guard (same-turn, not next-turn).

`record_post_turn_desync_check` catches a narrated-but-uncommitted closed-set outcome only AFTER
the turn — the player has already read "X is evicted" and the re-ground fires the NEXT turn. Part C
moves that closed-set check BEFORE emission, reusing the agent loop's existing sentence-buffered
stream scrubber. When a streamed SENTENCE asserts a closed-set board outcome (the same `_CLAIM_*`
detectors, phase-gated, that the post-turn check uses), the loop hands it to
`chat_helpers.screen_streamed_outcome`, which verifies it against the LIVE board and:

  • board backs the claim (the outcome really committed; OR phase-gating ruled it flavor; OR we are
    uncertain) → EMIT;
  • board does NOT back it (a phantom the engine never committed) → DROP it before the player sees
    it, and stash the existing `_DESYNC_REGROUND` next-turn backstop.

ADR 0005 principle #1 (hard): jurisdiction is CLOSED-SET BOARD CLAIMS ONLY — the guard must never
hold, drop, or rewrite creative/social prose. The non-collapse coverage lives alongside the existing
dynamism corpus in `test_expressive_non_collapse.py`; this file pins the verify + the agent-loop
stream wiring (`_pre_emission_outcome_guard`).

Roles only: throwaway proper nouns appear INSIDE narration strings to exercise the regexes
realistically (exactly as the sibling spine tests do) and never carry test intent.
"""

import asyncio
import importlib

import pytest

chat_helpers = importlib.import_module("routes.chat_helpers")
orwell_engine = importlib.import_module("src.orwell_engine")
agent_loop = importlib.import_module("src.agent_loop")


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


_USER = "u-pre-emission"


@pytest.fixture(autouse=True)
def _clean_state():
    chat_helpers._LAST_BEAT_SIG.pop(_USER, None)
    chat_helpers._DESYNC_REGROUND.pop(_USER, None)
    yield
    chat_helpers._LAST_BEAT_SIG.pop(_USER, None)
    chat_helpers._DESYNC_REGROUND.pop(_USER, None)


# Board fakes. `evicted_status` controls how many house members read non-active; `finished` /
# `hoh` let each test move (or not move) exactly the field its claim is checked against.
def _board_fakes(monkeypatch, *, phase, evicted, finished=False, hoh="npc:1", week=4):
    house = [{"id": "player", "status": "active"}]
    for i in range(evicted):
        house.append({"id": f"npc:{100 + i}", "status": "evicted"})
    house.append({"id": "npc:2", "status": "active"})

    async def fake_status(user=None):
        return {
            "week": week, "phase": phase,
            "hoh": {"id": hoh} if hoh else None,
            "nominees": [{"id": "npc:2"}, {"id": "npc:3"}],
            "veto": {"holder": None, "used": False, "players": []},
            "pending": None, "beatSeq": 7,
        }

    async def fake_state(user=None, **kw):
        return {"week": week, "phase": phase, "finished": finished, "house": house, "beatSeq": 7}

    monkeypatch.setattr(orwell_engine, "game_status", fake_status)
    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)


# ── _sentence_has_closed_set_claim: the cheap synchronous pre-filter ─────── #

def test_pre_filter_matches_the_four_closed_set_claims():
    assert chat_helpers._sentence_has_closed_set_claim("A houseguest is evicted from the house.")
    assert chat_helpers._sentence_has_closed_set_claim("She is crowned the winner of Big Brother!")
    assert chat_helpers._sentence_has_closed_set_claim("He wins the Head of Household competition.")
    assert chat_helpers._sentence_has_closed_set_claim("The jury verdict is 6 votes to 3.")


def test_pre_filter_ignores_creative_and_social_prose():
    # No closed-set OUTCOME language → never sent to the async verify.
    assert not chat_helpers._sentence_has_closed_set_claim(
        "They sit by the pool trading reads, and nothing is decided tonight.")
    assert not chat_helpers._sentence_has_closed_set_claim(
        "The player invents a 'silence pact' on the lawn at dawn.")
    assert not chat_helpers._sentence_has_closed_set_claim("")
    assert not chat_helpers._sentence_has_closed_set_claim("   ")


# ── screen_streamed_outcome: the live-board verify (emit True / hold False) ─ #

def test_phantom_eviction_is_held_and_reground_stashed(monkeypatch):
    """A streamed eviction the board never moved on (evicted count unchanged) → HOLD (False) and a
    next-turn re-ground is stashed."""
    chat_helpers._LAST_BEAT_SIG[_USER] = {
        "week": 4, "phase": "eviction", "pending": None, "hoh": "npc:1",
        "noms": ["npc:2", "npc:3"], "vetoHolder": None, "vetoUsed": False,
        "evicted": 2, "finished": False,
    }
    _board_fakes(monkeypatch, phase="eviction", evicted=2)  # board did NOT move
    emit = _run(chat_helpers.screen_streamed_outcome(
        _USER, "After the vote, one houseguest is evicted from the house."))
    assert emit is False
    assert _USER in chat_helpers._DESYNC_REGROUND
    assert "RE-GROUND" in chat_helpers._DESYNC_REGROUND[_USER]


def test_real_eviction_emits_and_stashes_nothing(monkeypatch):
    """A streamed eviction the board DID move on (evicted count incremented) → EMIT (True), no
    re-ground."""
    chat_helpers._LAST_BEAT_SIG[_USER] = {
        "week": 4, "phase": "eviction", "pending": None, "hoh": "npc:1",
        "noms": ["npc:2", "npc:3"], "vetoHolder": None, "vetoUsed": False,
        "evicted": 2, "finished": False,
    }
    _board_fakes(monkeypatch, phase="eviction", evicted=3)  # someone really left
    emit = _run(chat_helpers.screen_streamed_outcome(
        _USER, "After the vote, one houseguest is evicted from the house."))
    assert emit is True
    assert _USER not in chat_helpers._DESYNC_REGROUND


def test_phantom_winner_is_held(monkeypatch):
    chat_helpers._LAST_BEAT_SIG[_USER] = {
        "week": 12, "phase": "finale", "pending": None, "hoh": "npc:1",
        "noms": [], "vetoHolder": None, "vetoUsed": False, "evicted": 13, "finished": False,
    }
    _board_fakes(monkeypatch, phase="finale", evicted=13, finished=False)  # season NOT finished
    emit = _run(chat_helpers.screen_streamed_outcome(
        _USER, "Confetti falls — the houseguest is crowned the winner of Big Brother!"))
    assert emit is False
    assert "WINNER" in chat_helpers._DESYNC_REGROUND[_USER]


def test_real_winner_emits(monkeypatch):
    chat_helpers._LAST_BEAT_SIG[_USER] = {
        "week": 12, "phase": "finale", "pending": None, "hoh": "npc:1",
        "noms": [], "vetoHolder": None, "vetoUsed": False, "evicted": 13, "finished": False,
    }
    _board_fakes(monkeypatch, phase="finale", evicted=13, finished=True)  # season really ended
    emit = _run(chat_helpers.screen_streamed_outcome(
        _USER, "The houseguest is crowned the winner of the season."))
    assert emit is True
    assert _USER not in chat_helpers._DESYNC_REGROUND


def test_uncertain_no_before_signature_emits(monkeypatch):
    """No BEFORE baseline this turn (a fresh process / framing hiccup) → cannot tell phantom from
    real → EMIT (conservatism), and no re-ground is stashed."""
    chat_helpers._LAST_BEAT_SIG.pop(_USER, None)
    _board_fakes(monkeypatch, phase="eviction", evicted=2)
    emit = _run(chat_helpers.screen_streamed_outcome(
        _USER, "A houseguest is evicted from the house tonight."))
    assert emit is True
    assert _USER not in chat_helpers._DESYNC_REGROUND


def test_uncertain_live_board_read_fails_emits(monkeypatch):
    """The live-board read hiccups mid-stream → EMIT (fail-open), no suppression, no re-ground."""
    chat_helpers._LAST_BEAT_SIG[_USER] = {
        "week": 4, "phase": "eviction", "pending": None, "hoh": "npc:1",
        "noms": [], "vetoHolder": None, "vetoUsed": False, "evicted": 2, "finished": False,
    }

    async def boom(user=None):
        raise RuntimeError("engine blip")

    monkeypatch.setattr(orwell_engine, "game_status", boom)
    emit = _run(chat_helpers.screen_streamed_outcome(
        _USER, "A houseguest is evicted from the house tonight."))
    assert emit is True
    assert _USER not in chat_helpers._DESYNC_REGROUND


def test_screen_emits_creative_prose_without_reading_the_board(monkeypatch):
    """A sentence with NO closed-set claim, even handed straight to the verify, returns EMIT and
    never re-grounds — the open set is untouched (ADR 0005 #1)."""
    chat_helpers._LAST_BEAT_SIG[_USER] = {
        "week": 4, "phase": "social", "pending": None, "hoh": "npc:1",
        "noms": [], "vetoHolder": None, "vetoUsed": False, "evicted": 2, "finished": False,
    }
    _board_fakes(monkeypatch, phase="social", evicted=2)
    emit = _run(chat_helpers.screen_streamed_outcome(
        _USER, "They linger in the kitchen trading quiet reads; nothing is decided."))
    assert emit is True
    assert _USER not in chat_helpers._DESYNC_REGROUND


# ── _pre_emission_outcome_guard: the agent-loop stream wiring ──────────────── #

def test_guard_drops_only_the_phantom_sentence_keeps_neighbours(monkeypatch):
    """SENTENCE granularity: a chunk with a creative lead-in, a PHANTOM eviction, and a creative
    trailer drops ONLY the eviction sentence — the neighbours stream verbatim (delimiters intact)."""
    chat_helpers._LAST_BEAT_SIG[_USER] = {
        "week": 4, "phase": "eviction", "pending": None, "hoh": "npc:1",
        "noms": ["npc:2", "npc:3"], "vetoHolder": None, "vetoUsed": False,
        "evicted": 2, "finished": False,
    }
    _board_fakes(monkeypatch, phase="eviction", evicted=2)  # board did NOT move → phantom
    text = ("The house gathers in the living room, tense and quiet. "
            "After the vote, one houseguest is evicted from the house. "
            "Outside, the wind picks up over the empty backyard.")
    out = _run(agent_loop._pre_emission_outcome_guard(text, _USER))
    assert "is evicted" not in out                          # the phantom sentence is gone
    assert "The house gathers in the living room" in out    # creative lead-in kept
    assert "the wind picks up over the empty backyard" in out  # creative trailer kept
    assert _USER in chat_helpers._DESYNC_REGROUND


def test_guard_emits_a_real_outcome_unchanged(monkeypatch):
    """A chunk whose eviction the board DID move on streams byte-for-byte unchanged."""
    chat_helpers._LAST_BEAT_SIG[_USER] = {
        "week": 4, "phase": "eviction", "pending": None, "hoh": "npc:1",
        "noms": ["npc:2", "npc:3"], "vetoHolder": None, "vetoUsed": False,
        "evicted": 2, "finished": False,
    }
    _board_fakes(monkeypatch, phase="eviction", evicted=3)  # someone really left
    text = "By a vote of the house, one houseguest is evicted and walks out the front door."
    out = _run(agent_loop._pre_emission_outcome_guard(text, _USER))
    assert out == text
    assert _USER not in chat_helpers._DESYNC_REGROUND


def test_guard_returns_text_unchanged_when_no_closed_set_claim(monkeypatch):
    """The hot-path guarantee: a chunk with no closed-set claim language is returned verbatim WITHOUT
    touching the engine at all (the cheap pre-filter short-circuits). We assert that by making the
    board reads raise — the guard must still return the text unchanged."""
    async def boom(user=None):
        raise AssertionError("the guard read the board for pure creative prose (ADR 0005 #1)")

    monkeypatch.setattr(orwell_engine, "game_status", boom)
    monkeypatch.setattr(orwell_engine, "get_game_state", boom)
    text = ("The player drapes a bedsheet over their shoulders and narrates the house as a doomed "
            "ocean liner. Everyone is laughing too hard to remember it is a competition.")
    out = _run(agent_loop._pre_emission_outcome_guard(text, _USER))
    assert out == text


def test_guard_is_a_noop_without_an_owner(monkeypatch):
    async def boom(user=None):
        raise AssertionError("the guard touched the engine with no owner")

    monkeypatch.setattr(orwell_engine, "game_status", boom)
    text = "After the vote, one houseguest is evicted from the house."
    assert _run(agent_loop._pre_emission_outcome_guard(text, None)) == text
    assert _run(agent_loop._pre_emission_outcome_guard(text, "")) == text


# ── source-pins: the wiring stays where the spine expects it ────────────── #

def _read_src():
    import os
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(base, "src", "agent_loop.py"), encoding="utf-8") as fh:
        return fh.read()


def test_agent_loop_runs_pre_emission_guard_in_the_scrub_path():
    src = _read_src()
    # The guard is awaited inside the live-game scrub path (the same place the leak scrubber runs).
    assert "await _pre_emission_outcome_guard(" in src
    # It is applied to the leak-scrubbed text (after _scrub_game_leak), preserving granularity.
    assert "screen_streamed_outcome" in _read_chat_helpers()
    # The blank-turn fall-back: if holding would empty an as-yet-unseen turn, emit the raw clean text.
    assert "not _emitted_visible" in src


def _read_chat_helpers():
    import os
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(base, "routes", "chat_helpers.py"), encoding="utf-8") as fh:
        return fh.read()
