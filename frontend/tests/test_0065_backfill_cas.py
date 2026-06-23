"""Feature 0065 (Part A tail) — the CAS token on the FE-issued BACK-FILL mutating calls.

The A/B integration wired compare-and-swap + idempotency onto the PROGRESSION calls
(`advanceGame`/`submitDecision`) and left the lower-value, re-derivable back-fills as a "documented
future refinement". This lane closes that tail: the FE-issued `recordInteraction` / `makeDeal` /
`moveTo` (the `_auto_record_scene` / `_auto_record_deal` / `_auto_move_player` belts, plus the E22
`ensure_turn_recorded` fallback) now:

  * attach `expected_beat_seq=chat_helpers.last_beat_seq(owner)` to the engine call;
  * refresh last-seen from the response IMMEDIATELY (these fire MID-TURN, after other mutations may
    have bumped beatSeq — without refreshing the FE would self-409 its own next call);
  * on a stale 409 (`_is_stale_beat_error`) RECONCILE via `_handle_stale_beat` and SKIP the back-fill
    (it is re-derivable next turn — NOT the double-apply case, so never retried), letting no
    exception escape and counting it.

The HARD requirement proved here: a NORMAL multi-call turn (read → record/deal/move → advance) must
NEVER self-409, because last-seen is refreshed from every response. Roles only; the engine client is
faked so we capture the exact kwargs the FE passes.
"""
import asyncio
import importlib

import pytest

al = importlib.import_module("src.agent_loop")
chat_helpers = importlib.import_module("routes.chat_helpers")
orwell_engine = importlib.import_module("src.orwell_engine")
llm_core = importlib.import_module("src.llm_core")


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


HOUSE = [{"id": "npc:3", "name": "Cynthia Hawkins"}, {"id": "npc:7", "name": "Tobias Drake"}]


@pytest.fixture(autouse=True)
def _clean_state():
    chat_helpers._LAST_BEAT_SEQ.clear()
    chat_helpers._LAST_BEAT_SIG.clear()
    chat_helpers._DESYNC_REGROUND.clear()
    chat_helpers.reset_stale_beat_rejections()
    yield
    chat_helpers._LAST_BEAT_SEQ.clear()
    chat_helpers._LAST_BEAT_SIG.clear()
    chat_helpers._DESYNC_REGROUND.clear()
    chat_helpers.reset_stale_beat_rejections()


def _stale_409(now: int) -> "orwell_engine.EngineToolError":
    return orwell_engine.EngineToolError(
        f"stale write refused — expected beatSeq is behind the current board (now {now}); re-ground",
        status=409)


# ── 1. each back-fill attaches the CURRENT token + refreshes last-seen from its response ───────── #

def test_record_interaction_backfill_attaches_token_and_refreshes(monkeypatch):
    """`_auto_record_scene` passes the current last-seen beatSeq and refreshes from the response."""
    chat_helpers._LAST_BEAT_SEQ["owner"] = 11
    captured = {}

    async def fake_llm(*a, **k):
        return '{"withIds":["npc:3"],"kind":"bonding","content":"a quiet bond"}'

    async def fake_record(content, with_ids=None, kind=None, consequence=None,
                          expected_beat_seq=None, user=None):
        captured["expected_beat_seq"] = expected_beat_seq
        return {"recorded": True, "beatSeq": 12}  # the record committed → board moved to 12

    monkeypatch.setattr(llm_core, "llm_call_async", fake_llm)
    monkeypatch.setattr(orwell_engine, "record_interaction", fake_record)

    out = _run(al._auto_record_scene("a quiet bond", "talk to Cynthia", HOUSE, "url", "m", {}, "owner"))
    assert out is True
    assert captured["expected_beat_seq"] == 11               # the current last-seen token
    assert chat_helpers.last_beat_seq("owner") == 12         # refreshed FROM the record response


