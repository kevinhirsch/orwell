"""ADR 0009 (D3 Part B) — the PRE-EMISSION LOCATION guard (evicted-houseguest-in-a-room).

The PO's overriding constraint (2026-06-21): NO visible historic conflict between the prose and the
board. A legal narrated MOVE is hard-folded into the board (D2), so it is never a conflict. The
residual IMPOSSIBLE claim — "a houseguest who has LEFT the house (evicted / now on the jury) is back
in a room" — can never be folded, so it is caught BEFORE the player sees it (never a later-turn
correction, which would leave the conflict visible in the transcript).

Scope is deliberately narrow (the conservatism mandate — a false hold on creative prose is worse than
a missed phantom). The guard fires ONLY on the triple gate: an out-of-house NAME, bound (tightly) to
present-tense in-scene presence language, AND a real HOUSE ROOM in the sentence. Past-tense reference,
a departure to the jury house, and mere mention all EMIT untouched.

Synthetic placeholder names only — these are test fixtures, never cast personas.

SYNC + ASYNC tests (pytest-asyncio AUTO mode) — drive coroutines via run_until_complete.
"""

import asyncio
import importlib

import pytest

chat_helpers = importlib.import_module("routes.chat_helpers")
agent_loop = importlib.import_module("src.agent_loop")
orwell_engine = importlib.import_module("src.orwell_engine")

_USER = "u-adr0009-loc"
# Synthetic out-of-house names (full name + a distinct first name to exercise the first-name fallback).
_GONE = ["Alpha Nomad", "Bravo Driftwood"]


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


@pytest.fixture(autouse=True)
def _clean_state():
    chat_helpers._LAST_BEAT_SIG.pop(_USER, None)
    chat_helpers._DESYNC_REGROUND.pop(_USER, None)
    yield
    chat_helpers._LAST_BEAT_SIG.pop(_USER, None)
    chat_helpers._DESYNC_REGROUND.pop(_USER, None)


def _seed_sig(phase="social"):
    chat_helpers._LAST_BEAT_SIG[_USER] = {
        "week": 4, "phase": phase, "pending": None, "hoh": "npc:1", "noms": [],
        "vetoHolder": None, "vetoUsed": False, "evicted": 2, "evictedNames": list(_GONE),
        "finished": False,
    }


# ── _beat_signature: the cached evicted-names set ────────────────────────── #

def test_beat_signature_captures_out_of_house_names():
    state = {"house": [
        {"id": "npc:1", "name": "Active One", "status": "active"},
        {"id": "npc:2", "name": "Alpha Nomad", "status": "evicted"},
        {"id": "npc:3", "name": "Bravo Driftwood", "status": "jury"},
        {"id": "npc:4", "name": "Active Two"},  # missing status ⇒ active
    ]}
    sig = chat_helpers._beat_signature({}, state)
    assert sig["evicted"] == 2
    assert sig["evictedNames"] == ["Alpha Nomad", "Bravo Driftwood"]  # sorted, names only
    # An active houseguest's name is never in the out-of-house set.
    assert "Active One" not in sig["evictedNames"] and "Active Two" not in sig["evictedNames"]


# ── _sentence_places_evicted: the triple-gate detector ───────────────────── #

def test_detects_evicted_walking_into_a_house_room():
    out = chat_helpers._sentence_places_evicted("Alpha Nomad walks into the kitchen, grinning.", _GONE)
    assert out == "Alpha Nomad"


def test_detects_via_first_name_in_a_room():
    out = chat_helpers._sentence_places_evicted("In the backyard, Bravo leans against the fence.", _GONE)
    assert out == "Bravo Driftwood"


def test_mention_with_a_room_but_no_presence_verb_emits():
    # The kitchen is named and the evictee is mentioned, but they are not BOUND to a presence verb.
    out = chat_helpers._sentence_places_evicted("I miss Alpha Nomad; the kitchen just isn't the same.", _GONE)
    assert out is None


def test_presence_verb_but_no_house_room_emits():
    # "heads to the jury house" is a legitimate DEPARTURE — no house room, so never flagged.
    out = chat_helpers._sentence_places_evicted("Alpha Nomad heads to the jury house for good.", _GONE)
    assert out is None


def test_past_tense_reference_emits():
    out = chat_helpers._sentence_places_evicted("Alpha Nomad was evicted from the kitchen-side bedroom last week.", _GONE)
    # "was evicted" is past tense; no present-tense presence verb is bound → emit.
    assert out is None


def test_far_cooccurrence_is_not_bound():
    # The name and the presence verb are far apart (> the bind window) → not bound, emits.
    s = ("Alpha Nomad was sent home on a brutal vote, and much, much later that same restless night "
         "another houseguest quietly walks into the kitchen.")
    assert chat_helpers._sentence_places_evicted(s, _GONE) is None


def test_active_houseguest_name_is_never_flagged():
    # A name NOT in the out-of-house set is ignored even with a verb + room.
    assert chat_helpers._sentence_places_evicted("Active One walks into the kitchen.", _GONE) is None


def test_no_evicted_names_is_none():
    assert chat_helpers._sentence_places_evicted("Anyone walks into the kitchen.", []) is None


# ── _text_mentions_evicted_houseguest: the cheap pre-filter ──────────────── #

