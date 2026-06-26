"""FE setup/ops fixes (audit 2026-06-26 — F7/DB6, DB4, DB7).

Covers, fail-before / pass-after where feasible:

  F7  — a NULL-owner ("shared/legacy") endpoint a session points at must NOT be treated as
        removed (which produced an opaque 400 on every turn). It is recognized as present and
        ADOPTED for the creator; cross-user isolation still holds (user B's OWNED endpoint is
        never matched/leaked).
  DB6 — a 0-message, no-model, stale shell session is reaped; the canonical game session is
        NEVER reaped even with 0 messages.
  DB4 — disk usedPct is internally consistent with freeMb (same total-free basis).
  DB7 — the debug-bundle providerConfig surfaces the resolved default endpoint.

Name-agnostic; roles only. Uses the real test DB.
"""
import json

import pytest

import routes.chat_routes as chat_routes
from core.database import SessionLocal, ModelEndpoint, Session as DBSession


@pytest.fixture(autouse=True)
def _clean_db():
    db = SessionLocal()
    try:
        db.query(ModelEndpoint).delete()
        db.commit()
    finally:
        db.close()
    yield
    db = SessionLocal()
    try:
        db.query(ModelEndpoint).delete()
        db.commit()
    finally:
        db.close()


def _seed_endpoint(ep_id, *, base_url="https://openrouter.ai/api/v1", owner=None):
    db = SessionLocal()
    try:
        db.add(ModelEndpoint(
            id=ep_id, name="Provider", base_url=base_url, api_key="k",
            is_enabled=True, model_type="llm",
            cached_models=json.dumps(["deepseek/deepseek-v4-pro"]), owner=owner,
        ))
        db.commit()
    finally:
        db.close()


def _endpoint_owner(ep_id):
    db = SessionLocal()
    try:
        row = db.query(ModelEndpoint).filter(ModelEndpoint.id == ep_id).first()
        return row.owner if row else "MISSING"
    finally:
        db.close()


class _Sess:
    def __init__(self, sid, model="m", endpoint_url=""):
        self.id = sid
        self.model = model
        self.endpoint_url = endpoint_url
        self.headers = {"x": "y"}


# --------------------------------------------------------------------------- #
# F7 — owner=NULL endpoint usable by its creator
# --------------------------------------------------------------------------- #

def test_null_owner_endpoint_is_not_orphaned_and_is_adopted():
    """A session pointing at a NULL-owner (shared/legacy) endpoint is recognized as live, NOT
    cleared, and the endpoint is adopted for the creator (owner stamped). Fails before the fix
    (owner_filter(include_shared=False) excluded the NULL-owner row → cleared → returns True)."""
    _seed_endpoint("ep-shared", owner=None)
    sess = _Sess("s-null", endpoint_url="https://openrouter.ai/api/v1")

    cleared = chat_routes._clear_orphaned_session_endpoint(sess, owner="userA")

    assert cleared is False, "a live shared endpoint must not be treated as orphaned"
    assert sess.model == "m" and sess.endpoint_url, "the session binding must be left intact"
    assert _endpoint_owner("ep-shared") == "userA", "the shared endpoint should be adopted"


def test_own_endpoint_still_recognized():
    """An endpoint already owned by the user is recognized as live (regression guard)."""
    _seed_endpoint("ep-owned", owner="userA")
    sess = _Sess("s-own", endpoint_url="https://openrouter.ai/api/v1")
    assert chat_routes._clear_orphaned_session_endpoint(sess, owner="userA") is False
    assert _endpoint_owner("ep-owned") == "userA"  # unchanged


def test_cross_user_owned_endpoint_is_not_leaked():
    """ISOLATION: user B must NOT see user A's OWNED endpoint. A session of user B pointing at
    user A's owned endpoint is treated as orphaned (cleared), never adopted/leaked."""
    _seed_endpoint("ep-A", owner="userA")
    sess = _Sess("s-B", endpoint_url="https://openrouter.ai/api/v1")

    cleared = chat_routes._clear_orphaned_session_endpoint(sess, owner="userB")

    assert cleared is True, "another user's owned endpoint must read as removed, never reachable"
    assert _endpoint_owner("ep-A") == "userA", "user A's endpoint owner must be untouched"


def test_genuinely_removed_endpoint_still_clears():
    """An endpoint that truly does not exist still clears the session (regression guard)."""
    sess = _Sess("s-gone", endpoint_url="https://nowhere.example/api/v1")
    assert chat_routes._clear_orphaned_session_endpoint(sess, owner="userA") is True
    assert sess.model == "" and sess.endpoint_url == ""


# --------------------------------------------------------------------------- #
# DB6 — orphaned 0-message shell-session reaping
# --------------------------------------------------------------------------- #

def _seed_session(sid, *, owner, model="", message_count=0, age_minutes=0):
    from datetime import datetime, timedelta
    db = SessionLocal()
    try:
        created = datetime.utcnow() - timedelta(minutes=age_minutes)
        db.add(DBSession(
            id=sid, name="shell", endpoint_url="", model=model, owner=owner,
            message_count=message_count, created_at=created, updated_at=created,
        ))
        db.commit()
    finally:
        db.close()


def _session_exists(sid):
    db = SessionLocal()
    try:
        return db.query(DBSession).filter(DBSession.id == sid).first() is not None
    finally:
        db.close()


