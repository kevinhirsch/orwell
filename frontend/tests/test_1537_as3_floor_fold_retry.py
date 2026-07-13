"""#1537 / audit A-S3 / R1c — the E22 FLOOR digest is a fold that must never evaporate on a stale-409.

Background (feature 0065 closed-set sync spine): a mutating engine tool carrying a stale
`expectedBeatSeq` is refused with a typed StaleBeatError → HTTP 409 `stale-beat` BEFORE any write, and
the FE reconciles the 409 through the desync mechanism. Every FE-issued fold-bearing recordInteraction
already routes through `_backfill_with_cas` (the #591 single retry + the CON-11 deferred queue, each
attempt carrying the SAME at-most-once idempotency key). The ONE residual (this issue) was the E22
`ensure_turn_recorded` FLOOR digest — the LAST-resort record when the turn made no engine write AND the
richer `_e22_rich_extract` declined (no model / a solo beat / a hiccup). That floor digest is then the
scene's SOLE consequence fold, and on a stale-409 it used to reconcile-and-SKIP — silently evaporating
the beat's only hidden-impact fold (mandate #4 / I4: "a novel move must never evaporate").

The fix routes the floor digest through the SAME `_backfill_with_cas` machinery, so it:
  * RE-ATTEMPTS once against the reconciled beatSeq on a single stale-409 (#591), landing the sole fold;
  * DEFERS on a double-409 (CON-11) rather than dropping it — the fold lands late, never never;
  * threads ONE stable idempotency key through EVERY attempt (initial / retry / deferred-drain), so the
    engine dedups a same-key re-drive and the fold applies EXACTLY once even if a racing attempt already
    committed it (the double-commit-safe case).

Roles only; the engine client is faked so we capture the exact tokens/keys the FE passes.
"""
import asyncio
import importlib

import pytest

chat_helpers = importlib.import_module("routes.chat_helpers")
orwell_engine = importlib.import_module("src.orwell_engine")


def _run(coro):
    # NOTE (xdist hygiene): reuse the thread's existing event loop — never `asyncio.run()`, which would
    # null the thread's loop and poison sibling tests that call `get_event_loop()`.
    return asyncio.get_event_loop().run_until_complete(coro)


# Long enough to clear GAME_TURN_RECORD_MIN_CHARS (80) so the E22 guard actually fires.
NARRATION = "A charged one-on-one plays out in full, the player working a wary swing vote. " * 4


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
    chat_helpers._fallback_in_flight.clear()
    chat_helpers.reset_stale_beat_rejections()
    yield
    chat_helpers._LAST_BEAT_SEQ.clear()
    chat_helpers._LAST_BEAT_SIG.clear()
    chat_helpers._DESYNC_REGROUND.clear()
    chat_helpers._DEFERRED_FOLDS.clear()
    chat_helpers._fallback_in_flight.clear()
    chat_helpers.reset_stale_beat_rejections()


def _force_floor_digest(monkeypatch):
    """Make `_e22_rich_extract` decline so `ensure_turn_recorded` deterministically reaches the FLOOR
    digest — the sole-fold path under test — without depending on a real utility model / engine read."""
    async def decline_rich(user, player_message, narration):
        return False
    monkeypatch.setattr(chat_helpers, "_e22_rich_extract", decline_rich)


def _patch_reconcile_reads(monkeypatch, now: int):
    """`_handle_stale_beat` re-reads the board (gameStatus + getGameState) to reconcile precisely — fake
    both to the reconciled `beatSeq` so the retry attaches the fresh token."""
    async def fake_status(user=None):
        return {"week": 4, "phase": "veto", "pending": None, "veto": {}, "beatSeq": now}

    async def fake_state(user=None, **kw):
        return {"week": 4, "phase": "veto", "finished": False, "house": [], "beatSeq": now}

    monkeypatch.setattr(orwell_engine, "game_status", fake_status)
    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)


# ── 1. ACCEPTANCE: a sole recordInteraction that races a stale-409 still folds — exactly once ───────

def test_floor_digest_sole_fold_survives_stale_409_and_lands_once(monkeypatch):
    """The scene's ONLY fold hits a stale-409, reconciles, and RE-ISSUES against the fresh beatSeq —
    the fold lands (exactly once), never dropped. The retry reuses the SAME at-most-once key."""
    _force_floor_digest(monkeypatch)
    _patch_reconcile_reads(monkeypatch, now=9)
    chat_helpers._LAST_BEAT_SEQ["u"] = 4
    keys = []
    folds = {"n": 0}

    async def fake_record(content, with_ids=None, initiator="player", kind=None,
                          expected_beat_seq=None, idempotency_key=None, user=None):
        keys.append(idempotency_key)
        # The engine refuses a stale write BEFORE folding (fail-closed) — no fold, no key recorded.
        if expected_beat_seq != 9:
            raise _stale_409(9)
        folds["n"] += 1                                    # the reconciled write lands the fold
        return {"recorded": True, "beatSeq": 10}

    monkeypatch.setattr(orwell_engine, "record_interaction", fake_record)

    out = _run(chat_helpers.ensure_turn_recorded("u", "I press the swing vote.", NARRATION, []))
    assert out is True                                     # the sole fold LANDED after reconcile
    assert folds["n"] == 1                                 # exactly once — never dropped, never doubled
    assert len(keys) == 2, "stale once, then re-attempted once against the fresh beatSeq"
    assert keys[0] is not None and keys[0] == keys[1], "the retry reuses the SAME at-most-once key"
    assert chat_helpers.deferred_fold_count("u") == 0      # nothing left queued
    assert chat_helpers.stale_beat_rejections() == 1
    assert chat_helpers.fallback_in_flight("u") is False   # single-flight slot released


