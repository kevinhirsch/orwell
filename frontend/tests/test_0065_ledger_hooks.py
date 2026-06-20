"""Feature 0065 Part D — the per-turn sync-ledger HOOKS wired into the hot FE files.

The standalone ledger module + its store are proven in `test_0065_sync_ledger.py`. This lane proves
the INTEGRATION: the agent loop emits exactly ONE Vault-free ledger entry per finished live-game turn,
with the right closed-set fields read from the per-turn signals the loop already tracks, and never on
a non-game turn — and the hook is fail-open (a recorder that raises never breaks the turn).

The emit logic lives in `agent_loop._record_sync_ledger_turn` (called from the turn's tail, right
after `record_post_turn_desync_check`). We drive that helper directly — the convention the spine
tests use — and source-pin that the loop calls it once at the right place.

Roles only — tool NAMES are app capabilities; the session id keys the entry (never a body).
"""
import asyncio
import importlib
import os

import pytest

agent_loop = importlib.import_module("src.agent_loop")
chat_helpers = importlib.import_module("routes.chat_helpers")
ledger = importlib.import_module("src.orwell_sync_ledger")


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


_USER = "p-ledger"


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    chat_helpers._LAST_BEAT_SEQ.clear()
    chat_helpers._DESYNC_REGROUND.clear()
    chat_helpers.reset_stale_beat_rejections()
    yield
    chat_helpers._LAST_BEAT_SEQ.clear()
    chat_helpers._DESYNC_REGROUND.clear()
    chat_helpers.reset_stale_beat_rejections()


def _capture_record_turn(monkeypatch):
    """Monkeypatch the ledger's record_turn and return the list of (args, kwargs) it received."""
    calls = []

    def fake_record(user, **kwargs):
        calls.append((user, kwargs))

    monkeypatch.setattr(ledger, "record_turn", fake_record)
    return calls


# ── a finished live turn records ONE entry with the expected fields ────────────────────────────


def test_finished_live_turn_records_once_with_expected_fields(monkeypatch):
    calls = _capture_record_turn(monkeypatch)
    chat_helpers._LAST_BEAT_SEQ[_USER] = 7  # the engine moved 3 → 7 this turn
    agent_loop._record_sync_ledger_turn(
        _USER,
        session_id="sess-7",
        tool_events=[{"tool": "advanceGame"}, {"tool": "recordInteraction"}, {"noise": 1}],
        beat_seq_before=3,
        stale_before=0,
        nudges_fired=2,
        auto_backfills=1,
    )
    assert len(calls) == 1
    user, kw = calls[0]
    assert user == _USER
    assert kw["session"] == "sess-7" and kw["turn_id"] == "sess-7"
    assert kw["beat_seq_before"] == 3 and kw["beat_seq_after"] == 7
    assert kw["tools_called"] == ["advanceGame", "recordInteraction"]  # NAMES only, noise dropped
    assert kw["nudges_fired"] == 2 and kw["auto_backfills"] == 1
    assert kw["stale_rejections"] == 0
    assert kw["idempotency_hits"] == 0
    assert kw["desync_detected"] is False


def test_stale_rejections_is_the_turn_delta_and_resets(monkeypatch):
    calls = _capture_record_turn(monkeypatch)
    chat_helpers._LAST_BEAT_SEQ[_USER] = 9
    # Two stale-beat 409s were reconciled this turn (the process-global counter advanced 1 → 3).
    chat_helpers._STALE_BEAT_REJECTIONS = 3
    agent_loop._record_sync_ledger_turn(
        _USER, session_id="s", tool_events=[], beat_seq_before=9, stale_before=1,
        nudges_fired=0, auto_backfills=0)
    assert calls[0][1]["stale_rejections"] == 2          # 3 - 1 (this turn's share)
    # …and the global counter is RESET so the next turn measures only its own.
    assert chat_helpers.stale_beat_rejections() == 0


def test_desync_detected_when_a_reground_is_stashed(monkeypatch):
    calls = _capture_record_turn(monkeypatch)
    chat_helpers._LAST_BEAT_SEQ[_USER] = 5
    chat_helpers._DESYNC_REGROUND[_USER] = "RE-GROUND ON THE BOARD — …"
    agent_loop._record_sync_ledger_turn(
        _USER, session_id="s", tool_events=[], beat_seq_before=5, stale_before=0,
        nudges_fired=0, auto_backfills=0)
    assert calls[0][1]["desync_detected"] is True


def test_beat_after_falls_back_to_before_when_no_last_seen(monkeypatch):
    calls = _capture_record_turn(monkeypatch)
    # No last-seen token recorded for the user → beat_after degrades to beat_before (no spurious move).
    agent_loop._record_sync_ledger_turn(
        _USER, session_id="s", tool_events=[], beat_seq_before=4, stale_before=0,
        nudges_fired=0, auto_backfills=0)
    kw = calls[0][1]
    assert kw["beat_seq_before"] == 4 and kw["beat_seq_after"] == 4


# ── a non-game turn (no owner) records nothing ─────────────────────────────────────────────────


def test_no_owner_records_nothing(monkeypatch):
    calls = _capture_record_turn(monkeypatch)
    agent_loop._record_sync_ledger_turn(
        None, session_id="s", tool_events=[{"tool": "advanceGame"}], beat_seq_before=1,
        stale_before=0, nudges_fired=0, auto_backfills=0)
    assert calls == []


# ── fail-open: a recorder that raises never breaks the turn ────────────────────────────────────


def test_fail_open_when_record_turn_raises(monkeypatch):
    def boom(*_a, **_k):
        raise RuntimeError("ledger store on fire")
    monkeypatch.setattr(ledger, "record_turn", boom)
    chat_helpers._LAST_BEAT_SEQ[_USER] = 2
    # No exception escapes.
    agent_loop._record_sync_ledger_turn(
        _USER, session_id="s", tool_events=[], beat_seq_before=1, stale_before=0,
        nudges_fired=0, auto_backfills=0)


# ── source-pin: the loop calls the hook ONCE at the turn tail, after the desync check ──────────


def test_loop_calls_the_ledger_hook_once_after_the_desync_check():
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(base, "src", "agent_loop.py"), encoding="utf-8") as fh:
        src = fh.read()
    # Exactly one call site in the loop tail.
    assert src.count("_record_sync_ledger_turn(") == 2  # the def + the single call
    # The call sits AFTER the post-turn desync check (so _DESYNC_REGROUND reflects this turn).
    i_desync = src.index("record_post_turn_desync_check(owner")
    i_ledger = src.index("_record_sync_ledger_turn(\n")
    assert i_desync < i_ledger
    # The turn-start baselines are captured (before→after + the stale-rejection delta).
    assert "_ledger_beat_seq_before" in src and "_ledger_stale_before" in src
