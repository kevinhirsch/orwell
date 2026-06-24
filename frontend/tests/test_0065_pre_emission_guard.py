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
def _board_fakes(monkeypatch, *, phase, evicted, finished=False, hoh="npc:1", week=4,
                 noms=("npc:2", "npc:3"), veto_holder=None):
    house = [{"id": "player", "status": "active"}]
    for i in range(evicted):
        house.append({"id": f"npc:{100 + i}", "status": "evicted"})
    house.append({"id": "npc:2", "status": "active"})

    async def fake_status(user=None):
        return {
            "week": week, "phase": phase,
            "hoh": {"id": hoh} if hoh else None,
            "nominees": [{"id": n} for n in (noms or [])],
            "veto": {"holder": ({"id": veto_holder} if veto_holder else None),
                     "used": False, "players": []},
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


# ── #574 (NARR-8): nomination & veto-winner closed-set claims ──────────────── #

def test_pre_filter_matches_nomination_and_veto_claims():
    assert chat_helpers._sentence_has_closed_set_claim("She nominates two houseguests for eviction.")
    assert chat_helpers._sentence_has_closed_set_claim("He puts the rivals on the block.")
    assert chat_helpers._sentence_has_closed_set_claim("She wins the Power of Veto!")


def test_phantom_nomination_is_held(monkeypatch):
    """A nomination narrated in the nomination phase, but the nominee set never moved → HOLD."""
    chat_helpers._LAST_BEAT_SIG[_USER] = {
        "week": 4, "phase": "nominations", "pending": None, "hoh": "npc:1",
        "noms": ["npc:2", "npc:3"], "vetoHolder": None, "vetoUsed": False,
        "evicted": 2, "finished": False,
    }
    _board_fakes(monkeypatch, phase="nominations", evicted=2,
                 noms=("npc:2", "npc:3"))  # nominee set did NOT change
    emit = _run(chat_helpers.screen_streamed_outcome(
        _USER, "At the ceremony, the Head of Household nominates two houseguests for eviction."))
    assert emit is False
    assert "NOMINATION" in chat_helpers._DESYNC_REGROUND[_USER]


def test_real_nomination_emits(monkeypatch):
    """The nominee set really moved → EMIT, no re-ground."""
    chat_helpers._LAST_BEAT_SIG[_USER] = {
        "week": 4, "phase": "nominations", "pending": None, "hoh": "npc:1",
        "noms": ["npc:2", "npc:3"], "vetoHolder": None, "vetoUsed": False,
        "evicted": 2, "finished": False,
    }
    _board_fakes(monkeypatch, phase="nominations", evicted=2,
                 noms=("npc:4", "npc:5"))  # new nominees committed
    emit = _run(chat_helpers.screen_streamed_outcome(
        _USER, "The Head of Household puts two houseguests on the block."))
    assert emit is True
    assert _USER not in chat_helpers._DESYNC_REGROUND


def test_nomination_claim_outside_nom_phase_is_flavor(monkeypatch):
    """"I might nominate you" outside the nomination beat is plan/flavor → EMIT (never policed)."""
    chat_helpers._LAST_BEAT_SIG[_USER] = {
        "week": 4, "phase": "social", "pending": None, "hoh": "npc:1",
        "noms": ["npc:2", "npc:3"], "vetoHolder": None, "vetoUsed": False,
        "evicted": 2, "finished": False,
    }
    _board_fakes(monkeypatch, phase="social", evicted=2, noms=("npc:2", "npc:3"))
    emit = _run(chat_helpers.screen_streamed_outcome(
        _USER, "She whispers that she might nominate the rivals for eviction next week."))
    assert emit is True
    assert _USER not in chat_helpers._DESYNC_REGROUND


def test_phantom_veto_winner_is_held(monkeypatch):
    """A veto win narrated in the veto phase, but the veto holder never changed → HOLD."""
    chat_helpers._LAST_BEAT_SIG[_USER] = {
        "week": 4, "phase": "veto", "pending": None, "hoh": "npc:1",
        "noms": ["npc:2", "npc:3"], "vetoHolder": None, "vetoUsed": False,
        "evicted": 2, "finished": False,
    }
    _board_fakes(monkeypatch, phase="veto", evicted=2, veto_holder=None)  # no holder committed
    emit = _run(chat_helpers.screen_streamed_outcome(
        _USER, "After the comp, the underdog wins the Power of Veto."))
    assert emit is False
    assert "VETO" in chat_helpers._DESYNC_REGROUND[_USER]


def test_real_veto_winner_emits(monkeypatch):
    """The veto holder really changed → EMIT, no re-ground."""
    chat_helpers._LAST_BEAT_SIG[_USER] = {
        "week": 4, "phase": "veto", "pending": None, "hoh": "npc:1",
        "noms": ["npc:2", "npc:3"], "vetoHolder": None, "vetoUsed": False,
        "evicted": 2, "finished": False,
    }
    _board_fakes(monkeypatch, phase="veto", evicted=2, veto_holder="npc:2")  # a winner committed
    emit = _run(chat_helpers.screen_streamed_outcome(
        _USER, "After the comp, the underdog wins the Power of Veto."))
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


# ── #540 (LIVE-7): the eviction TALLY / self-counted "majority" before commit ─ #

def test_pre_filter_matches_eviction_tally_and_majority():
    # A numeric tally and a self-counted "majority"/"short" both reach the verify.
    assert chat_helpers._sentence_has_closed_set_claim("The count is 8 votes to 7.")
    assert chat_helpers._sentence_has_closed_set_claim("Seven. That's the majority.")
    assert chat_helpers._sentence_has_closed_set_claim("She comes up one vote short.")


def test_phantom_eviction_tally_is_held_mid_season(monkeypatch):
    """A vote tally narrated during the EVICTION phase while the eviction hasn't committed (evicted
    count unchanged) → HOLD. The engine never hands the player a tally — it is a fabrication."""
    chat_helpers._LAST_BEAT_SIG[_USER] = {
        "week": 1, "phase": "eviction", "pending": None, "hoh": "npc:1",
        "noms": ["npc:2", "npc:3"], "vetoHolder": None, "vetoUsed": False,
        "evicted": 0, "finished": False,
    }
    _board_fakes(monkeypatch, phase="eviction", evicted=0, week=1)  # eviction NOT committed
    emit = _run(chat_helpers.screen_streamed_outcome(
        _USER, "Eight to seven — the houseguest came up one vote short."))
    assert emit is False
    assert "TALLY" in chat_helpers._DESYNC_REGROUND[_USER]


def test_self_counted_majority_is_held_mid_season(monkeypatch):
    """A self-counted "that's the majority" conclusion before the engine commits → HOLD."""
    chat_helpers._LAST_BEAT_SIG[_USER] = {
        "week": 1, "phase": "eviction", "pending": None, "hoh": "npc:1",
        "noms": ["npc:2", "npc:3"], "vetoHolder": None, "vetoUsed": False,
        "evicted": 0, "finished": False,
    }
    _board_fakes(monkeypatch, phase="eviction", evicted=0, week=1)
    emit = _run(chat_helpers.screen_streamed_outcome(
        _USER, "That's six votes. Seven. That's the majority."))
    assert emit is False
    assert _USER in chat_helpers._DESYNC_REGROUND


def test_eviction_tally_emits_once_committed(monkeypatch):
    """Once the eviction has committed (evicted count moved), the result-stage narration emits."""
    chat_helpers._LAST_BEAT_SIG[_USER] = {
        "week": 1, "phase": "eviction", "pending": None, "hoh": "npc:1",
        "noms": ["npc:2", "npc:3"], "vetoHolder": None, "vetoUsed": False,
        "evicted": 0, "finished": False,
    }
    _board_fakes(monkeypatch, phase="eviction", evicted=1, week=1)  # someone really left
    emit = _run(chat_helpers.screen_streamed_outcome(
        _USER, "The vote was close, but the majority has spoken."))
    assert emit is True
    assert _USER not in chat_helpers._DESYNC_REGROUND


def test_close_votes_flavor_outside_eviction_phase_emits(monkeypatch):
    """A "the votes look close" line OUTSIDE the eviction phase is flavor → never policed."""
    chat_helpers._LAST_BEAT_SIG[_USER] = {
        "week": 2, "phase": "social", "pending": None, "hoh": "npc:1",
        "noms": ["npc:2", "npc:3"], "vetoHolder": None, "vetoUsed": False,
        "evicted": 0, "finished": False,
    }
    _board_fakes(monkeypatch, phase="social", evicted=0, week=2)
    emit = _run(chat_helpers.screen_streamed_outcome(
        _USER, "If it came down to it, you'd want the majority on your side."))
    assert emit is True


# ── #561: a NON-NOMINEE staged AS on the block (wrong-nominee grounding) ───── #

def _nominee_sig(phase="eviction", nom_names=("Sofia", "Mario"),
                 active=("Sofia", "Mario", "Harrison", "Player")):
    return {
        "week": 6, "phase": phase, "pending": None, "hoh": "npc:1",
        "noms": ["npc:2", "npc:3"], "nomNames": list(nom_names),
        "activeNames": list(active), "vetoHolder": None, "vetoUsed": False,
        "evicted": 2, "finished": False,
    }


def test_pre_filter_matches_nominee_status_language():
    assert chat_helpers._sentence_has_nominee_status("Harrison is on the block tonight.")
    assert chat_helpers._sentence_has_nominee_status("Two names are up for eviction.")
    assert not chat_helpers._sentence_has_nominee_status("They chat quietly by the pool.")


def test_wrong_nominee_named_on_the_block_is_held():
    """A non-nominee active houseguest staged AS on the block → HOLD, re-ground names the real noms."""
    chat_helpers._LAST_BEAT_SIG[_USER] = _nominee_sig()
    emit = _run(chat_helpers.screen_streamed_nominee(
        _USER, "Two portraits glow: Sofia and Harrison are on the block. One walks out tonight."))
    assert emit is False
    rg = chat_helpers._DESYNC_REGROUND[_USER]
    assert "ON THE BLOCK" in rg and "Sofia" in rg and "Mario" in rg


def test_real_nominees_on_the_block_emit():
    """Naming the REAL nominees on the block emits untouched."""
    chat_helpers._LAST_BEAT_SIG[_USER] = _nominee_sig()
    emit = _run(chat_helpers.screen_streamed_nominee(
        _USER, "Sofia and Mario are on the block; one of them leaves tonight."))
    assert emit is True
    assert _USER not in chat_helpers._DESYNC_REGROUND


def test_nominee_guard_skips_when_no_committed_noms():
    """No committed 2-nominee set → uncertain, emit (never policed)."""
    chat_helpers._LAST_BEAT_SIG[_USER] = _nominee_sig(nom_names=())
    emit = _run(chat_helpers.screen_streamed_nominee(
        _USER, "Harrison might be on the block if the veto is used."))
    assert emit is True


def test_nominee_guard_scoped_to_nom_eviction_phases():
    """Outside nom/veto-ceremony/eviction phases, nominee-status prose is flavor → emit."""
    chat_helpers._LAST_BEAT_SIG[_USER] = _nominee_sig(phase="social")
    emit = _run(chat_helpers.screen_streamed_nominee(
        _USER, "Harrison jokes he'd be on the block if he weren't so charming."))
    assert emit is True


def test_eviction_steer_appended_for_eviction_beats():
    """LIVE-4 (#541): the agent loop appends the eviction-reveal steer for an eviction-stage beat."""
    steer = agent_loop._eviction_reveal_steer("eviction-reveal", "a vote to evict NAME")
    assert "LIVE EVICTION REVEAL" in steer
    assert "a vote to evict NAME" in steer
    assert "eviction-reveal" in agent_loop._EVICTION_STAGE_BEATS
    src = _read_src()
    assert "_eviction_reveal_steer(" in src