def test_make_deal_backfill_attaches_token_and_refreshes(monkeypatch):
    """`_auto_record_deal` passes the current last-seen beatSeq and refreshes from the response."""
    chat_helpers._LAST_BEAT_SEQ["owner"] = 20
    captured = {}

    async def fake_llm(*a, **k):
        return '{"struck":true,"withId":"npc:3","kind":"safety","terms":"no noms"}'

    async def fake_make_deal(with_id, kind, terms, expected_beat_seq=None, user=None):
        captured["expected_beat_seq"] = expected_beat_seq
        return {"deal": {"kind": kind}, "beatSeq": 21}

    monkeypatch.setattr(llm_core, "llm_call_async", fake_llm)
    monkeypatch.setattr(orwell_engine, "make_deal", fake_make_deal)

    out = _run(al._auto_record_deal("I shake Cynthia's hand on a pact.", "deal", HOUSE, "url", "m", {}, "owner"))
    assert out is True
    assert captured["expected_beat_seq"] == 20
    assert chat_helpers.last_beat_seq("owner") == 21


def test_move_to_backfill_attaches_token_and_refreshes(monkeypatch):
    """`_auto_move_player` passes the current last-seen beatSeq and refreshes from the response."""
    chat_helpers._LAST_BEAT_SEQ["owner"] = 30
    captured = {}

    async def fake_llm(*a, **k):
        return '{"room":"kitchen"}'

    async def fake_move_to(room, expected_beat_seq=None, user=None):
        captured["expected_beat_seq"] = expected_beat_seq
        return {"whereabouts": {"room": room}, "beatSeq": 31}

    monkeypatch.setattr(llm_core, "llm_call_async", fake_llm)
    monkeypatch.setattr(orwell_engine, "move_to", fake_move_to)

    out = _run(al._auto_move_player("You drift into the kitchen.", "I head to the kitchen", "url", "m", {}, "owner"))
    assert out is True
    assert captured["expected_beat_seq"] == 30
    assert chat_helpers.last_beat_seq("owner") == 31


def test_e22_fallback_record_attaches_token_and_refreshes(monkeypatch):
    """The E22 `ensure_turn_recorded` fallback (an FE-issued recordInteraction in chat_helpers) also
    carries the CAS token and refreshes last-seen."""
    chat_helpers._LAST_BEAT_SEQ["u"] = 7
    captured = {}

    async def fake_record(content, with_ids=None, initiator="player", kind=None,
                          expected_beat_seq=None, user=None):
        captured["expected_beat_seq"] = expected_beat_seq
        return {"recorded": True, "beatSeq": 8}

    monkeypatch.setattr(orwell_engine, "record_interaction", fake_record)
    narration = "The kitchen goes quiet as the player walks in. " * 5
    out = _run(chat_helpers.ensure_turn_recorded("u", "I size up the room.", narration, ["getGameState"]))
    assert out is True
    assert captured["expected_beat_seq"] == 7
    assert chat_helpers.last_beat_seq("u") == 8


# ── 2. THE HARD GUARD: a normal multi-call turn never self-409s ────────────────────────────────── #

