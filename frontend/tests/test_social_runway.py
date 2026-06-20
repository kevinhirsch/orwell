"""The SOCIAL RUNWAY — the "never fast-forward through ceremonies" fix.

Owner playtest verdict (the defect this proves fixed): "It should never fast forward in the game…
it skips all of the social narrative gameplay and advances straight to nominations… There is zero
social opportunity. This is a critical failure."

Root cause: the C-02 pre-resolve advanced ONE engine beat per turn whenever no player decision was
pending, so for a spectator player the chain HOH → noms → veto → eviction marched with no social
turns between ceremonies. The fix holds a SOCIAL RUNWAY of player turns after each ceremony lands
the player in a new spectator beat — overriding the moment to the engine's own `social` beat and
NOT advancing — until the runway is spent (or the player asks to move on). Pacing only: the engine
still decides every outcome; we never invent content, we just stop skipping the player's turns.
"""

import asyncio
import importlib

import pytest

chat_helpers = importlib.import_module("routes.chat_helpers")
orwell_engine = importlib.import_module("src.orwell_engine")


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


@pytest.fixture(autouse=True)
def _clear_runway():
    chat_helpers.clear_social_runway("u")
    yield
    chat_helpers.clear_social_runway("u")


class _Engine:
    """A tiny scripted live engine: advancing walks phases for a SPECTATOR player (never a pending),
    so the test exercises exactly the force-march case the runway protects. `week`/`phase` change on
    advance so the `(week:phase)` runway signature is realistic."""

    # A spectator's week as the pre-resolve would drive it, one ceremony per advance.
    _CHAIN = ["hoh-competition", "nominations", "veto-competition", "veto-ceremony", "eviction"]

    def __init__(self, start="nominations", pending=None):
        self.week = 1
        self.phase = start
        self.pending = pending
        self.advances = 0

    def state(self):
        return {"started": True, "week": self.week, "phase": self.phase, "moment": self.phase}

    async def game_status(self, user=None):
        return {"phase": self.phase, "pending": self.pending, "week": self.week}

    async def get_game_state(self, user=None, **kw):
        return self.state()

    async def advance_game(self, user=None):
        self.advances += 1
        i = self._CHAIN.index(self.phase) if self.phase in self._CHAIN else -1
        nxt = self._CHAIN[i + 1] if 0 <= i < len(self._CHAIN) - 1 else self.phase
        self.phase = nxt
        return {"event": {"content": f"resolved into {nxt}"}}

    def wire(self, monkeypatch):
        monkeypatch.setattr(orwell_engine, "game_status", self.game_status)
        monkeypatch.setattr(orwell_engine, "get_game_state", self.get_game_state)
        monkeypatch.setattr(orwell_engine, "advance_game", self.advance_game)
        return self


def _pre(eng, *, player_msg=None):
    return _run(chat_helpers._pre_resolve_npc_ceremony(
        "u", eng.state(), retry=False, player_msg=player_msg))


# ── The core guarantee: a resolved ceremony is FOLLOWED by social turns, not the next ceremony ──

def test_a_resolved_ceremony_arms_a_social_runway_instead_of_marching_on(monkeypatch):
    eng = _Engine(start="nominations").wire(monkeypatch)
    out = _pre(eng)
    # The ceremony resolved for real (C-02 preserved — the engine decides, not the model)…
    assert eng.advances == 1, "the pending-free ceremony is resolved for real"
    # …but the very next turn is framed as SOCIAL play, not driven straight into the next ceremony.
    assert out.get("moment") == "social", "the player gets a social beat after the ceremony resolves"


def test_the_runway_holds_the_next_ceremony_for_social_turns(monkeypatch):
    eng = _Engine(start="nominations").wire(monkeypatch)
    _pre(eng)                       # resolves nominations → arms a runway at veto-competition
    advances_after_first = eng.advances
    # The next two turns must HOLD — social opportunity, no further advance.
    for _ in range(chat_helpers._SOCIAL_RUNWAY_TURNS):
        out = _pre(eng)
        assert out.get("moment") == "social", "still lingering — a social beat, not a ceremony"
    assert eng.advances == advances_after_first, "the runway did NOT march to the next ceremony"


