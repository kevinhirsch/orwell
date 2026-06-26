"""F2 (issue #936 — "Recovered empty session model" fires every turn / model written to one session
identity, read from another).

Two deterministic halves:

  1. `sync_session_metadata` must NOT stomp a just-repaired in-memory model with a DB "". Recovery
     binds a model onto the cached session this request; `get_session` calls sync on the NEXT read
     BEFORE recovery re-runs — an unconditional `model = db_session.model or ""` blanked the live
     binding, re-firing recovery forever (and refusing the send). The DB only ever ADDS a model here.

  2. A FRAMED game/casting turn resolves a CANONICAL session that can DIFFER from the per-tab
     session the window POSTed under. The recovered model lived on the per-tab row but the run
     executes/persists against the canonical row → the canonical row stayed empty, so recovery
     re-fired every turn. `_mirror_model_to_canonical_session` copies the binding onto the canonical
     identity (cache + DB) so the model is bound where the turn actually runs.

Both fail before the fix, pass after. Name-agnostic; real SessionManager + real test DB.
"""
import pytest

import routes.chat_routes as chat_routes
from core.session_manager import SessionManager
from core import database as db


@pytest.fixture
def sm():
    return SessionManager()


def _db_model(session_id):
    s = db.SessionLocal()
    try:
        row = s.query(db.Session).filter(db.Session.id == session_id).first()
        return (row.model if row else None)
    finally:
        s.close()


# ── Half 1: sync must not blank a repaired model ──────────────────────────── #

def test_sync_does_not_stomp_repaired_model_with_db_blank(sm):
    """The session row has model="" in the DB; the cached object was just repaired in memory.
    sync_session_metadata must KEEP the in-memory model (DB only adds a model, never clears one)."""
    sid = "f2-sync-keep"
    sm.create_session(sid, "n", "http://x", "", owner="u")  # DB row model is blank
    sess = sm.get_session(sid)
    # Simulate _recover_empty_session_model having just bound a model in memory this request.
    sess.model = "deepseek/deepseek-v4-pro"

    # The next read's sync (DB still blank) MUST NOT blank the live binding.
    sm.sync_session_metadata(sid)
    assert sess.model == "deepseek/deepseek-v4-pro", (
        "a blank DB model must not stomp a just-repaired in-memory model (the recovery loop)"
    )


def test_sync_adopts_a_real_db_model(sm):
    """The normal direction still works: a NON-empty DB model is adopted into the cache."""
    sid = "f2-sync-adopt"
    sm.create_session(sid, "n", "http://x", "real/model-a", owner="u")
    sess = sm.get_session(sid)
    sess.model = "stale/old"
    # Write a new model straight to the DB row, then sync.
    s = db.SessionLocal()
    try:
        row = s.query(db.Session).filter(db.Session.id == sid).first()
        row.model = "real/model-b"
        s.commit()
    finally:
        s.close()
    sm.sync_session_metadata(sid)
    assert sess.model == "real/model-b", "a real DB model is still adopted on sync"


# ── Half 2: the canonical-session model mirror ────────────────────────────── #

def test_model_mirrors_onto_canonical_session(sm):
    """The per-tab session carries a recovered model; the canonical (game) session is empty.
    The mirror must bind the model onto the canonical row (cache + DB) so the turn — which runs
    on the canonical id — sees it, instead of re-recovering every turn."""
    per_tab, canonical = "f2-per-tab", "f2-canonical"
    sm.create_session(per_tab, "n", "http://x", "bound/model", owner="u")
    sm.create_session(canonical, "n", "http://x", "", owner="u")  # canonical row is blank
    per_tab_sess = sm.get_session(per_tab)
    canon_sess = sm.get_session(canonical)
    assert (canon_sess.model or "") == ""

    chat_routes._mirror_model_to_canonical_session(sm, per_tab_sess, per_tab, canonical)

    assert canon_sess.model == "bound/model", "mirror binds the cached canonical session's model"
    assert _db_model(canonical) == "bound/model", "mirror persists the model onto the canonical DB row"


def test_mirror_never_overwrites_a_real_canonical_model(sm):
    """If the canonical session already has a real model, the mirror must NOT change it (only ever
    fills an EMPTY canonical model — same 'DB only adds a model' invariant the sync guard relies on)."""
    per_tab, canonical = "f2-pt2", "f2-canon2"
    sm.create_session(per_tab, "n", "http://x", "tab/model", owner="u")
    sm.create_session(canonical, "n", "http://x", "canonical/already-set", owner="u")
    per_tab_sess = sm.get_session(per_tab)
    canon_sess = sm.get_session(canonical)

    chat_routes._mirror_model_to_canonical_session(sm, per_tab_sess, per_tab, canonical)

    assert canon_sess.model == "canonical/already-set"
    assert _db_model(canonical) == "canonical/already-set"


def test_mirror_is_a_noop_when_ids_match_or_no_model(sm):
    """Defensive: same per-tab/canonical id, or no model to mirror, must do nothing and not raise."""
    sid = "f2-same"
    sm.create_session(sid, "n", "http://x", "m", owner="u")
    sess = sm.get_session(sid)
    chat_routes._mirror_model_to_canonical_session(sm, sess, sid, sid)            # same id
    chat_routes._mirror_model_to_canonical_session(sm, sess, sid, None)           # no canonical
    empty = type(sess)(id="x", name="n", endpoint_url="", model="", history=[])
    chat_routes._mirror_model_to_canonical_session(sm, empty, "x", "y")           # no model on source
    assert _db_model(sid) == "m"
