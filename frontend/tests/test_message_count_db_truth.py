"""F1 (issue #936 — casting transcript truncation): `Session.message_count` must be written from
DB TRUTH, never from `len(in_memory_history)`.

The bug: a session loaded metadata-only (`load_sessions` seeds `history=[]` + a `message_count`),
or one whose cache lost an append to a concurrent `get_session` replace, has an in-memory length that
DISAGREES with the persisted `chat_messages` rows. `_persist_message` wrote `message_count` from that
in-memory length, so a write landing BEFORE re-hydration stamped a count TOO LOW. The `load_sessions`
`message_count > 0` filter and the hydrate gate then trusted a count that disagreed with the real
rows → a truncated transcript on reload.

These gates fail before the fix (the count tracks `len(history)`) and pass after (it tracks the DB
row count). Name-agnostic; uses the real SessionManager persistence path against the test DB.
"""
import pytest

from core.session_manager import SessionManager
from core.models import ChatMessage
from core import database as db


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


def _db_message_count(session_id):
    s = db.SessionLocal()
    try:
        row = s.query(db.Session).filter(db.Session.id == session_id).first()
        return row.message_count if row else None
    finally:
        s.close()


def test_persist_into_metadata_only_session_writes_db_truth_count(sm):
    """The core F1 case: a session that exists with rows but is cached metadata-only (history=[]).
    A persist before re-hydration must stamp `message_count` = real DB row count, not 0/1."""
    sid = "f1-metadata-only"
    sm.create_session(sid, "n", "http://x", "m", owner="u")
    sess = sm.get_session(sid)
    # Seed three real messages — three persisted rows.
    for i in range(3):
        sm.add_message(sid, ChatMessage("user" if i % 2 == 0 else "assistant", f"m{i}", metadata={}))
    assert _db_row_count(sid) == 3
    assert _db_message_count(sid) == 3

    # Simulate the metadata-only cache state: history dropped, but the rows are still in the DB.
    # (This is exactly what `load_sessions` produces, and what a concurrent get_session replace can
    # leave mid-request — an empty in-memory history over a populated chat_messages table.)
    sess.history = []
    sess.message_count = 0

    # A write lands BEFORE re-hydration (the streaming save path → _persist_message directly).
    sm._persist_message(sid, ChatMessage("user", "late-arriving", metadata={}))

    # DB truth: 4 rows now exist. message_count MUST equal the row count — not len(history)+1 == 1.
    assert _db_row_count(sid) == 4
    assert _db_message_count(sid) == 4, (
        "message_count must be derived from the persisted rows, not the (empty) in-memory history"
    )


def test_message_count_equals_db_rows_across_a_normal_conversation(sm):
    """Invariant: after every persist, the stamped `message_count` equals the real row count."""
    sid = "f1-running"
    sm.create_session(sid, "n", "http://x", "m", owner="u")
    sess = sm.get_session(sid)
    for i in range(7):
        sm.add_message(sid, ChatMessage("user" if i % 2 == 0 else "assistant", f"m{i}", metadata={}))
        assert _db_message_count(sid) == _db_row_count(sid) == (i + 1)


def test_count_recovers_even_when_history_lost_an_append(sm):
    """The concurrent-replace flavor: the cached history is SHORTER than the DB (an append was
    orphaned). The next persist must still write the true total, not history_len+1."""
    sid = "f1-lost-append"
    sm.create_session(sid, "n", "http://x", "m", owner="u")
    sess = sm.get_session(sid)
    for i in range(5):
        sm.add_message(sid, ChatMessage("user", f"m{i}", metadata={}))
    assert _db_row_count(sid) == 5

    # Pretend a concurrent get_session replace left a stale, short in-memory history (2 of 5).
    sess.history = sess.history[:2]
    sess.message_count = 2

    sm._persist_message(sid, ChatMessage("assistant", "recover", metadata={}))
    assert _db_row_count(sid) == 6
    assert _db_message_count(sid) == 6, "count tracks DB rows, never the truncated in-memory history"
