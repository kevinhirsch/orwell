"""#995 — residual DEFENSIVE closures so a player message is never lost.

Message loss is the highest-severity class in this project. The just-merged #987/#990/#936
reduce orphan CREATION; these gates cover the residual DEFENSIVE behaviour so a real player
message is never silently dropped:

  #1  `_persist_message` must NEVER silently drop a real player message. If the parent
      DbSession row is gone but the in-memory `Session` still has cached state (i.e. NOT a
      confirmed delete), LAZY-RECREATE the row and persist onto it. Only a genuine tombstone
      (no cached session) drops — and that drop is LOUD (logger.error), never silent.

  #3  the empty-session reaper (`cleanup_empty_sessions`) must EXEMPT game sessions
      (name "Casting interview" / agent game mode) and freshly-created rows, so it can't
      race a casting/canonical session that legitimately holds 0 messages for a window.

Fail-before / pass-after; name-agnostic (roles only — no houseguest/player names); uses the
real SessionManager persistence path against the test DB. Mirrors test_message_count_db_truth.py
and test_lost_model_persistence.py.
"""
from datetime import timedelta

import pytest

from core.session_manager import SessionManager
from core.models import ChatMessage
from core import database as db
from core.database import utcnow_naive


@pytest.fixture
def sm():
    return SessionManager()


def _db_row_count(session_id):
    s = db.SessionLocal()
    try:
        return (
            s.query(db.ChatMessage)
            .filter(db.ChatMessage.session_id == session_id)
            .count()
        )
    finally:
        s.close()


def _db_session_exists(session_id):
    s = db.SessionLocal()
    try:
        return s.query(db.Session).filter(db.Session.id == session_id).first() is not None
    finally:
        s.close()


def _delete_db_session_row_out_of_band(session_id):
    """Remove ONLY the parent `sessions` row (simulating the empty reaper / a partial
    delete racing a live persist) — WITHOUT going through `delete_session`, so the cached
    in-memory Session survives (this is the RACE case, not a confirmed tombstone)."""
    s = db.SessionLocal()
    try:
        row = s.query(db.Session).filter(db.Session.id == session_id).first()
        if row is not None:
            s.delete(row)
            s.commit()
    finally:
        s.close()


# ── #1: a persist whose parent row was deleted out-of-band must SELF-HEAL ──────── #

def test_persist_recreates_row_when_deleted_out_of_band(sm):
    """The dominant loss path: the `sessions` row is gone but the cached Session still exists.
    The message MUST be recreated+persisted (self-heal), NOT dropped."""
    sid = "i995-self-heal"
    sm.create_session(sid, "Casting interview", "http://x", "m", owner="player")
    sess = sm.get_session(sid)
    # one real turn already on file
    sm.add_message(sid, ChatMessage("user", "first turn", metadata={}))
    assert _db_row_count(sid) == 1

    # The parent row vanishes out-of-band (reaper race / partial delete), but the cached
    # in-memory Session is untouched — this is a RACE, not a confirmed delete.
    _delete_db_session_row_out_of_band(sid)
    assert not _db_session_exists(sid)
    assert sid in sm.sessions  # cache survived → NOT a tombstone

    # A real player message lands AFTER the row vanished. It must NOT be dropped.
    sm._persist_message(sid, ChatMessage("user", "this must not be lost", metadata={"phase": "casting"}))

    # Self-healed: the parent row is back AND the message is persisted onto it.
    assert _db_session_exists(sid), "the missing DbSession row must be recreated, not dropped"
    # The previously-orphaned row's messages survive too (the recreate re-parents them),
    # so the new message is persisted — at minimum the new row exists with the new message.
    rows = _db_row_count(sid)
    assert rows >= 1, "the player message must be persisted onto the recreated row, not lost"
    # And the new message is actually present.
    s = db.SessionLocal()
    try:
        contents = [
            m.content for m in s.query(db.ChatMessage).filter(db.ChatMessage.session_id == sid).all()
        ]
    finally:
        s.close()
    assert "this must not be lost" in contents


