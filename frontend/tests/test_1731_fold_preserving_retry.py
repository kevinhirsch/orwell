"""#1731 (C2) / audit A-S3 — a consequence fold must never be dropped on a double stale-409 under real
two-window concurrency, and a fold that ULTIMATELY cannot commit must be SURFACED, never silently lost.

Background (feature 0065 closed-set sync spine): a mutating engine tool carrying a stale `expectedBeatSeq`
is refused with a typed StaleBeatError → HTTP 409 `stale-beat` BEFORE any write, and the FE reconciles the
409 through the desync mechanism. Every FE-issued fold-bearing back-fill (`recordInteraction`/`makeDeal`/
the trust levers) routes through `_backfill_with_cas`, which:
  * RE-ATTEMPTS once against the reconciled beatSeq on a SINGLE stale-409 (#591), landing the sole fold;
  * DEFERS on a DOUBLE stale-409 (CON-11) into a bounded per-owner queue rather than dropping it — the
    fold lands late (drained on the next back-fill), never never;
  * threads ONE stable `idempotency_key` through EVERY attempt (initial / #591 retry / deferred-drain), so
    the engine dedups a same-key re-drive and the fold applies EXACTLY once even if a racing attempt
    already committed it.

Requirement #1 (exactly-once via idempotencyKey) is pinned by ``test_a10_fold_idempotency.py`` /
``test_1537_as3_floor_fold_retry.py``. THIS suite pins the C2 closure — requirement #2 / AC-2: the
opportunistic retry is itself BOUNDED. Under SUSTAINED concurrency the board can keep moving under every
drain attempt; without a bound the deferred fold would be re-queued forever (silently stuck — a mandate-#4
/ I4 non-degradation breach that never surfaces). After ``_DEFERRED_FOLD_MAX_DRAINS`` failed drains the
fold is declared a GENUINE loss: FAIL-CLOSED and SURFACED (a RED-eligible ``sync:dropped-fold`` health
event + a ledger note), then dropped — accounted, never invisible. And AC-3: the alarm stays a TRUE
positive — a fold that lands on an early drain never trips it.

Roles only; the engine client is faked so we capture the exact tokens/keys the FE passes and can force
the double-409 path deterministically.
"""
import asyncio
import importlib

import pytest

chat_helpers = importlib.import_module("routes.chat_helpers")
orwell_engine = importlib.import_module("src.orwell_engine")
agent_loop = importlib.import_module("src.agent_loop")
sync_ledger = importlib.import_module("src.orwell_sync_ledger")


def _run(coro):
    # NOTE (xdist hygiene): reuse the thread's existing event loop — never `asyncio.run()`, which would
    # null the thread's loop and poison sibling tests that call `get_event_loop()`.
    return asyncio.get_event_loop().run_until_complete(coro)


def _stale_409(now: int) -> "orwell_engine.EngineToolError":
    return orwell_engine.EngineToolError(
        f"stale write refused — expected beatSeq is behind the current board (now {now}); re-ground",
        status=409)


@pytest.fixture(autouse=True)
def _clean_state():
    chat_helpers._LAST_BEAT_SEQ.clear()
    chat_helpers._LAST_BEAT_SIG.clear()
    chat_helpers._DESYNC_REGROUND.clear()
    chat_helpers._DEFERRED_FOLDS.clear()
    chat_helpers._draining_folds.clear()
    chat_helpers.reset_stale_beat_rejections()
    yield
    chat_helpers._LAST_BEAT_SEQ.clear()
    chat_helpers._LAST_BEAT_SIG.clear()
    chat_helpers._DESYNC_REGROUND.clear()
    chat_helpers._DEFERRED_FOLDS.clear()
    chat_helpers._draining_folds.clear()
    chat_helpers.reset_stale_beat_rejections()