class _FakeSessionManager:
    """Minimal stand-in: deletes via the real DB so the reaper's effect is observable."""
    def delete_session(self, sid):
        db = SessionLocal()
        try:
            row = db.query(DBSession).filter(DBSession.id == sid).first()
            if row:
                db.delete(row)
                db.commit()
                return True
            return False
        finally:
            db.close()


@pytest.fixture(autouse=True)
def _clean_sessions():
    db = SessionLocal()
    try:
        db.query(DBSession).delete()
        db.commit()
    finally:
        db.close()
    yield
    db = SessionLocal()
    try:
        db.query(DBSession).delete()
        db.commit()
    finally:
        db.close()


def test_reaps_stale_zero_message_shell(monkeypatch):
    monkeypatch.setattr(
        "src.orwell_game_session.get_game_session", lambda owner: None, raising=True
    )
    _seed_session("shell-old", owner="userA", model="", message_count=0, age_minutes=120)
    reaped = chat_routes._reap_orphaned_shell_sessions(_FakeSessionManager(), "userA")
    assert reaped == 1
    assert not _session_exists("shell-old")


def test_does_not_reap_fresh_shell(monkeypatch):
    """A just-opened (mid-setup) shell is younger than the cutoff — never reaped."""
    monkeypatch.setattr(
        "src.orwell_game_session.get_game_session", lambda owner: None, raising=True
    )
    _seed_session("shell-fresh", owner="userA", model="", message_count=0, age_minutes=1)
    reaped = chat_routes._reap_orphaned_shell_sessions(_FakeSessionManager(), "userA")
    assert reaped == 0
    assert _session_exists("shell-fresh")


def test_never_reaps_canonical_session(monkeypatch):
    """The live game's canonical session is NEVER reaped, even at 0 messages / no model."""
    monkeypatch.setattr(
        "src.orwell_game_session.get_game_session", lambda owner: "canon-1", raising=True
    )
    _seed_session("canon-1", owner="userA", model="", message_count=0, age_minutes=999)
    reaped = chat_routes._reap_orphaned_shell_sessions(_FakeSessionManager(), "userA")
    assert reaped == 0
    assert _session_exists("canon-1")


def test_does_not_reap_session_with_model(monkeypatch):
    """A configured session (model bound) is a real chat the user set up — not a shell."""
    monkeypatch.setattr(
        "src.orwell_game_session.get_game_session", lambda owner: None, raising=True
    )
    _seed_session("has-model", owner="userA", model="some/model", message_count=0, age_minutes=120)
    reaped = chat_routes._reap_orphaned_shell_sessions(_FakeSessionManager(), "userA")
    assert reaped == 0
    assert _session_exists("has-model")


def test_reaper_owner_scoped(monkeypatch):
    """ISOLATION: reaping for userA must never touch userB's sessions."""
    monkeypatch.setattr(
        "src.orwell_game_session.get_game_session", lambda owner: None, raising=True
    )
    _seed_session("a-shell", owner="userA", model="", message_count=0, age_minutes=120)
    _seed_session("b-shell", owner="userB", model="", message_count=0, age_minutes=120)
    chat_routes._reap_orphaned_shell_sessions(_FakeSessionManager(), "userA")
    assert not _session_exists("a-shell")
    assert _session_exists("b-shell")


# --------------------------------------------------------------------------- #
# DB4 — disk usedPct internally consistent with freeMb
# --------------------------------------------------------------------------- #

def test_disk_usedpct_consistent_with_freemb():
    import routes.admin_health_routes as ahr
    info = ahr._system_info()
    disk = info.get("disk")
    assert isinstance(disk, dict)
    total = disk["totalMb"]
    free = disk["freeMb"]
    pct = disk["usedPct"]
    assert total > 0 and pct is not None
    # usedPct must equal (total - free)/total — the SAME basis as freeMb (DB4).
    expected = round(100 * (total - free) / total, 1)
    assert abs(pct - expected) <= 0.2, f"usedPct {pct} contradicts freeMb-derived {expected}"


# --------------------------------------------------------------------------- #
# DB7 — bundle providerConfig surfaces the resolved default
# --------------------------------------------------------------------------- #

def test_provider_config_surfaces_default(monkeypatch):
    import routes.admin_health_routes as ahr
    _seed_endpoint("ep-default", owner=None)
    monkeypatch.setattr(
        "src.settings.load_settings",
        lambda: {"default_endpoint_id": "ep-default", "default_model": "deepseek/deepseek-v4-pro"},
        raising=True,
    )
    cfg = ahr._provider_config()
    assert cfg.get("defaultEndpointId") == "ep-default"
    assert cfg.get("defaultModel") == "deepseek/deepseek-v4-pro"
    resolved = cfg.get("defaultResolved")
    assert isinstance(resolved, dict) and resolved.get("id") == "ep-default"
    # The default endpoint is flagged in the per-endpoint list.
    flagged = [e for e in cfg["endpoints"] if e.get("isDefault")]
    assert len(flagged) == 1 and flagged[0]["id"] == "ep-default"
    # supportsTools key is present per endpoint (NULL = unknown is allowed).
    assert all("supportsTools" in e for e in cfg["endpoints"])