def test_normal_multicall_turn_record_then_advance_never_self_409s(monkeypatch):
    """The whole risk of this slice: a back-fill (record) followed by a progression (advance) in the
    SAME turn must NEVER trip a stale rejection — because each call refreshes last-seen from its own
    response, so the advance attaches the freshest token. The fake engine 409s ONLY a token behind the
    live board, exactly like the real CAS, so a stale value WOULD be caught."""
    seq = {"v": 50}
    chat_helpers._LAST_BEAT_SEQ["owner"] = 50

    async def fake_llm(*a, **k):
        return '{"withIds":["npc:3"],"kind":"strategy","content":"the player worked the room"}'

    async def fake_record(content, with_ids=None, kind=None, consequence=None,
                          expected_beat_seq=None, user=None):
        if expected_beat_seq is not None and expected_beat_seq != seq["v"]:
            raise _stale_409(seq["v"])
        seq["v"] += 1                          # the record committed — beatSeq moved
        return {"recorded": True, "beatSeq": seq["v"]}

    async def fake_status(user=None):
        return {"phase": "nominations", "pending": None, "veto": {}, "beatSeq": seq["v"]}

    async def fake_state(user=None, **kw):
        return {"phase": "veto-competition", "week": 1, "finished": False, "house": [], "beatSeq": seq["v"]}

    async def fake_advance(expected_beat_seq=None, idempotency_key=None, user=None):
        if expected_beat_seq is not None and expected_beat_seq != seq["v"]:
            raise _stale_409(seq["v"])         # a stale token would 409 here — proves the guard works
        seq["v"] += 1
        return {"event": {"content": "noms"}, "beatSeq": seq["v"]}

    monkeypatch.setattr(llm_core, "llm_call_async", fake_llm)
    monkeypatch.setattr(orwell_engine, "record_interaction", fake_record)
    monkeypatch.setattr(orwell_engine, "game_status", fake_status)
    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)
    monkeypatch.setattr(orwell_engine, "advance_game", fake_advance)
    chat_helpers.clear_social_runway("owner")

    # The turn: a recorded scene (bumps beatSeq 50→51), THEN a progression advance. If the advance
    # attached the stale pre-record token (50) it would 409 — the refresh from the record's response
    # is what prevents it.
    assert _run(al._auto_record_scene("worked the room", "talk", HOUSE, "url", "m", {}, "owner")) is True
    _run(chat_helpers._pre_resolve_npc_ceremony("owner", {"phase": "nominations", "week": 1},
                                                retry=False, player_msg="let's see the noms"))
    assert chat_helpers.stale_beat_rejections() == 0, "a normal record→advance turn must not self-409"


def test_normal_turn_make_deal_never_self_409s(monkeypatch):
    """A read seeds last-seen, then a back-fill makeDeal attaches the fresh token — no self-409."""
    seq = {"v": 60}

    async def fake_llm(*a, **k):
        return '{"struck":true,"withId":"npc:7","kind":"final-two","terms":"to the end"}'

    async def fake_status(user=None):
        return {"phase": "social", "pending": None, "veto": {}, "beatSeq": seq["v"]}

    async def fake_state(user=None, **kw):
        return {"phase": "social", "week": 1, "finished": False, "house": [], "beatSeq": seq["v"]}

    async def fake_make_deal(with_id, kind, terms, expected_beat_seq=None, user=None):
        if expected_beat_seq is not None and expected_beat_seq != seq["v"]:
            raise _stale_409(seq["v"])
        seq["v"] += 1
        return {"deal": {"kind": kind}, "beatSeq": seq["v"]}

    monkeypatch.setattr(llm_core, "llm_call_async", fake_llm)
    monkeypatch.setattr(orwell_engine, "game_status", fake_status)
    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)
    monkeypatch.setattr(orwell_engine, "make_deal", fake_make_deal)

    # A framing read seeds last-seen (60), then the deal back-fill attaches that fresh token.
    _run(chat_helpers._capture_beat_signature("owner"))
    assert _run(al._auto_record_deal("we shake on a final two", "deal", HOUSE, "url", "m", {}, "owner")) is True
    assert chat_helpers.stale_beat_rejections() == 0


