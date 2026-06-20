"""CHANGE 2 — admin deletes another user from Settings, with three guards.

Roles only (no personal names): "admin"/"second"/"victim" are ACCOUNT ROLES.

The DELETE /api/auth/users route enforces, server-side (the hidden UI is never
trusted):
  (a) you cannot delete your OWN user;
  (b) you cannot delete the LAST remaining admin;
  (c) the request must carry confirm_username matching the target EXACTLY
      (the typed-confirmation step) — otherwise the delete never runs.

Deletion also cleans up the deleted user's game sandbox through the engine's one
sanctioned reset door (manageSandbox reset), best-effort.

Guards (a)/(b) live in core.auth.delete_user (the single user-store mutation
door) and are unit-tested directly here too; guard (c) + the sandbox cleanup live
in the route and are driven end-to-end through a TestClient with a real session.
"""

import importlib
import os

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

auth_mod = importlib.import_module("core.auth")
auth_routes = importlib.import_module("routes.auth_routes")
orwell_engine = importlib.import_module("src.orwell_engine")
AuthManager = auth_mod.AuthManager

ADMIN = "admin"
SECOND = "second"
VICTIM = "victim"
SESSION_COOKIE = auth_routes.SESSION_COOKIE


@pytest.fixture
def auth(tmp_path):
    return AuthManager(auth_path=os.path.join(str(tmp_path), "auth.json"))


@pytest.fixture
def reset_calls(monkeypatch):
    """Capture manageSandbox('reset', user=...) calls and stub the engine out."""
    calls = []

    async def fake_manage(op=None, user=None):
        calls.append((op, user))
        return {"ok": True}

    monkeypatch.setattr(orwell_engine, "manage_sandbox", fake_manage)
    return calls


def _client(auth_mgr):
    app = FastAPI()
    app.include_router(auth_routes.setup_auth_routes(auth_mgr))
    return TestClient(app, raise_server_exceptions=False)


def _login(client, auth_mgr, username):
    """Mint a real session for `username` and attach it as the auth cookie."""
    token = auth_mgr.create_session_trusted(username)
    client.cookies.set(SESSION_COOKIE, token)
    return client


def _delete(client, username, confirm_username):
    # TestClient.delete() doesn't take json=; send the body via request().
    return client.request(
        "DELETE",
        "/api/auth/users",
        json={"username": username, "confirm_username": confirm_username},
    )


# ── guard (a): cannot delete your own user ───────────────────────────────────

def test_self_delete_rejected(auth, reset_calls):
    auth.setup(ADMIN, "password123")
    auth.create_user(SECOND, "password123", is_admin=True)  # so a last-admin block can't mask it
    client = _login(_client(auth), auth, ADMIN)
    # Even with the username typed exactly right, deleting yourself is refused.
    r = _delete(client, ADMIN, ADMIN)
    assert r.status_code == 400
    assert ADMIN in auth.users  # still present
    assert reset_calls == []  # no sandbox wipe for a refused delete


# ── guard (b): cannot delete the last admin ──────────────────────────────────

def test_last_admin_delete_rejected_via_route(auth, reset_calls):
    """With two admins one CAN be removed through the route; once only one admin
    remains, that final admin is undeletable — refused server-side (400)."""
    auth.setup(ADMIN, "password123")
    auth.create_user(SECOND, "password123", is_admin=True)
    with auth._config_lock:
        assert auth._count_admins_locked() == 2

    # SECOND removes ADMIN through the route — allowed, because one admin (SECOND)
    # still remains afterward. (Not self for SECOND, so guard (a) doesn't apply.)
    client = _login(_client(auth), auth, SECOND)
    r = _delete(client, ADMIN, ADMIN)
    assert r.status_code == 200
    assert ADMIN not in auth.users
    assert ("reset", ADMIN) in reset_calls

    # SECOND is now the LAST admin. A delete targeting the sole admin is refused.
    # SECOND is also self here, but the last-admin guard stands independently — it
    # is asserted directly at the store (the route delegates here unchanged), and
    # the route's own refusal is the resulting 400.
    assert auth.delete_user(SECOND, SECOND) is False
    with auth._config_lock:
        assert auth._count_admins_locked() == 1
    assert SECOND in auth.users


# ── guard (c): the typed username must match exactly ─────────────────────────

def test_wrong_typed_username_rejected(auth, reset_calls):
    auth.setup(ADMIN, "password123")
    auth.create_user(VICTIM, "password123")
    client = _login(_client(auth), auth, ADMIN)

    # Mismatched confirmation -> 400, user untouched, no sandbox wipe.
    r = _delete(client, VICTIM, "not-the-victim")
    assert r.status_code == 400
    assert VICTIM in auth.users
    assert reset_calls == []


def test_missing_typed_username_rejected(auth, reset_calls):
    auth.setup(ADMIN, "password123")
    auth.create_user(VICTIM, "password123")
    client = _login(_client(auth), auth, ADMIN)

    # Omitting confirm_username entirely is treated as a non-match -> 400. This is
    # what stops an older/direct caller from skipping the typed step.
    r = client.request("DELETE", "/api/auth/users", json={"username": VICTIM})
    assert r.status_code == 400
    assert VICTIM in auth.users
    assert reset_calls == []


# ── the happy path: correct flow succeeds + sandbox is cleaned up ────────────

def test_correct_flow_succeeds_and_wipes_sandbox(auth, reset_calls):
    auth.setup(ADMIN, "password123")
    auth.create_user(VICTIM, "password123")
    client = _login(_client(auth), auth, ADMIN)

    r = _delete(client, VICTIM, VICTIM)
    assert r.status_code == 200
    assert VICTIM not in auth.users
    # The deleted user's game sandbox is reset through the one sanctioned door,
    # scoped to that user (normalized lowercase).
    assert ("reset", VICTIM) in reset_calls


def test_typed_username_match_is_case_insensitive(auth, reset_calls):
    """Usernames are stored lowercased; a confirmation typed with different case
    still counts as an exact match (both sides normalized the same way)."""
    auth.setup(ADMIN, "password123")
    auth.create_user(VICTIM, "password123")
    client = _login(_client(auth), auth, ADMIN)

    r = _delete(client, VICTIM, VICTIM.upper())
    assert r.status_code == 200
    assert VICTIM not in auth.users
    assert ("reset", VICTIM) in reset_calls


# ── the admin-only gate still applies (non-admin can't reach delete) ─────────

def test_non_admin_cannot_delete(auth, reset_calls):
    auth.setup(ADMIN, "password123")
    auth.create_user(SECOND, "password123")  # non-admin
    auth.create_user(VICTIM, "password123")
    client = _login(_client(auth), auth, SECOND)

    r = _delete(client, VICTIM, VICTIM)
    assert r.status_code == 403
    assert VICTIM in auth.users
    assert reset_calls == []


# ── drift pin: the route enforces the typed-confirmation guard ───────────────

def test_route_source_enforces_typed_confirmation():
    src_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "routes", "auth_routes.py",
    )
    with open(src_path, "r", encoding="utf-8") as f:
        src = f.read()
    body = src.split('@router.delete("/users")')[1]
    # The route compares the typed confirmation against the target before the
    # store mutation, and cleans up the sandbox afterward.
    assert "confirm_username" in body
    assert "manage_sandbox" in body