def _patch_reconcile_reads(monkeypatch, now: int):
    """`_handle_stale_beat` re-reads the board (gameStatus + getGameState) to reconcile precisely — fake
    both to the reconciled `beatSeq` so a retry attaches the fresh token (no real network)."""
    async def fake_status(user=None):
        return {"week": 4, "phase": "veto", "pending": None, "veto": {}, "beatSeq": now}

    async def fake_state(user=None, **kw):
        return {"week": 4, "phase": "veto", "finished": False, "house": [], "beatSeq": now}

    monkeypatch.setattr(orwell_engine, "game_status", fake_status)
    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)


# ── 1. EXACTLY-ONCE under a forced DOUBLE stale-409, then success (not zero, not two) ─────────────── #

def test_double_stale_then_settle_folds_exactly_once_same_key(monkeypatch):
    """The fold-bearing back-fill hits a stale-409, the #591 retry hits ANOTHER (a genuine second
    concurrent move), so it DEFERS (never drops). When the board settles and the owner drains, the
    deferred fold lands EXACTLY once — every attempt carried the SAME at-most-once key, so even a racing
    re-drive could not double-apply at the engine."""
    _patch_reconcile_reads(monkeypatch, now=9)
    chat_helpers._LAST_BEAT_SEQ["owner"] = 4
    keys = []
    committed = {}                                   # idempotency_key -> prior result (engine ledger)
    settled = {"v": False}

    async def fake_record(content, with_ids=None, kind=None, consequence=None,
                          expected_beat_seq=None, idempotency_key=None, felt_minutes=None, user=None):
        keys.append(idempotency_key)
        if idempotency_key in committed:
            return committed[idempotency_key]        # DEDUP — a repeat re-drive never folds twice
        if not settled["v"]:
            raise _stale_409(9)                      # board keeps moving — both in-turn attempts stale
        committed[idempotency_key] = {"recorded": True, "beatSeq": 12}
        return committed[idempotency_key]

    scene_key = chat_helpers._mint_idempotency_key()
    res = _run(agent_loop._backfill_with_cas(
        "owner", fake_record, "a wary swing-vote bond",
        with_ids=["npc:3"], kind="bonding", user="owner",
        defer_fold=True, idempotency_key=scene_key))
    assert res is None                               # nothing landed THIS call — deferred, never dropped
    assert chat_helpers.deferred_fold_count("owner") == 1
    assert len(committed) == 0                        # the fold did NOT apply while contested
    assert len(keys) == 2 and keys[0] == keys[1] == scene_key, "both in-turn attempts reused the key"

    # The board settles; a drain re-drives the deferred fold — it lands EXACTLY once, same key.
    settled["v"] = True
    chat_helpers._LAST_BEAT_SEQ["owner"] = 11
    _run(chat_helpers._drain_deferred_folds("owner"))
    assert chat_helpers.deferred_fold_count("owner") == 0, "the deferred fold drained and landed"
    assert len(committed) == 1, "applied EXACTLY once — never zero, never two"
    assert keys[-1] == scene_key, "the drain re-drove with the SAME key (engine dedups)"


# ── 2. A fold that ULTIMATELY cannot commit is SURFACED (typed + ledger), never silently dropped ─── #