def test_normal_turn_move_never_self_409s(monkeypatch):
    seq = {"v": 70}

    async def fake_llm(*a, **k):
        return '{"room":"backyard"}'

    async def fake_status(user=None):
        return {"phase": "social", "pending": None, "veto": {}, "beatSeq": seq["v"]}

    async def fake_state(user=None, **kw):
        return {"phase": "social", "week": 1, "finished": False, "house": [], "beatSeq": seq["v"]}

    async def fake_move_to(room, expected_beat_seq=None, user=None):
        if expected_beat_seq is not None and expected_beat_seq != seq["v"]:
            raise _stale_409(seq["v"])
        seq["v"] += 1
        return {"whereabouts": {"room": room}, "beatSeq": seq["v"]}

    monkeypatch.setattr(llm_core, "llm_call_async", fake_llm)
    monkeypatch.setattr(orwell_engine, "game_status", fake_status)
    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)
    monkeypatch.setattr(orwell_engine, "move_to", fake_move_to)

    _run(chat_helpers._capture_beat_signature("owner"))
    assert _run(al._auto_move_player("You step out back.", "let's go out back", "url", "m", {}, "owner")) is True
    assert chat_helpers.stale_beat_rejections() == 0


# ── 3. a stale 409 on a back-fill is reconciled-and-RE-ATTEMPTED against the fresh beatSeq (#591) ── #
#
# #591 (A-S3) reversed the prior reconcile-and-SKIP: the engine throws StaleBeatError BEFORE folding
# (fail-closed, at-most-once), so the write provably did not land — and a recordInteraction back-fill is
# often a scene's ONLY consequence fold (mandate #4 — "a novel move must never evaporate"). So the belt
# now reconciles to the fresh beatSeq and RE-ATTEMPTS the same mutation once. These tests are the #591
# falsifier: a stale token on a back-fill's sole call, asserting the fold STILL lands exactly once after
# reconcile (not dropped).

def test_record_backfill_stale_409_is_reattempted_and_lands(monkeypatch):
    """A recordInteraction back-fill hitting a stale 409 (the board moved under it) reconciles to the
    fresh beatSeq and RE-ATTEMPTS — the fold lands exactly once (#591), it does NOT evaporate. The
    engine threw before folding, so the single retry cannot double-apply."""
    chat_helpers._LAST_BEAT_SEQ["owner"] = 4   # stale token
    record_calls = {"n": 0}

    async def fake_llm(*a, **k):
        return '{"withIds":["npc:3"],"kind":"bonding","content":"a bond"}'

    async def fake_record(content, with_ids=None, kind=None, consequence=None,
                          expected_beat_seq=None, user=None):
        record_calls["n"] += 1
        # First call carries the stale token (4) → 409; the reconcile refreshes last-seen to 9, so the
        # RE-ATTEMPT carries 9 and the engine accepts it (the fold lands).
        if expected_beat_seq != 9:
            raise _stale_409(9)                # board moved on to 9 under the stale write
        return {"recorded": True, "beatSeq": 10}

    # the board re-read on reconcile
    async def fake_status(user=None):
        return {"week": 3, "phase": "veto", "pending": None, "veto": {}, "beatSeq": 9}

    async def fake_state(user=None, **kw):
        return {"week": 3, "phase": "veto", "finished": False, "house": [], "beatSeq": 9}

    monkeypatch.setattr(llm_core, "llm_call_async", fake_llm)
    monkeypatch.setattr(orwell_engine, "record_interaction", fake_record)
    monkeypatch.setattr(orwell_engine, "game_status", fake_status)
    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)

    out = _run(al._auto_record_scene("a bond", "talk", HOUSE, "url", "m", {}, "owner"))
    assert out is True, "the fold lands after the reconcile+re-attempt — it does not evaporate (#591)"
    assert record_calls["n"] == 2, "stale once, then re-attempted exactly once against the fresh seq"
    assert chat_helpers.stale_beat_rejections() == 1
    assert chat_helpers.last_beat_seq("owner") == 10       # refreshed off the successful retry's response