# ── 2. DOUBLE-COMMIT SAFE: if the first attempt actually committed, the retry is a no-op ────────────

def test_floor_digest_retry_is_idempotent_under_double_commit(monkeypatch):
    """The nastier race: the FIRST attempt's write actually COMMITTED the fold server-side (and recorded
    its idempotency key), but a concurrent advance meant the FE observed a stale-409 for it. The retry
    re-drives with the SAME key — the engine dedups it and does NOT fold a second time. Net: exactly one
    fold. Proves the retry can never double-apply even when the original DID land."""
    _force_floor_digest(monkeypatch)
    _patch_reconcile_reads(monkeypatch, now=9)
    chat_helpers._LAST_BEAT_SEQ["u"] = 4
    keys = []
    committed = {}          # idempotency_key -> prior result (the engine's at-most-once ledger)
    folds = {"n": 0}

    async def fake_record(content, with_ids=None, initiator="player", kind=None,
                          expected_beat_seq=None, idempotency_key=None, user=None):
        keys.append(idempotency_key)
        if idempotency_key in committed:
            return committed[idempotency_key]              # DEDUP — a repeat re-drive, no second fold
        committed[idempotency_key] = {"recorded": True, "beatSeq": 10}
        folds["n"] += 1                                    # the fold DID commit on the first attempt
        if expected_beat_seq != 9:
            # ...but the FE's ack raced a concurrent advance, so it observes a stale-409 anyway.
            raise _stale_409(9)
        return committed[idempotency_key]

    monkeypatch.setattr(orwell_engine, "record_interaction", fake_record)

    out = _run(chat_helpers.ensure_turn_recorded("u", "I press the swing vote.", NARRATION, []))
    assert out is True
    assert folds["n"] == 1, "the fold applied EXACTLY once despite the double commit + reconcile retry"
    assert len(keys) == 2 and keys[0] == keys[1], "both attempts carried the SAME key — the engine dedups"
    assert chat_helpers.deferred_fold_count("u") == 0


# ── 3. NEVER DROPPED: a double stale-409 DEFERS the sole fold; a later drain lands it once ──────────

def test_floor_digest_double_409_defers_then_lands_once_never_dropped(monkeypatch):
    """Under sustained concurrency the board can move AGAIN under the #591 retry (a second stale-409).
    The sole fold must still not evaporate — it DEFERS (CON-11) and lands on the next drain, once, with
    the same key. This is the exact A-S3 latent, closed for the floor digest."""
    _force_floor_digest(monkeypatch)
    _patch_reconcile_reads(monkeypatch, now=9)
    chat_helpers._LAST_BEAT_SEQ["u"] = 4
    keys = []
    state = {"settled": False, "folds": 0}

    async def fake_record(content, with_ids=None, initiator="player", kind=None,
                          expected_beat_seq=None, idempotency_key=None, user=None):
        keys.append(idempotency_key)
        if state["settled"]:
            state["folds"] += 1
            return {"recorded": True, "beatSeq": 12}
        raise _stale_409(9)                                # keeps moving — both in-turn attempts stay stale

    monkeypatch.setattr(orwell_engine, "record_interaction", fake_record)

    out = _run(chat_helpers.ensure_turn_recorded("u", "I press the swing vote.", NARRATION, []))
    assert out is False                                    # nothing landed THIS call...
    assert state["folds"] == 0
    assert chat_helpers.deferred_fold_count("u") == 1      # ...but the sole fold is QUEUED, never dropped
    assert len(keys) == 2 and keys[0] is not None and keys[0] == keys[1], "the #591 retry reused the key"
    scene_key = keys[0]
    # the queued entry carries the SAME key so any later drain re-drives it idempotently
    queued = chat_helpers._DEFERRED_FOLDS[chat_helpers._beat_seq_key("u")]
    assert queued[0]["kwargs"].get("idempotency_key") == scene_key
    assert chat_helpers.fallback_in_flight("u") is False   # single-flight slot released even when deferred

    # The board settles; the opportunistic drain re-drives the deferred fold — it lands EXACTLY once,
    # with the SAME key (so a concurrent drain of the same fold could never double-apply at the engine).
    state["settled"] = True
    _run(chat_helpers._drain_deferred_folds("u"))
    assert chat_helpers.deferred_fold_count("u") == 0, "the deferred fold drained and landed"
    assert state["folds"] == 1, "the fold applied exactly once, just late"
    assert len(keys) == 3 and keys[2] == scene_key, "the drain re-drove with the SAME key"


# ── 4. source-pin: the floor digest is wired through the CAS back-fill with defer_fold + a stable key ─

def test_floor_digest_wiring_source_pin():
    import os
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(base, "routes", "chat_helpers.py"), encoding="utf-8") as fh:
        src = fh.read()
    # the E22 floor digest routes through the shared CAS back-fill (retry + CON-11 deferral)
    assert "_backfill_with_cas(\n            user, orwell_engine.record_interaction, digest," in src
    # ...as a fold-bearing call (deferred, never dropped) carrying a stable at-most-once key
    assert "defer_fold=True, idempotency_key=_mint_idempotency_key()" in src