def test_deferred_fold_exhausting_its_retry_budget_is_surfaced_not_silently_dropped(monkeypatch):
    """Under sustained concurrency the board moves under EVERY drain. The deferred fold must NOT be
    re-queued forever (which would silently swallow a scene's only consequence fold). After
    `_DEFERRED_FOLD_MAX_DRAINS` failed drains it is declared a genuine loss: surfaced via
    `note_stale_rejection(dropped_fold=True)` (the RED `sync:dropped-fold` health event + a ledger note)
    and dropped from the queue. This is the exact #1731 requirement #2 / AC-2 closure."""
    _patch_reconcile_reads(monkeypatch, now=9)
    chat_helpers._LAST_BEAT_SEQ["owner"] = 4

    surfaced = []
    real_note = sync_ledger.note_stale_rejection

    def spy_note(user, n=1, *args, **kwargs):
        if kwargs.get("dropped_fold"):
            surfaced.append(kwargs.get("cause"))
        return real_note(user, n, *args, **kwargs)

    monkeypatch.setattr(sync_ledger, "note_stale_rejection", spy_note)

    scene_key = chat_helpers._mint_idempotency_key()
    attempts = {"n": 0}

    async def always_stale(*a, expected_beat_seq=None, idempotency_key=None, **k):
        attempts["n"] += 1
        raise _stale_409(9)                          # the board never settles — every drive stays stale

    # Queue a fold-bearing entry directly (as `_backfill_with_cas` would after a double-409), carrying
    # the stable key in its stored kwargs so any drain re-drives it idempotently.
    chat_helpers._defer_fold("owner", always_stale, ("a bond",),
                             {"idempotency_key": scene_key, "user": "owner"},
                             desc="record_interaction")
    assert chat_helpers.deferred_fold_count("owner") == 1

    max_drains = chat_helpers._DEFERRED_FOLD_MAX_DRAINS
    # The first (max_drains - 1) drains keep it queued (still contested, within budget); the LAST one
    # crosses the budget → surface + drop.
    for i in range(max_drains - 1):
        _run(chat_helpers._drain_deferred_folds("owner"))
        assert chat_helpers.deferred_fold_count("owner") == 1, f"still queued within budget (drain {i+1})"
        assert not surfaced, "not surfaced while still within the retry budget (AC-3: a true positive only)"

    _run(chat_helpers._drain_deferred_folds("owner"))
    assert chat_helpers.deferred_fold_count("owner") == 0, "the un-committable fold is DROPPED, not re-queued forever"
    assert surfaced, "the genuine loss surfaced a typed dropped-fold ledger note (never silent)"
    assert "budget" in (surfaced[0] or ""), "the surfaced cause names the exhausted retry budget"
    assert attempts["n"] == max_drains, "each drain re-drove the SAME entry with the same key exactly once"


# ── 3. AC-3 true-positive: a fold that LANDS on an early drain never surfaces the alarm ───────────── #

def test_deferred_fold_that_lands_on_an_early_drain_never_surfaces_the_alarm(monkeypatch):
    """The dropped-fold alarm must be a TRUE positive: a fold that merely deferred and then LANDED on a
    later drain (bounded latency, no data loss) must NOT fire `sync:dropped-fold`."""
    _patch_reconcile_reads(monkeypatch, now=9)
    chat_helpers._LAST_BEAT_SEQ["owner"] = 4

    surfaced = []
    real_note = sync_ledger.note_stale_rejection

    def spy_note(user, n=1, *args, **kwargs):
        if kwargs.get("dropped_fold"):
            surfaced.append(kwargs.get("cause"))
        return real_note(user, n, *args, **kwargs)

    monkeypatch.setattr(sync_ledger, "note_stale_rejection", spy_note)

    scene_key = chat_helpers._mint_idempotency_key()
    settled = {"v": False}
    folds = {"n": 0}

    async def record(*a, expected_beat_seq=None, idempotency_key=None, **k):
        if not settled["v"]:
            raise _stale_409(9)
        folds["n"] += 1
        return {"recorded": True, "beatSeq": 12}

    chat_helpers._defer_fold("owner", record, ("a bond",),
                             {"idempotency_key": scene_key, "user": "owner"}, desc="record_interaction")

    # One contested drain (stays queued, within budget) — then the board settles and it lands.
    _run(chat_helpers._drain_deferred_folds("owner"))
    assert chat_helpers.deferred_fold_count("owner") == 1
    settled["v"] = True
    _run(chat_helpers._drain_deferred_folds("owner"))
    assert chat_helpers.deferred_fold_count("owner") == 0
    assert folds["n"] == 1, "the fold landed exactly once, just late"
    assert not surfaced, "a deferred-then-landed fold is NOT a dropped fold — the alarm stays silent"


# ── 3b. CONCURRENCY (Greptile P1): two concurrent drains for the SAME owner must not double-execute ─ #