def test_self_heal_restores_cascade_deleted_transcript(sm):
    """Deleting the parent `sessions` row cascade-deletes its chat_messages, so a prior turn
    survives ONLY in the in-memory cache. The self-heal must BACKFILL that cached transcript
    (non-degradation), not just persist the latest turn — a reload must show the full history."""
    sid = "i995-restore-transcript"
    sm.create_session(sid, "Casting interview", "http://x", "m", owner="player")
    sm.add_message(sid, ChatMessage("user", "first turn (already persisted)", metadata={"phase": "casting"}))
    assert _db_row_count(sid) == 1

    # The row vanishes out-of-band — cascade wipes the persisted message from the DB.
    _delete_db_session_row_out_of_band(sid)
    assert _db_row_count(sid) == 0  # cascade took the chat_messages too
    assert sid in sm.sessions       # but the cache (and its history) survives

    # The next turn lands. Self-heal must restore the row AND the cascade-deleted prior turn.
    sm._persist_message(sid, ChatMessage("assistant", "second turn (new)", metadata={"phase": "casting"}))

    # Reload from DB truth (fresh manager) — both turns must be present, in order.
    reloaded = SessionManager().get_session(sid)
    contents = [m.content for m in reloaded.history]
    assert contents == ["first turn (already persisted)", "second turn (new)"], (
        f"the cascade-deleted prior turn must be restored before the new one; got {contents}"
    )


def test_persist_drops_only_a_confirmed_tombstone_loudly(sm, caplog):
    """A genuinely deleted session (no cached Session — a confirmed tombstone) is the one
    legitimate drop. It must still be LOUD (logger.error), never a silent warning."""
    import logging

    sid = "i995-tombstone"
    sm.create_session(sid, "n", "http://x", "m", owner="player")
    sm.add_message(sid, ChatMessage("user", "turn", metadata={}))

    # Confirmed delete: this pops the cached Session AND removes the row.
    sm.delete_session(sid)
    assert sid not in sm.sessions
    assert not _db_session_exists(sid)

    with caplog.at_level(logging.ERROR, logger="core.session_manager"):
        sm._persist_message(sid, ChatMessage("assistant", "late callback", metadata={}))

    # No row resurrected for a confirmed tombstone.
    assert not _db_session_exists(sid)
    # The drop is LOUD (error-level), not silent.
    assert any(
        rec.levelno >= logging.ERROR and sid in rec.getMessage()
        for rec in caplog.records
    ), "a real drop must be logged at ERROR level (loud), not silently"


# ── #3: the empty reaper must EXEMPT fresh / game sessions ─────────────────────── #

def test_reaper_spares_fresh_zero_message_game_session(sm):
    """A fresh 0-message 'Casting interview' session must SURVIVE cleanup_empty_sessions —
    deleting it would race the first casting persist (a message-loss path)."""
    sid = "i995-fresh-game"
    sm.create_session(sid, "Casting interview", "http://x", "m", owner="player")
    assert _db_session_exists(sid)
    assert _db_row_count(sid) == 0  # legitimately empty for now

    stats = sm.cleanup_empty_sessions()

    assert _db_session_exists(sid), (
        "a fresh 0-message game/casting session must NOT be reaped (it races the first persist)"
    )
    assert stats.get("exempt_empty", 0) >= 1


def test_reaper_still_deletes_a_stale_empty_non_game_session(sm):
    """The reaper must STILL clean a genuinely-empty, old, non-game session (no regression)."""
    sid = "i995-stale-empty"
    sm.create_session(sid, "Untitled chat", "http://x", "m", owner="player")
    # Age it past the fresh-grace window and clear its mode so neither exemption applies.
    s = db.SessionLocal()
    try:
        row = s.query(db.Session).filter(db.Session.id == sid).first()
        row.created_at = utcnow_naive() - timedelta(hours=2)
        row.mode = None
        row.message_count = 0
        s.commit()
    finally:
        s.close()

    sm.cleanup_empty_sessions(fresh_grace_minutes=15)

    assert not _db_session_exists(sid), (
        "a stale, empty, non-game session must still be reaped (no regression)"
    )


def test_reaper_spares_agent_mode_session(sm):
    """An agent-mode game row that is empty + past the fresh window is still spared by mode."""
    sid = "i995-agent-mode"
    sm.create_session(sid, "A game", "http://x", "m", owner="player")
    s = db.SessionLocal()
    try:
        row = s.query(db.Session).filter(db.Session.id == sid).first()
        row.created_at = utcnow_naive() - timedelta(hours=2)  # not fresh
        row.mode = "agent"
        row.message_count = 0
        s.commit()
    finally:
        s.close()

    sm.cleanup_empty_sessions(fresh_grace_minutes=15)

    assert _db_session_exists(sid), "an agent-mode game session must be exempt from the empty reaper"
