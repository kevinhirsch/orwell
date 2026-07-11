"""A10 / #591 / R1c — the FE half of the at-most-once fold key.

The engine now dedups a re-driven `recordInteraction` by a caller-minted `idempotencyKey` (see
`tests/unit/recordInteractionIdempotency.test.ts`). For that to actually stop the double-apply, the FE
must mint ONE stable key per scene and attach the SAME key to EVERY attempt of that scene: the initial
call, the #591 single retry after a reconcile, AND every CON-11 deferred-queue drain. This suite pins
that end of the contract.

Why it matters (the bug): under sustained two-window concurrency two turns can drain the SAME deferred
fold and re-drive it; a 409 there is ambiguous, so the FE conservatively re-queues and the fold would
land twice. A stable key rides in kwargs — `_backfill_with_cas` and the deferred queue both re-pass the
same kwargs — so every re-drive carries the same key and the engine folds it at most once. Roles only;
the engine client is faked so we capture the exact key the FE passes.
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
    chat_helpers._DEFERRED_FOLDS.clear()
    chat_helpers.reset_stale_beat_rejections()
    yield
    chat_helpers._LAST_BEAT_SEQ.clear()
    chat_helpers._LAST_BEAT_SIG.clear()
    chat_helpers._DESYNC_REGROUND.clear()
    chat_helpers._DEFERRED_FOLDS.clear()
    chat_helpers.reset_stale_beat_rejections()


def _stale_409(now: int) -> "orwell_engine.EngineToolError":
    return orwell_engine.EngineToolError(
        f"stale write refused — expected beatSeq is behind the current board (now {now}); re-ground",
        status=409)


# ── 1. a normal record attaches a NON-EMPTY idempotency key ─────────────────────────────────────── #

def test_record_backfill_attaches_a_stable_idempotency_key(monkeypatch):
    chat_helpers._LAST_BEAT_SEQ["owner"] = 11
    captured = {}

    async def fake_llm(*a, **k):
        return '{"withIds":["npc:3"],"kind":"bonding","content":"a quiet bond"}'

    async def fake_record(content, with_ids=None, kind=None, consequence=None,
                          expected_beat_seq=None, idempotency_key=None, user=None):
        captured["key"] = idempotency_key
        return {"recorded": True, "beatSeq": 12}

    monkeypatch.setattr(llm_core, "llm_call_async", fake_llm)
    monkeypatch.setattr(orwell_engine, "record_interaction", fake_record)

    out = _run(al._auto_record_scene("a quiet bond", "talk to Cynthia", HOUSE, "url", "m", {}, "owner"))
    assert out is True
    assert isinstance(captured["key"], str) and captured["key"], "a stable at-most-once key is attached"


# ── 2. the #591 single retry after a reconcile reuses the SAME key ──────────────────────────────── #

def test_stale_once_retry_reuses_the_same_key(monkeypatch):
    """A stale-409 reconcile+re-attempt (#591) must carry the SAME key on both attempts — otherwise the
    engine could not recognize the retry as the same scene and would fold it twice."""
    chat_helpers._LAST_BEAT_SEQ["owner"] = 4
    keys = []

    async def fake_llm(*a, **k):
        return '{"withIds":["npc:3"],"kind":"bonding","content":"a bond"}'

    async def fake_record(content, with_ids=None, kind=None, consequence=None,
                          expected_beat_seq=None, idempotency_key=None, user=None):
        keys.append(idempotency_key)
        if expected_beat_seq != 9:
            raise _stale_409(9)                # board moved on to 9 under the stale write
        return {"recorded": True, "beatSeq": 10}

    async def fake_status(user=None):
        return {"week": 3, "phase": "veto", "pending": None, "veto": {}, "beatSeq": 9}

    async def fake_state(user=None, **kw):
        return {"week": 3, "phase": "veto", "finished": False, "house": [], "beatSeq": 9}

    monkeypatch.setattr(llm_core, "llm_call_async", fake_llm)
    monkeypatch.setattr(orwell_engine, "record_interaction", fake_record)
    monkeypatch.setattr(orwell_engine, "game_status", fake_status)
    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)

    out = _run(al._auto_record_scene("a bond", "talk", HOUSE, "url", "m", {}, "owner"))
    assert out is True
    assert len(keys) == 2, "stale once, then re-attempted once"
    assert keys[0] is not None and keys[0] == keys[1], "the retry reuses the SAME key (at-most-once)"


# ── 3. a deferred fold (double stale-409) carries the key, and the drain reuses it ──────────────── #

def test_deferred_fold_carries_the_key_and_drain_reuses_it(monkeypatch):
    """A double stale-409 defers the fold (CON-11). The queued entry must carry the key, and when it is
    drained on the next back-fill opportunity it must re-drive with the SAME key — so a concurrent
    re-drive of the same deferred fold can never double-apply at the engine."""
    chat_helpers._LAST_BEAT_SEQ["owner"] = 4
    keys = []

    async def fake_llm(*a, **k):
        return '{"withIds":["npc:3"],"kind":"bonding","content":"a bond"}'

    async def fake_record(content, with_ids=None, kind=None, consequence=None,
                          expected_beat_seq=None, idempotency_key=None, user=None):
        keys.append(idempotency_key)
        if expected_beat_seq == 11:
            return {"recorded": True, "beatSeq": 12}   # board settled at 11 — it lands
        raise _stale_409(9 + len(keys))                # always stale — the board keeps moving

    async def fake_status(user=None):
        return {"week": 3, "phase": "veto", "pending": None, "veto": {}, "beatSeq": 99}

    async def fake_state(user=None, **kw):
        return {"week": 3, "phase": "veto", "finished": False, "house": [], "beatSeq": 99}

    monkeypatch.setattr(llm_core, "llm_call_async", fake_llm)
    monkeypatch.setattr(orwell_engine, "record_interaction", fake_record)
    monkeypatch.setattr(orwell_engine, "game_status", fake_status)
    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)

    out = _run(al._auto_record_scene("a bond", "talk", HOUSE, "url", "m", {}, "owner"))
    assert out is False                                 # nothing landed yet — deferred
    assert chat_helpers.deferred_fold_count("owner") == 1
    assert len(keys) == 2 and keys[0] == keys[1], "the #591 retry already reused the key"
    scene_key = keys[0]

    # The queued entry must carry the SAME key in its stored kwargs (so any later drain re-drives it
    # idempotently — the crux of the double-apply fix under concurrency).
    queued = chat_helpers._DEFERRED_FOLDS[chat_helpers._beat_seq_key("owner")]
    assert queued[0]["kwargs"].get("idempotency_key") == scene_key

    # Now the board settles at 11 and this owner issues a NEW back-fill (a deal) — the drain retries the
    # deferred record BEFORE the new call, and must re-drive with the SAME key.
    chat_helpers._LAST_BEAT_SEQ["owner"] = 11

    async def fake_llm_deal(*a, **k):
        return '{"struck":true,"withId":"npc:7","kind":"safety","terms":"x"}'

    async def fake_make_deal(with_id, kind, terms, expected_beat_seq=None, idempotency_key=None, user=None):
        return {"deal": True, "beatSeq": 13}

    monkeypatch.setattr(llm_core, "llm_call_async", fake_llm_deal)
    monkeypatch.setattr(orwell_engine, "make_deal", fake_make_deal)

    out2 = _run(al._auto_record_deal("we shake on it", "deal", HOUSE, "url", "m", {}, "owner"))
    assert out2 is True
    assert chat_helpers.deferred_fold_count("owner") == 0, "the deferred fold drained and landed"
    assert len(keys) == 3, "the deferred record was re-driven exactly once on the drain"
    assert keys[2] == scene_key, "the drain re-drove with the SAME key — the engine dedups it"


# ── 4. source-pins: the wiring is where it must be ──────────────────────────────────────────────── #

def test_wiring_source_pins():
    import os
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(base, "src", "agent_loop.py"), encoding="utf-8") as fh:
        al_src = fh.read()
    # the scene belt mints a stable key and threads it into the CAS back-fill
    assert "_mint_idempotency_key()" in al_src
    assert "idempotency_key=_scene_idem_key" in al_src

    with open(os.path.join(base, "src", "orwell_engine.py"), encoding="utf-8") as fh:
        oe_src = fh.read()
    # the wrapper forwards the key into the engine payload as idempotencyKey (at-most-once)
    assert "idempotency_key: str | None = None" in oe_src
    assert 'req["idempotencyKey"] = idempotency_key' in oe_src


# ── 5. the fold-bearing SIBLING LEVERS (A10 follow-up — the FE half of #1305) ───────────────────── #
#
# The engine dedups makeDeal/confide/exposeSecret/tradeSecret by a caller-minted idempotencyKey
# (tests/unit/foldLeverIdempotency.test.ts). These pin the FE half for each lever's belt: the belt
# mints ONE stable key and threads it through EVERY attempt (initial call, the #591 retry, and the
# CON-11 deferred-queue drain) — without it the engine ledgers are dead at runtime and the deferred-
# fold double-apply latent (#1297's bug) stays open for these levers.

_LEVER_CASES = [
    # (belt, engine fn name, extraction JSON, success result, needs get_visible_state knowledge)
    ("_auto_record_deal", "make_deal",
     '{"struck":true,"withId":"npc:7","kind":"safety","terms":"x"}', {"deal": True}, False),
    ("_auto_confide", "confide",
     '{"npcId":"npc:3"}', {"disclosed": False}, False),
    ("_auto_expose_secret", "expose_secret",
     '{"factId":"fact:1"}', {"exposed": True}, True),
    ("_auto_trade_secret", "trade_secret",
     '{"factId":"fact:1","toNpcId":"npc:3","askKind":"a vote"}', {"accepted": True}, True),
]


def _patch_vis(monkeypatch):
    """The player legitimately knows ONE fact about npc:7 (roles only) — what the expose/trade belts
    ground their extraction in (never invented)."""
    async def fake_vis(user=None, **k):
        return {"knowledge": [{"id": "fact:1", "content": "a hidden past", "subject": "npc:7"}]}
    monkeypatch.setattr(orwell_engine, "get_visible_state", fake_vis)


@pytest.mark.parametrize("belt,fn_name,llm_json,ok,needs_vis", _LEVER_CASES)
def test_lever_backfill_attaches_a_stable_idempotency_key(monkeypatch, belt, fn_name, llm_json, ok, needs_vis):
    chat_helpers._LAST_BEAT_SEQ["owner"] = 11
    keys = []

    async def fake_llm(*a, **k):
        return llm_json

    async def fake_lever(*a, expected_beat_seq=None, idempotency_key=None, user=None, **k):
        keys.append(idempotency_key)
        return {**ok, "beatSeq": 12}

    monkeypatch.setattr(llm_core, "llm_call_async", fake_llm)
    monkeypatch.setattr(orwell_engine, fn_name, fake_lever)
    if needs_vis:
        _patch_vis(monkeypatch)

    out = _run(getattr(al, belt)("what happened", "the player's move", HOUSE, "url", "m", {}, "owner"))
    assert out is True
    assert len(keys) == 1
    assert isinstance(keys[0], str) and keys[0], f"{fn_name}: a stable at-most-once key is attached"


@pytest.mark.parametrize("belt,fn_name,llm_json,ok,needs_vis", _LEVER_CASES)
def test_lever_stale_once_retry_reuses_the_same_key(monkeypatch, belt, fn_name, llm_json, ok, needs_vis):
    """A stale-409 reconcile+re-attempt (#591) must carry the SAME key on both attempts for every
    fold-bearing lever — otherwise the engine cannot recognize the retry as the same action and the
    hidden fold applies twice."""
    chat_helpers._LAST_BEAT_SEQ["owner"] = 4
    keys = []

    async def fake_llm(*a, **k):
        return llm_json

    async def fake_lever(*a, expected_beat_seq=None, idempotency_key=None, user=None, **k):
        keys.append(idempotency_key)
        if expected_beat_seq != 9:
            raise _stale_409(9)                 # board moved on to 9 under the stale write
        return {**ok, "beatSeq": 10}

    async def fake_status(user=None):
        return {"week": 3, "phase": "veto", "pending": None, "veto": {}, "beatSeq": 9}

    async def fake_state(user=None, **kw):
        return {"week": 3, "phase": "veto", "finished": False, "house": [], "beatSeq": 9}

    monkeypatch.setattr(llm_core, "llm_call_async", fake_llm)
    monkeypatch.setattr(orwell_engine, fn_name, fake_lever)
    monkeypatch.setattr(orwell_engine, "game_status", fake_status)
    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)
    if needs_vis:
        _patch_vis(monkeypatch)

    out = _run(getattr(al, belt)("what happened", "the player's move", HOUSE, "url", "m", {}, "owner"))
    assert out is True
    assert len(keys) == 2, f"{fn_name}: stale once, then re-attempted once"
    assert keys[0] is not None and keys[0] == keys[1], \
        f"{fn_name}: the retry reuses the SAME key (at-most-once)"


def test_lever_deferred_fold_carries_the_key_and_drain_reuses_it(monkeypatch):
    """A double stale-409 on a fold-bearing LEVER defers it (CON-11). The queued entry must carry the
    key, and the drain must re-drive with the SAME key — so two turns draining the same deferred deal
    can never fold it twice at the engine (the exact #1297 latent, closed for the levers)."""
    chat_helpers._LAST_BEAT_SEQ["owner"] = 4
    keys = []

    async def fake_llm(*a, **k):
        return '{"struck":true,"withId":"npc:7","kind":"safety","terms":"x"}'

    async def fake_make_deal(with_id, kind, terms, expected_beat_seq=None,
                             idempotency_key=None, user=None):
        keys.append(idempotency_key)
        if expected_beat_seq == 11:
            return {"deal": True, "beatSeq": 12}   # board settled at 11 — it lands
        raise _stale_409(5)                        # keeps moving — both in-turn attempts stay stale

    async def fake_status(user=None):
        return {"week": 3, "phase": "veto", "pending": None, "veto": {}, "beatSeq": 5}

    async def fake_state(user=None, **kw):
        return {"week": 3, "phase": "veto", "finished": False, "house": [], "beatSeq": 5}

    monkeypatch.setattr(llm_core, "llm_call_async", fake_llm)
    monkeypatch.setattr(orwell_engine, "make_deal", fake_make_deal)
    monkeypatch.setattr(orwell_engine, "game_status", fake_status)
    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)

    out = _run(al._auto_record_deal("we shake on it", "deal", HOUSE, "url", "m", {}, "owner"))
    assert out is False                             # nothing landed yet — deferred
    assert chat_helpers.deferred_fold_count("owner") == 1
    assert len(keys) == 2 and keys[0] is not None and keys[0] == keys[1]
    deal_key = keys[0]

    # The queued entry carries the SAME key in its stored kwargs (the crux under concurrency).
    queued = chat_helpers._DEFERRED_FOLDS[chat_helpers._beat_seq_key("owner")]
    assert queued[0]["kwargs"].get("idempotency_key") == deal_key

    # The board settles at 11; the opportunistic drain re-drives the deal with the SAME key.
    chat_helpers._LAST_BEAT_SEQ["owner"] = 11
    _run(chat_helpers._drain_deferred_folds("owner"))
    assert chat_helpers.deferred_fold_count("owner") == 0, "the deferred deal drained and landed"
    assert len(keys) == 3 and keys[2] == deal_key, \
        "the drain re-drove with the SAME key — the engine dedups it"


def test_lever_wiring_source_pins():
    import os
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(base, "src", "agent_loop.py"), encoding="utf-8") as fh:
        al_src = fh.read()
    # each fold-bearing lever belt mints a stable key and threads it into the CAS back-fill
    assert al_src.count("idempotency_key=_ch_idem._mint_idempotency_key()") >= 4, \
        "the deal/confide/expose/trade belts each mint + thread an at-most-once key"

    with open(os.path.join(base, "src", "orwell_engine.py"), encoding="utf-8") as fh:
        oe_src = fh.read()
    # each lever wrapper forwards the key into the engine payload as idempotencyKey (at-most-once)
    assert oe_src.count('args["idempotencyKey"] = idempotency_key') >= 4, \
        "make_deal/confide/expose_secret/trade_secret each thread idempotencyKey when provided"