def test_record_backfill_stale_twice_gives_up_no_stomp(monkeypatch):
    """If the board moves AGAIN under the retry (a second consecutive stale 409), the belt reconciles
    and gives up — it returns False (re-derives next turn), never blind-loops into a stomp."""
    chat_helpers._LAST_BEAT_SEQ["owner"] = 4
    record_calls = {"n": 0}

    async def fake_llm(*a, **k):
        return '{"withIds":["npc:3"],"kind":"bonding","content":"a bond"}'

    async def fake_record(content, with_ids=None, kind=None, consequence=None,
                          expected_beat_seq=None, user=None):
        record_calls["n"] += 1
        raise _stale_409(9 + record_calls["n"])  # always stale — the board keeps moving

    async def fake_status(user=None):
        return {"week": 3, "phase": "veto", "pending": None, "veto": {}, "beatSeq": 99}

    async def fake_state(user=None, **kw):
        return {"week": 3, "phase": "veto", "finished": False, "house": [], "beatSeq": 99}

    monkeypatch.setattr(llm_core, "llm_call_async", fake_llm)
    monkeypatch.setattr(orwell_engine, "record_interaction", fake_record)
    monkeypatch.setattr(orwell_engine, "game_status", fake_status)
    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)

    out = _run(al._auto_record_scene("a bond", "talk", HOUSE, "url", "m", {}, "owner"))
    assert out is False, "a second consecutive stale 409 gives up (re-derives next turn)"
    assert record_calls["n"] == 2, "tried once + re-attempted once, then stopped (no blind loop)"
    assert chat_helpers.stale_beat_rejections() == 2       # both 409s reconciled/counted
    assert "owner" in chat_helpers._DESYNC_REGROUND        # next turn re-grounds to the moved board


def test_make_deal_backfill_stale_409_is_reattempted(monkeypatch):
    chat_helpers._LAST_BEAT_SEQ["owner"] = 4
    calls = {"n": 0}

    async def fake_llm(*a, **k):
        return '{"struck":true,"withId":"npc:3","kind":"safety","terms":"x"}'

    async def fake_make_deal(with_id, kind, terms, expected_beat_seq=None, user=None):
        calls["n"] += 1
        if expected_beat_seq != 15:
            raise _stale_409(15)
        return {"deal": True, "beatSeq": 16}

    async def fake_status(user=None):
        return {"week": 4, "phase": "eviction", "pending": None, "veto": {}, "beatSeq": 15}

    async def fake_state(user=None, **kw):
        return {"week": 4, "phase": "eviction", "finished": False, "house": [], "beatSeq": 15}

    monkeypatch.setattr(llm_core, "llm_call_async", fake_llm)
    monkeypatch.setattr(orwell_engine, "make_deal", fake_make_deal)
    monkeypatch.setattr(orwell_engine, "game_status", fake_status)
    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)

    out = _run(al._auto_record_deal("we shake on it", "deal", HOUSE, "url", "m", {}, "owner"))
    assert out is True                                      # re-attempted against the fresh seq (#591)
    assert calls["n"] == 2                                  # stale once, then re-attempted once
    assert chat_helpers.stale_beat_rejections() == 1
    assert chat_helpers.last_beat_seq("owner") == 16        # off the successful retry's response


def test_move_backfill_stale_409_is_reattempted(monkeypatch):
    chat_helpers._LAST_BEAT_SEQ["owner"] = 4
    calls = {"n": 0}

    async def fake_llm(*a, **k):
        return '{"room":"kitchen"}'

    async def fake_move_to(room, expected_beat_seq=None, user=None):
        calls["n"] += 1
        if expected_beat_seq != 22:
            raise _stale_409(22)
        return {"whereabouts": {"room": room}, "beatSeq": 23}

    async def fake_status(user=None):
        return {"week": 5, "phase": "hoh-competition", "pending": None, "veto": {}, "beatSeq": 22}

    async def fake_state(user=None, **kw):
        return {"week": 5, "phase": "hoh-competition", "finished": False, "house": [], "beatSeq": 22}

    monkeypatch.setattr(llm_core, "llm_call_async", fake_llm)
    monkeypatch.setattr(orwell_engine, "move_to", fake_move_to)
    monkeypatch.setattr(orwell_engine, "game_status", fake_status)
    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)

    out = _run(al._auto_move_player("You head to the kitchen.", "I head to the kitchen", "url", "m", {}, "owner"))
    assert out is True                                      # re-attempted against the fresh seq (#591)
    assert calls["n"] == 2
    assert chat_helpers.stale_beat_rejections() == 1
    assert chat_helpers.last_beat_seq("owner") == 23


