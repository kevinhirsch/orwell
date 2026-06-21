"""ADR 0012 — the two-window lockstep "Messenger mirror" behavioral gates.

§3.2 (this file, for now): the `message-added` completion broadcast must fire on the STREAMING
save path (`ChatSession.add_message` → `_persist_message`) — the **dead leg** that previously
bypassed the broadcast living only in `SessionManager.add_message`. With the broadcast moved into
the shared `_persist_message` primitive, EVERY persist path publishes the authoritative `{id, seq}`
exactly once, so two windows reconcile by id instead of drifting until a late poll/reconcile.

Name-agnostic; exercises the real `SessionManager` persist path against the test DB. Roles only.
"""
import pytest

from core.session_manager import SessionManager
from core.models import ChatMessage, set_session_manager
import core.models as core_models


@pytest.fixture
def sm():
    manager = SessionManager()
    prior = getattr(core_models, "_session_manager", None)
    set_session_manager(manager)          # so ChatSession.add_message persists through the manager
    yield manager
    set_session_manager(prior)


def _capture_publish(monkeypatch):
    from src import session_events as se
    events = []
    monkeypatch.setattr(se, "publish", lambda *a, **k: events.append(a))
    return events


def test_streaming_save_path_broadcasts_message_added(sm, monkeypatch):
    # The dead leg: ChatSession.add_message → _persist_message. Before ADR 0012 it persisted but
    # never published message-added (the broadcast lived only in SessionManager.add_message). Now the
    # shared primitive broadcasts, so the streaming save path fires exactly one completion event.
    events = _capture_publish(monkeypatch)
    sid = "adr0012-deadleg"
    sm.create_session(sid, "n", "http://x", "m", owner="u")
    sess = sm.get_session(sid)
    sess.add_message(ChatMessage("assistant", "a streamed reply", metadata={"client_msg_id": "tmp-1"}))

    added = [e for e in events if len(e) >= 2 and e[1] == "message-added"]
    assert len(added) == 1, "the streaming save path must publish exactly one message-added"
    _sid, _etype, payload = added[0]
    assert _sid == sid
    assert payload["role"] == "assistant"
    assert payload["seq"] == 0 and payload["id"], "the broadcast carries the authoritative {id, seq}"
    assert payload["client_msg_id"] == "tmp-1", "the optimistic client id rides along for adoption"
    assert "content" not in payload, "Vault-free / cross-user-safe: never the message body"


def test_manager_add_message_broadcasts_exactly_once(sm, monkeypatch):
    # SessionManager.add_message also persists via _persist_message; it must still broadcast, and
    # exactly once (no double-publish now that the broadcast moved into the shared primitive).
    events = _capture_publish(monkeypatch)
    sid = "adr0012-once"
    sm.create_session(sid, "n", "http://x", "m", owner="u")
    sm.add_message(sid, ChatMessage("user", "hi", metadata={}))
    added = [e for e in events if len(e) >= 2 and e[1] == "message-added"]
    assert len(added) == 1, "exactly one broadcast per persisted message (no double-publish)"


def test_each_message_gets_its_own_broadcast_in_seq_order(sm, monkeypatch):
    # A multi-message turn (user + assistant) yields one broadcast per persist, in seq order.
    events = _capture_publish(monkeypatch)
    sid = "adr0012-multi"
    sm.create_session(sid, "n", "http://x", "m", owner="u")
    sess = sm.get_session(sid)
    sess.add_message(ChatMessage("user", "u", metadata={}))
    sess.add_message(ChatMessage("assistant", "a", metadata={}))
    seqs = [e[2]["seq"] for e in events if len(e) >= 2 and e[1] == "message-added"]
    assert seqs == [0, 1], "one in-order broadcast per persisted message"
