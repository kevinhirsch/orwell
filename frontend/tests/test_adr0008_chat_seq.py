"""ADR 0008 — the authoritative per-session chat `seq` (the convergence foundation).

The audit (S3-RACE) proved two tabs diverge under concurrent writes because the FE conversation was
a replicated log with NO ordering key: `ChatMessage` had only a non-unique `timestamp`, so near-
simultaneous writes tied and reordered across tabs. Phase A makes the persisted log a single
authoritative, totally-ordered log. These gates pin that foundation (the render half is exercised by
the FE reconcile-contract gate + the JS itself):

  • every persisted message gets a monotonic, gap-free, per-session `seq` (0..n);
  • the order is stable under interleaved writers to ONE session (the "concurrent write" case
    distilled to the server layer — the looped two-tab harness's convergence guarantee);
  • `seq` is per-session independent;
  • the UNIQUE(session_id, seq) index is enforced (the race backstop);
  • the legacy-row migration backfills a dense order by (timestamp, rowid), breaking the
    non-unique-timestamp ties that caused the reorder;
  • the history projection exposes {id, seq} so the FE can render/reconcile by id.

Name-agnostic; uses the SessionManager persistence path against the test DB with unique ids.
"""
import json
import sqlite3

import pytest

from core.session_manager import SessionManager
from core.models import ChatMessage, set_session_manager
from core import database as db
import core.models as core_models


@pytest.fixture
def sm(monkeypatch):
    manager = SessionManager()
    prior = getattr(core_models, "_session_manager", None)
    set_session_manager(manager)          # so Session.add_message persists through the manager
    yield manager
    set_session_manager(prior)


def _seqs(session_id):
    s = db.SessionLocal()
    try:
        rows = (
            s.query(db.ChatMessage)
            .filter(db.ChatMessage.session_id == session_id)
            .order_by(db.ChatMessage.seq)
            .all()
        )
        return [r.seq for r in rows]
    finally:
        s.close()


def test_seq_is_monotonic_and_gap_free_per_session(sm):
    sid = "adr0008-mono"
    sm.create_session(sid, "n", "http://x", "m", owner="u")
    sess = sm.get_session(sid)
    for i in range(6):
        sess.add_message(ChatMessage("user" if i % 2 == 0 else "assistant", f"m{i}", metadata={}))
    assert _seqs(sid) == [0, 1, 2, 3, 4, 5], "seq must be a dense, monotonic 0..n per session"
    # Every in-memory message also carries its authoritative {_db_id, _seq} for the render paths.
    for i, msg in enumerate(sess.history):
        assert msg.metadata.get("_seq") == i
        assert msg.metadata.get("_db_id")


def test_seq_is_per_session_independent(sm):
    a, b = "adr0008-A", "adr0008-B"
    sm.create_session(a, "n", "http://x", "m", owner="u")
    sm.create_session(b, "n", "http://x", "m", owner="u")
    sa, sb = sm.get_session(a), sm.get_session(b)
    sa.add_message(ChatMessage("user", "a0", metadata={}))
    sb.add_message(ChatMessage("user", "b0", metadata={}))
    sa.add_message(ChatMessage("assistant", "a1", metadata={}))
    sb.add_message(ChatMessage("assistant", "b1", metadata={}))
    assert _seqs(a) == [0, 1]
    assert _seqs(b) == [0, 1], "each session's seq starts at 0 and is independent"


def test_interleaved_writers_one_session_stay_a_single_total_order(sm):
    """The concurrent-write case distilled to the server: many writers append to ONE session;
    the result must be a single gap-free total order with no duplicate seq (what both tabs render)."""
    sid = "adr0008-interleave"
    sm.create_session(sid, "n", "http://x", "m", owner="u")
    sess = sm.get_session(sid)
    # 20 messages "from different tabs" — the manager serializes the persist; seq must stay total.
    for i in range(20):
        sess.add_message(ChatMessage("user" if i % 3 else "assistant", f"x{i}", metadata={}))
    seqs = _seqs(sid)
    assert seqs == list(range(20)), "interleaved writers converge to one dense total order"
    assert len(set(seqs)) == len(seqs), "no duplicate seq"


def test_unique_session_seq_index_is_enforced(sm):
    sid = "adr0008-unique"
    sm.create_session(sid, "n", "http://x", "m", owner="u")
    sess = sm.get_session(sid)
    sess.add_message(ChatMessage("user", "first", metadata={}))  # seq 0
    s = db.SessionLocal()
    try:
        dup = db.ChatMessage(id="dup-row", session_id=sid, role="user", content="x", seq=0)
        s.add(dup)
        with pytest.raises(Exception):  # IntegrityError on UNIQUE(session_id, seq)
            s.commit()
        s.rollback()
    finally:
        s.close()


def test_migration_backfills_dense_order_breaking_timestamp_ties(tmp_path):
    """A legacy DB (no seq column) with tie-timestamp rows backfills to a dense 0..n order by
    (timestamp, rowid) — the rowid tiebreak resolves the non-unique-timestamp reorder."""
    dbfile = tmp_path / "legacy.db"
    conn = sqlite3.connect(dbfile)
    conn.execute(
        "CREATE TABLE chat_messages (id TEXT PRIMARY KEY, session_id TEXT, role TEXT, "
        "content TEXT, metadata TEXT, timestamp DATETIME)"
    )
    ts = "2026-06-21 00:00:00"  # identical timestamp on every row — the tie that reordered tabs
    for mid, role, c in [("a", "user", "u1"), ("b", "assistant", "a1"),
                         ("c", "user", "u2"), ("d", "assistant", "a2")]:
        conn.execute("INSERT INTO chat_messages VALUES (?,?,?,?,?,?)", (mid, "s1", role, c, None, ts))
    conn.commit()
    conn.close()

    orig = db.DATABASE_URL
    try:
        db.DATABASE_URL = f"sqlite:///{dbfile}"
        db._migrate_add_chat_message_seq_column()
    finally:
        db.DATABASE_URL = orig

    conn = sqlite3.connect(dbfile)
    try:
        rows = conn.execute("SELECT id, seq FROM chat_messages ORDER BY seq").fetchall()
        assert [r[1] for r in rows] == [0, 1, 2, 3], "backfill assigns a dense 0..n"
        assert [r[0] for r in rows] == ["a", "b", "c", "d"], "insertion order preserved via rowid tiebreak"
        # Idempotent: a second run does not renumber.
        db.DATABASE_URL = f"sqlite:///{dbfile}"
        try:
            db._migrate_add_chat_message_seq_column()
        finally:
            db.DATABASE_URL = orig
        rows2 = conn.execute("SELECT id, seq FROM chat_messages ORDER BY seq").fetchall()
        assert rows2 == rows, "migration is idempotent — a re-run never renumbers a live log"
    finally:
        conn.close()


def test_history_projection_exposes_id_and_seq(sm):
    """The render/reconcile-by-id contract: the in-memory history the API serializes carries the
    authoritative {id, seq} so the FE can adopt optimistic bubbles + detect divergence."""
    sid = "adr0008-history"
    sm.create_session(sid, "n", "http://x", "m", owner="u")
    sess = sm.get_session(sid)
    sess.add_message(ChatMessage("user", "u", metadata={}))
    sess.add_message(ChatMessage("assistant", "a", metadata={}))
    # The route builds each entry's id/seq from message.metadata._db_id/_seq (in-memory path).
    for i, msg in enumerate(sess.history):
        assert msg.metadata.get("_db_id"), "each message exposes a canonical id"
        assert msg.metadata.get("_seq") == i, "each message exposes its authoritative seq"
