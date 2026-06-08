"""Feature 0029 — app administrator role & user management (name-agnostic).

"admin" / "user" / "second" are ACCOUNT ROLES, never personal names. Covers the
server-side security logic (the hidden UI is never trusted): first-user-admin +
entitlements, promote/demote with the last-admin guard, the admin-only gate,
self vs admin password reset (with session revoke), and the LLM-settings gate.
"""

import importlib
import os
import types

import pytest
from fastapi import HTTPException

auth_mod = importlib.import_module("core.auth")
mw = importlib.import_module("core.middleware")
AuthManager = auth_mod.AuthManager

ADMIN = "admin"
USER = "user"
SECOND = "second"


@pytest.fixture
def auth(tmp_path):
    return AuthManager(auth_path=os.path.join(str(tmp_path), "auth.json"))


def _fake_request(auth_mgr, username):
    """A minimal Request stand-in for the middleware gates."""
    return types.SimpleNamespace(
        headers={},  # .get(...) -> None (no internal-tool bypass)
        state=types.SimpleNamespace(current_user=username),
        app=types.SimpleNamespace(state=types.SimpleNamespace(auth_manager=auth_mgr)),
    )


# S1 -------------------------------------------------------------------------
def test_first_account_is_administrator_with_entitlements(auth):
    assert auth.setup(ADMIN, "password123") is True
    assert auth.is_admin(ADMIN) is True
    assert auth.has_entitlement(ADMIN, "manage_users") is True
    assert auth.has_entitlement(ADMIN, "manage_llm_settings") is True
    # setup is first-run only — a second setup never creates another admin.
    assert auth.setup(USER, "password123") is False


# S2 -------------------------------------------------------------------------
def test_admin_promotes_and_demotes_other_users(auth):
    auth.setup(ADMIN, "password123")
    auth.create_user(USER, "password123", is_admin=False)
    assert auth.has_entitlement(USER, "manage_users") is False

    assert auth.set_admin(USER, True, ADMIN) is True
    assert auth.is_admin(USER) is True
    assert auth.has_entitlement(USER, "manage_users") is True
    assert auth.has_entitlement(USER, "manage_llm_settings") is True

    assert auth.set_admin(USER, False, ADMIN) is True
    assert auth.is_admin(USER) is False
    assert auth.has_entitlement(USER, "manage_users") is False


def test_non_admin_cannot_change_roles(auth):
    auth.setup(ADMIN, "password123")
    auth.create_user(USER, "password123")
    auth.create_user(SECOND, "password123")
    assert auth.set_admin(SECOND, True, USER) is False  # USER holds no admin power
    assert auth.is_admin(SECOND) is False


# S3 -------------------------------------------------------------------------
def test_last_administrator_cannot_be_demoted_or_deleted(auth):
    auth.setup(ADMIN, "password123")
    with auth._config_lock:
        assert auth._count_admins_locked() == 1

    assert auth.set_admin(ADMIN, False, ADMIN) is False  # would remove the last admin
    assert auth.is_admin(ADMIN) is True
    assert auth.delete_user(ADMIN, ADMIN) is False  # refused — at least one admin remains
    assert ADMIN in auth.users

    # With a second admin present, the first CAN be demoted (one still remains).
    auth.create_user(SECOND, "password123", is_admin=True)
    assert auth.set_admin(ADMIN, False, SECOND) is True
    assert auth.is_admin(ADMIN) is False
    with auth._config_lock:
        assert auth._count_admins_locked() == 1


# S4 -------------------------------------------------------------------------
def test_user_management_gate_is_enforced_server_side(auth, monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "true")
    auth.setup(ADMIN, "password123")
    auth.create_user(USER, "password123")

    for gate in (lambda r: mw.require_admin(r), lambda r: mw.require_entitlement(r, "manage_users")):
        with pytest.raises(HTTPException) as exc:
            gate(_fake_request(auth, USER))
        assert exc.value.status_code == 403

    # An administrator passes both gates without raising.
    mw.require_admin(_fake_request(auth, ADMIN))
    mw.require_entitlement(_fake_request(auth, ADMIN), "manage_users")


# S5 -------------------------------------------------------------------------
def test_any_user_changes_their_own_password(auth):
    auth.setup(ADMIN, "password123")
    auth.create_user(USER, "oldpassword")
    assert auth.change_password(USER, "wrongpassword", "newpassword") is False  # needs the current one
    assert auth.change_password(USER, "oldpassword", "newpassword") is True
    assert auth.verify_password(USER, "newpassword") is True


# S6 -------------------------------------------------------------------------
def test_admin_resets_another_password_without_current_and_revokes_sessions(auth):
    auth.setup(ADMIN, "password123")
    auth.create_user(USER, "oldpassword")
    token = auth.create_session_trusted(USER)
    assert auth.validate_token(token) is True

    # A non-admin cannot reset someone else's password.
    auth.create_user(SECOND, "password123")
    assert auth.admin_reset_password(USER, "hijacked123", SECOND) is False

    # The admin resets it WITHOUT the current password...
    assert auth.admin_reset_password(USER, "resetpass123", ADMIN) is True
    assert auth.verify_password(USER, "resetpass123") is True
    # ...and the target's active sessions are revoked.
    assert auth.validate_token(token) is False


# S7 -------------------------------------------------------------------------
def test_changing_global_llm_settings_requires_the_entitlement(auth, monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "true")
    auth.setup(ADMIN, "password123")
    auth.create_user(USER, "password123")

    assert auth.has_entitlement(ADMIN, "manage_llm_settings") is True
    assert auth.has_entitlement(USER, "manage_llm_settings") is False
    assert auth.has_entitlement(ADMIN, "not_a_real_entitlement") is False  # unknown is never granted

    with pytest.raises(HTTPException) as exc:
        mw.require_entitlement(_fake_request(auth, USER), "manage_llm_settings")
    assert exc.value.status_code == 403
    mw.require_entitlement(_fake_request(auth, ADMIN), "manage_llm_settings")  # admin can