def test_prefilter_true_when_an_evictee_is_named():
    _seed_sig()
    assert chat_helpers._text_mentions_evicted_houseguest(_USER, "Bravo lingers by the door.") is True


def test_prefilter_false_when_no_evictee_named():
    _seed_sig()
    assert chat_helpers._text_mentions_evicted_houseguest(_USER, "The kitchen is loud tonight.") is False


def test_prefilter_false_in_finale_phase():
    _seed_sig(phase="finale")
    # Jurors legitimately reappear at the finale — the location guard does not apply there.
    assert chat_helpers._text_mentions_evicted_houseguest(_USER, "Alpha Nomad casts a vote.") is False


def test_prefilter_false_without_a_signature():
    assert chat_helpers._text_mentions_evicted_houseguest(_USER, "Alpha Nomad walks in.") is False


# ── screen_streamed_location: the async pre-emission decision ─────────────── #

def test_screen_holds_an_evicted_in_room_claim_and_regrounds():
    _seed_sig()
    emit = _run(chat_helpers.screen_streamed_location(_USER, "Alpha Nomad strolls into the kitchen."))
    assert emit is False
    assert _USER in chat_helpers._DESYNC_REGROUND
    assert "Alpha Nomad" in chat_helpers._DESYNC_REGROUND[_USER]


def test_screen_emits_a_legitimate_sentence_and_does_not_reground():
    _seed_sig()
    emit = _run(chat_helpers.screen_streamed_location(_USER, "Alpha Nomad heads to the jury house."))
    assert emit is True
    assert _USER not in chat_helpers._DESYNC_REGROUND


def test_screen_skips_the_finale():
    _seed_sig(phase="finale")
    emit = _run(chat_helpers.screen_streamed_location(_USER, "Alpha Nomad walks into the kitchen."))
    assert emit is True  # finale phase → not policed (jurors return)
    assert _USER not in chat_helpers._DESYNC_REGROUND


def test_screen_emits_without_a_signature():
    emit = _run(chat_helpers.screen_streamed_location(_USER, "Alpha Nomad walks into the kitchen."))
    assert emit is True  # no baseline this turn → uncertain, emit (conservatism)


# ── _pre_emission_outcome_guard: end-to-end sentence granularity ─────────── #

def test_guard_drops_only_the_evicted_sentence_keeps_neighbours(monkeypatch):
    # The engine must NOT be read on this path (no closed-set claim) — make the board reads raise.
    async def boom(user=None):
        raise AssertionError("the location guard read the board (it should use the cached signature)")
    monkeypatch.setattr(orwell_engine, "game_status", boom)
    monkeypatch.setattr(orwell_engine, "get_game_state", boom)
    _seed_sig()
    text = ("The remaining houseguests gather in the living room, tense and quiet. "
            "Alpha Nomad wanders into the kitchen and pours a coffee. "
            "Outside, the wind picks up over the empty backyard.")
    out = _run(agent_loop._pre_emission_outcome_guard(text, _USER))
    assert "Alpha Nomad wanders into the kitchen" not in out          # the impossible sentence is gone
    assert "The remaining houseguests gather in the living room" in out  # creative lead-in kept
    assert "the wind picks up over the empty backyard" in out          # creative trailer kept
    assert _USER in chat_helpers._DESYNC_REGROUND


def test_guard_emits_a_legitimate_departure_unchanged(monkeypatch):
    async def boom(user=None):
        raise AssertionError("the location guard read the board for a legitimate sentence")
    monkeypatch.setattr(orwell_engine, "game_status", boom)
    monkeypatch.setattr(orwell_engine, "get_game_state", boom)
    _seed_sig()
    text = "Alpha Nomad hugs everyone goodbye and heads to the jury house."
    out = _run(agent_loop._pre_emission_outcome_guard(text, _USER))
    assert out == text
    assert _USER not in chat_helpers._DESYNC_REGROUND


def test_guard_returns_text_unchanged_when_no_evictee_named(monkeypatch):
    async def boom(user=None):
        raise AssertionError("the guard touched the engine for prose with no evictee + no closed claim")
    monkeypatch.setattr(orwell_engine, "game_status", boom)
    monkeypatch.setattr(orwell_engine, "get_game_state", boom)
    _seed_sig()
    text = "The kitchen fills with laughter as the active houseguests cook a chaotic dinner together."
    out = _run(agent_loop._pre_emission_outcome_guard(text, _USER))
    assert out == text


# ── source-pins: the wiring stays in the scrub path ──────────────────────── #

def _read(name):
    import os
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    sub = "routes" if name == "chat_helpers.py" else "src"
    with open(os.path.join(base, sub, name), encoding="utf-8") as fh:
        return fh.read()


def test_agent_loop_runs_the_location_screen_in_the_scrub_path():
    src = _read("agent_loop.py")
    assert "screen_streamed_location" in src
    assert "_text_mentions_evicted_houseguest" in src
    # The cheap pre-filter short-circuits the hot path alongside the closed-set one.
    assert "_text_mentions_evicted_houseguest(owner, text)" in src


def test_chat_helpers_exposes_the_location_screen():
    src = _read("chat_helpers.py")
    assert "async def screen_streamed_location(" in src
    assert "def _sentence_places_evicted(" in src
    assert '"evictedNames"' in src  # cached in the beat signature