def test_two_concurrent_drains_do_not_double_execute_or_premature_alarm(monkeypatch):
    """Under real two-window concurrency both windows can drain the same owner's queue at once (each
    `_backfill_with_cas` drains at its top). Without a per-owner single-flight guard both drains would
    execute the SAME deferred entry AND double-increment its shared `attempts` — double-firing the engine
    call and tripping the dropped-fold alarm for a fold the other drain may have committed. The guard
    makes the drain single-flight per owner: exactly one execution, no double-count, no premature alarm."""
    _patch_reconcile_reads(monkeypatch, now=9)
    chat_helpers._LAST_BEAT_SEQ["owner"] = 11

    surfaced = []
    real_note = sync_ledger.note_stale_rejection

    def spy_note(user, n=1, *args, **kwargs):
        if kwargs.get("dropped_fold"):
            surfaced.append(kwargs.get("cause"))
        return real_note(user, n, *args, **kwargs)

    monkeypatch.setattr(sync_ledger, "note_stale_rejection", spy_note)

    scene_key = chat_helpers._mint_idempotency_key()
    executed = {"n": 0}

    async def slow_record(*a, expected_beat_seq=None, idempotency_key=None, **k):
        executed["n"] += 1
        # Yield control so a concurrently-scheduled second drain runs WHILE this entry is in flight —
        # that second drain must see the in-flight guard and skip, not re-execute this same entry.
        await asyncio.sleep(0.02)
        return {"recorded": True, "beatSeq": 12}

    chat_helpers._defer_fold("owner", slow_record, ("a bond",),
                             {"idempotency_key": scene_key, "user": "owner"}, desc="record_interaction")
    assert chat_helpers.deferred_fold_count("owner") == 1

    async def _both():
        await asyncio.gather(
            chat_helpers._drain_deferred_folds("owner"),
            chat_helpers._drain_deferred_folds("owner"),
        )

    _run(_both())

    assert executed["n"] == 1, "the deferred entry executed EXACTLY once despite two concurrent drains"
    assert chat_helpers.deferred_fold_count("owner") == 0, "the fold landed and the queue drained"
    assert not surfaced, "no premature dropped-fold alarm — the fold committed, it was never a loss"
    assert chat_helpers._draining_folds == set(), "the in-flight guard released after the drain"


# ── 4. source-pins: the record path forwards + reuses idempotency_key, and the drain is bounded ──── #

def test_record_path_forwards_and_reuses_idempotency_key_source_pin():
    import os
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    with open(os.path.join(base, "src", "orwell_engine.py"), encoding="utf-8") as fh:
        oe_src = fh.read()
    # the record_interaction wrapper accepts + forwards the key into the engine payload as idempotencyKey
    assert "idempotency_key: int | None = None" not in oe_src  # sanity: it's a str param, not int
    assert "idempotency_key: str | None = None" in oe_src
    assert 'req["idempotencyKey"] = idempotency_key' in oe_src

    with open(os.path.join(base, "src", "agent_loop.py"), encoding="utf-8") as fh:
        al_src = fh.read()
    # the scene belt mints ONE stable key and threads it into the fold-bearing CAS back-fill
    assert "idempotency_key=_scene_idem_key" in al_src
    # the CAS back-fill re-attaches on the #591 retry (same **kwargs, incl. idempotency_key) and defers
    assert "defer_fold=True" in al_src


def test_drain_is_bounded_and_surfaces_the_loss_source_pin():
    import os
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(base, "routes", "chat_helpers.py"), encoding="utf-8") as fh:
        src = fh.read()
    # the bound exists and the drain declares a genuine loss + surfaces it (never re-queues forever)
    assert "_DEFERRED_FOLD_MAX_DRAINS" in src
    assert 'entry["attempts"] = entry.get("attempts", 0) + 1' in src
    assert 'if entry["attempts"] >= _DEFERRED_FOLD_MAX_DRAINS:' in src
    assert "dropped_fold=True" in src
    # the drain is single-flight PER OWNER (Greptile P1): a concurrent drain skips, and the guard is
    # released in a finally so exactly one drain owns each entry's execute/increment/drop lifecycle.
    assert "_draining_folds" in src
    assert "if key in _draining_folds:" in src
    assert "_draining_folds.discard(key)" in src