def test_the_next_ceremony_drives_once_the_runway_is_spent(monkeypatch):
    eng = _Engine(start="nominations").wire(monkeypatch)
    _pre(eng)                       # resolve nominations → runway armed at veto-competition
    for _ in range(chat_helpers._SOCIAL_RUNWAY_TURNS):
        _pre(eng)                   # spend the runway (social holds)
    before = eng.advances
    _pre(eng)                       # runway spent → the next ceremony is driven for real
    assert eng.advances == before + 1, "after the social runway, the next ceremony resolves"


def test_no_force_march_across_multiple_ceremonies(monkeypatch):
    # Five consecutive spectator turns must NOT blow through the whole week. With a runway between
    # each ceremony, five turns resolve at most a couple of beats — not the entire HOH→eviction chain.
    eng = _Engine(start="nominations").wire(monkeypatch)
    for _ in range(5):
        _pre(eng)
    assert eng.advances <= 2, (
        f"five spectator turns force-marched {eng.advances} ceremonies — the social runway is not holding")


# ── Engagement, not a turn count: the player can cut the runway short ──

def test_player_readiness_cuts_the_runway_short(monkeypatch):
    eng = _Engine(start="nominations").wire(monkeypatch)
    _pre(eng)                       # resolve nominations → runway armed
    before = eng.advances
    # "let's see the veto" is an explicit move-on cue → the runway yields and the ceremony drives now.
    out = _pre(eng, player_msg="ok let's move on and see the veto")
    assert eng.advances == before + 1, "an explicit 'move on' cuts the runway and drives the ceremony"
    assert out.get("moment") != "social", "readiness ends the lingering"


def test_substantive_play_keeps_lingering(monkeypatch):
    eng = _Engine(start="nominations").wire(monkeypatch)
    _pre(eng)
    before = eng.advances
    # A long scheming message is ENGAGEMENT, never a lull — the runway keeps the player in the house.
    scheme = ("I pull the swing vote aside in the storage room and walk them through exactly why "
              "flipping on the HOH this week protects both of us long term, then go shore up my "
              "side alliance before anyone notices we talked.")
    out = _pre(eng, player_msg=scheme)
    assert eng.advances == before, "substantive social play does not advance the ceremony"
    assert out.get("moment") == "social", "the scheming player keeps their social beat"


# ── A player decision is NEVER held behind a runway ──

def test_a_pending_decision_clears_the_runway_and_never_holds(monkeypatch):
    eng = _Engine(start="nominations").wire(monkeypatch)
    _pre(eng)                       # arm a runway at veto-competition
    # Now the engine surfaces a player decision (e.g. the player drew a veto comp-intent).
    eng.pending = {"kind": "comp-intent"}
    before = eng.advances
    out = _pre(eng)
    assert eng.advances == before, "a pending is the player's card — never auto-resolved"
    assert out.get("moment") != "social", "the decision card leads; we do not override to social"
    # The runway was dropped so the turn after the decision drives the result, not another lull.
    assert chat_helpers._RUNWAY_LEFT.get("u", 0) == 0


# ── The staged eviction reveal is not held mid-reveal (E12) ──

def test_staged_eviction_reveal_is_not_held_between_ballots(monkeypatch):
    # During the eviction reveal the phase STAYS `eviction` across advances (same signature), so the
    # runway never re-arms mid-reveal — the ballots tick one per turn as before (E12 staged reveal).
    class _Eviction(_Engine):
        async def advance_game(self, user=None):
            self.advances += 1
            return {"event": {"content": "a vote to evict <name>"}}  # phase stays `eviction`

    eng = _Eviction(start="eviction").wire(monkeypatch)
    # No runway armed for eviction yet, and the phase does not change → each turn ticks a ballot.
    for _ in range(3):
        _pre(eng)
    assert eng.advances == 3, "the staged eviction reveal advances one ballot per turn, never held"


# ── The reset path drops a stale runway ──

def test_clear_social_runway_drops_state():
    chat_helpers._arm_runway("u", "1:nominations")
    assert chat_helpers._RUNWAY_LEFT.get("u", 0) > 0
    chat_helpers.clear_social_runway("u")
    assert chat_helpers._RUNWAY_LEFT.get("u", 0) == 0
    assert "u" not in chat_helpers._RUNWAY_SIG
