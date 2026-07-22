"""G3 (2026-07-22 whole-repo gap audit) — the generated-image cross-user ownership check must fail
CLOSED, not open.

`serve_generated_image` (frontend/app.py) resolves ownership via a gallery-row DB lookup before
serving image bytes. On any unexpected error while resolving that ownership (get_current_user,
SessionLocal(), or the ORM query itself — e.g. a SQLite "database is locked" contention error), the
handler used to fall through a bare `except Exception: pass` and serve the file bytes
UNCONDITIONALLY — the failure path was MORE permissive than the success path, a silent violation of
the cross-user isolation guarantee CLAUDE.md calls "a first-class guarantee... alongside the Vault
Wall." This pins the fix: an ownership-check exception now (1) refuses the request — the image is
NEVER served, (2) logs at WARNING, (3) fires a RED-eligible soft-failure event (#1599 —
`record_soft_failure`, visible on /admin/status); the happy path (no error, matching or absent
owner) is unchanged, and an ordinary (non-error) ownership MISMATCH still refuses without alarming
(an expected denial is not a failure).

Calls the route handler DIRECTLY (not through TestClient/AuthMiddleware) — the security boundary
under test is the handler's own ownership try/except, independent of whichever auth layer resolved
`request.state.current_user` upstream, so a bare `Request` + a monkeypatched `get_current_user` is
the precise unit under test.

Roles only — every identifier here is a generic probe ("playerA"/"someoneElse"), never cast
material.
"""
import asyncio
import importlib

import pytest
from fastapi import HTTPException
from fastapi.responses import FileResponse
from starlette.requests import Request

log_rings = importlib.import_module("src.log_rings")
auth_helpers = importlib.import_module("src.auth_helpers")
database = importlib.import_module("core.database")
app_mod = importlib.import_module("app")


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _request() -> Request:
    return Request(scope={"type": "http", "headers": [], "method": "GET", "path": "/x"})


def _clear_overseer():
    log_rings.OVERSEER.buf.clear()


def _ownership_failure_hits():
    _, lines = log_rings.OVERSEER.since(0, limit=100000)
    return [e for e in lines if e.get("kind") == "image:ownership-check-failed"]


class _Row:
    def __init__(self, owner):
        self.owner = owner


class _FakeQuery:
    def __init__(self, row):
        self._row = row

    def filter(self, *a, **k):
        return self

    def first(self):
        return self._row


class _FakeDB:
    def __init__(self, row=None, raise_on_query=False):
        self._row = row
        self._raise_on_query = raise_on_query
        self.closed = False

    def query(self, model):
        if self._raise_on_query:
            raise RuntimeError("simulated DB contention (e.g. 'database is locked')")
        return _FakeQuery(self._row)

    def close(self):
        self.closed = True


@pytest.fixture()
def real_image(tmp_path, monkeypatch):
    """A real file on disk behind a schema-valid filename. `resolve_generated_image_path` is
    monkeypatched to hand it back directly, so the test never touches the real on-disk
    generated-images directory."""
    img = tmp_path / "deadbeefcafe0123.png"
    img.write_bytes(b"fake-png-bytes")
    monkeypatch.setattr(app_mod, "resolve_generated_image_path", lambda filename: img)
    return img.name


def _serve(filename):
    return _run(app_mod.serve_generated_image(filename, _request()))


# ── the exception paths must fail CLOSED ──────────────────────────────────────────────────────

def test_get_current_user_exception_fails_closed(monkeypatch, real_image):
    _clear_overseer()

    def _boom(request):
        raise RuntimeError("simulated get_current_user failure")

    monkeypatch.setattr(auth_helpers, "get_current_user", _boom)
    with pytest.raises(HTTPException) as ei:
        _serve(real_image)
    assert ei.value.status_code == 404, "an ownership-check exception must refuse the request, not serve the image"
    hits = _ownership_failure_hits()
    assert hits, "the ownership-check exception must fire a RED-eligible soft-failure event"
    assert hits[-1]["ok"] is False


def test_db_session_construction_exception_fails_closed(monkeypatch, real_image):
    _clear_overseer()
    monkeypatch.setattr(auth_helpers, "get_current_user", lambda request: "playerA")

    def _boom():
        raise RuntimeError("simulated SessionLocal() failure")

    monkeypatch.setattr(database, "SessionLocal", _boom)
    with pytest.raises(HTTPException) as ei:
        _serve(real_image)
    assert ei.value.status_code == 404
    assert _ownership_failure_hits()


def test_orm_query_exception_fails_closed(monkeypatch, real_image):
    _clear_overseer()
    monkeypatch.setattr(auth_helpers, "get_current_user", lambda request: "playerA")
    monkeypatch.setattr(database, "SessionLocal", lambda: _FakeDB(raise_on_query=True))
    with pytest.raises(HTTPException) as ei:
        _serve(real_image)
    assert ei.value.status_code == 404
    hits = _ownership_failure_hits()
    assert hits, "an ORM query error while checking ownership must fail closed and alarm"


# ── the happy path must stay unchanged ────────────────────────────────────────────────────────

def test_happy_path_no_gallery_row_still_serves(monkeypatch, real_image):
    """A generated-but-not-yet-imported image (no gallery row at all) is normal flow, not a
    failure — it must serve, and must NOT fire a soft-failure event."""
    _clear_overseer()
    monkeypatch.setattr(auth_helpers, "get_current_user", lambda request: "playerA")
    monkeypatch.setattr(database, "SessionLocal", lambda: _FakeDB(row=None))
    resp = _serve(real_image)
    assert isinstance(resp, FileResponse)
    assert not _ownership_failure_hits()


def test_happy_path_matching_owner_serves(monkeypatch, real_image):
    _clear_overseer()
    monkeypatch.setattr(auth_helpers, "get_current_user", lambda request: "playerA")
    monkeypatch.setattr(database, "SessionLocal", lambda: _FakeDB(row=_Row(owner="playerA")))
    resp = _serve(real_image)
    assert isinstance(resp, FileResponse)
    assert not _ownership_failure_hits()


def test_happy_path_no_authenticated_user_still_serves(monkeypatch, real_image):
    """No current user resolved at all (e.g. AUTH_ENABLED=false) ⇒ the ownership branch is
    skipped entirely, exactly as before — unaffected by the fail-closed change."""
    _clear_overseer()
    monkeypatch.setattr(auth_helpers, "get_current_user", lambda request: None)
    resp = _serve(real_image)
    assert isinstance(resp, FileResponse)
    assert not _ownership_failure_hits()


def test_ordinary_ownership_mismatch_still_refuses_but_does_not_alarm(monkeypatch, real_image):
    """The pre-existing (non-error) ownership-mismatch branch is unchanged: a 404 refusal — but
    since nothing actually WENT WRONG (the check ran fine and correctly denied), it must NOT fire
    the soft-failure event (an expected denial is not a failure, per the #1599 owner ruling)."""
    _clear_overseer()
    monkeypatch.setattr(auth_helpers, "get_current_user", lambda request: "playerA")
    monkeypatch.setattr(database, "SessionLocal", lambda: _FakeDB(row=_Row(owner="someoneElse")))
    with pytest.raises(HTTPException) as ei:
        _serve(real_image)
    assert ei.value.status_code == 404
    assert not _ownership_failure_hits()