def test_e22_fallback_stale_409_is_skipped(monkeypatch):
    """The E22 fallback also reconciles-and-skips a stale 409, releasing its single-flight slot."""
    chat_helpers._LAST_BEAT_SEQ["u"] = 1

    async def fake_record(content, with_ids=None, initiator="player", kind=None,
                          expected_beat_seq=None, user=None):
        raise _stale_409(33)

    async def fake_status(user=None):
        return {"week": 6, "phase": "eviction", "pending": None, "veto": {}, "beatSeq": 33}

    async def fake_state(user=None, **kw):
        return {"week": 6, "phase": "eviction", "finished": False, "house": [], "beatSeq": 33}

    monkeypatch.setattr(orwell_engine, "record_interaction", fake_record)
    monkeypatch.setattr(orwell_engine, "game_status", fake_status)
    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)
    narration = "A long beat the model never recorded, recounted in full. " * 4
    out = _run(chat_helpers.ensure_turn_recorded("u", "m", narration, []))
    assert out is False
    assert chat_helpers.stale_beat_rejections() == 1
    assert chat_helpers.last_beat_seq("u") == 33
    assert chat_helpers.fallback_in_flight("u") is False    # the single-flight slot was released


# ── 4. a NON-stale error still falls through the back-fill's own fail-closed handler ───────────── #

def test_non_stale_error_in_backfill_is_swallowed_fail_closed(monkeypatch):
    """A NON-stale engine error (e.g. a 500) is re-raised by the CAS helper and caught by the
    back-fill's own fail-closed `except` — it returns False, never crashes, and does NOT count as a
    stale rejection."""
    chat_helpers._LAST_BEAT_SEQ["owner"] = 5

    async def fake_llm(*a, **k):
        return '{"withIds":["npc:3"],"kind":"bonding","content":"a bond"}'

    async def fake_record(content, with_ids=None, kind=None, consequence=None,
                          expected_beat_seq=None, user=None):
        raise orwell_engine.EngineToolError("engine exploded", status=500)

    monkeypatch.setattr(llm_core, "llm_call_async", fake_llm)
    monkeypatch.setattr(orwell_engine, "record_interaction", fake_record)
    out = _run(al._auto_record_scene("a bond", "talk", HOUSE, "url", "m", {}, "owner"))
    assert out is False
    assert chat_helpers.stale_beat_rejections() == 0        # a 500 is not a stale-beat


# ── 5. source-pin: the three back-fills route through the CAS helper ───────────────────────────── #

def test_backfills_are_wired_through_the_cas_helper():
    import os
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(base, "src", "agent_loop.py"), encoding="utf-8") as fh:
        src = fh.read()
    assert "async def _backfill_with_cas" in src
    assert "_backfill_with_cas(owner, _oe.record_interaction" in src
    assert "_backfill_with_cas(owner, _oe.make_deal" in src
    assert "_backfill_with_cas(owner, _oe.move_to" in src
    # the helper attaches the token, refreshes from the response, and skips a stale 409
    assert "expected_beat_seq=_ch.last_beat_seq(owner)" in src
    assert "_ch._refresh_beat_seq(owner" in src
    assert "_ch._handle_stale_beat(owner" in src

    with open(os.path.join(base, "routes", "chat_helpers.py"), encoding="utf-8") as fh:
        ch = fh.read()
    # the E22 fallback also carries the CAS token + reconciles a stale 409
    assert "expected_beat_seq=last_beat_seq(user)" in ch
    assert "_is_stale_beat_error(_stale_e)" in ch
